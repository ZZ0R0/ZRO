//! IPC module — inter-app message routing.
//!
//! Allows apps to send messages to other apps via the runtime's IPC
//! routing mechanism. The module registers `__ipc:send` for outgoing
//! messages and an `__ipc:receive` event handler for incoming messages.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::ipc::{IpcModule, IpcHandler};
//!
//! let ipc = IpcModule::new()
//!     .on_receive("open-file", |ctx, data| Box::pin(async move {
//!         let path = data.get("path").and_then(|v| v.as_str()).unwrap_or("");
//!         eprintln!("Received request to open: {path}");
//!         Ok(serde_json::json!({ "opened": true }))
//!     }));
//!
//! app.module(ipc);
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::app::BoxFuture;
use crate::context::AppContext;
use crate::module::{ModuleMeta, ModuleRegistrar, ZroModule};

/// Handler for an incoming IPC message on a named channel.
pub type IpcHandler = Arc<
    dyn Fn(AppContext, serde_json::Value) -> BoxFuture<Result<serde_json::Value, String>>
        + Send
        + Sync,
>;

/// Payload for an outgoing IPC message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcSendPayload {
    /// Target app slug.
    pub target: String,
    /// Channel name.
    pub channel: String,
    /// Message data.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Payload for an incoming IPC message (received from another app).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcReceivePayload {
    /// Source app slug.
    pub source: String,
    /// Channel name.
    pub channel: String,
    /// Message data.
    #[serde(default)]
    pub data: serde_json::Value,
}

/// IPC module for inter-app communication.
pub struct IpcModule {
    handlers: HashMap<String, IpcHandler>,
}

impl IpcModule {
    /// Create a new IPC module with no channel handlers.
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register a handler for incoming messages on a named channel.
    pub fn on_receive<F, Fut>(mut self, channel: &str, handler: F) -> Self
    where
        F: Fn(AppContext, serde_json::Value) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<serde_json::Value, String>> + Send + 'static,
    {
        self.handlers.insert(
            channel.to_string(),
            Arc::new(move |ctx, data| Box::pin(handler(ctx, data))),
        );
        self
    }
}

impl Default for IpcModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for IpcModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("ipc", "0.1.0")
            .description("Inter-app message routing")
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        // Command: __ipc:send — send a message to another app via the runtime
        r.command("__ipc:send", |params: serde_json::Value, ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
            Box::pin(async move {
                let payload: IpcSendPayload = serde_json::from_value(params)
                    .map_err(|e| format!("Invalid IPC send payload: {e}"))?;

                // Emit the IPC message to the runtime for routing
                let ipc_msg = serde_json::json!({
                    "source": ctx.slug,
                    "target": payload.target,
                    "channel": payload.channel,
                    "data": payload.data,
                });

                ctx.emit("__ipc:route", ipc_msg)
                    .await
                    .map_err(|e| format!("Failed to route IPC message: {e}"))?;

                Ok(serde_json::json!({ "status": "sent" }))
            })
        });

        // Event handler: __ipc:receive — incoming IPC messages from other apps
        let handlers = Arc::new(self.handlers.clone());
        r.on_event("__ipc:receive", move |data: serde_json::Value, ctx: AppContext| {
            let handlers = handlers.clone();
            async move {
                let payload: IpcReceivePayload = match serde_json::from_value(data) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!("Invalid IPC receive payload: {e}");
                        return;
                    }
                };

                if let Some(handler) = handlers.get(&payload.channel) {
                    match handler(ctx, payload.data).await {
                        Ok(_) => {
                            tracing::debug!(
                                source = %payload.source,
                                channel = %payload.channel,
                                "IPC message handled"
                            );
                        }
                        Err(e) => {
                            tracing::error!(
                                source = %payload.source,
                                channel = %payload.channel,
                                error = %e,
                                "IPC handler error"
                            );
                        }
                    }
                } else {
                    tracing::debug!(
                        source = %payload.source,
                        channel = %payload.channel,
                        "No handler registered for IPC channel"
                    );
                }
            }
        });
    }
}
