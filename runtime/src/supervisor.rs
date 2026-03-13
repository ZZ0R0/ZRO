use std::pin::Pin;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::{Child, Command};

use zro_protocol::constants::HANDSHAKE_TIMEOUT_SECS;
use zro_protocol::messages::*;

use crate::gateway::state::AppState as GatewayState;
use crate::ipc::channel::IpcChannel;
use crate::ipc::server;
use crate::registry::AppState;

/// Track running backend processes.
#[allow(dead_code)]
struct BackendProcess {
    child: Child,
    slug: String,
}

/// Start all backends defined in the registry.
pub async fn start_all_backends(state: GatewayState) -> anyhow::Result<()> {
    let apps = state.registry.all().await;

    for app_entry in &apps {
        let slug = app_entry.manifest.app.slug.clone();
        if let Err(e) = start_single_backend(state.clone(), &slug).await {
            tracing::error!(slug = %slug, "Failed to start backend: {}", e);
        }
    }

    Ok(())
}

/// Start a single backend process by slug. The app must already be registered.
pub async fn start_single_backend(state: GatewayState, slug: &str) -> anyhow::Result<()> {
    let app_entry = state.registry.get_by_slug(slug).await
        .ok_or_else(|| anyhow::anyhow!("app '{}' not found in registry", slug))?;

    let manifest = &app_entry.manifest;
    let config = &state.config;

    let backend = match &manifest.backend {
        Some(b) => b,
        None => {
            tracing::info!(slug = slug, "Frontend-only app, no backend to start");
            state.registry.set_state(slug, AppState::Running).await;
            return Ok(());
        }
    };

    tracing::info!(slug = slug, "Starting backend for {}", manifest.app.name);

        // Create IPC socket
        let ipc_dir = &config.control.ipc_dir;
        let (listener, socket_path) = server::create_socket(slug, Some(ipc_dir)).await?;

        // Determine the executable path
        let exe_name = &backend.executable;
        // Look for the binary in ./bin/ first, then PATH
        let exe_path = if Path::new(&format!("./bin/{}", exe_name)).exists() {
            format!("./bin/{}", exe_name)
        } else {
            exe_name.clone()
        };

        // Create data directory for this app
        let data_dir = format!("{}/{}", config.apps.data_dir, slug);
        tokio::fs::create_dir_all(&data_dir).await?;

        // Spawn the backend process
        // If `command` is set (e.g. "python3", "node"), spawn as: command [args...] executable
        // Otherwise spawn the executable directly.
        let child = if let Some(ref cmd) = backend.command {
            let mut c = Command::new(cmd);
            for arg in &backend.args {
                c.arg(arg);
            }
            c.arg(&exe_path);
            c.env("ZRO_APP_SLUG", slug)
                .env("ZRO_IPC_SOCKET", socket_path.to_str().unwrap())
                .env("ZRO_DATA_DIR", &data_dir)
                .env("ZRO_LOG_LEVEL", &config.logging.level)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .kill_on_drop(true)
                .spawn()
        } else {
            Command::new(&exe_path)
                .env("ZRO_APP_SLUG", slug)
                .env("ZRO_IPC_SOCKET", socket_path.to_str().unwrap())
                .env("ZRO_DATA_DIR", &data_dir)
                .env("ZRO_LOG_LEVEL", &config.logging.level)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .kill_on_drop(true)
                .spawn()
        };

        let mut child = match child {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(slug = slug, "Failed to spawn backend: {}", e);
                state.registry.set_state(slug, AppState::Error(format!("spawn failed: {}", e))).await;
                anyhow::bail!("Failed to spawn backend '{}': {}", slug, e);
            }
        };

        // Wait for the backend to connect (with timeout)
        let accept_result = tokio::time::timeout(
            Duration::from_secs(HANDSHAKE_TIMEOUT_SECS),
            listener.accept(),
        ).await;

        let stream = match accept_result {
            Ok(Ok((stream, _))) => stream,
            Ok(Err(e)) => {
                tracing::error!(slug = slug, "IPC accept failed: {}", e);
                state.registry.set_state(slug, AppState::Error(format!("ipc accept: {}", e))).await;
                let _ = child.kill().await;
                anyhow::bail!("IPC accept failed for '{}': {}", slug, e);
            }
            Err(_) => {
                tracing::error!(slug = slug, "Handshake timeout ({}s)", HANDSHAKE_TIMEOUT_SECS);
                state.registry.set_state(slug, AppState::Error("handshake timeout".into())).await;
                let _ = child.kill().await;
                anyhow::bail!("Handshake timeout for '{}' ({}s)", slug, HANDSHAKE_TIMEOUT_SECS);
            }
        };

        let (reader, writer) = stream.into_split();
        let channel = IpcChannel::new(reader, writer);

        // Wait for Hello message
        let hello_result = tokio::time::timeout(
            Duration::from_secs(5),
            channel.recv(),
        ).await;

        match hello_result {
            Ok(Ok(msg)) if msg.msg_type == "Hello" => {
                // Validate protocol version
                if let Ok(hello) = serde_json::from_value::<HelloPayload>(msg.payload.clone()) {
                    if hello.protocol_version != zro_protocol::constants::PROTOCOL_VERSION {
                        tracing::error!(
                            slug = slug,
                            expected = zro_protocol::constants::PROTOCOL_VERSION,
                            got = hello.protocol_version,
                            "Protocol version mismatch"
                        );
                        state.registry.set_state(slug, AppState::Error(
                            format!("protocol version mismatch: expected {}, got {}", zro_protocol::constants::PROTOCOL_VERSION, hello.protocol_version)
                        )).await;
                        let _ = child.kill().await;
                        anyhow::bail!("Protocol version mismatch for '{}'", slug);
                    }
                }

                tracing::info!(slug = slug, "Received Hello from {}", slug);

                // Send HelloAck
                let ack = IpcMessage::new("HelloAck", serde_json::to_value(HelloAckPayload {
                    status: "ok".to_string(),
                    runtime_version: env!("CARGO_PKG_VERSION").to_string(),
                })?);
                channel.send(&ack).await?;

                // Register channel
                state.ipc_router.register(slug, channel.clone()).await;
                state.registry.set_state(slug, AppState::Running).await;

                tracing::info!(slug = slug, "Backend ready");

                // Spawn a task to read messages from this backend
                let state_clone = state.clone();
                let slug_owned = slug.to_string();
                tokio::spawn(async move {
                    backend_reader_loop(state_clone, slug_owned, channel).await;
                });
            }
            _ => {
                tracing::error!(slug = slug, "Invalid handshake from {}", slug);
                state.registry.set_state(slug, AppState::Error("invalid handshake".into())).await;
                let _ = child.kill().await;
                anyhow::bail!("Invalid handshake from '{}'", slug);
            }
        }

        // Store the child process handle
        state.add_process(slug, child).await;

    Ok(())
}

