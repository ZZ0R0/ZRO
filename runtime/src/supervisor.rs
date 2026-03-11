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
    let config = &state.config;

    for app_entry in &apps {
        let manifest = &app_entry.manifest;
        let slug = &manifest.app.slug;

        tracing::info!(slug = slug, "Starting backend for {}", manifest.app.name);

        // Create IPC socket
        let (listener, socket_path) = server::create_socket(slug).await?;

        // Determine the executable path
        let exe_name = &manifest.backend.executable;
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
        let child = if let Some(ref cmd) = manifest.backend.command {
            let mut c = Command::new(cmd);
            for arg in &manifest.backend.args {
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
                continue;
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
                continue;
            }
            Err(_) => {
                tracing::error!(slug = slug, "Handshake timeout ({}s)", HANDSHAKE_TIMEOUT_SECS);
                state.registry.set_state(slug, AppState::Error("handshake timeout".into())).await;
                let _ = child.kill().await;
                continue;
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
                        continue;
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
                let slug_clone = slug.clone();
                tokio::spawn(async move {
                    backend_reader_loop(state_clone, slug_clone, channel).await;
                });
            }
            _ => {
                tracing::error!(slug = slug, "Invalid handshake from {}", slug);
                state.registry.set_state(slug, AppState::Error("invalid handshake".into())).await;
                let _ = child.kill().await;
            }
        }

        // Store the child process handle
        state.add_process(slug, child).await;
    }

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
                break;
            }
        }
    }
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
        server::remove_socket(slug).await;
    }

    // Kill remaining processes
    state.kill_all_processes().await;

    for slug in &slugs {
        state.registry.set_state(slug, AppState::Stopped).await;
    }
}
