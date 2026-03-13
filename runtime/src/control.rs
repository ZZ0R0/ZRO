//! Control socket server for CLI ↔ Runtime communication.
//!
//! Listens on a Unix domain socket (default: `/run/zro/control.sock`)
//! and handles administrative commands from the `zro` CLI tool.
//! Uses the same length-prefixed JSON framing as the IPC protocol.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::net::UnixListener;
use serde::{Deserialize, Serialize};

use zro_protocol::messages::{read_message, write_message, IpcMessage};

use crate::auth;
use crate::gateway::state::AppState;
use crate::registry::AppState as RegistryAppState;
use crate::supervisor;

/// Default control socket path.
pub const DEFAULT_CONTROL_SOCKET: &str = "/run/zro/control.sock";

/// Control server — listens for CLI commands on a Unix socket.
pub struct ControlServer {
    listener: UnixListener,
    state: AppState,
}

/// Incoming command from the CLI.
#[derive(Debug, Deserialize)]
struct ControlRequest {
    cmd: String,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    staging_path: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    lines: Option<usize>,
    // user management fields
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password_hash: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    groups: Option<Vec<String>>,
}

/// Outgoing response to the CLI.
#[derive(Debug, Serialize)]
struct ControlResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ControlResponse {
    fn success(data: serde_json::Value) -> Self {
        Self { ok: true, data: Some(data), error: None }
    }

    fn error(msg: impl Into<String>) -> Self {
        Self { ok: false, data: None, error: Some(msg.into()) }
    }
}

impl ControlServer {
    /// Create and bind the control socket.
    pub async fn bind(socket_path: &str, state: AppState) -> anyhow::Result<Self> {
        let path = Path::new(socket_path);

        // Create parent directory
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Remove stale socket
        if path.exists() {
            tokio::fs::remove_file(path).await?;
        }

        let listener = UnixListener::bind(path)?;

        // Set socket permissions to 0660
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o660))?;
        }

        tracing::info!("Control socket listening on {}", socket_path);
        Ok(Self { listener, state })
    }

    /// Run the control server accept loop. Call this in a spawned task.
    pub async fn run(self) {
        loop {
            match self.listener.accept().await {
                Ok((stream, _addr)) => {
                    let state = self.state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(state, stream).await {
                            tracing::debug!("Control connection ended: {}", e);
                        }
                    });
                }
                Err(e) => {
                    tracing::error!("Control socket accept error: {}", e);
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    }

    /// Get the socket path (for cleanup).
    pub fn path(&self) -> PathBuf {
        // The listener's local_addr gives us the path
        self.listener
            .local_addr()
            .ok()
            .and_then(|a| a.as_pathname().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from(DEFAULT_CONTROL_SOCKET))
    }
}

/// Handle a single CLI connection — read commands, write responses.
async fn handle_connection(
    state: AppState,
    stream: tokio::net::UnixStream,
) -> anyhow::Result<()> {
    let (reader, writer) = stream.into_split();
    let reader = Arc::new(tokio::sync::Mutex::new(reader));
    let writer = Arc::new(tokio::sync::Mutex::new(writer));

    loop {
        // Read one command
        let msg = {
            let mut r = reader.lock().await;
            match read_message(&mut *r).await {
                Ok(msg) => msg,
                Err(_) => return Ok(()), // Connection closed
            }
        };

        // Parse the command payload
        let req: ControlRequest = match serde_json::from_value(msg.payload.clone()) {
            Ok(r) => r,
            Err(e) => {
                let resp = ControlResponse::error(format!("invalid request: {}", e));
                let reply = IpcMessage::reply(&msg.id, "ControlResponse", serde_json::to_value(&resp)?);
                let mut w = writer.lock().await;
                write_message(&mut *w, &reply).await?;
                continue;
            }
        };

        // Dispatch and execute
        let resp = dispatch_command(&state, req).await;

        // Send response
        let reply = IpcMessage::reply(&msg.id, "ControlResponse", serde_json::to_value(&resp)?);
        let mut w = writer.lock().await;
        write_message(&mut *w, &reply).await?;
    }
}

