use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use base64::Engine;
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tracing;

use zro_protocol::messages::*;
use zro_protocol::types::{SessionId, SessionInfo};
use zro_protocol::constants::PROTOCOL_VERSION;

use crate::context::AppContext;

#[derive(Debug, thiserror::Error)]
pub enum ZroSdkError {
    #[error("IPC connection failed: {0}")]
    IpcConnectionFailed(String),

    #[error("IPC handshake failed: {0}")]
    HandshakeFailed(String),

    #[error("Message serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Environment variable missing: {0}")]
    EnvMissing(String),

    #[error("Handler error: {0}")]
    HandlerError(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Protocol error: {0}")]
    Protocol(#[from] zro_protocol::errors::ProtocolError),
}

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// A command handler function (req/resp — used for WS invoke and HTTP API).
/// Use `#[zro::command]` to auto-generate this signature from normal async functions.
pub type CommandFn = Arc<
    dyn Fn(serde_json::Value, AppContext) -> BoxFuture<Result<serde_json::Value, String>>
        + Send
        + Sync,
>;

/// An event handler function (fire-and-forget — used for WS emit/events).
/// Does not return a result since events are fire-and-forget.
pub type EventFn = Arc<
    dyn Fn(serde_json::Value, AppContext) -> BoxFuture<()>
        + Send
        + Sync,
>;

pub type LifecycleHandler = Arc<dyn Fn(AppContext) -> BoxFuture<()> + Send + Sync>;

// ── EventEmitter ────────────────────────────────────────────────

/// Cloneable handle for emitting events from outside command handlers.
/// Obtain via `ZroApp::emitter()` before calling `.run()`.
#[derive(Clone)]
pub struct EventEmitter {
    writer: Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>,
}

impl EventEmitter {
    /// Emit an event to a specific client instance.
    pub async fn emit_to(
        &self,
        instance_id: &str,
        event: &str,
        payload: serde_json::Value,
    ) -> Result<(), ZroSdkError> {
        let emit = EventEmitPayload {
            event: event.to_string(),
            payload,
            target: EventTarget::Instance {
                instance_id: instance_id.to_string(),
            },
        };
        let msg = IpcMessage::new("EventEmit", serde_json::to_value(emit)?);
        let mut w = self.writer.lock().await;
        write_message(&mut *w, &msg).await?;
        Ok(())
    }

    /// Broadcast an event to all connected clients of this app.
    pub async fn emit(
        &self,
        event: &str,
        payload: serde_json::Value,
    ) -> Result<(), ZroSdkError> {
        let emit = EventEmitPayload {
            event: event.to_string(),
            payload,
            target: EventTarget::Broadcast,
        };
        let msg = IpcMessage::new("EventEmit", serde_json::to_value(emit)?);
        let mut w = self.writer.lock().await;
        write_message(&mut *w, &msg).await?;
        Ok(())
    }
}

// ── Builder ─────────────────────────────────────────────────────

/// Builder for configuring a ZRO application.
pub struct ZroAppBuilder {
    commands: HashMap<String, CommandFn>,
    event_handlers: HashMap<String, EventFn>,
    lifecycle_handlers: HashMap<String, LifecycleHandler>,
}

/// Main SDK entry point for zro backend applications.
///
/// Supports three communication channels:
/// - **WS invoke** (req/resp): registered via `.command(name, handler)`
/// - **WS event** (fire-and-forget): registered via `.on_event(name, handler)`
/// - **HTTP API** (req/resp): auto-routed to `.command()` handlers
///
/// Lifecycle hooks are registered via `.on("client:connected", handler)` etc.
pub struct ZroApp {
    slug: String,
    data_dir: PathBuf,
    commands: HashMap<String, CommandFn>,
    event_handlers: HashMap<String, EventFn>,
    lifecycle_handlers: HashMap<String, LifecycleHandler>,
    writer: Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>,
    reader: Mutex<tokio::net::unix::OwnedReadHalf>,
}

impl ZroAppBuilder {
    /// Register a command handler (for WS invoke and HTTP API requests).
    ///
    /// The handler must match the `CommandFn` signature. Use `#[zro::command]`
    /// to auto-generate this from a normal async function.
    pub fn command(
        mut self,
        name: &str,
        handler: impl Fn(serde_json::Value, AppContext) -> BoxFuture<Result<serde_json::Value, String>>
            + Send
            + Sync
            + 'static,
    ) -> Self {
        self.commands.insert(name.to_string(), Arc::new(handler));
        self
    }

    /// Register an event handler (for WS emit — fire-and-forget events from clients).
    ///
    /// Event handlers do not return a value since events are fire-and-forget.
    /// The event name matches what the client sends via `conn.emit(event, data)`.
    pub fn on_event<F, Fut>(mut self, event: &str, handler: F) -> Self
    where
        F: Fn(serde_json::Value, AppContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.event_handlers
            .insert(event.to_string(), Arc::new(move |data, ctx| Box::pin(handler(data, ctx))));
        self
    }

    /// Register a lifecycle event handler.
    ///
    /// Supported events: `"client:connected"`, `"client:disconnected"`,
    /// `"client:reconnected"`.
    ///
    /// ```ignore
    /// ZroApp::builder()
    ///     .on("client:connected", |ctx: AppContext| async move {
    ///         println!("Client {} connected", ctx.instance_id.unwrap_or_default());
    ///     })
    /// ```
    pub fn on<F, Fut>(mut self, event: &str, handler: F) -> Self
    where
        F: Fn(AppContext) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        self.lifecycle_handlers
            .insert(event.to_string(), Arc::new(move |ctx| Box::pin(handler(ctx))));
        self
    }

    /// Build and connect to the runtime. Performs the IPC handshake.
    pub async fn build(self) -> Result<ZroApp, ZroSdkError> {
        // Initialize tracing
        let log_level = std::env::var("ZRO_LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
        let filter = tracing_subscriber::EnvFilter::try_new(&log_level)
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(true)
            .init();

        let slug = std::env::var("ZRO_APP_SLUG")
            .map_err(|_| ZroSdkError::EnvMissing("ZRO_APP_SLUG".into()))?;
        let socket_path = std::env::var("ZRO_IPC_SOCKET")
            .map_err(|_| ZroSdkError::EnvMissing("ZRO_IPC_SOCKET".into()))?;
        let data_dir = PathBuf::from(
            std::env::var("ZRO_DATA_DIR")
                .map_err(|_| ZroSdkError::EnvMissing("ZRO_DATA_DIR".into()))?,
        );

        tokio::fs::create_dir_all(&data_dir).await?;
        tracing::info!(slug = %slug, "Connecting to runtime...");

        let stream = UnixStream::connect(&socket_path)
            .await
            .map_err(|e| ZroSdkError::IpcConnectionFailed(format!("{}: {}", socket_path, e)))?;
        let (reader, mut writer) = stream.into_split();

        // Hello handshake
        let hello = IpcMessage::new(
            "Hello",
            serde_json::to_value(HelloPayload {
                slug: slug.clone(),
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                protocol_version: PROTOCOL_VERSION,
            })?,
        );
        write_message(&mut writer, &hello).await?;

        let mut reader = reader;
        let ack = read_message(&mut reader).await?;
        if ack.msg_type != "HelloAck" {
            return Err(ZroSdkError::HandshakeFailed(format!(
                "Expected HelloAck, got {}",
                ack.msg_type
            )));
        }
        let ack_payload: HelloAckPayload = serde_json::from_value(ack.payload)?;
        if ack_payload.status != "ok" {
            return Err(ZroSdkError::HandshakeFailed(format!(
                "HelloAck status: {}",
                ack_payload.status
            )));
        }

        tracing::info!(
            slug = %slug,
            "Connected to runtime (v{})",
            ack_payload.runtime_version
        );

        let writer = Arc::new(Mutex::new(writer));

        Ok(ZroApp {
            slug,
            data_dir,
            commands: self.commands,
            event_handlers: self.event_handlers,
            lifecycle_handlers: self.lifecycle_handlers,
            writer,
            reader: Mutex::new(reader),
        })
    }
}

impl ZroApp {
    /// Create a new builder to configure the app.
    pub fn builder() -> ZroAppBuilder {
        ZroAppBuilder {
            commands: HashMap::new(),
            event_handlers: HashMap::new(),
            lifecycle_handlers: HashMap::new(),
        }
    }

    /// Get a cloneable [`EventEmitter`] for emitting events from outside command handlers.
    /// Call this before `.run()`, then clone the emitter into closures as needed.
    pub fn emitter(&self) -> EventEmitter {
        EventEmitter {
            writer: self.writer.clone(),
        }
    }

    /// Get the app data directory path.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Get the app slug.
    pub fn slug(&self) -> &str {
        &self.slug
    }

    /// Run the main event loop. Blocks until shutdown.
    pub async fn run(self) -> Result<(), ZroSdkError> {
        let commands = Arc::new(self.commands);
        let event_handlers = Arc::new(self.event_handlers);
        let lifecycle_handlers = Arc::new(self.lifecycle_handlers);
        let writer = self.writer;
        let reader = self.reader;
        let slug = self.slug;
        let data_dir = self.data_dir;

        tracing::info!(slug = %slug, "Entering main loop");

        loop {
            let msg = {
                let mut r = reader.lock().await;
                match read_message(&mut *r).await {
                    Ok(msg) => msg,
                    Err(e) => {
                        tracing::error!("IPC read error: {}", e);
                        break;
                    }
                }
            };

            match msg.msg_type.as_str() {
                "CommandRequest" => {
                    let payload: CommandRequestPayload =
                        match serde_json::from_value(msg.payload.clone()) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Failed to parse CommandRequest: {}", e);
                                let resp = CommandResponsePayload {
                                    result: None,
                                    error: Some(format!("Invalid request: {}", e)),
                                };
                                let resp_msg = IpcMessage::reply(
                                    &msg.id,
                                    "CommandResponse",
                                    serde_json::to_value(resp)?,
                                );
                                let mut w = writer.lock().await;
                                write_message(&mut *w, &resp_msg).await?;
                                continue;
                            }
                        };

                    let ctx = AppContext::new(
                        payload.session,
                        payload.instance_id,
                        slug.clone(),
                        data_dir.clone(),
                        writer.clone(),
                    );

                    let resp = if let Some(handler) = commands.get(&payload.command) {
                        match handler(payload.params, ctx).await {
                            Ok(result) => CommandResponsePayload {
                                result: Some(result),
                                error: None,
                            },
                            Err(e) => CommandResponsePayload {
                                result: None,
                                error: Some(e),
                            },
                        }
                    } else {
                        CommandResponsePayload {
                            result: None,
                            error: Some(format!("Unknown command: {}", payload.command)),
                        }
                    };

                    let resp_msg = IpcMessage::reply(
                        &msg.id,
                        "CommandResponse",
                        serde_json::to_value(resp)?,
                    );
                    let mut w = writer.lock().await;
                    write_message(&mut *w, &resp_msg).await?;
                }

                "ClientConnected" => {
                    let payload: ClientConnectedPayload =
                        match serde_json::from_value(msg.payload.clone()) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Failed to parse ClientConnected: {}", e);
                                continue;
                            }
                        };
                    let ctx = AppContext::new(
                        payload.session,
                        Some(payload.instance_id),
                        slug.clone(),
                        data_dir.clone(),
                        writer.clone(),
                    );
                    if let Some(handler) = lifecycle_handlers.get("client:connected") {
                        handler(ctx).await;
                    }
                }

                "ClientDisconnected" => {
                    let payload: ClientDisconnectedPayload =
                        match serde_json::from_value(msg.payload.clone()) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Failed to parse ClientDisconnected: {}", e);
                                continue;
                            }
                        };
                    let ctx = AppContext::new(
                        SessionInfo {
                            session_id: SessionId("".into()),
                            user_id: "".into(),
                            username: "".into(),
                            role: "".into(),
                            groups: vec![],
                        },
                        Some(payload.instance_id),
                        slug.clone(),
                        data_dir.clone(),
                        writer.clone(),
                    );
                    if let Some(handler) = lifecycle_handlers.get("client:disconnected") {
                        handler(ctx).await;
                    }
                }

                "ClientReconnected" => {
                    let payload: ClientReconnectedPayload =
                        match serde_json::from_value(msg.payload.clone()) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Failed to parse ClientReconnected: {}", e);
                                continue;
                            }
                        };
                    let ctx = AppContext::new(
                        payload.session,
                        Some(payload.instance_id),
                        slug.clone(),
                        data_dir.clone(),
                        writer.clone(),
                    );
                    if let Some(handler) = lifecycle_handlers.get("client:reconnected") {
                        handler(ctx).await;
                    }
                }

                // ── WsMessage: client sent an emit/send event ───────
                "WsMessage" => {
                    let payload: WsInPayload =
                        match serde_json::from_value(msg.payload.clone()) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Failed to parse WsMessage: {}", e);
                                continue;
                            }
                        };
                    let ctx = AppContext::new(
                        payload.session,
                        Some(payload.instance_id),
                        slug.clone(),
                        data_dir.clone(),
                        writer.clone(),
                    );

                    let event = &payload.event;

                    // 1. Try dedicated event handlers first (registered via .on_event())
                    let event_handler = event_handlers.get(event.as_str()).cloned()
                        .or_else(|| {
                            // Try replacing ':' with '_' (e.g. term:input → term_input)
                            let alt = event.replace(':', "_");
                            event_handlers.get(alt.as_str()).cloned()
                        });

                    if let Some(handler) = event_handler {
                        handler(payload.data, ctx).await;
                        continue;
                    }

                    // 2. Fall back to command handlers (for backward compat)
                    let command_name = if commands.contains_key(event.as_str()) {
                        Some(event.clone())
                    } else {
                        let alt = event.replace(':', "_");
                        if commands.contains_key(alt.as_str()) {
                            Some(alt)
                        } else {
                            None
                        }
                    };

                    if let Some(name) = command_name {
                        if let Some(handler) = commands.get(name.as_str()) {
                            match handler(payload.data, ctx).await {
                                Ok(_) => {}
                                Err(e) => tracing::debug!(
                                    event = %event,
                                    "WsMessage handler error: {}", e
                                ),
                            }
                        }
                    } else {
                        tracing::debug!(event = %event, "No handler for WS event");
                    }
                }

                // ── HttpRequest: runtime proxied an HTTP API call ───
                "HttpRequest" => {
                    let payload: HttpRequestPayload =
                        match serde_json::from_value(msg.payload.clone()) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Failed to parse HttpRequest: {}", e);
                                let resp = HttpResponsePayload {
                                    status: 500,
                                    headers: HashMap::from([
                                        ("content-type".into(), "application/json".into()),
                                    ]),
                                    body: Some(b64_encode(
                                        r#"{"error":"Invalid request payload"}"#,
                                    )),
                                };
                                let resp_msg = IpcMessage::reply(
                                    &msg.id,
                                    "HttpResponse",
                                    serde_json::to_value(resp)?,
                                );
                                let mut w = writer.lock().await;
                                write_message(&mut *w, &resp_msg).await?;
                                continue;
                            }
                        };

                    let ctx = AppContext::new(
                        payload.session,
                        None,
                        slug.clone(),
                        data_dir.clone(),
                        writer.clone(),
                    );

                    // Auto-route: strip /api/ prefix, find matching command
                    let path = payload
                        .path
                        .strip_prefix("/api/")
                        .unwrap_or(&payload.path);
                    let path = path.strip_prefix('/').unwrap_or(path);
                    let segments: Vec<&str> =
                        path.split('/').filter(|s| !s.is_empty()).collect();
                    let base = segments.first().copied().unwrap_or("");
                    let method_lower = payload.method.to_lowercase();

                    // Build candidate command names (try in order)
                    let mut candidates = Vec::with_capacity(10);
                    candidates.push(base.to_string());
                    candidates.push(format!("{}_{}", method_lower, base));
                    let crud_actions: &[&str] = match method_lower.as_str() {
                        "get" => &["list", "get"],
                        "post" => &["create"],
                        "put" => &["update", "set"],
                        "delete" => &["delete"],
                        "patch" => &["update"],
                        _ => &[],
                    };
                    for action in crud_actions {
                        candidates.push(format!("{}_{}", base, action));
                        candidates.push(format!("{}_{}", action, base));
                    }
                    // Try with second segment: tasks/move → move_task, task_move
                    if segments.len() > 1 {
                        let second = segments[1];
                        candidates.push(format!("{}_{}", base, second));
                        candidates.push(format!("{}_{}", second, base));
                    }

                    let command_name = candidates
                        .iter()
                        .find(|c| commands.contains_key(c.as_str()))
                        .cloned();

                    let resp = if let Some(name) = command_name {
                        let handler = commands.get(name.as_str()).unwrap();

                        // Build params from body + query + path id
                        let mut params = if let Some(ref body_b64) = payload.body {
                            match b64_decode(body_b64) {
                                Ok(decoded) => serde_json::from_slice(&decoded)
                                    .unwrap_or(serde_json::Value::Object(Default::default())),
                                Err(_) => {
                                    serde_json::Value::Object(Default::default())
                                }
                            }
                        } else {
                            serde_json::Value::Object(Default::default())
                        };

                        // Merge query params
                        if let serde_json::Value::Object(ref mut map) = params {
                            for (k, v) in &payload.query {
                                map.entry(k.clone()).or_insert(
                                    serde_json::Value::String(v.clone()),
                                );
                            }
                            // Provide path segment as `id` if present
                            if segments.len() > 1 {
                                map.entry("id".to_string()).or_insert(
                                    serde_json::Value::String(
                                        segments[1..].join("/"),
                                    ),
                                );
                            }
                            // Include method for disambiguation
                            map.entry("_method".to_string()).or_insert(
                                serde_json::Value::String(
                                    payload.method.clone(),
                                ),
                            );
                        }

                        match handler(params, ctx).await {
                            Ok(result) => {
                                let body_json = serde_json::to_string(&result)
                                    .unwrap_or_default();
                                HttpResponsePayload {
                                    status: 200,
                                    headers: HashMap::from([(
                                        "content-type".into(),
                                        "application/json".into(),
                                    )]),
                                    body: Some(b64_encode(&body_json)),
                                }
                            }
                            Err(e) => {
                                let body_json =
                                    serde_json::json!({"error": e}).to_string();
                                HttpResponsePayload {
                                    status: 500,
                                    headers: HashMap::from([(
                                        "content-type".into(),
                                        "application/json".into(),
                                    )]),
                                    body: Some(b64_encode(&body_json)),
                                }
                            }
                        }
                    } else {
                        let body_json = serde_json::json!({
                            "error": format!("No handler for {} {}", payload.method, payload.path)
                        })
                        .to_string();
                        HttpResponsePayload {
                            status: 404,
                            headers: HashMap::from([(
                                "content-type".into(),
                                "application/json".into(),
                            )]),
                            body: Some(b64_encode(&body_json)),
                        }
                    };

                    let resp_msg = IpcMessage::reply(
                        &msg.id,
                        "HttpResponse",
                        serde_json::to_value(resp)?,
                    );
                    let mut w = writer.lock().await;
                    write_message(&mut *w, &resp_msg).await?;
                }

                "Shutdown" => {
                    tracing::info!("Received shutdown request");
                    let ack = IpcMessage::new(
                        "ShutdownAck",
                        serde_json::to_value(ShutdownAckPayload {
                            status: "ok".to_string(),
                        })?,
                    );
                    let mut w = writer.lock().await;
                    let _ = write_message(&mut *w, &ack).await;
                    break;
                }

                other => {
                    tracing::warn!("Unknown message type: {}", other);
                }
            }
        }

        tracing::info!("App shutting down");
        Ok(())
    }
}

/// Helper: extract and deserialize a single param from a JSON object.
/// Used by the `#[zro::command]` macro generated code.
pub fn extract_param<T: serde::de::DeserializeOwned>(
    params: &serde_json::Value,
    name: &str,
) -> Result<T, String> {
    let val = params
        .get(name)
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    serde_json::from_value(val).map_err(|e| format!("param '{}': {}", name, e))
}

// ── Base64 helpers ──────────────────────────────────────────────

fn b64_encode(input: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(input.as_bytes())
}

fn b64_decode(input: &str) -> Result<Vec<u8>, base64::DecodeError> {
    base64::engine::general_purpose::STANDARD.decode(input)
}
