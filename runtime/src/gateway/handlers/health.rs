use axum::{extract::State, response::Json};
use serde_json::{json, Value};

use crate::gateway::state::AppState;

/// GET /health — Health check endpoint.
pub async fn health_check(State(state): State<AppState>) -> Json<Value> {
    let uptime = state.start_time.elapsed().as_secs();

    let all_apps = state.registry.all().await;
    let mut apps_status = serde_json::Map::new();
    for entry in &all_apps {
        apps_status.insert(
            entry.manifest.app.slug.clone(),
            json!({
                "state": entry.state.to_string(),
                "name": entry.manifest.app.name,
                "version": entry.manifest.app.version,
            }),
        );
    }

    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": uptime,
        "apps": apps_status,
    }))
}