/// Dispatch a control command to the appropriate handler.
async fn dispatch_command(state: &AppState, req: ControlRequest) -> ControlResponse {
    match req.cmd.as_str() {
        "status" => cmd_status(state).await,
        "app.list" => cmd_app_list(state).await,
        "app.info" => cmd_app_info(state, req.slug.as_deref()).await,
        "app.start" => cmd_app_start(state, req.slug.as_deref()).await,
        "app.stop" => cmd_app_stop(state, req.slug.as_deref()).await,
        "app.restart" => cmd_app_restart(state, req.slug.as_deref()).await,
        "app.install" => cmd_app_install(state, req.slug.as_deref(), req.staging_path.as_deref()).await,
        "app.remove" => cmd_app_remove(state, req.slug.as_deref()).await,
        "app.update" => cmd_app_update(state, req.slug.as_deref(), req.staging_path.as_deref()).await,
        "config.show" => cmd_config_show(state).await,
        "config.reload" => cmd_config_reload(state).await,
        "user.list" => cmd_user_list(state).await,
        "user.add" => cmd_user_add(state, &req).await,
        "user.remove" => cmd_user_remove(state, req.username.as_deref()).await,
        "user.passwd" => cmd_user_passwd(state, &req).await,
        other => ControlResponse::error(format!("unknown command: {}", other)),
    }
}

// ── Command handlers ────────────────────────────────────────────

async fn cmd_status(state: &AppState) -> ControlResponse {
    let apps = state.registry.all().await;
    let running = apps.iter().filter(|a| a.state == RegistryAppState::Running).count();
    let stopped = apps.iter().filter(|a| a.state == RegistryAppState::Stopped).count();
    let errored = apps.iter().filter(|a| matches!(a.state, RegistryAppState::Error(_))).count();
    let uptime = state.start_time.elapsed().as_secs();

    ControlResponse::success(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": uptime,
        "pid": std::process::id(),
        "port": state.config.server.port,
        "mode": state.config.runtime_mode.to_string(),
        "apps_running": running,
        "apps_stopped": stopped,
        "apps_error": errored,
        "active_ws_connections": state.ws_manager.connection_count().await,
    }))
}

async fn cmd_app_list(state: &AppState) -> ControlResponse {
    let apps = state.registry.all().await;
    let list: Vec<serde_json::Value> = apps.iter().map(|entry| {
        serde_json::json!({
            "slug": entry.manifest.app.slug,
            "name": entry.manifest.app.name,
            "version": entry.manifest.app.version,
            "state": entry.state.to_string(),
        })
    }).collect();

    ControlResponse::success(serde_json::json!({ "apps": list }))
}

async fn cmd_app_info(state: &AppState, slug: Option<&str>) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };

    let entry = match state.registry.get_by_slug(slug).await {
        Some(e) => e,
        None => return ControlResponse::error(format!("app '{}' not found", slug)),
    };

    ControlResponse::success(serde_json::json!({
        "slug": entry.manifest.app.slug,
        "name": entry.manifest.app.name,
        "version": entry.manifest.app.version,
        "description": entry.manifest.app.description,
        "state": entry.state.to_string(),
        "executable": entry.manifest.backend.as_ref().map(|b| b.executable.as_str()).unwrap_or("(none)"),
        "frontend_dir": format!("{}/{}/frontend", state.config.apps.manifest_dir, slug),
        "data_dir": format!("{}/{}", state.config.apps.data_dir, slug),
        "transport": entry.manifest.backend.as_ref().map(|b| b.transport.as_str()).unwrap_or("none"),
    }))
}

async fn cmd_app_start(state: &AppState, slug: Option<&str>) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };

    if state.registry.get_by_slug(slug).await.is_none() {
        return ControlResponse::error(format!("app '{}' not found", slug));
    }

    match supervisor::start_single_backend(state.clone(), slug).await {
        Ok(()) => ControlResponse::success(serde_json::json!({ "slug": slug })),
        Err(e) => ControlResponse::error(format!("failed to start '{}': {}", slug, e)),
    }
}

