//! Integration tests for the zro-runtime gateway.
//!
//! These tests spin up the full axum router (without app backends) and exercise
//! the HTTP API surface: health checks, auth flow, app listing, and security headers.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

use zro_protocol::manifest::*;
use zro_runtime::auth;
use zro_runtime::auth_provider::{AuthPipeline, LocalAuthProvider};
use zro_runtime::config;
use zro_runtime::config::*;
use zro_runtime::gateway;
use zro_runtime::jwt::JwtManager;
use zro_runtime::registry::AppRegistry;

/// Build a test state with optional users and manifests.
fn test_state(users: Vec<auth::UserEntry>, manifests: Vec<AppManifest>) -> gateway::state::AppState {
    let config = RuntimeConfig {
        server: ServerConfig::default(),
        apps: AppsConfig::default(),
        session: SessionConfig::default(),
        auth: AuthConfig::default(),
        logging: LoggingConfig::default(),
        supervisor: SupervisorConfig::default(),
        mode: config::ModeConfig::default(),
        development: config::DevelopmentConfig::default(),
        production: config::ProductionConfig::default(),
        storage: config::StorageConfig::default(),
        control: config::ControlConfig::default(),
        desktop: config::DesktopConfig::default(),
        runtime_mode: config::RuntimeMode::Development,
    };

    let local_provider = LocalAuthProvider::new(users);
    let pipeline = AuthPipeline::new(vec![Box::new(local_provider)]);

    let tmp_dir = std::env::temp_dir().join(format!("zro-test-jwt-{}", uuid::Uuid::new_v4()));
    let jwt_manager = JwtManager::new(
        tmp_dir.to_str().unwrap(),
        config.auth.jwt_ttl_seconds,
        config.auth.jwt_refresh_ttl_seconds,
    ).unwrap();

    let registry = AppRegistry::new(manifests);
    gateway::state::AppState::new(config, registry, pipeline, jwt_manager)
}

/// Build a test user with a properly hashed password.
fn test_user(username: &str, password: &str, role: &str) -> auth::UserEntry {
    let hash = auth::hash_password(password).unwrap();
    auth::UserEntry {
        username: username.to_string(),
        password_hash: hash,
        role: role.to_string(),
        user_id: format!("u-{}", uuid::Uuid::new_v4()),
        groups: vec![],
    }
}

/// Helper: build test manifest.
fn test_manifest(_id: &str, slug: &str, name: &str) -> AppManifest {
    AppManifest {
        app: AppInfo {
            slug: slug.to_string(),
            name: name.to_string(),
            version: "0.1.0".to_string(),
            description: format!("{} app", name),
            icon: String::new(),
            category: AppCategory::default(),
            keywords: vec![],
            mime_types: vec![],
            single_instance: false,
        },
        backend: Some(BackendInfo {
            executable: format!("zro-app-{}", slug),
            transport: "unix_socket".to_string(),
            command: None,
            args: vec![],
        }),
        frontend: FrontendInfo {
            directory: "frontend".to_string(),
            index: "index.html".to_string(),
            dev: None,
        },
        permissions: PermissionsInfo::default(),
        window: WindowConfig::default(),
    }
}

