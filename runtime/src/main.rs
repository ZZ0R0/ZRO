use zro_runtime::{config, auth, auth_provider, jwt, registry, supervisor, gateway, hot_reload, storage, permissions};

use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    // 1. Load configuration
    let config = config::RuntimeConfig::load()?;

    // 2. Initialize logging
    let log_level = if config.runtime_mode.is_dev() && config.logging.level == "info" {
        "debug".to_string()
    } else {
        config.logging.level.clone()
    };
    let filter = tracing_subscriber::EnvFilter::try_new(&log_level)
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();

    tracing::info!(
        "Starting zro runtime v{} in {} mode",
        env!("CARGO_PKG_VERSION"),
        config.runtime_mode,
    );

    // 3. Load users and build auth pipeline from config.auth.providers
    let users = auth::load_users(&config)?;
    tracing::info!("Loaded {} user(s)", users.len());

    let mut providers: Vec<Box<dyn auth_provider::AuthProvider>> = Vec::new();
    for name in &config.auth.providers {
        match name.as_str() {
            "local" => {
                providers.push(Box::new(auth_provider::LocalAuthProvider::new(users.clone())));
                tracing::info!("Auth provider: local (users.toml)");
            }
            #[cfg(feature = "pam")]
            "pam" => {
                let pam = zro_runtime::auth_pam::provider::PamAuthProvider::new(&config.auth.pam);
                providers.push(Box::new(pam));
                tracing::info!("Auth provider: PAM (service={})", config.auth.pam.service_name);
            }
            #[cfg(not(feature = "pam"))]
            "pam" => {
                tracing::warn!("PAM provider requested but feature 'pam' is not enabled — skipping");
            }
            #[cfg(feature = "ldap")]
            "ldap" => {
                let ldap = zro_runtime::auth_ldap::provider::LdapAuthProvider::new(&config.auth.ldap);
                providers.push(Box::new(ldap));
                tracing::info!("Auth provider: LDAP (url={})", config.auth.ldap.url);
            }
            #[cfg(not(feature = "ldap"))]
            "ldap" => {
                tracing::warn!("LDAP provider requested but feature 'ldap' is not enabled — skipping");
            }
            other => {
                tracing::warn!("Unknown auth provider '{}' — skipping", other);
            }
        }
    }
    if providers.is_empty() {
        tracing::warn!("No auth providers configured, falling back to local");
        providers.push(Box::new(auth_provider::LocalAuthProvider::new(users)));
    }
    let auth_pipeline = auth_provider::AuthPipeline::new(providers);
    tracing::info!("Auth pipeline: {:?}", config.auth.providers);

    // 3b. Load permissions
    let perms = permissions::PermissionsConfig::load("config/permissions.toml");
    if perms.has_rules() {
        tracing::info!("Permissions loaded: {} app rules", perms.app_count());
    } else {
        tracing::info!("No permissions.toml — all apps accessible to all users");
    }

    // 4. Initialize JWT manager (loads or generates Ed25519 keypair)
    let jwt_manager = jwt::JwtManager::new(
        &config.auth.key_path,
        config.auth.jwt_ttl_seconds,
        config.auth.jwt_refresh_ttl_seconds,
    )?;

    // 5. Scan and load manifests
    let manifests = registry::load_manifests(&config.apps.manifest_dir)?;
    tracing::info!("Loaded {} app manifest(s)", manifests.len());

    // 6. Build app registry
    let app_registry = registry::AppRegistry::new(manifests);

    // 7. Create shared state
    let state = gateway::state::AppState::new(
        config.clone(),
        app_registry,
        auth_pipeline,
        jwt_manager,
    ).with_permissions(perms);

    // 7b. Initialize SQLite store
    let state = match storage::SqliteStore::new(
        &config.storage.path,
        config.storage.pool_size,
        config.storage.wal_mode,
    ) {
        Ok(sqlite) => {
            tracing::info!("SQLite store initialized at {}", config.storage.path);
            storage::SqliteStore::spawn_cleanup_task(
                sqlite.clone(),
                config.storage.cleanup_interval_seconds,
            );
            state.with_storage(sqlite)
        }
        Err(e) => {
            tracing::warn!("Failed to initialize SQLite store: {} — running without persistence", e);
            state
        }
    };

    // 8. Start hot reload watcher in development mode
    let _hot_reload = if config.hot_reload_enabled() {
        match hot_reload::HotReloadWatcher::start(
            &config.apps.manifest_dir,
            state.registry.clone(),
            state.ws_manager.clone(),
        ).await {
            Ok(watcher) => {
                tracing::info!("Hot reload enabled");
                Some(watcher)
            }
            Err(e) => {
                tracing::warn!("Failed to start hot reload watcher: {}", e);
                None
            }
        }
    } else {
        None
    };

    // 8b. Spawn disconnected instance cleanup task (5 min grace period)
    {
        let ws_mgr = state.ws_manager.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                ws_mgr.cleanup_disconnected(std::time::Duration::from_secs(300)).await;
            }
        });
    }

    // 9. Start IPC server and launch backends
    let state_clone = state.clone();
    let _ipc_handle = tokio::spawn(async move {
        if let Err(e) = supervisor::start_all_backends(state_clone).await {
            tracing::error!("Supervisor error: {}", e);
        }
    });

    // 10. Start gateway
    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Gateway listening on {}", addr);

    let router = gateway::router::build_router(state.clone());
    let listener = tokio::net::TcpListener::bind(&addr).await?;

    // 11. Handle shutdown signals
    let shutdown = async {
        tokio::signal::ctrl_c().await.ok();
        tracing::info!("Shutdown signal received");
    };

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown)
        .await?;

    tracing::info!("Gateway stopped, shutting down backends...");
    supervisor::shutdown_all_backends(state).await;

    tracing::info!("zro runtime shutdown complete");
    Ok(())
}
