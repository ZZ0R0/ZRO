//! Notifications module — emit structured notifications to frontend clients.
//!
//! Provides a command (`__notify`) for emitting notifications to connected
//! clients and a builder API for constructing notifications programmatically
//! from other backend modules.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::notifications::NotificationsModule;
//!
//! app.module(NotificationsModule::new());
//!
//! // From a command handler, emit a notification:
//! ctx.emit("zro:notification", serde_json::json!({
//!     "title": "Task complete",
//!     "body": "Build finished successfully",
//!     "level": "success",
//! })).await.ok();
//! ```

use serde::{Deserialize, Serialize};

use crate::app::BoxFuture;
use crate::context::AppContext;
use crate::module::{ModuleMeta, ModuleRegistrar, ZroModule};

/// Notification severity level.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum NotificationLevel {
    #[default]
    Info,
    Success,
    Warning,
    Error,
}

/// An action button that can be attached to a notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationAction {
    /// Unique action identifier.
    pub id: String,
    /// Label displayed on the button.
    pub label: String,
}

/// A structured notification payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    /// Notification title.
    pub title: String,
    /// Optional body text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Severity level (info, success, warning, error).
    #[serde(default)]
    pub level: NotificationLevel,
    /// Duration in milliseconds before auto-dismiss (0 = sticky).
    #[serde(default = "default_duration")]
    pub duration: u64,
    /// Optional action buttons.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<NotificationAction>,
}

fn default_duration() -> u64 {
    5000
}

/// Notifications module — registers the `__notify` command.
pub struct NotificationsModule;

impl NotificationsModule {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NotificationsModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for NotificationsModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("notifications", "0.1.0")
            .description("Emit structured notifications to frontend clients")
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        // Command: __notify — emit a notification to the calling client or broadcast
        r.command("__notify", |params: serde_json::Value, ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
            Box::pin(async move {
                let notification: Notification = serde_json::from_value(params.clone())
                    .map_err(|e| format!("Invalid notification payload: {e}"))?;

                let payload = serde_json::to_value(&notification)
                    .map_err(|e| format!("Serialization error: {e}"))?;

                // If we have an instance_id, notify that specific client.
                // Otherwise broadcast to all instances.
                if let Some(ref instance_id) = ctx.instance_id {
                    ctx.emit_to(instance_id, "zro:notification", payload)
                        .await
                        .map_err(|e| format!("Failed to emit notification: {e}"))?;
                } else {
                    ctx.emit("zro:notification", payload)
                        .await
                        .map_err(|e| format!("Failed to broadcast notification: {e}"))?;
                }

                Ok(serde_json::json!({ "status": "ok" }))
            })
        });

        // Command: __notify:broadcast — always broadcast to all instances
        r.command("__notify:broadcast", |params: serde_json::Value, ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
            Box::pin(async move {
                let notification: Notification = serde_json::from_value(params.clone())
                    .map_err(|e| format!("Invalid notification payload: {e}"))?;

                let payload = serde_json::to_value(&notification)
                    .map_err(|e| format!("Serialization error: {e}"))?;

                ctx.emit("zro:notification", payload)
                    .await
                    .map_err(|e| format!("Failed to broadcast notification: {e}"))?;

                Ok(serde_json::json!({ "status": "ok" }))
            })
        });
    }
}
