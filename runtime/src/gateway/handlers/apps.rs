use axum::{
    extract::{Path, Query, State},
    response::{Html, Json},
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::gateway::state::AppState;
use crate::registry::{self, AppState as RegistryAppState};
use crate::session::Session;
use crate::supervisor;

/// GET /apps — List available applications (JSON or HTML).
pub async fn app_list(State(state): State<AppState>) -> Html<String> {
    let all_apps = state.registry.all().await;

    Html(launcher_html(&all_apps))
}

/// GET /api/apps — JSON API variant. Filters by permissions if a session is present.
pub async fn app_list_json(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
) -> Json<Value> {
    let all_apps = state.registry.all().await;

    let apps_json: Vec<Value> = all_apps.iter().filter(|entry| {
        // If we have a session, filter by permissions
        if let Some(axum::Extension(ref s)) = session {
            state.permissions.can_access(
                &s.username,
                &s.role,
                &s.groups,
                &entry.manifest.app.slug,
            )
        } else {
            true // No session (shouldn't happen behind auth middleware) → show all
        }
    }).map(|entry| {
        json!({
            "slug": entry.manifest.app.slug,
            "name": entry.manifest.app.name,
            "version": entry.manifest.app.version,
            "description": entry.manifest.app.description,
            "category": entry.manifest.app.category.to_string(),
            "state": entry.state.to_string(),
            "icon": format!("/{}/static/icon.svg", entry.manifest.app.slug),
        })
    }).collect();

    Json(json!(apps_json))
}

#[derive(Deserialize)]
pub struct RegisterAppRequest {
    pub slug: String,
}

/// POST /api/apps/register — Dynamically register and start a new app. Admin only.
pub async fn register_app_handler(
    State(state): State<AppState>,
    axum::Extension(session): axum::Extension<Session>,
    Json(body): Json<RegisterAppRequest>,
) -> Json<Value> {
    if session.role != "admin" {
        return Json(json!({ "error": "admin role required" }));
    }

    let slug = &body.slug;

    // Load manifest from the apps directory
    let manifest = match registry::load_single_manifest(&state.config.apps.manifest_dir, slug) {
        Ok(m) => m,
        Err(e) => return Json(json!({ "error": format!("failed to load manifest: {}", e) })),
    };

    // Register in the registry
    if !state.registry.register_app(manifest).await {
        return Json(json!({ "error": format!("app '{}' is already registered", slug) }));
    }

    // Start the backend
    if let Err(e) = supervisor::start_single_backend(state.clone(), slug).await {
        // Roll back registration on failure
        state.registry.unregister_app(slug).await;
        return Json(json!({ "error": format!("failed to start backend: {}", e) }));
    }

    Json(json!({ "status": "ok", "slug": slug, "message": format!("app '{}' registered and started", slug) }))
}

/// POST /api/apps/{slug}/unregister — Stop and unregister an app. Admin only.
pub async fn unregister_app_handler(
    State(state): State<AppState>,
    axum::Extension(session): axum::Extension<Session>,
    Path(slug): Path<String>,
) -> Json<Value> {
    if session.role != "admin" {
        return Json(json!({ "error": "admin role required" }));
    }

    // Check the app exists
    if state.registry.get_by_slug(&slug).await.is_none() {
        return Json(json!({ "error": format!("app '{}' not found", slug) }));
    }

    // Stop the backend
    if let Err(e) = supervisor::stop_single_backend(&state, &slug).await {
        tracing::warn!(slug = %slug, "Error during backend stop: {}", e);
    }

    // Unregister from the registry
    state.registry.unregister_app(&slug).await;

    Json(json!({ "status": "ok", "slug": slug, "message": format!("app '{}' unregistered", slug) }))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

/// GET /api/apps/metadata — Enriched app list with categories, icons, keywords, MIME types.
pub async fn app_metadata(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
    Query(query): Query<SearchQuery>,
) -> Json<Value> {
    // If a search query is provided, use search_apps
    if let Some(ref q) = query.q {
        if !q.is_empty() {
            let results = state.registry.search_apps(q).await;
            let metadata: Vec<Value> = filter_by_session(&state, &session, &results)
                .into_iter()
                .map(|e| entry_to_metadata(&e))
                .collect();
            return Json(json!({"ok": true, "apps": metadata}));
        }
    }

    // If a category filter is provided
    if let Some(ref cat) = query.category {
        if let Some(category) = parse_category(cat) {
            let results = state.registry.apps_in_category(&category).await;
            let metadata: Vec<Value> = filter_by_session(&state, &session, &results)
                .into_iter()
                .map(|e| entry_to_metadata(&e))
                .collect();
            return Json(json!({"ok": true, "apps": metadata}));
        }
    }

    // Default: return all metadata
    let all_meta = state.registry.all_app_metadata().await;
    Json(json!({"ok": true, "apps": all_meta}))
}

/// GET /api/apps/for-mime/{type}/{subtype} — Apps that can handle a MIME type.
pub async fn apps_for_mime(
    State(state): State<AppState>,
    Path((mime_type, mime_subtype)): Path<(String, String)>,
) -> Json<Value> {
    let full_mime = format!("{}/{}", mime_type, mime_subtype);
    let apps = state.registry.apps_for_mime(&full_mime).await;
    let metadata: Vec<Value> = apps.iter().map(|e| entry_to_metadata(e)).collect();
    Json(json!({"ok": true, "mime": full_mime, "apps": metadata}))
}

fn entry_to_metadata(entry: &registry::AppEntry) -> Value {
    let app = &entry.manifest.app;
    json!({
        "slug": app.slug,
        "name": app.name,
        "version": app.version,
        "description": app.description,
        "icon": app.icon,
        "category": app.category.to_string(),
        "keywords": app.keywords,
        "mime_types": app.mime_types,
        "single_instance": app.single_instance,
        "state": entry.state.to_string(),
    })
}

fn filter_by_session(
    state: &AppState,
    session: &Option<axum::Extension<Session>>,
    entries: &[registry::AppEntry],
) -> Vec<registry::AppEntry> {
    entries.iter().filter(|entry| {
        if let Some(axum::Extension(ref s)) = session {
            state.permissions.can_access(&s.username, &s.role, &s.groups, &entry.manifest.app.slug)
        } else {
            true
        }
    }).cloned().collect()
}

fn parse_category(s: &str) -> Option<zro_protocol::manifest::AppCategory> {
    use zro_protocol::manifest::AppCategory;
    match s.to_lowercase().as_str() {
        "system" => Some(AppCategory::System),
        "tools" => Some(AppCategory::Tools),
        "internet" => Some(AppCategory::Internet),
        "multimedia" => Some(AppCategory::Multimedia),
        "productivity" => Some(AppCategory::Productivity),
        "other" => Some(AppCategory::Other),
        _ => None,
    }
}

fn launcher_html(apps: &[crate::registry::AppEntry]) -> String {
    let mut app_cards = String::new();
    for entry in apps {
        let slug = &entry.manifest.app.slug;
        let name = &entry.manifest.app.name;
        let desc = &entry.manifest.app.description;
        let state_class = if entry.state == RegistryAppState::Running { "running" } else { "offline" };
        app_cards.push_str(&format!(
            r#"<a href="/{slug}/" class="app-card {state_class}">
                <div class="app-icon">
                    <img src="/{slug}/static/icon.svg" alt="{name}" onerror="this.style.display='none'">
                </div>
                <div class="app-info">
                    <span class="app-name">{name}</span>
                    <span class="app-desc">{desc}</span>
                </div>
                <span class="app-state">{state_class}</span>
            </a>"#
        ));
    }

    format!(r##"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>zro — Apps</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f1117;
            color: #e4e4e7;
            padding: 2rem;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
        }}
        h1 {{ font-size: 1.5rem; }}
        h1 span {{ color: #6366f1; }}
        .logout {{ color: #a1a1aa; text-decoration: none; font-size: 0.875rem; }}
        .logout:hover {{ color: #ef4444; }}
        .apps-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1rem;
        }}
        .app-card {{
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1rem;
            background: #1a1b23;
            border: 1px solid #2a2b35;
            border-radius: 8px;
            text-decoration: none;
            color: #e4e4e7;
            transition: border-color 0.2s;
        }}
        .app-card:hover {{ border-color: #6366f1; }}
        .app-card.offline {{ opacity: 0.5; pointer-events: none; }}
        .app-icon {{ width: 40px; height: 40px; flex-shrink: 0; }}
        .app-icon img {{ width: 100%; height: 100%; }}
        .app-info {{ flex: 1; display: flex; flex-direction: column; }}
        .app-name {{ font-weight: 600; }}
        .app-desc {{ font-size: 0.8rem; color: #a1a1aa; }}
        .app-state {{
            font-size: 0.7rem;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            background: #22c55e22;
            color: #22c55e;
        }}
        .offline .app-state {{ background: #ef444422; color: #ef4444; }}
    </style>
</head>
<body>
    <div class="header">
        <h1><span>zro</span> apps</h1>
        <a href="#" class="logout" onclick="fetch('/auth/logout',{{method:'POST'}}).then(()=>location.href='/auth/login')">Logout</a>
    </div>
    <div class="apps-grid">
        {app_cards}
    </div>
</body>
</html>"##)
}
