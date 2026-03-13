//! Desktop environment API handlers.
//!
//! Routes:
//!   GET  /api/desktop/preferences       — All user preferences
//!   PUT  /api/desktop/preferences/{key}  — Set a preference
//!   GET  /api/desktop/themes             — Available themes
//!   GET  /api/desktop/wallpapers         — Available wallpapers

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;

use crate::gateway::state::AppState;
use crate::session::Session;

/// GET /api/desktop/preferences — all preferences for the current user.
pub async fn get_preferences(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
) -> Response {
    let session = match session {
        Some(axum::Extension(s)) => s,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "not_authenticated"}))).into_response(),
    };
    let store = match &state.preference_store {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "storage_unavailable"}))).into_response(),
    };

    match store.get_all(&session.user_id) {
        Ok(prefs) => Json(json!({"ok": true, "preferences": prefs})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

/// PUT /api/desktop/preferences/{key} — set a single preference.
pub async fn set_preference(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
    Path(key): Path<String>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Response {
    let session = match session {
        Some(axum::Extension(s)) => s,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "not_authenticated"}))).into_response(),
    };
    let store = match &state.preference_store {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "storage_unavailable"}))).into_response(),
    };

    let value = match body.get("value").and_then(|v| v.as_str()) {
        Some(v) => v.to_string(),
        None => {
            // Accept raw JSON value as string
            match body.get("value") {
                Some(v) => v.to_string(),
                None => return (StatusCode::BAD_REQUEST, Json(json!({"error": "missing 'value' field"}))).into_response(),
            }
        }
    };

    match store.set(&session.user_id, &key, &value) {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

/// GET /api/desktop/themes — list available themes.
pub async fn list_themes() -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "themes": [
            {"id": "catppuccin-mocha", "name": "Catppuccin Mocha", "variant": "dark"},
            {"id": "catppuccin-latte", "name": "Catppuccin Latte", "variant": "light"},
            {"id": "nord", "name": "Nord", "variant": "dark"},
            {"id": "dracula", "name": "Dracula", "variant": "dark"},
            {"id": "tokyo-night", "name": "Tokyo Night", "variant": "dark"},
            {"id": "gruvbox-dark", "name": "Gruvbox Dark", "variant": "dark"},
            {"id": "solarized-dark", "name": "Solarized Dark", "variant": "dark"},
            {"id": "solarized-light", "name": "Solarized Light", "variant": "light"},
        ]
    }))
}

/// GET /api/desktop/wallpapers — list available wallpapers from the wallpapers directory.
pub async fn list_wallpapers(
    State(state): State<AppState>,
) -> Response {
    let wallpapers_dir = &state.config.desktop.wallpapers_dir;
    let dir = std::path::Path::new(wallpapers_dir);

    if !dir.exists() {
        return Json(json!({"ok": true, "wallpapers": []})).into_response();
    }

    let mut wallpapers = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if matches!(ext.to_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp" | "svg") {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        wallpapers.push(json!({
                            "name": name,
                            "url": format!("/static/wallpapers/{}", name),
                        }));
                    }
                }
            }
        }
    }

    Json(json!({"ok": true, "wallpapers": wallpapers})).into_response()
}