/// Stop a single backend process by slug.
pub async fn stop_single_backend(state: &GatewayState, slug: &str) -> anyhow::Result<()> {
    tracing::info!(slug = slug, "Stopping backend");
    state.registry.set_state(slug, AppState::Stopping).await;

    let shutdown_msg = IpcMessage::new("Shutdown", serde_json::to_value(ShutdownPayload {
        reason: "app_unregister".to_string(),
        grace_period_ms: state.config.supervisor.shutdown_timeout_seconds * 1000,
    })?);

    if let Err(e) = state.ipc_router.send_message(slug, &shutdown_msg).await {
        tracing::warn!(slug = slug, "Failed to send shutdown: {}", e);
    }

    state.ipc_router.unregister(slug).await;
    server::remove_socket(slug, Some(&state.config.control.ipc_dir)).await;
    state.kill_process(slug).await;
    state.registry.set_state(slug, AppState::Stopped).await;

    tracing::info!(slug = slug, "Backend stopped");
    Ok(())
}

/// Read loop for messages coming from a backend.
async fn backend_reader_loop(state: GatewayState, slug: String, channel: IpcChannel) {
    loop {
        match channel.recv().await {
            Ok(msg) => {
                match msg.msg_type.as_str() {
                    "HttpResponse" => {
                        // Deliver to the pending request
                        if !state.ipc_router.deliver_response(msg).await {
                            tracing::warn!(slug = slug, "No pending request for HttpResponse");
                        }
                    }
                    "WsMessage" | "WsBroadcast" => {
                        // Legacy v1 event paths — backends should use EventEmit instead.
                        tracing::warn!(
                            slug = slug,
                            msg_type = msg.msg_type.as_str(),
                            "Received deprecated {} message. Use EventEmit instead.",
                            msg.msg_type
                        );
                    }
                    "CommandResponse" => {
                        // Deliver to the pending command request (same correlation as HttpResponse)
                        if !state.ipc_router.deliver_response(msg).await {
                            tracing::warn!(slug = slug, "No pending request for CommandResponse");
                        }
                    }
                    "EventEmit" => {
                        // Route event to WS clients based on target
                        if let Ok(payload) = serde_json::from_value::<EventEmitPayload>(msg.payload) {
                            match &payload.target {
                                EventTarget::Instance { instance_id } => {
                                    tracing::debug!(
                                        slug = slug,
                                        instance = %instance_id,
                                        event = %payload.event,
                                        "EventEmit: routing event to instance"
                                    );
                                    let event_msg = serde_json::json!({
                                        "type": "event",
                                        "instance": instance_id,
                                        "event": payload.event,
                                        "payload": payload.payload,
                                    });
                                    state.ws_manager.send_to_instance(instance_id, &event_msg).await;
                                }
                                EventTarget::Broadcast => {
                                    let event_msg = serde_json::json!({
                                        "type": "event",
                                        "event": payload.event,
                                        "payload": payload.payload,
                                    });
                                    state.ws_manager.broadcast_to_app(&slug, &event_msg).await;
                                }
                                EventTarget::Session { session_id } => {
                                    let event_msg = serde_json::json!({
                                        "type": "event",
                                        "event": payload.event,
                                        "payload": payload.payload,
                                    });
                                    state.ws_manager.broadcast_to_session(session_id, &event_msg).await;
                                }
                                EventTarget::System => {
                                    let event_msg = serde_json::json!({
                                        "type": "event",
                                        "event": payload.event,
                                        "payload": payload.payload,
                                    });
                                    state.ws_manager.broadcast_to_all(&event_msg).await;
                                }
                            }
                        }
                    }
                    "ShutdownAck" => {
                        tracing::info!(slug = slug, "Backend acknowledged shutdown");
                        break;
                    }
                    "Log" => {
                        if let Ok(payload) = serde_json::from_value::<LogPayload>(msg.payload) {
                            match payload.level.as_str() {
                                "error" => tracing::error!(slug = slug, "{}", payload.message),
                                "warn" => tracing::warn!(slug = slug, "{}", payload.message),
                                "info" => tracing::info!(slug = slug, "{}", payload.message),
                                "debug" => tracing::debug!(slug = slug, "{}", payload.message),
                                _ => tracing::trace!(slug = slug, "{}", payload.message),
                            }
                        }
                    }
                    other => {
                        tracing::warn!(slug = slug, "Unknown message from backend: {}", other);
                    }
                }
            }
            Err(e) => {
                tracing::error!(slug = slug, "IPC read error: {}", e);
                state.registry.set_state(&slug, AppState::Error("ipc disconnected".into())).await;

                // Clean up stale IPC state
                state.ipc_router.unregister(&slug).await;
                server::remove_socket(&slug, Some(&state.config.control.ipc_dir)).await;
                state.kill_process(&slug).await;

                // Spawn auto-restart in a separate task so this reader loop can exit
                let restart_state = state.clone();
                let restart_slug = slug.clone();
                tokio::spawn(auto_restart_backend(restart_state, restart_slug));
                break;
            }
        }
    }
}

