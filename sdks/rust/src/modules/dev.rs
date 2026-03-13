//! Dev module — structured logging and diagnostics.
//!
//! Provides conditional structured logging that respects a configurable
//! log level. In development mode, all levels are emitted. In production,
//! only warnings and errors are logged. The module also exposes a
//! `__dev:log` command for frontend-originated log messages.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::dev::{DevModule, LogLevel};
//!
//! let dev = DevModule::new()
//!     .level(LogLevel::Debug)
//!     .prefix("my-app");
//!
//! app.module(dev);
//! ```

use serde::{Deserialize, Serialize};

use crate::app::BoxFuture;
use crate::context::AppContext;
use crate::module::{ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule};

/// Log levels for the dev module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Silent = 4,
}

impl Default for LogLevel {
    fn default() -> Self {
        Self::Info
    }
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Debug => write!(f, "DEBUG"),
            Self::Info => write!(f, "INFO"),
            Self::Warn => write!(f, "WARN"),
            Self::Error => write!(f, "ERROR"),
            Self::Silent => write!(f, "SILENT"),
        }
    }
}

/// A log entry submitted via the `__dev:log` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct LogEntry {
    level: LogLevel,
    #[serde(default)]
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

/// Dev module — structured logging and diagnostics.
pub struct DevModule {
    level: LogLevel,
    prefix: Option<String>,
}

impl DevModule {
    /// Create a new dev module with default Info log level.
    pub fn new() -> Self {
        Self {
            level: LogLevel::Info,
            prefix: None,
        }
    }

    /// Set the minimum log level. Messages below this level are silenced.
    pub fn level(mut self, level: LogLevel) -> Self {
        self.level = level;
        self
    }

    /// Set a prefix for all log messages (typically the app name).
    pub fn prefix(mut self, prefix: &str) -> Self {
        self.prefix = Some(prefix.to_string());
        self
    }
}

impl Default for DevModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for DevModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("dev", "0.1.0")
            .description("Structured logging and diagnostics")
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        let min_level = self.level;
        let prefix = self.prefix.clone();

        // Init hook: log startup diagnostics
        {
            let prefix = prefix.clone();
            r.on_init(move |ctx: ModuleInitContext| {
                let prefix = prefix.clone();
                async move {
                    let tag = prefix.as_deref().unwrap_or(&ctx.slug);
                    tracing::info!(
                        tag = %tag,
                        data_dir = %ctx.data_dir.display(),
                        "Dev module initialized"
                    );
                    Ok(())
                }
            });
        }

        // Command: __dev:log — accept log messages from frontend
        {
            let prefix = prefix.clone();
            r.command("__dev:log", move |params: serde_json::Value, ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                let prefix = prefix.clone();
                Box::pin(async move {
                    let entry: LogEntry = serde_json::from_value(params)
                        .map_err(|e| format!("Invalid log entry: {e}"))?;

                    if entry.level < min_level {
                        return Ok(serde_json::json!({ "status": "filtered" }));
                    }

                    let tag = prefix.as_deref().unwrap_or(&ctx.slug);
                    let instance = ctx.instance_id.as_deref().unwrap_or("unknown");

                    match entry.level {
                        LogLevel::Debug => {
                            tracing::debug!(
                                tag = %tag,
                                instance = %instance,
                                data = ?entry.data,
                                "{}", entry.message
                            );
                        }
                        LogLevel::Info => {
                            tracing::info!(
                                tag = %tag,
                                instance = %instance,
                                data = ?entry.data,
                                "{}", entry.message
                            );
                        }
                        LogLevel::Warn => {
                            tracing::warn!(
                                tag = %tag,
                                instance = %instance,
                                data = ?entry.data,
                                "{}", entry.message
                            );
                        }
                        LogLevel::Error => {
                            tracing::error!(
                                tag = %tag,
                                instance = %instance,
                                data = ?entry.data,
                                "{}", entry.message
                            );
                        }
                        LogLevel::Silent => {}
                    }

                    Ok(serde_json::json!({ "status": "ok" }))
                })
            });
        }

        // Command: __dev:info — return diagnostic information
        {
            r.command("__dev:info", move |_params: serde_json::Value, ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                Box::pin(async move {
                    Ok(serde_json::json!({
                        "slug": ctx.slug,
                        "instance_id": ctx.instance_id,
                        "data_dir": ctx.data_dir.to_string_lossy(),
                        "session": {
                            "session_id": ctx.session.session_id,
                            "username": ctx.session.username,
                            "role": ctx.session.role,
                        },
                        "min_log_level": min_level,
                    }))
                })
            });
        }
    }
}
