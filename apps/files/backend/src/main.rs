use std::path::{Path, PathBuf};

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use zro_sdk::modules::dev::{DevModule, LogLevel};
use zro_sdk::modules::ipc::IpcModule;
use zro_sdk::modules::lifecycle::LifecycleModule;
use zro_sdk::modules::notifications::NotificationsModule;
use zro_sdk::modules::state::StateModule;

const MAX_READ_SIZE: u64 = 1024 * 1024;

#[derive(Serialize)]
struct DirEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
    size: u64,
    modified: String,
}

fn resolve_safe_path(root: &Path, requested: &str) -> Option<PathBuf> {
    let requested = requested.trim_start_matches('/');
    let candidate = root.join(requested);
    let canonical_root = root.canonicalize().ok()?;
    let canonical = candidate.canonicalize().ok()?;
    if canonical.starts_with(&canonical_root) {
        Some(canonical)
    } else {
        None
    }
}

fn is_binary(data: &[u8]) -> bool {
    let check_len = data.len().min(8192);
    data[..check_len].contains(&0)
}

fn format_time(modified: std::time::SystemTime) -> String {
    let dt: DateTime<Utc> = modified.into();
    dt.to_rfc3339()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let root_dir = PathBuf::from(std::env::var("ZRO_DATA_DIR").unwrap_or_else(|_| "/tmp/zro-files".into()));
    tokio::fs::create_dir_all(&root_dir).await?;

    let app = ZroApp::builder()
        .module(StateModule::new())
        .module(IpcModule::new())
        .module(NotificationsModule::new())
        .module(DevModule::new().level(LogLevel::Info))
        .module(LifecycleModule::new())
        // ── ls ──────────────────────────────────────────────────────
        .command("ls", {
            let root = root_dir.clone();
            move |params, _ctx: AppContext| {
                let root = root.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { #[serde(default = "default_path")] path: String }
                    fn default_path() -> String { "/".into() }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let target = resolve_safe_path(&root, &p.path).ok_or("invalid path")?;
                    if !target.is_dir() {
                        return Err("not a directory".into());
                    }
                    let mut entries = Vec::new();
                    let mut dir = tokio::fs::read_dir(&target).await.map_err(|e| e.to_string())?;
                    while let Ok(Some(entry)) = dir.next_entry().await {
                        let meta = match entry.metadata().await { Ok(m) => m, Err(_) => continue };
                        let name = entry.file_name().to_string_lossy().to_string();
                        let entry_type = if meta.is_dir() { "dir" } else { "file" };
                        let modified = meta.modified().map(format_time).unwrap_or_default();
                        entries.push(DirEntry { name, entry_type: entry_type.into(), size: meta.len(), modified });
                    }
                    entries.sort_by(|a, b| {
                        let type_order = |t: &str| if t == "dir" { 0 } else { 1 };
                        type_order(&a.entry_type).cmp(&type_order(&b.entry_type))
                            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                    });
                    serde_json::to_value(serde_json::json!({ "path": p.path, "entries": entries })).map_err(|e| e.to_string())
                })
            }
        })
        // ── read_file ───────────────────────────────────────────────
        .command("read_file", {
            let root = root_dir.clone();
            move |params, _ctx| {
                let root = root.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { path: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let target = resolve_safe_path(&root, &p.path).ok_or("invalid path")?;
                    if !target.is_file() { return Err("not a file".into()); }
                    let meta = tokio::fs::metadata(&target).await.map_err(|e| e.to_string())?;
                    if meta.len() > MAX_READ_SIZE {
                        return Ok(serde_json::json!({ "path": p.path, "binary": true, "size": meta.len(), "error": "file too large (max 1 MiB)" }));
                    }
                    let data = tokio::fs::read(&target).await.map_err(|e| e.to_string())?;
                    if is_binary(&data) {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                        return Ok(serde_json::json!({ "path": p.path, "binary": true, "size": meta.len(), "base64": b64 }));
                    }
                    let content = String::from_utf8_lossy(&data).to_string();
                    Ok(serde_json::json!({ "path": p.path, "content": content, "size": meta.len() }))
                })
            }
        })
        // ── mkdir ───────────────────────────────────────────────────
        .command("mkdir", {
            let root = root_dir.clone();
            move |params, _ctx| {
                let root = root.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { path: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let target = root.join(p.path.trim_start_matches('/'));
                    tokio::fs::create_dir_all(&target).await.map_err(|e| format!("mkdir: {}", e))?;
                    Ok(serde_json::json!({ "ok": true }))
                })
            }
        })
        // ── touch ───────────────────────────────────────────────────
        .command("touch", {
            let root = root_dir.clone();
            move |params, _ctx| {
                let root = root.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { path: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let target = root.join(p.path.trim_start_matches('/'));
                    if let Some(parent) = target.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    tokio::fs::write(&target, b"").await.map_err(|e| format!("touch: {}", e))?;
                    Ok(serde_json::json!({ "ok": true }))
                })
            }
        })
        // ── rm ──────────────────────────────────────────────────────
        .command("rm", {
            let root = root_dir.clone();
            move |params, _ctx| {
                let root = root.clone();
                Box::pin(async move {
                    #[derive(Deserialize)]
                    struct P { path: String }
                    let p: P = serde_json::from_value(params).map_err(|e| e.to_string())?;
                    let target = resolve_safe_path(&root, &p.path).ok_or("invalid path")?;
                    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
                    if target == canonical_root {
                        return Err("cannot delete root directory".into());
                    }
                    if target.is_dir() {
                        tokio::fs::remove_dir_all(&target).await.map_err(|e| e.to_string())?;
                    } else {
                        tokio::fs::remove_file(&target).await.map_err(|e| e.to_string())?;
                    }
                    Ok(serde_json::json!({ "ok": true }))
                })
            }
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}
