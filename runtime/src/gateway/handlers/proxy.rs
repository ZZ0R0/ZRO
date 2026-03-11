use std::collections::HashMap;
use std::time::Duration;

use axum::{
    extract::{Path as AxumPath, State, Request},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use base64::Engine;

use zro_protocol::messages::*;
use zro_protocol::constants::HTTP_REQUEST_TIMEOUT_SECS;

use crate::gateway::state::AppState;
use crate::session::Session;
use crate::registry::AppState as RegistryAppState;

/// ANY /{slug}/api/{*path} — Proxy API requests to app backends via IPC.
pub async fn proxy_api(
    State(state): State<AppState>,
    AxumPath((slug, api_path)): AxumPath<(String, String)>,
    req: Request,
) -> Response {
    proxy_api_inner(state, slug, api_path, req).await
}

/// ANY /{slug}/{instance_id}/api/{*path} — Same as proxy_api but with instance path.
pub async fn proxy_instance_api(
    State(state): State<AppState>,
    AxumPath((slug, _instance_id, api_path)): AxumPath<(String, String, String)>,
    req: Request,
) -> Response {
    proxy_api_inner(state, slug, api_path, req).await
}

/// Shared implementation for API proxy.
async fn proxy_api_inner(
    state: AppState,
    slug: String,
    api_path: String,
    req: Request,
) -> Response {
    // Look up the app
    let entry = match state.registry.get_by_slug(&slug).await {
        Some(e) => e,
        None => return (StatusCode::NOT_FOUND, "App not found").into_response(),
    };

    if entry.state != RegistryAppState::Running {
        return (StatusCode::SERVICE_UNAVAILABLE, "App not running").into_response();
    }

    // Extract session from extensions
    let session = match req.extensions().get::<Session>() {
        Some(s) => s.to_session_info(),
        None => return (StatusCode::UNAUTHORIZED, "No session").into_response(),
    };

    let method = req.method().to_string();
    let query_string = req.uri().query().unwrap_or("");
    let query: HashMap<String, String> = query_string
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            Some((
                parts.next()?.to_string(),
                parts.next().unwrap_or("").to_string(),
            ))
        })
        .collect();

    let mut headers_map = HashMap::new();
    for (key, value) in req.headers() {
        if let Ok(v) = value.to_str() {
            headers_map.insert(key.as_str().to_string(), v.to_string());
        }
    }

    // Read body
    let body_bytes = match axum::body::to_bytes(req.into_body(), 16 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "Failed to read body").into_response(),
    };

    let body_b64 = if body_bytes.is_empty() {
        None
    } else {
        Some(base64::engine::general_purpose::STANDARD.encode(&body_bytes))
    };

    let payload = HttpRequestPayload {
        method,
        path: format!("/api/{}", api_path),
        headers: headers_map,
        query,
        body: body_b64,
        session,
    };

    let ipc_msg = IpcMessage::new("HttpRequest", serde_json::to_value(&payload).unwrap());

    // Send request and wait for response (use slug as IPC key)
    let response = match state.ipc_router.send_request(
        &slug,
        ipc_msg,
        Duration::from_secs(HTTP_REQUEST_TIMEOUT_SECS),
    ).await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!(slug = slug, "API proxy error: {}", e);
            return (StatusCode::BAD_GATEWAY, format!("Backend error: {}", e)).into_response();
        }
    };

    // Parse the response
    let resp_payload: HttpResponsePayload = match serde_json::from_value(response.payload) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to parse backend response: {}", e);
            return (StatusCode::BAD_GATEWAY, "Invalid backend response").into_response();
        }
    };

    // Build HTTP response
    let status = StatusCode::from_u16(resp_payload.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    let body = match resp_payload.body {
        Some(b64) => base64::engine::general_purpose::STANDARD.decode(&b64).unwrap_or_default(),
        None => Vec::new(),
    };

    let mut response = (status, body).into_response();

    for (key, value) in &resp_payload.headers {
        if let (Ok(name), Ok(val)) = (
            header::HeaderName::try_from(key.as_str()),
            header::HeaderValue::from_str(value),
        ) {
            response.headers_mut().insert(name, val);
        }
    }

    response
}
