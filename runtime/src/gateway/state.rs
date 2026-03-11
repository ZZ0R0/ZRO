use std::collections::HashMap;
use std::sync::Arc;

use tokio::process::Child;
use tokio::sync::Mutex;

use crate::auth::RateLimiter;
use crate::auth_provider::AuthPipeline;
use crate::config::RuntimeConfig;
use crate::ipc::router::IpcRouter;
use crate::jwt::JwtManager;
use crate::registry::AppRegistry;
use crate::storage::SqliteStore;
use crate::storage::session_store::SessionStore;
use crate::storage::state_store::StateStore;
use crate::storage::token_store::TokenStore;
use crate::permissions::PermissionsConfig;
use crate::gateway::handlers::websocket::WsSessionManager;

/// Shared application state for the gateway.
#[derive(Clone)]
pub struct AppState {
    pub config: RuntimeConfig,
    pub registry: AppRegistry,
    pub auth_pipeline: Arc<AuthPipeline>,
    pub jwt_manager: JwtManager,
    pub rate_limiter: RateLimiter,
    pub ipc_router: IpcRouter,
    pub ws_manager: WsSessionManager,
    pub start_time: std::time::Instant,
    pub sqlite_store: Option<SqliteStore>,
    pub session_store: Option<SessionStore>,
    pub state_store: Option<StateStore>,
    pub token_store: Option<TokenStore>,
    pub permissions: Arc<PermissionsConfig>,
    processes: Arc<Mutex<HashMap<String, Child>>>,
}

impl AppState {
    pub fn new(
        config: RuntimeConfig,
        registry: AppRegistry,
        auth_pipeline: AuthPipeline,
        jwt_manager: JwtManager,
    ) -> Self {
        Self {
            config,
            registry,
            auth_pipeline: Arc::new(auth_pipeline),
            jwt_manager,
            rate_limiter: RateLimiter::new(),
            ipc_router: IpcRouter::new(),
            ws_manager: WsSessionManager::new(),
            start_time: std::time::Instant::now(),
            sqlite_store: None,
            session_store: None,
            state_store: None,
            token_store: None,
            permissions: Arc::new(PermissionsConfig::default()),
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Set the permissions configuration.
    pub fn with_permissions(mut self, perms: PermissionsConfig) -> Self {
        self.permissions = Arc::new(perms);
        self
    }

    /// Attach a SQLite store and create sub-stores.
    pub fn with_storage(mut self, sqlite: SqliteStore) -> Self {
        self.session_store = Some(SessionStore::new(sqlite.clone()));
        self.state_store = Some(StateStore::new(sqlite.clone()));
        self.token_store = Some(TokenStore::new(sqlite.clone()));
        self.sqlite_store = Some(sqlite);
        self
    }

    /// Store a child process handle.
    /// Store a child process handle.
    pub async fn add_process(&self, slug: &str, child: Child) {
        let mut procs = self.processes.lock().await;
        procs.insert(slug.to_string(), child);
    }

    /// Kill all child processes.
    pub async fn kill_all_processes(&self) {
        let mut procs = self.processes.lock().await;
        for (slug, mut child) in procs.drain() {
            tracing::info!(slug = slug, "Killing backend process");
            let _ = child.kill().await;
        }
    }
}
