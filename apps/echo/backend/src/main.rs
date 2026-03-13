//! zro-app-echo — Complete test application for the zro framework (v2).
//!
//! This app exercises every SDK feature:
//! - Command handlers: status, echo, kv_set, kv_get, kv_list, kv_delete, log, ping, counter, get_clients
//! - Client lifecycle: connected / disconnected
//! - Data persistence: read/write to data directory
//! - Session inspection: returns session info
//! - Event emission: broadcast + targeted

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use zro_sdk::modules::dev::{DevModule, LogLevel};
use zro_sdk::modules::files::FilesModule;
use zro_sdk::modules::ipc::IpcModule;
use zro_sdk::modules::lifecycle::LifecycleModule;
use zro_sdk::modules::notifications::NotificationsModule;
use zro_sdk::modules::state::StateModule;
use zro_sdk::modules::system::SystemModule;

// ── Shared state ────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LogEntry {
    timestamp: String,
    kind: String,
    message: String,
}

struct AppState {
    counter: AtomicU64,
    log: RwLock<Vec<LogEntry>>,
    clients: RwLock<Vec<String>>,
    kv: RwLock<HashMap<String, serde_json::Value>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            counter: AtomicU64::new(0),
            log: RwLock::new(Vec::new()),
            clients: RwLock::new(Vec::new()),
            kv: RwLock::new(HashMap::new()),
        }
    }

    fn next_id(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::SeqCst) + 1
    }

    async fn push_log(&self, kind: &str, message: &str) {
        let mut log = self.log.write().await;
        log.push(LogEntry {
            timestamp: Utc::now().to_rfc3339(),
            kind: kind.to_string(),
            message: message.to_string(),
        });
        if log.len() > 200 {
            let start = log.len() - 200;
            *log = log[start..].to_vec();
        }
    }
}

// ── Persistence helpers ─────────────────────────────────────────────────────

