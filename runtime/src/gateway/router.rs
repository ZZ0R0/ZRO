use axum::{
    middleware,
    routing::{any, get, post},
    Router,
    response::Redirect,
};

use crate::gateway::state::AppState;
use crate::gateway::handlers;
use crate::gateway::middleware::{auth_mw, security};
use crate::session::Session;

/// Build the complete axum router.
pub fn build_router(state: AppState) -> Router {
    let default_app = state.config.apps.default_app.clone();

    Router::new()
        // Public routes (matched first — before slug catch-all)
        .route("/health", get(handlers::health::health_check))
        .route("/auth/login", get(handlers::auth::login_page).post(handlers::auth::login))
        .route("/auth/logout", post(handlers::auth::logout))
        .route("/auth/refresh", post(handlers::auth::refresh))
        // Protected routes
        .route("/auth/me", get(handlers::auth::me))
        // Root redirect: /{default_app}/ if authenticated, /auth/login otherwise
        .route("/", get(move |req: axum::extract::Request| {
            let default_app = default_app.clone();
            async move {
                if req.extensions().get::<Session>().is_some() {
                    Redirect::temporary(&format!("/{}/", default_app))
                } else {
                    Redirect::temporary("/auth/login")
                }
            }
        }))
        // App list (JSON API for Shell to enumerate apps)
        .route("/api/apps", get(handlers::apps::app_list_json))
        // Legacy app list page (fallback when no Shell)
        .route("/apps", get(handlers::apps::app_list))
        // Multiplexed WebSocket (v2)
        .route("/ws", get(handlers::websocket::ws_handler))
        // Shared static assets
        .route("/static/{*path}", get(handlers::static_files::serve_shared_static))
        // App instance routes: /{slug}/{instance_id}/ (must be before /{slug}/ catch-all)
        .route("/{slug}/{instance_id}/", get(handlers::static_files::serve_app_instance_index))
        .route("/{slug}/{instance_id}/static/{*path}", get(handlers::static_files::serve_app_instance_static))
        .route("/{slug}/{instance_id}/api/{*path}", any(handlers::proxy::proxy_instance_api))
        // App routes: /{slug}/, /{slug}/static/{*path}, /{slug}/api/{*path}
        .route("/{slug}/", get(handlers::static_files::serve_app_index))
        .route("/{slug}/static/{*path}", get(handlers::static_files::serve_app_static))
        .route("/{slug}/api/{*path}", any(handlers::proxy::proxy_api))
        // Slug without trailing slash -> redirect
        .route("/{slug}", get(|axum::extract::Path(slug): axum::extract::Path<String>| async move {
            Redirect::permanent(&format!("/{}/", slug))
        }))
        // Middleware stack
        .layer(middleware::from_fn_with_state(state.clone(), auth_mw::auth_middleware))
        .layer(middleware::from_fn(security::security_headers))
        .with_state(state)
}