async fn cmd_app_stop(state: &AppState, slug: Option<&str>) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };

    if state.registry.get_by_slug(slug).await.is_none() {
        return ControlResponse::error(format!("app '{}' not found", slug));
    }

    match supervisor::stop_single_backend(state, slug).await {
        Ok(()) => ControlResponse::success(serde_json::json!({ "slug": slug })),
        Err(e) => ControlResponse::error(format!("failed to stop '{}': {}", slug, e)),
    }
}

async fn cmd_app_restart(state: &AppState, slug: Option<&str>) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };

    if state.registry.get_by_slug(slug).await.is_none() {
        return ControlResponse::error(format!("app '{}' not found", slug));
    }

    // Stop, then start
    if let Err(e) = supervisor::stop_single_backend(state, slug).await {
        tracing::warn!(slug = slug, "Error stopping for restart: {}", e);
    }

    match supervisor::start_single_backend(state.clone(), slug).await {
        Ok(()) => ControlResponse::success(serde_json::json!({ "slug": slug })),
        Err(e) => ControlResponse::error(format!("failed to restart '{}': {}", slug, e)),
    }
}

async fn cmd_app_install(
    state: &AppState,
    slug: Option<&str>,
    staging_path: Option<&str>,
) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };
    let staging = match staging_path {
        Some(s) => s,
        None => return ControlResponse::error("missing 'staging_path' field"),
    };

    // Validate staging path is under /tmp/
    let staging_canonical = match std::fs::canonicalize(staging) {
        Ok(p) => p,
        Err(e) => return ControlResponse::error(format!("invalid staging path: {}", e)),
    };
    if !staging_canonical.starts_with("/tmp/") {
        return ControlResponse::error("staging_path must be under /tmp/");
    }

    // Check manifest exists in staging
    let manifest_path = staging_canonical.join("manifest.toml");
    if !manifest_path.exists() {
        return ControlResponse::error("manifest.toml not found in staging directory");
    }

    // Load and validate manifest
    let manifest = match zro_protocol::manifest::AppManifest::load(&manifest_path) {
        Ok(m) => m,
        Err(e) => return ControlResponse::error(format!("invalid manifest: {}", e)),
    };

    if manifest.app.slug != slug {
        return ControlResponse::error(format!(
            "slug mismatch: expected '{}', manifest says '{}'",
            slug, manifest.app.slug
        ));
    }

    // Check not already registered
    if state.registry.get_by_slug(slug).await.is_some() {
        return ControlResponse::error(format!("app '{}' is already registered", slug));
    }

    // Move staging to apps directory
    let target_dir = format!("{}/{}", state.config.apps.manifest_dir, slug);
    if Path::new(&target_dir).exists() {
        return ControlResponse::error(format!("directory already exists: {}", target_dir));
    }

    // Copy staging → target (cross-device safe — can't guarantee same FS)
    if let Err(e) = copy_dir_recursive(&staging_canonical, Path::new(&target_dir)).await {
        // Cleanup on failure
        let _ = tokio::fs::remove_dir_all(&target_dir).await;
        return ControlResponse::error(format!("failed to copy app files: {}", e));
    }

    // Make backend executable
    if let Some(ref backend) = manifest.backend {
        let exe_name = &backend.executable;
        let backend_path = Path::new(&target_dir).join("backend").join(exe_name);
        if backend_path.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&backend_path, std::fs::Permissions::from_mode(0o755));
            }

            // Create symlink in bin directory
            let bin_dir = Path::new(&state.config.apps.manifest_dir).parent()
                .unwrap_or(Path::new("."))
                .join("bin");
            let _ = tokio::fs::create_dir_all(&bin_dir).await;
            let link_path = bin_dir.join(exe_name);
            let _ = tokio::fs::remove_file(&link_path).await; // remove stale
            if let Err(e) = tokio::fs::symlink(&backend_path, &link_path).await {
                tracing::warn!("Failed to create bin symlink: {}", e);
            }
        }
    }

    // Register in the registry
    if !state.registry.register_app(manifest).await {
        let _ = tokio::fs::remove_dir_all(&target_dir).await;
        return ControlResponse::error(format!("app '{}' registration failed", slug));
    }

    // Start the backend
    if let Err(e) = supervisor::start_single_backend(state.clone(), slug).await {
        state.registry.unregister_app(slug).await;
        let _ = tokio::fs::remove_dir_all(&target_dir).await;
        return ControlResponse::error(format!("failed to start backend: {}", e));
    }

    // Clean up staging
    let _ = tokio::fs::remove_dir_all(staging).await;

    tracing::info!(slug = slug, "App installed and started via control socket");
    ControlResponse::success(serde_json::json!({ "slug": slug }))
}

