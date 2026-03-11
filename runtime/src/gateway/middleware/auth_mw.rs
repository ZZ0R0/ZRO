use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Redirect, Response},
};
use tokio::sync::Mutex;

use crate::gateway::state::AppState;
use crate::session::Session;

/// In-memory tracker for throttled touch() calls — at most once per 60s per session.
static TOUCH_TRACKER: std::sync::LazyLock<Arc<Mutex<HashMap<String, std::time::Instant>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

const TOUCH_INTERVAL_SECS: u64 = 60;

/// Check if the request is likely from a browser (wants HTML).
fn is_browser_request(req: &Request) -> bool {
    req.headers()
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/html"))
        .unwrap_or(false)
}

/// JWT-based auth middleware.
///
/// Extracts the access token from the `zro-token` cookie, verifies the Ed25519
/// signature, checks expiry and JTI blacklist, then injects `Session` into
/// request extensions. No DB/HashMap lookup is needed for validation.
pub async fn auth_middleware(
    state: axum::extract::State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = req.uri().path().to_string();

    // Public routes that don't require auth
    let public_routes = ["/health", "/auth/login", "/auth/logout", "/auth/refresh"];
    if public_routes.iter().any(|r| path == *r || path.starts_with("/auth/login"))
        || path.starts_with("/static/")
    {
        return Ok(next.run(req).await);
    }

    // Extract JWT from cookie
    let token = req
        .headers()
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';')
                .map(|c| c.trim())
                .find(|c| c.starts_with(&format!("{}=", state.config.auth.token_cookie_name)))
                .map(|c| c.split_once('=').map(|x| x.1).unwrap_or("").to_string())
        });

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => {
            if is_browser_request(&req) {
                return Ok(Redirect::temporary("/auth/login").into_response());
            }
            return Err(StatusCode::UNAUTHORIZED);
        }
    };

    // Verify JWT signature + expiry (O(1), no DB lookup)
    let claims = match state.jwt_manager.verify_access_token(&token) {
        Ok(c) => c,
        Err(_) => {
            if is_browser_request(&req) {
                return Ok(Redirect::temporary("/auth/login").into_response());
            }
            return Err(StatusCode::UNAUTHORIZED);
        }
    };

    // Check JTI blacklist (O(1) in-memory first, then SQLite fallback)
    if state.jwt_manager.is_blacklisted(&claims.jti).await {
        if is_browser_request(&req) {
            return Ok(Redirect::temporary("/auth/login").into_response());
        }
        return Err(StatusCode::UNAUTHORIZED);
    }
    // SQLite fallback for blacklist (covers runtime restart scenario)
    if let Some(ref token_store) = state.token_store {
        if token_store.is_blacklisted(&claims.jti).unwrap_or(false) {
            // Re-add to in-memory for future fast checks
            state.jwt_manager.blacklist_jti(&claims.jti).await;
            if is_browser_request(&req) {
                return Ok(Redirect::temporary("/auth/login").into_response());
            }
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    // Build session from claims and inject into extensions
    let session = Session::from_claims(&claims);

    // Throttled touch: update last_active in SQLite at most once per 60s per session
    if let Some(ref session_store) = state.session_store {
        let session_id_str = session.session_id.0.clone();
        let should_touch = {
            let mut tracker = TOUCH_TRACKER.lock().await;
            let now = std::time::Instant::now();
            match tracker.get(&session_id_str) {
                Some(last) if now.duration_since(*last).as_secs() < TOUCH_INTERVAL_SECS => false,
                _ => {
                    tracker.insert(session_id_str.clone(), now);
                    true
                }
            }
        };
        if should_touch {
            let _ = session_store.touch(&session_id_str);
        }
    }

    req.extensions_mut().insert(session);

    Ok(next.run(req).await)
}
