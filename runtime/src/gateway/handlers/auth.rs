use axum::{
    extract::State,
    http::{header, StatusCode, HeaderMap},
    response::{Html, IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::json;

use crate::gateway::state::AppState;
use crate::session::Session;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// GET /auth/login — Serve the login page.
pub async fn login_page() -> Html<String> {
    Html(LOGIN_HTML.to_string())
}

/// POST /auth/login — Authenticate via AuthPipeline, return JWT cookies.
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<LoginRequest>,
) -> Response {
    let ip = extract_ip(&headers);

    // Check rate limit
    if state.rate_limiter.is_limited(&ip).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"ok": false, "error": "too_many_requests"})),
        ).into_response();
    }

    // Authenticate via pipeline
    let auth_result = match state.auth_pipeline.authenticate(&body.username, &body.password).await {
        Some(r) => r,
        None => {
            state.rate_limiter.record_attempt(&ip).await;
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"ok": false, "error": "invalid_credentials"})),
            ).into_response();
        }
    };

    // Generate JWT access token
    let access_token = match state.jwt_manager.create_access_token(&auth_result) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to create JWT: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"ok": false, "error": "internal_error"})),
            ).into_response();
        }
    };

    // Generate refresh token
    let refresh_token = state.jwt_manager.create_refresh_token(&auth_result).await;

    state.rate_limiter.clear(&ip).await;

    tracing::info!(username = auth_result.username, ip = ip, "User logged in");

    // Persist session in SQLite if available
    if let Some(ref session_store) = state.session_store {
        let expires_secs = state.config.auth.jwt_refresh_ttl_seconds;
        let expires_at = chrono::Utc::now()
            + chrono::Duration::seconds(expires_secs as i64);

        let record = crate::storage::session_store::SessionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            user_id: auth_result.user_id.clone(),
            username: auth_result.username.clone(),
            role: auth_result.role.clone(),
            groups: auth_result.groups.clone(),
            created_at: String::new(),
            last_active: String::new(),
            expires_at: expires_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
            ip_address: Some(ip.clone()),
            user_agent: headers.get("user-agent")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string()),
            is_active: true,
        };
        if let Err(e) = session_store.create(&record) {
            tracing::warn!("Failed to persist session: {}", e);
        }
    }

    // Persist refresh token in SQLite if available
    if let Some(ref token_store) = state.token_store {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(refresh_token.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        let expires_at = chrono::Utc::now()
            + chrono::Duration::seconds(state.config.auth.jwt_refresh_ttl_seconds as i64);
        let _ = token_store.store_refresh(
            &uuid::Uuid::new_v4().to_string(),
            &auth_result.user_id,
            &hash,
            &expires_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
        );
    }

    let access_cookie = format!(
        "{}={}; HttpOnly; SameSite=Strict; Path=/",
        state.config.auth.token_cookie_name, access_token,
    );
    let refresh_cookie = format!(
        "{}={}; HttpOnly; SameSite=Strict; Path=/auth/refresh",
        state.config.auth.refresh_cookie_name, refresh_token,
    );

    let mut response = Json(json!({
        "ok": true,
        "username": auth_result.username,
        "role": auth_result.role,
    })).into_response();

    let hdrs = response.headers_mut();
    hdrs.append(header::SET_COOKIE, access_cookie.parse().unwrap());
    hdrs.append(header::SET_COOKIE, refresh_cookie.parse().unwrap());

    response
}

/// POST /auth/logout — Blacklist JTI & revoke refresh token.
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    // Extract access token, blacklist its JTI
    if let Some(token) = extract_cookie(&headers, &state.config.auth.token_cookie_name) {
        if let Ok(claims) = state.jwt_manager.verify_access_token(&token) {
            state.jwt_manager.blacklist_jti(&claims.jti).await;

            // Persist blacklist in SQLite
            if let Some(ref token_store) = state.token_store {
                let exp = chrono::DateTime::from_timestamp(claims.exp as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
                    .unwrap_or_default();
                let _ = token_store.blacklist_jti(&claims.jti, &exp);
            }
        }
    }

    // Revoke refresh token
    if let Some(refresh) = extract_cookie(&headers, &state.config.auth.refresh_cookie_name) {
        state.jwt_manager.revoke_refresh_token(&refresh).await;

        // Persist revocation in SQLite
        if let Some(ref token_store) = state.token_store {
            use sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            hasher.update(refresh.as_bytes());
            let hash = format!("{:x}", hasher.finalize());
            if let Ok(Some(info)) = token_store.verify_refresh(&hash) {
                let _ = token_store.revoke_refresh(&info.id);
            }
        }
    }

    let clear_access = format!("{}=; Max-Age=0; Path=/", state.config.auth.token_cookie_name);
    let clear_refresh = format!("{}=; Max-Age=0; Path=/auth/refresh", state.config.auth.refresh_cookie_name);

    let mut response = Json(json!({"ok": true})).into_response();
    let hdrs = response.headers_mut();
    hdrs.append(header::SET_COOKIE, clear_access.parse().unwrap());
    hdrs.append(header::SET_COOKIE, clear_refresh.parse().unwrap());

    response
}