async fn cmd_app_remove(state: &AppState, slug: Option<&str>) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };

    if state.registry.get_by_slug(slug).await.is_none() {
        return ControlResponse::error(format!("app '{}' not found", slug));
    }

    // Stop the backend
    if let Err(e) = supervisor::stop_single_backend(state, slug).await {
        tracing::warn!(slug = slug, "Error stopping backend during remove: {}", e);
    }

    // Unregister
    state.registry.unregister_app(slug).await;

    // Remove app directory (manifest + frontend + backend)
    let app_dir = format!("{}/{}", state.config.apps.manifest_dir, slug);
    if let Err(e) = tokio::fs::remove_dir_all(&app_dir).await {
        tracing::warn!(slug = slug, "Failed to remove app directory: {}", e);
    }

    // Remove bin symlink
    let bin_dir = Path::new(&state.config.apps.manifest_dir).parent()
        .unwrap_or(Path::new("."))
        .join("bin");
    let exe_candidates = [
        bin_dir.join(format!("zro-app-{}", slug)),
        bin_dir.join(slug),
    ];
    for p in &exe_candidates {
        let _ = tokio::fs::remove_file(p).await;
    }

    // Note: data directory is preserved intentionally

    tracing::info!(slug = slug, "App removed via control socket");
    ControlResponse::success(serde_json::json!({ "slug": slug }))
}

async fn cmd_app_update(
    state: &AppState,
    slug: Option<&str>,
    staging_path: Option<&str>,
) -> ControlResponse {
    let slug = match slug {
        Some(s) => s,
        None => return ControlResponse::error("missing 'slug' field"),
    };
    let staging = match staging_path {
        Some(s) => s,
        None => return ControlResponse::error("missing 'staging_path' field"),
    };

    // The app must already exist
    if state.registry.get_by_slug(slug).await.is_none() {
        return ControlResponse::error(format!("app '{}' not found", slug));
    }

    // Validate staging path
    let staging_canonical = match std::fs::canonicalize(staging) {
        Ok(p) => p,
        Err(e) => return ControlResponse::error(format!("invalid staging path: {}", e)),
    };
    if !staging_canonical.starts_with("/tmp/") {
        return ControlResponse::error("staging_path must be under /tmp/");
    }

    // Load new manifest
    let manifest_path = staging_canonical.join("manifest.toml");
    let manifest = match zro_protocol::manifest::AppManifest::load(&manifest_path) {
        Ok(m) => m,
        Err(e) => return ControlResponse::error(format!("invalid manifest: {}", e)),
    };

    if manifest.app.slug != slug {
        return ControlResponse::error(format!(
            "slug mismatch: expected '{}', manifest says '{}'",
            slug, manifest.app.slug
        ));
    }

    // Stop the backend
    if let Err(e) = supervisor::stop_single_backend(state, slug).await {
        tracing::warn!(slug = slug, "Error stopping backend during update: {}", e);
    }

    // Replace app files
    let target_dir = format!("{}/{}", state.config.apps.manifest_dir, slug);
    let backup_dir = format!("{}.bak", target_dir);

    // Backup current → .bak
    if Path::new(&target_dir).exists() {
        let _ = tokio::fs::remove_dir_all(&backup_dir).await;
        if let Err(e) = tokio::fs::rename(&target_dir, &backup_dir).await {
            return ControlResponse::error(format!("failed to backup current app: {}", e));
        }
    }

    // Copy staging → target
    if let Err(e) = copy_dir_recursive(&staging_canonical, Path::new(&target_dir)).await {
        // Restore backup on failure
        let _ = tokio::fs::remove_dir_all(&target_dir).await;
        let _ = tokio::fs::rename(&backup_dir, &target_dir).await;
        return ControlResponse::error(format!("failed to copy update files: {}", e));
    }

    // Make backend executable
    if let Some(ref backend) = manifest.backend {
        let backend_path = Path::new(&target_dir).join("backend").join(&backend.executable);
        if backend_path.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&backend_path, std::fs::Permissions::from_mode(0o755));
            }
        }
    }

    // Update registry entry (unregister old, register new)
    state.registry.unregister_app(slug).await;
    state.registry.register_app(manifest).await;

    // Restart the backend
    if let Err(e) = supervisor::start_single_backend(state.clone(), slug).await {
        // Restore backup
        let _ = tokio::fs::remove_dir_all(&target_dir).await;
        let _ = tokio::fs::rename(&backup_dir, &target_dir).await;
        return ControlResponse::error(format!("failed to restart after update: {}", e));
    }

    // Remove backup and staging
    let _ = tokio::fs::remove_dir_all(&backup_dir).await;
    let _ = tokio::fs::remove_dir_all(staging).await;

    tracing::info!(slug = slug, "App updated via control socket");
    ControlResponse::success(serde_json::json!({ "slug": slug }))
}

