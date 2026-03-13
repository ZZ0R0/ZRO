use std::path::{Path, PathBuf, Component};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use sha2::{Sha256, Digest};

use crate::config::RuntimeMode;
use crate::gateway::state::AppState;
use crate::session::Session;

/// GET /{slug}/ — Serve the app's index.html (or proxy in dev mode).
pub async fn serve_app_index(
    State(state): State<AppState>,
    AxumPath(slug): AxumPath<String>,
    session: Option<axum::Extension<Session>>,
    headers: HeaderMap,
) -> Response {
    // Permissions check
    if let Some(axum::Extension(ref s)) = session {
        if !state.permissions.can_access(&s.username, &s.role, &s.groups, &slug) {
            return (StatusCode::FORBIDDEN, "Access denied").into_response();
        }
    }

    let entry = match state.registry.get_by_slug(&slug).await {
        Some(e) => e,
        None => return (StatusCode::NOT_FOUND, "App not found").into_response(),
    };

    if entry.state != crate::registry::AppState::Running {
        return (StatusCode::SERVICE_UNAVAILABLE, "App not running").into_response();
    }

    // Dev proxy: if dev_url is set and we're in development mode, proxy the request
    if state.config.runtime_mode.is_dev() {
        if let Some(ref dev) = entry.manifest.frontend.dev {
            if let Some(ref dev_url) = dev.dev_url {
                return proxy_to_dev_server(dev_url, "/").await;
            }
        }
    }

    let base_dir = &state.config.apps.manifest_dir;
    let index_path = PathBuf::from(base_dir)
        .join(&slug)
        .join(&entry.manifest.frontend.directory)
        .join(&entry.manifest.frontend.index);

    serve_file_with_cache(&index_path, "text/html; charset=utf-8", &state.config.runtime_mode, &headers).await
}

/// GET /{slug}/static/{*path} — Serve app static assets (or proxy in dev mode).
pub async fn serve_app_static(
    State(state): State<AppState>,
    AxumPath((slug, file_path)): AxumPath<(String, String)>,
    session: Option<axum::Extension<Session>>,
    headers: HeaderMap,
) -> Response {
    // Permissions check
    if let Some(axum::Extension(ref s)) = session {
        if !state.permissions.can_access(&s.username, &s.role, &s.groups, &slug) {
            return (StatusCode::FORBIDDEN, "Access denied").into_response();
        }
    }

    let entry = match state.registry.get_by_slug(&slug).await {
        Some(e) => e,
        None => return (StatusCode::NOT_FOUND, "App not found").into_response(),
    };

    if !is_safe_path(&file_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path").into_response();
    }

    // Dev proxy
    if state.config.runtime_mode.is_dev() {
        if let Some(ref dev) = entry.manifest.frontend.dev {
            if let Some(ref dev_url) = dev.dev_url {
                return proxy_to_dev_server(dev_url, &format!("/static/{}", file_path)).await;
            }
        }
    }

    let base_dir = &state.config.apps.manifest_dir;
    let full_path = PathBuf::from(base_dir)
        .join(&slug)
        .join(&entry.manifest.frontend.directory)
        .join(&file_path);

    let mime = guess_mime(&file_path);
    serve_file_with_cache(&full_path, mime, &state.config.runtime_mode, &headers).await
}

/// GET /{slug}/{instance_id}/ — Serve app index for a specific instance.
/// The instance_id is only used client-side (zro-client.js extracts it from the URL).
/// The served content is identical to /{slug}/.
pub async fn serve_app_instance_index(
    state: State<AppState>,
    AxumPath((slug, _instance_id)): AxumPath<(String, String)>,
    session: Option<axum::Extension<Session>>,
    headers: HeaderMap,
) -> Response {
    serve_app_index(state, AxumPath(slug), session, headers).await
}

