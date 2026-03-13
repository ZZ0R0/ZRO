//! Notification API handlers.
//!
//! Routes:
//!   GET    /api/notifications           — List notifications (?all=true for all)
//!   POST   /api/notifications/{id}/read — Mark as read
//!   POST   /api/notifications/read-all  — Mark all as read
//!   DELETE /api/notifications/{id}      — Delete a notification

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::gateway::state::AppState;
use crate::session::Session;

#[derive(Deserialize)]
pub struct NotificationQuery {
    #[serde(default)]
    pub all: Option<bool>,
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 { 100 }

/// GET /api/notifications
pub async fn list_notifications(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
    Query(query): Query<NotificationQuery>,
) -> Response {
    let session = match session {
        Some(axum::Extension(s)) => s,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "not_authenticated"}))).into_response(),
    };
    let store = match &state.notification_store {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "storage_unavailable"}))).into_response(),
    };

    let unread_only = !query.all.unwrap_or(false);
    match store.get(&session.user_id, unread_only, query.limit) {
        Ok(notifs) => {
            let count = store.count_unread(&session.user_id).unwrap_or(0);
            Json(json!({"ok": true, "notifications": notifs, "unread_count": count})).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

/// POST /api/notifications/{id}/read
pub async fn mark_read(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
    Path(id): Path<String>,
) -> Response {
    let session = match session {
        Some(axum::Extension(s)) => s,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "not_authenticated"}))).into_response(),
    };
    let store = match &state.notification_store {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "storage_unavailable"}))).into_response(),
    };

    match store.mark_read(&id, &session.user_id) {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

/// POST /api/notifications/read-all
pub async fn mark_all_read(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
) -> Response {
    let session = match session {
        Some(axum::Extension(s)) => s,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "not_authenticated"}))).into_response(),
    };
    let store = match &state.notification_store {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "storage_unavailable"}))).into_response(),
    };

    match store.mark_all_read(&session.user_id) {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}

/// DELETE /api/notifications/{id}
pub async fn delete_notification(
    State(state): State<AppState>,
    session: Option<axum::Extension<Session>>,
    Path(id): Path<String>,
) -> Response {
    let session = match session {
        Some(axum::Extension(s)) => s,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error": "not_authenticated"}))).into_response(),
    };
    let store = match &state.notification_store {
        Some(s) => s,
        None => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": "storage_unavailable"}))).into_response(),
    };

    match store.delete(&id, &session.user_id) {
        Ok(()) => Json(json!({"ok": true})).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))).into_response(),
    }
}