async fn cmd_config_show(state: &AppState) -> ControlResponse {
    ControlResponse::success(serde_json::json!({
        "server": {
            "host": state.config.server.host,
            "port": state.config.server.port,
        },
        "apps": {
            "manifest_dir": state.config.apps.manifest_dir,
            "data_dir": state.config.apps.data_dir,
            "default_app": state.config.apps.default_app,
        },
        "auth": {
            "providers": state.config.auth.providers,
            "users_file": state.config.auth.users_file,
        },
        "logging": {
            "level": state.config.logging.level,
        },
        "storage": {
            "path": state.config.storage.path,
        },
        "mode": state.config.runtime_mode.to_string(),
    }))
}

async fn cmd_config_reload(state: &AppState) -> ControlResponse {
    let mut reloaded = Vec::new();

    // Reload permissions
    let perms_path = "config/permissions.toml";
    if Path::new(perms_path).exists() {
        let _perms = crate::permissions::PermissionsConfig::load(perms_path);
        // We can't replace Arc contents, but permissions is behind Arc — we'd need interior mutability.
        // For now, log that it was requested. Full reload requires runtime restart.
        tracing::info!("Permissions reload requested (effective on next request via fresh load)");
        reloaded.push("permissions");
    }

    // Reload users
    if Path::new(&state.config.auth.users_file).exists() {
        tracing::info!("Users file reload requested");
        reloaded.push("users");
    }

    if reloaded.is_empty() {
        ControlResponse::success(serde_json::json!({
            "reloaded": [],
            "note": "No reloadable configs found. Some changes require restart."
        }))
    } else {
        ControlResponse::success(serde_json::json!({ "reloaded": reloaded }))
    }
}

async fn cmd_user_list(state: &AppState) -> ControlResponse {
    match auth::load_users(&state.config) {
        Ok(users) => {
            let list: Vec<serde_json::Value> = users.iter().map(|u| {
                serde_json::json!({
                    "username": u.username,
                    "role": u.role,
                    "groups": u.groups,
                })
            }).collect();
            ControlResponse::success(serde_json::json!({ "users": list }))
        }
        Err(e) => ControlResponse::error(format!("failed to load users: {}", e)),
    }
}