/// POST /auth/refresh — Use refresh token to get a new access token.
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let refresh_token = match extract_cookie(&headers, &state.config.auth.refresh_cookie_name) {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"ok": false, "error": "no_refresh_token"})),
            ).into_response();
        }
    };

    let auth_result = match state.jwt_manager.validate_refresh_token(&refresh_token).await {
        Some(r) => r,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"ok": false, "error": "invalid_refresh_token"})),
            ).into_response();
        }
    };

    // Blacklist old access token JTI if present
    if let Some(old_token) = extract_cookie(&headers, &state.config.auth.token_cookie_name) {
        if let Ok(claims) = state.jwt_manager.verify_access_token(&old_token) {
            state.jwt_manager.blacklist_jti(&claims.jti).await;
        }
    }

    // Issue new access token
    let new_token = match state.jwt_manager.create_access_token(&auth_result) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to create JWT on refresh: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"ok": false, "error": "internal_error"})),
            ).into_response();
        }
    };

    let cookie = format!(
        "{}={}; HttpOnly; SameSite=Strict; Path=/",
        state.config.auth.token_cookie_name, new_token,
    );

    let mut response = Json(json!({
        "ok": true,
        "username": auth_result.username,
        "role": auth_result.role,
    })).into_response();
    response.headers_mut().insert(header::SET_COOKIE, cookie.parse().unwrap());

    response
}

/// GET /auth/me — Return current user's profile from the JWT session.
pub async fn me(
    session: Option<axum::Extension<Session>>,
) -> Response {
    match session {
        Some(axum::Extension(s)) => {
            Json(json!({
                "ok": true,
                "username": s.username,
                "user_id": s.user_id,
                "role": s.role,
                "groups": s.groups,
            })).into_response()
        }
        None => {
            (StatusCode::UNAUTHORIZED, Json(json!({"ok": false, "error": "not_authenticated"}))).into_response()
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

fn extract_ip(headers: &HeaderMap) -> String {
    headers.get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("unknown").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';')
                .map(|c| c.trim())
                .find(|c| c.starts_with(&format!("{}=", name)))
                .map(|c| c.split_once('=').map(|x| x.1).unwrap_or("").to_string())
        })
}

const LOGIN_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>zro — Login</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f1117;
            color: #e4e4e7;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .login-card {
            background: #1a1b23;
            border: 1px solid #2a2b35;
            border-radius: 12px;
            padding: 2rem;
            width: 100%;
            max-width: 380px;
        }
        h1 {
            text-align: center;
            margin-bottom: 1.5rem;
            font-size: 1.5rem;
            color: #fff;
        }
        h1 span { color: #6366f1; }
        .form-group {
            margin-bottom: 1rem;
        }
        label {
            display: block;
            margin-bottom: 0.25rem;
            font-size: 0.875rem;
            color: #a1a1aa;
        }
        input {
            width: 100%;
            padding: 0.625rem 0.75rem;
            background: #0f1117;
            border: 1px solid #2a2b35;
            border-radius: 6px;
            color: #e4e4e7;
            font-size: 0.875rem;
            outline: none;
        }
        input:focus { border-color: #6366f1; }
        button {
            width: 100%;
            padding: 0.625rem;
            background: #6366f1;
            color: #fff;
            border: none;
            border-radius: 6px;
            font-size: 0.875rem;
            cursor: pointer;
            margin-top: 0.5rem;
        }
        button:hover { background: #4f46e5; }
        .error {
            color: #ef4444;
            text-align: center;
            margin-top: 0.75rem;
            font-size: 0.8rem;
            display: none;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <h1><span>zro</span> login</h1>
        <form id="login-form">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username" required autofocus>
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required>
            </div>
            <button type="submit">Sign in</button>
            <p class="error" id="error-msg"></p>
        </form>
    </div>
    <script>
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const err = document.getElementById('error-msg');
            err.style.display = 'none';
            try {
                const res = await fetch('/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('username').value,
                        password: document.getElementById('password').value,
                    }),
                });
                const data = await res.json();
                if (data.ok) {
                    window.location.href = '/apps';
                } else {
                    err.textContent = data.error === 'too_many_requests'
                        ? 'Too many attempts. Try again later.'
                        : 'Invalid username or password.';
                    err.style.display = 'block';
                }
            } catch (ex) {
                err.textContent = 'Connection error.';
                err.style.display = 'block';
            }
        });
    </script>
</body>
</html>"#;