async fn load_kv(data_dir: &std::path::Path) -> HashMap<String, serde_json::Value> {
    let path = data_dir.join("kv.json");
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

async fn save_kv(data_dir: &std::path::Path, kv: &HashMap<String, serde_json::Value>) {
    let path = data_dir.join("kv.json");
    let _ = tokio::fs::create_dir_all(data_dir).await;
    if let Ok(json) = serde_json::to_string_pretty(kv) {
        let _ = tokio::fs::write(path, json).await;
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let data_dir = PathBuf::from(std::env::var("ZRO_DATA_DIR").unwrap_or_else(|_| "/tmp/zro-echo".into()));
    tokio::fs::create_dir_all(&data_dir).await?;

    let initial_kv = load_kv(&data_dir).await;

    let state = Arc::new(AppState::new());
    {
        let mut kv = state.kv.write().await;
        *kv = initial_kv;
    }

    let lifecycle = LifecycleModule::new()
        .on_connect({
            let s = state.clone();
            move |ctx: AppContext| {
                let s = s.clone();
                async move {
                    let id = ctx.instance_id.clone().unwrap_or_default();
                    tracing::info!("Client connected: {}", id);
                    s.clients.write().await.push(id.clone());
                    s.push_log("lifecycle", &format!("connected: {} ({})", id, ctx.session.username)).await;
                }
            }
        })
        .on_disconnect({
            let s = state.clone();
            move |ctx: AppContext| {
                let s = s.clone();
                async move {
                    let id = ctx.instance_id.clone().unwrap_or_default();
                    tracing::info!("Client disconnected: {}", id);
                    s.clients.write().await.retain(|c| c != &id);
                    s.push_log("lifecycle", &format!("disconnected: {}", id)).await;
                }
            }
        });

    let app = ZroApp::builder()
        .module(StateModule::new())
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(FilesModule::new())
        .module(SystemModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(lifecycle)
        // ── status ──────────────────────────────────────────────────
        .command("status", {
            let s = state.clone();
            move |_params, ctx: AppContext| {
                let s = s.clone();
                Box::pin(async move {
                    let clients = s.clients.read().await;
                    let kv = s.kv.read().await;
                    serde_json::to_value(serde_json::json!({
                        "ok": true,

                        "slug": ctx.slug,
                        "request_number": s.next_id(),
                        "timestamp": Utc::now().to_rfc3339(),
                        "connected_clients": clients.len(),
                        "kv_entries": kv.len(),
                        "session": {
                            "user_id": ctx.session.user_id,
                            "username": ctx.session.username,
                            "role": ctx.session.role,
                        }
                    })).map_err(|e| e.to_string())
                })
            }
        })
        // ── echo ────────────────────────────────────────────────────
        .command("echo", {
            let s = state.clone();
            move |params, ctx: AppContext| {
                let s = s.clone();
                Box::pin(async move {
                    s.push_log("cmd", "echo").await;
                    serde_json::to_value(serde_json::json!({
                        "ok": true,
                        "request_number": s.next_id(),
                        "echo": params,
                        "session": { "username": ctx.session.username, "role": ctx.session.role }
                    })).map_err(|e| e.to_string())
                })
            }
        })
        // ── kv_list ─────────────────────────────────────────────────
        .command("kv_list", {
            let s = state.clone();
            move |_params, _ctx| {
                let s = s.clone();
                Box::pin(async move {
                    let kv = s.kv.read().await;
                    serde_json::to_value(serde_json::json!({ "ok": true, "entries": *kv }))
                        .map_err(|e| e.to_string())
                })
            }
        })
        // ── kv_set ──────────────────────────────────────────────────
        .command("kv_set", {
            let s = state.clone();
            let dd = data_dir.clone();
            move |params, _ctx| {
                let s = s.clone();
                let dd = dd.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { key: String, value: serde_json::Value }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut kv = s.kv.write().await;
                    kv.insert(p.key.clone(), p.value.clone());
                    save_kv(&dd, &kv).await;
                    s.push_log("kv", &format!("SET {}", p.key)).await;
                    Ok(serde_json::json!({ "ok": true, "key": p.key, "value": p.value }))
                })
            }
        })
        // ── kv_delete ───────────────────────────────────────────────
        .command("kv_delete", {
            let s = state.clone();
            let dd = data_dir.clone();
            move |params, _ctx| {
                let s = s.clone();
                let dd = dd.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { key: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let mut kv = s.kv.write().await;
                    let removed = kv.remove(&p.key);
                    save_kv(&dd, &kv).await;
                    s.push_log("kv", &format!("DEL {}", p.key)).await;
                    Ok(serde_json::json!({ "ok": true, "key": p.key, "removed": removed.is_some() }))
                })
            }
        })
        // ── log ─────────────────────────────────────────────────────
        .command("log", {
            let s = state.clone();
            move |_params, _ctx| {
                let s = s.clone();
                Box::pin(async move {
                    let log = s.log.read().await;
                    serde_json::to_value(serde_json::json!({ "ok": true, "count": log.len(), "entries": *log }))
                        .map_err(|e| e.to_string())
                })
            }
        })
        // ── ping ────────────────────────────────────────────────────
        .command("ping", {
            let s = state.clone();
            move |_params, _ctx| {
                let s = s.clone();
                Box::pin(async move {
                    s.push_log("cmd", "ping/pong").await;
                    Ok(serde_json::json!({ "timestamp": Utc::now().to_rfc3339(), "message": "pong!" }))
                })
            }
        })
        // ── counter ─────────────────────────────────────────────────
        .command("counter", {
            let s = state.clone();
            move |_params, _ctx| {
                let s = s.clone();
                Box::pin(async move {
                    let n = s.next_id();
                    Ok(serde_json::json!({ "count": n }))
                })
            }
        })
        // ── get_clients ─────────────────────────────────────────────
        .command("get_clients", {
            let s = state.clone();
            move |_params, _ctx| {
                let s = s.clone();
                Box::pin(async move {
                    let clients = s.clients.read().await;
                    Ok(serde_json::json!({ "clients": *clients }))
                })
            }
        })
        .build()
        .await?;

    tracing::info!("Echo test app ready — waiting for commands");
    app.run().await?;
    Ok(())
}