/// Auto-restart a crashed backend with exponential backoff.
/// Returns a boxed future to break the async recursion cycle
/// (start_single_backend → backend_reader_loop → auto_restart_backend → start_single_backend).
fn auto_restart_backend(state: GatewayState, slug: String) -> Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(async move {
        let max_attempts = state.config.supervisor.max_restart_attempts;
        let base_delay = state.config.supervisor.restart_delay_seconds;

    for attempt in 1..=max_attempts {
        let delay = base_delay * (1u64 << (attempt - 1).min(5));
        tracing::info!(
            slug = slug,
            attempt = attempt,
            max = max_attempts,
            delay_secs = delay,
            "Attempting backend restart"
        );
        tokio::time::sleep(Duration::from_secs(delay)).await;

        match start_single_backend(state.clone(), &slug).await {
            Ok(()) => {
                tracing::info!(slug = slug, "Backend restarted successfully on attempt {}", attempt);
                return;
            }
            Err(e) => {
                tracing::error!(slug = slug, attempt = attempt, "Restart failed: {}", e);
            }
        }
    }

    tracing::error!(slug = slug, "Backend failed to restart after {} attempts", max_attempts);
    state.registry.set_state(&slug, AppState::Error(
        format!("crashed — {} restart attempts exhausted", max_attempts)
    )).await;
    }) // close Box::pin
}

/// Send shutdown to all backends and wait for them to stop.
pub async fn shutdown_all_backends(state: GatewayState) {
    let slugs = state.registry.all_slugs().await;

    for slug in &slugs {
        tracing::info!(slug = slug, "Sending shutdown to backend");
        state.registry.set_state(slug, AppState::Stopping).await;

        let shutdown_msg = IpcMessage::new("Shutdown", serde_json::to_value(ShutdownPayload {
            reason: "runtime_shutdown".to_string(),
            grace_period_ms: state.config.supervisor.shutdown_timeout_seconds * 1000,
        }).unwrap());

        if let Err(e) = state.ipc_router.send_message(slug, &shutdown_msg).await {
            tracing::warn!(slug = slug, "Failed to send shutdown: {}", e);
        }

        state.ipc_router.unregister(slug).await;
        server::remove_socket(slug, Some(&state.config.control.ipc_dir)).await;
    }

    // Kill remaining processes
    state.kill_all_processes().await;

    for slug in &slugs {
        state.registry.set_state(slug, AppState::Stopped).await;
    }
}