/// Helper: extract body as string.
async fn body_string(body: Body) -> String {
    let bytes = body.collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

/// Helper: extract body as JSON.
async fn body_json(body: Body) -> Value {
    let s = body_string(body).await;
    serde_json::from_str(&s).unwrap()
}

// ── Health check tests ──────────────────────────────────────────

#[tokio::test]
async fn test_health_check_returns_ok() {
    let state = test_state(vec![], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response.into_body()).await;
    assert_eq!(body["status"], "ok");
    assert!(body["uptime_seconds"].is_number());
}

#[tokio::test]
async fn test_health_check_includes_apps() {
    let manifests = vec![
        test_manifest("a1000000-0000-0000-0000-000000000001", "notes", "Notes"),
        test_manifest("a2000000-0000-0000-0000-000000000002", "files", "Files"),
    ];
    let state = test_state(vec![], manifests);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_json(response.into_body()).await;
    assert!(body["apps"]["notes"].is_object());
    assert!(body["apps"]["files"].is_object());
    assert_eq!(body["apps"]["notes"]["name"], "Notes");
}

// ── Security headers tests ──────────────────────────────────────

#[tokio::test]
async fn test_security_headers_present() {
    let state = test_state(vec![], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );
    assert_eq!(
        response.headers().get("x-frame-options").unwrap(),
        "SAMEORIGIN"
    );
    assert_eq!(
        response.headers().get("x-xss-protection").unwrap(),
        "0"
    );
    assert!(response
        .headers()
        .get("content-security-policy")
        .is_some());
    assert!(response
        .headers()
        .get("referrer-policy")
        .is_some());
}

// ── Auth flow tests ─────────────────────────────────────────────

#[tokio::test]
async fn test_login_page_served() {
    let state = test_state(vec![], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/auth/login")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_string(response.into_body()).await;
    assert!(body.contains("<!DOCTYPE html>"));
    assert!(body.contains("zro"));
    assert!(body.contains("login"));
}

#[tokio::test]
async fn test_login_success() {
    let user = test_user("admin", "secret123", "admin");
    let state = test_state(vec![user], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&json!({
                        "username": "admin",
                        "password": "secret123"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Should have Set-Cookie header with JWT token
    let cookies: Vec<_> = response.headers().get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let access_cookie = cookies.iter().find(|c| c.starts_with("zro-token=")).unwrap();
    assert!(access_cookie.contains("HttpOnly"));
    assert!(access_cookie.contains("SameSite=Strict"));
    // Should also have refresh cookie
    assert!(cookies.iter().any(|c| c.starts_with("zro-refresh=")));

    let body = body_json(response.into_body()).await;
    assert_eq!(body["ok"], true);
    assert_eq!(body["username"], "admin");
    assert_eq!(body["role"], "admin");
}

#[tokio::test]
async fn test_login_wrong_password() {
    let user = test_user("admin", "secret123", "admin");
    let state = test_state(vec![user], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&json!({
                        "username": "admin",
                        "password": "wrongpassword"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = body_json(response.into_body()).await;
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"], "invalid_credentials");
}

#[tokio::test]
async fn test_login_unknown_user() {
    let state = test_state(vec![], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&json!({
                        "username": "noone",
                        "password": "pass"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ── Protected routes require auth ───────────────────────────────

#[tokio::test]
async fn test_apps_requires_auth() {
    let state = test_state(vec![], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/apps")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_root_requires_auth() {
    let state = test_state(vec![], vec![]);
    let app = gateway::router::build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // Should be either a redirect (which gets caught by auth) or unauthorized
    let status = response.status();
    assert!(
        status == StatusCode::UNAUTHORIZED
            || status == StatusCode::PERMANENT_REDIRECT
            || status == StatusCode::TEMPORARY_REDIRECT,
        "Expected auth challenge or redirect, got {}",
        status
    );
}

// ── Full auth flow: login → access /apps → logout ───────────────

#[tokio::test]
async fn test_full_auth_flow() {
    let user = test_user("admin", "pass123", "admin");
    let manifests = vec![
        test_manifest("a1000000-0000-0000-0000-000000000001", "notes", "Notes"),
    ];
    let state = test_state(vec![user], manifests);

    // Step 1: Login
    let app = gateway::router::build_router(state.clone());
    let login_resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_string(&json!({
                        "username": "admin",
                        "password": "pass123"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(login_resp.status(), StatusCode::OK);
    // Collect all cookies from login response  
    let cookies: Vec<_> = login_resp.headers().get_all(header::SET_COOKIE)
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let access_cookie = cookies.iter().find(|c| c.starts_with("zro-token=")).unwrap();
    let cookie_pair = access_cookie.split(';').next().unwrap();

    // Step 2: Access /apps with the session cookie
    let app = gateway::router::build_router(state.clone());
    let apps_resp = app
        .oneshot(
            Request::builder()
                .uri("/apps")
                .header("cookie", cookie_pair)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(apps_resp.status(), StatusCode::OK);
    let body = body_string(apps_resp.into_body()).await;
    assert!(body.contains("Notes")); // Should show the app name

    // Step 3: Access /api/apps JSON endpoint
    let app = gateway::router::build_router(state.clone());
    let api_resp = app
        .oneshot(
            Request::builder()
                .uri("/api/apps")
                .header("cookie", cookie_pair)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(api_resp.status(), StatusCode::OK);
    let body = body_json(api_resp.into_body()).await;
    assert!(body.is_array());
    assert_eq!(body[0]["slug"], "notes");

    // Step 4: Logout
    let app = gateway::router::build_router(state.clone());
    let logout_resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/auth/logout")
                .header("cookie", cookie_pair)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(logout_resp.status(), StatusCode::OK);
    let body = body_json(logout_resp.into_body()).await;
    assert_eq!(body["ok"], true);

    // Step 5: Access /apps with the same cookie should now fail
    let app = gateway::router::build_router(state.clone());
    let unauth_resp = app
        .oneshot(
            Request::builder()
                .uri("/apps")
                .header("cookie", cookie_pair)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(unauth_resp.status(), StatusCode::UNAUTHORIZED);
}

// ── IPC Router unit tests ───────────────────────────────────────

#[tokio::test]
async fn test_ipc_router_register_and_get() {
    use zro_runtime::ipc::router::IpcRouter;
    use zro_runtime::ipc::channel::IpcChannel;
    use tokio::net::UnixStream;

    let router = IpcRouter::new();

    // Create a pair of Unix sockets
    let (s1, _s2) = UnixStream::pair().unwrap();
    let (reader, writer) = s1.into_split();
    let channel = IpcChannel::new(reader, writer);

    router.register("app-1", channel).await;
    assert!(router.get_channel("app-1").await.is_some());
    assert!(router.get_channel("app-2").await.is_none());

    router.unregister("app-1").await;
    assert!(router.get_channel("app-1").await.is_none());
}
