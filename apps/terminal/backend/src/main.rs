use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Deserialize;
use tokio::sync::{mpsc, Mutex, RwLock};

use zro_sdk::app::{EventEmitter, ZroApp};
use zro_sdk::context::AppContext;
use zro_sdk::modules::dev::{DevModule, LogLevel};
use zro_sdk::modules::ipc::IpcModule;
use zro_sdk::modules::lifecycle::LifecycleModule;
use zro_sdk::modules::notifications::NotificationsModule;
use zro_sdk::modules::state::StateModule;

#[derive(Deserialize)]
struct TermInput {
    data: String,
}

#[derive(Deserialize)]
struct TermResize {
    cols: u16,
    rows: u16,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    pair: portable_pty::PtyPair,
    _shutdown_tx: mpsc::Sender<()>,
}

type Sessions = Arc<RwLock<HashMap<String, Arc<Mutex<PtySession>>>>>;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let sessions: Sessions = Arc::new(RwLock::new(HashMap::new()));

    // We'll set the emitter after build
    let emitter_holder: Arc<tokio::sync::OnceCell<EventEmitter>> =
        Arc::new(tokio::sync::OnceCell::new());

    let lifecycle = LifecycleModule::new()
        .grace_period(Duration::from_secs(5))
        .on_connect({
            let sessions = sessions.clone();
            let emitter_holder = emitter_holder.clone();
            move |ctx: AppContext| {
                let sessions = sessions.clone();
                let emitter_holder = emitter_holder.clone();
                async move {
                    let instance_id = ctx.instance_id.clone().unwrap_or_default();

                    // If a PTY session already exists, reuse it (pop-out scenario)
                    {
                        let sess = sessions.read().await;
                        if sess.contains_key(&instance_id) {
                            tracing::info!(instance = %instance_id, "Client reconnected, reusing existing PTY");
                            return;
                        }
                    }

                    tracing::info!(instance = %instance_id, "Client connected, spawning PTY");

                    let pty_system = NativePtySystem::default();
                    let pair = match pty_system.openpty(PtySize {
                        rows: 24,
                        cols: 80,
                        pixel_width: 0,
                        pixel_height: 0,
                    }) {
                        Ok(p) => p,
                        Err(e) => {
                            tracing::error!("Failed to open PTY: {}", e);
                            return;
                        }
                    };

                    let mut cmd = CommandBuilder::new("/bin/bash");
                    cmd.env("TERM", "xterm-256color");

                    let _child = match pair.slave.spawn_command(cmd) {
                        Ok(c) => c,
                        Err(e) => {
                            tracing::error!("Failed to spawn shell: {}", e);
                            return;
                        }
                    };

                    let reader = match pair.master.try_clone_reader() {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::error!("Failed to clone PTY reader: {}", e);
                            return;
                        }
                    };
                    let writer = match pair.master.take_writer() {
                        Ok(w) => w,
                        Err(e) => {
                            tracing::error!("Failed to take PTY writer: {}", e);
                            return;
                        }
                    };

                    let (shutdown_tx, _shutdown_rx) = mpsc::channel::<()>(1);

                    let session = PtySession {
                        writer,
                        pair,
                        _shutdown_tx: shutdown_tx,
                    };

                    {
                        let mut sess = sessions.write().await;
                        sess.insert(instance_id.clone(), Arc::new(Mutex::new(session)));
                    }

                    // Spawn background task to read PTY output and emit events
                    let emitter = emitter_holder.get().cloned();
                    let output_instance_id = instance_id.clone();
                    tokio::task::spawn_blocking(move || {
                        let rt = tokio::runtime::Handle::current();
                        let mut reader = reader;
                        let mut buf = [0u8; 4096];
                        loop {
                            match reader.read(&mut buf) {
                                Ok(0) => {
                                    if let Some(ref em) = emitter {
                                        let _ = rt.block_on(em.emit_to(
                                            &output_instance_id,
                                            "term:exit",
                                            serde_json::json!({ "code": 0 }),
                                        ));
                                    }
                                    break;
                                }
                                Ok(n) => {
                                    let data =
                                        String::from_utf8_lossy(&buf[..n]).to_string();
                                    if let Some(ref em) = emitter {
                                        if let Err(e) = rt.block_on(em.emit_to(
                                            &output_instance_id,
                                            "term:output",
                                            serde_json::json!({ "data": data }),
                                        )) {
                                            // Don't break — the client may reconnect (pop-out).
                                            tracing::debug!(
                                                "Failed to send PTY output (client may be reconnecting): {}",
                                                e
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::debug!(
                                        "PTY read error (likely closed): {}",
                                        e
                                    );
                                    break;
                                }
                            }
                        }
                    });

                    tracing::info!(instance = %instance_id, "PTY session started");
                }
            }
        })
        .on_disconnect({
            move |ctx: AppContext| {
                async move {
                    let instance_id = ctx.instance_id.clone().unwrap_or_default();

                    // Track disconnect events for visibility; cleanup is done in on_timeout.
                    tracing::info!(
                        instance = %instance_id,
                        "Client disconnected, awaiting lifecycle grace timeout"
                    );
                }
            }
        })
        .on_timeout({
            let sessions = sessions.clone();
            move |ctx: AppContext| {
                let sessions = sessions.clone();
                async move {
                    let instance_id = ctx.instance_id.clone().unwrap_or_default();

                    // Grace period expired — actually clean up
                    let mut sess = sessions.write().await;
                    if sess.remove(&instance_id).is_some() {
                        tracing::info!(instance = %instance_id, "PTY session cleaned up (grace period expired)");
                    }
                }
            }
        });

    let app = ZroApp::builder()
        .module(StateModule::new())
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(lifecycle)
        // ── term_input — write to PTY ───────────────────────────────
        .command("term_input", {
            let sessions = sessions.clone();
            move |params, ctx: AppContext| {
                let sessions = sessions.clone();
                Box::pin(async move {
                    let input: TermInput =
                        serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let instance_id = ctx.instance_id.unwrap_or_default();
                    let sess_map = sessions.read().await;
                    if let Some(session) = sess_map.get(&instance_id) {
                        let mut session = session.lock().await;
                        session
                            .writer
                            .write_all(input.data.as_bytes())
                            .map_err(|e| format!("PTY write error: {}", e))?;
                    }
                    Ok(serde_json::json!({ "ok": true }))
                })
            }
        })
        // ── term_resize — resize PTY ────────────────────────────────
        .command("term_resize", {
            let sessions = sessions.clone();
            move |params, ctx: AppContext| {
                let sessions = sessions.clone();
                Box::pin(async move {
                    let resize: TermResize =
                        serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let instance_id = ctx.instance_id.unwrap_or_default();
                    let sess_map = sessions.read().await;
                    if let Some(session) = sess_map.get(&instance_id) {
                        let session = session.lock().await;
                        session
                            .pair
                            .master
                            .resize(PtySize {
                                rows: resize.rows,
                                cols: resize.cols,
                                pixel_width: 0,
                                pixel_height: 0,
                            })
                            .map_err(|e| format!("PTY resize error: {}", e))?;
                    }
                    Ok(serde_json::json!({ "ok": true }))
                })
            }
        })
        .build()
        .await?;

    // Set the emitter so on_client_connected can use it
    let _ = emitter_holder.set(app.emitter());

    app.run().await?;
    Ok(())
}