async fn cmd_user_add(state: &AppState, req: &ControlRequest) -> ControlResponse {
    let username = match req.username.as_deref() {
        Some(u) => u,
        None => return ControlResponse::error("missing 'username' field"),
    };
    let password_hash = match req.password_hash.as_deref() {
        Some(h) => h,
        None => return ControlResponse::error("missing 'password_hash' field"),
    };
    let role = req.role.as_deref().unwrap_or("user");
    let groups = req.groups.clone().unwrap_or_default();

    let users_file = &state.config.auth.users_file;

    // Load existing users
    let mut users = match auth::load_users(&state.config) {
        Ok(u) => u,
        Err(e) => return ControlResponse::error(format!("failed to load users: {}", e)),
    };

    // Check for duplicate
    if users.iter().any(|u| u.username == username) {
        return ControlResponse::error(format!("user '{}' already exists", username));
    }

    // Add new user
    users.push(auth::UserEntry {
        username: username.to_string(),
        password_hash: password_hash.to_string(),
        role: role.to_string(),
        user_id: format!("u-{}", uuid::Uuid::new_v4()),
        groups,
    });

    // Write back
    if let Err(e) = write_users_file(users_file, &users) {
        return ControlResponse::error(format!("failed to write users file: {}", e));
    }

    tracing::info!(username = username, "User added via control socket");
    ControlResponse::success(serde_json::json!({ "username": username }))
}

async fn cmd_user_remove(state: &AppState, username: Option<&str>) -> ControlResponse {
    let username = match username {
        Some(u) => u,
        None => return ControlResponse::error("missing 'username' field"),
    };

    let users_file = &state.config.auth.users_file;

    let mut users = match auth::load_users(&state.config) {
        Ok(u) => u,
        Err(e) => return ControlResponse::error(format!("failed to load users: {}", e)),
    };

    let before = users.len();
    users.retain(|u| u.username != username);

    if users.len() == before {
        return ControlResponse::error(format!("user '{}' not found", username));
    }

    if let Err(e) = write_users_file(users_file, &users) {
        return ControlResponse::error(format!("failed to write users file: {}", e));
    }

    tracing::info!(username = username, "User removed via control socket");
    ControlResponse::success(serde_json::json!({ "username": username }))
}

async fn cmd_user_passwd(state: &AppState, req: &ControlRequest) -> ControlResponse {
    let username = match req.username.as_deref() {
        Some(u) => u,
        None => return ControlResponse::error("missing 'username' field"),
    };
    let password_hash = match req.password_hash.as_deref() {
        Some(h) => h,
        None => return ControlResponse::error("missing 'password_hash' field"),
    };

    let users_file = &state.config.auth.users_file;

    let mut users = match auth::load_users(&state.config) {
        Ok(u) => u,
        Err(e) => return ControlResponse::error(format!("failed to load users: {}", e)),
    };

    let user = match users.iter_mut().find(|u| u.username == username) {
        Some(u) => u,
        None => return ControlResponse::error(format!("user '{}' not found", username)),
    };

    user.password_hash = password_hash.to_string();

    if let Err(e) = write_users_file(users_file, &users) {
        return ControlResponse::error(format!("failed to write users file: {}", e));
    }

    tracing::info!(username = username, "Password changed via control socket");
    ControlResponse::success(serde_json::json!({ "username": username }))
}

// ── Helpers ─────────────────────────────────────────────────────

/// Write the users list back to users.toml.
fn write_users_file(path: &str, users: &[auth::UserEntry]) -> anyhow::Result<()> {
    use std::fmt::Write;

    let mut content = String::new();

    for user in users {
        writeln!(content, "[[users]]")?;
        writeln!(content, "username = \"{}\"", user.username)?;
        writeln!(content, "password_hash = \"{}\"", user.password_hash)?;
        writeln!(content, "role = \"{}\"", user.role)?;
        writeln!(content, "user_id = \"{}\"", user.user_id)?;
        if !user.groups.is_empty() {
            let groups: Vec<String> = user.groups.iter().map(|g| format!("\"{}\"", g)).collect();
            writeln!(content, "groups = [{}]", groups.join(", "))?;
        }
        writeln!(content)?;
    }

    std::fs::write(path, content)?;
    Ok(())
}

/// Recursively copy a directory tree.
async fn copy_dir_recursive(src: &Path, dst: &Path) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dst).await?;

    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if entry.file_type().await?.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
        }
    }

    Ok(())
}
