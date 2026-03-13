//! State module — server-side key-value state management.
//!
//! Provides convenient commands for managing per-app persistent state
//! via the runtime's built-in KV store. The state is stored server-side
//! and persists across browser sessions and devices.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::state::StateModule;
//!
//! app.module(StateModule::new());
//!
//! // From frontend:
//! // conn.invoke('__kv:get', { key: 'theme' })
//! // conn.invoke('__kv:set', { key: 'theme', value: 'dark' })
//! // conn.invoke('__kv:delete', { key: 'theme' })
//! // conn.invoke('__kv:list', {})
//! ```

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::app::BoxFuture;
use crate::context::AppContext;
use crate::module::{ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule};

/// In-memory KV store backed by a JSON file on disk.
#[derive(Debug, Clone)]
struct KvStore {
    data: Arc<RwLock<HashMap<String, serde_json::Value>>>,
    path: Arc<RwLock<Option<PathBuf>>>,
}

impl KvStore {
    fn new() -> Self {
        Self {
            data: Arc::new(RwLock::new(HashMap::new())),
            path: Arc::new(RwLock::new(None)),
        }
    }

    async fn init(&self, data_dir: &std::path::Path) {
        let kv_path = data_dir.join("kv.json");

        // Load existing data if file exists
        if kv_path.exists() {
            if let Ok(contents) = tokio::fs::read_to_string(&kv_path).await {
                if let Ok(parsed) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&contents) {
                    let mut data = self.data.write().await;
                    *data = parsed;
                    tracing::debug!(
                        path = %kv_path.display(),
                        entries = data.len(),
                        "Loaded KV store"
                    );
                }
            }
        }

        let mut path = self.path.write().await;
        *path = Some(kv_path);
    }

    async fn get(&self, key: &str) -> Option<serde_json::Value> {
        let data = self.data.read().await;
        data.get(key).cloned()
    }

    async fn set(&self, key: String, value: serde_json::Value) {
        {
            let mut data = self.data.write().await;
            data.insert(key, value);
        }
        self.persist().await;
    }

    async fn delete(&self, key: &str) -> bool {
        let removed = {
            let mut data = self.data.write().await;
            data.remove(key).is_some()
        };
        if removed {
            self.persist().await;
        }
        removed
    }

    async fn list(&self) -> Vec<String> {
        let data = self.data.read().await;
        data.keys().cloned().collect()
    }

    async fn get_all(&self) -> HashMap<String, serde_json::Value> {
        let data = self.data.read().await;
        data.clone()
    }

    async fn persist(&self) {
        let path = self.path.read().await;
        if let Some(ref kv_path) = *path {
            let data = self.data.read().await;
            match serde_json::to_string_pretty(&*data) {
                Ok(json) => {
                    // Ensure parent directory exists
                    if let Some(parent) = kv_path.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    if let Err(e) = tokio::fs::write(kv_path, json).await {
                        tracing::error!(error = %e, "Failed to persist KV store");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to serialize KV store");
                }
            }
        }
    }
}

/// State module — server-side KV state management.
pub struct StateModule;

impl StateModule {
    pub fn new() -> Self {
        Self
    }
}

impl Default for StateModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for StateModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("state", "0.1.0")
            .description("Server-side key-value state management")
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        let store = KvStore::new();

        // Init hook: load persisted state from disk
        {
            let store = store.clone();
            r.on_init(move |ctx: ModuleInitContext| {
                let store = store.clone();
                async move {
                    store.init(&ctx.data_dir).await;
                    Ok(())
                }
            });
        }

        // Command: __kv:get — retrieve a value by key
        {
            let store = store.clone();
            r.command("__kv:get", move |params: serde_json::Value, _ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                let store = store.clone();
                Box::pin(async move {
                    let key = params.get("key")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "Missing 'key' parameter".to_string())?;

                    match store.get(key).await {
                        Some(value) => Ok(serde_json::json!({ "key": key, "value": value })),
                        None => Ok(serde_json::json!({ "key": key, "value": null })),
                    }
                })
            });
        }

        // Command: __kv:set — set a key-value pair
        {
            let store = store.clone();
            r.command("__kv:set", move |params: serde_json::Value, _ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                let store = store.clone();
                Box::pin(async move {
                    let key = params.get("key")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "Missing 'key' parameter".to_string())?
                        .to_string();

                    let value = params.get("value")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);

                    store.set(key.clone(), value).await;
                    Ok(serde_json::json!({ "key": key, "status": "ok" }))
                })
            });
        }

        // Command: __kv:delete — delete a key
        {
            let store = store.clone();
            r.command("__kv:delete", move |params: serde_json::Value, _ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                let store = store.clone();
                Box::pin(async move {
                    let key = params.get("key")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "Missing 'key' parameter".to_string())?;

                    let deleted = store.delete(key).await;
                    Ok(serde_json::json!({ "key": key, "deleted": deleted }))
                })
            });
        }

        // Command: __kv:list — list all keys
        {
            let store = store.clone();
            r.command("__kv:list", move |_params: serde_json::Value, _ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                let store = store.clone();
                Box::pin(async move {
                    let keys = store.list().await;
                    Ok(serde_json::json!({ "keys": keys }))
                })
            });
        }

        // Command: __kv:get_all — retrieve all key-value pairs
        {
            let store = store.clone();
            r.command("__kv:get_all", move |_params: serde_json::Value, _ctx: AppContext| -> BoxFuture<Result<serde_json::Value, String>> {
                let store = store.clone();
                Box::pin(async move {
                    let all = store.get_all().await;
                    Ok(serde_json::json!({ "entries": all }))
                })
            });
        }
    }
}
