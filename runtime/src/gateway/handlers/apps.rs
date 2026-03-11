use axum::{
    extract::State,
    response::{Html, Json},
};
use serde_json::{json, Value};

use crate::gateway::state::AppState;
use crate::registry::AppState as RegistryAppState;
use crate::session::Session;

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
            "state": entry.state.to_string(),
            "icon": format!("/{}/static/icon.svg", entry.manifest.app.slug),
        })
    }).collect();

    Json(json!(apps_json))
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