/// GET /{slug}/{instance_id}/static/{*path} — Serve app static assets for a specific instance.
pub async fn serve_app_instance_static(
    state: State<AppState>,
    AxumPath((slug, _instance_id, file_path)): AxumPath<(String, String, String)>,
    session: Option<axum::Extension<Session>>,
    headers: HeaderMap,
) -> Response {
    serve_app_static(state, AxumPath((slug, file_path)), session, headers).await
}

/// GET /static/{*path} — Serve shared static assets (zro-client.js, etc.).
pub async fn serve_shared_static(
    State(state): State<AppState>,
    AxumPath(file_path): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    if !is_safe_path(&file_path) {
        return (StatusCode::BAD_REQUEST, "Invalid path").into_response();
    }

    let full_path = PathBuf::from("./static").join(&file_path);
    let mime = guess_mime(&file_path);
    serve_file_with_cache(&full_path, mime, &state.config.runtime_mode, &headers).await
}

/// Proxy a request to a development server (e.g., Vite).
async fn proxy_to_dev_server(dev_url: &str, path: &str) -> Response {
    let url = format!("{}{}", dev_url.trim_end_matches('/'), path);
    match reqwest::get(&url).await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY);
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            match resp.bytes().await {
                Ok(body) => {
                    let mut response = (status, body.to_vec()).into_response();
                    response.headers_mut().insert(
                        header::CONTENT_TYPE,
                        content_type.parse().unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
                    );
                    response.headers_mut().insert(
                        header::CACHE_CONTROL,
                        "no-store".parse().unwrap(),
                    );
                    response
                }
                Err(_) => (StatusCode::BAD_GATEWAY, "Failed to read dev server response").into_response(),
            }
        }
        Err(e) => {
            tracing::warn!("Dev proxy failed for {}: {}", url, e);
            (StatusCode::BAD_GATEWAY, format!("Dev server unreachable: {}", e)).into_response()
        }
    }
}

/// Check that a path doesn't contain traversal attacks.
fn is_safe_path(path: &str) -> bool {
    let p = Path::new(path);
    for component in p.components() {
        match component {
            Component::ParentDir => return false,
            Component::RootDir => return false,
            _ => {}
        }
    }
    !path.contains("..") && !path.starts_with('/')
}

/// Compute SHA-256 hex digest of content.
fn sha256_hex(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

/// Serve a file from disk with ETag-based cache revalidation.
async fn serve_file_with_cache(
    path: &Path,
    content_type: &str,
    _mode: &RuntimeMode,
    request_headers: &HeaderMap,
) -> Response {
    match tokio::fs::read(path).await {
        Ok(content) => {
            let etag = format!("\"{}\"", sha256_hex(&content));

            // ETag / If-None-Match support
            if let Some(if_none_match) = request_headers.get(header::IF_NONE_MATCH) {
                if let Ok(val) = if_none_match.to_str() {
                    if val == etag || val == "*" {
                        let mut resp = StatusCode::NOT_MODIFIED.into_response();
                        resp.headers_mut().insert(header::ETAG, etag.parse().unwrap());
                        resp.headers_mut().insert(
                            header::CACHE_CONTROL,
                            "no-cache".parse().unwrap(),
                        );
                        return resp;
                    }
                }
            }

            let mut response = (StatusCode::OK, content).into_response();
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                content_type.parse().unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
            );

            // Always use ETag-based revalidation: browser caches but checks
            // freshness on every request via If-None-Match (304 if unchanged).
            // HTML files use no-store to always get fresh content.
            let cache_policy = if content_type.starts_with("text/html") {
                "no-store"
            } else {
                "no-cache"
            };
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                cache_policy.parse().unwrap(),
            );
            response.headers_mut().insert(
                header::ETAG,
                etag.parse().unwrap(),
            );

            response
        }
        Err(_) => (StatusCode::NOT_FOUND, "File not found").into_response(),
    }
}

/// Guess MIME type from file extension.
fn guess_mime(path: &str) -> &str {
    match Path::new(path).extension().and_then(|e| e.to_str()) {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("map") => "application/json",
        _ => "application/octet-stream",
    }
}
