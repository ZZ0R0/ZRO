//! Files module — sandboxed filesystem operations within the app's data directory.
//!
//! Provides commands for reading, writing, listing, and deleting files
//! within the app's private data directory. All paths are sandboxed.
//!
//! # Example
//!
//! ```ignore
//! use zro_sdk::modules::files::FilesModule;
//!
//! app.module(FilesModule::new());
//!
//! // From frontend:
//! // conn.invoke('__fs:read', { path: 'notes/hello.md' })
//! // conn.invoke('__fs:write', { path: 'notes/hello.md', content: '# Hello' })
//! // conn.invoke('__fs:list', { path: 'notes' })
//! // conn.invoke('__fs:delete', { path: 'notes/hello.md' })
//! // conn.invoke('__fs:mkdir', { path: 'notes' })
//! // conn.invoke('__fs:stat', { path: 'notes/hello.md' })
//! ```

use std::path::{Path, PathBuf};

use crate::context::AppContext;
use crate::module::{ModuleMeta, ModuleRegistrar, ZroModule};

/// Sandboxed filesystem module.
pub struct FilesModule;

impl FilesModule {
    pub fn new() -> Self {
        Self
    }
}

impl Default for FilesModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ZroModule for FilesModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta {
            name: "files".into(),
            version: "0.1.0".into(),
            description: Some("Sandboxed filesystem operations".to_string()),
            dependencies: vec![],
        }
    }

    fn register(&self, registrar: &mut ModuleRegistrar) {
        registrar.command("__fs:read", |params, ctx| {
            Box::pin(async move { cmd_read(params, ctx).await })
        });
        registrar.command("__fs:write", |params, ctx| {
            Box::pin(async move { cmd_write(params, ctx).await })
        });
        registrar.command("__fs:list", |params, ctx| {
            Box::pin(async move { cmd_list(params, ctx).await })
        });
        registrar.command("__fs:delete", |params, ctx| {
            Box::pin(async move { cmd_delete(params, ctx).await })
        });
        registrar.command("__fs:mkdir", |params, ctx| {
            Box::pin(async move { cmd_mkdir(params, ctx).await })
        });
        registrar.command("__fs:stat", |params, ctx| {
            Box::pin(async move { cmd_stat(params, ctx).await })
        });
    }
}

/// Resolve and validate a path within the data directory. Prevents path traversal.
fn resolve_safe_path(data_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("path is required".into());
    }

    // Normalize: remove leading slashes, reject ".."
    let cleaned = relative.trim_start_matches('/');
    if cleaned.contains("..") {
        return Err("path traversal not allowed".into());
    }

    let full = data_dir.join(cleaned);

    // Ensure resolved path is still within data_dir
    let canonical_base = data_dir
        .canonicalize()
        .map_err(|e| format!("data dir error: {}", e))?;

    // For new files that don't exist yet, check the parent
    if full.exists() {
        let canonical = full
            .canonicalize()
            .map_err(|e| format!("path error: {}", e))?;
        if !canonical.starts_with(&canonical_base) {
            return Err("path outside data directory".into());
        }
        Ok(canonical)
    } else {
        // Verify parent exists within sandbox
        if let Some(parent) = full.parent() {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| format!("parent path error: {}", e))?;
                if !canonical_parent.starts_with(&canonical_base) {
                    return Err("path outside data directory".into());
                }
            }
        }
        Ok(full)
    }
}

async fn cmd_read(params: serde_json::Value, ctx: AppContext) -> Result<serde_json::Value, String> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let full_path = resolve_safe_path(&ctx.data_dir, path_str)?;

    if !full_path.exists() {
        return Err(format!("file not found: {}", path_str));
    }
    if !full_path.is_file() {
        return Err(format!("not a file: {}", path_str));
    }

    let content = tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| format!("read error: {}", e))?;

    Ok(serde_json::json!({ "content": content }))
}

async fn cmd_write(params: serde_json::Value, ctx: AppContext) -> Result<serde_json::Value, String> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
    let full_path = resolve_safe_path(&ctx.data_dir, path_str)?;

    // Create parent directories
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir error: {}", e))?;
    }

    tokio::fs::write(&full_path, content)
        .await
        .map_err(|e| format!("write error: {}", e))?;

    Ok(serde_json::json!({ "ok": true, "bytes": content.len() }))
}

async fn cmd_list(params: serde_json::Value, ctx: AppContext) -> Result<serde_json::Value, String> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    let full_path = resolve_safe_path(&ctx.data_dir, path_str)?;

    if !full_path.exists() {
        return Err(format!("directory not found: {}", path_str));
    }
    if !full_path.is_dir() {
        return Err(format!("not a directory: {}", path_str));
    }

    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&full_path)
        .await
        .map_err(|e| format!("readdir error: {}", e))?;

    while let Some(entry) = dir.next_entry().await.map_err(|e| format!("entry error: {}", e))? {
        let name = entry.file_name().to_string_lossy().to_string();
        let ft = entry.file_type().await.map_err(|e| format!("filetype error: {}", e))?;
        let meta = entry.metadata().await.ok();
        entries.push(serde_json::json!({
            "name": name,
            "is_dir": ft.is_dir(),
            "is_file": ft.is_file(),
            "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
        }));
    }

    Ok(serde_json::json!({ "entries": entries }))
}

async fn cmd_delete(params: serde_json::Value, ctx: AppContext) -> Result<serde_json::Value, String> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let full_path = resolve_safe_path(&ctx.data_dir, path_str)?;

    if !full_path.exists() {
        return Err(format!("not found: {}", path_str));
    }

    if full_path.is_dir() {
        tokio::fs::remove_dir_all(&full_path)
            .await
            .map_err(|e| format!("rmdir error: {}", e))?;
    } else {
        tokio::fs::remove_file(&full_path)
            .await
            .map_err(|e| format!("rm error: {}", e))?;
    }

    Ok(serde_json::json!({ "ok": true }))
}

async fn cmd_mkdir(params: serde_json::Value, ctx: AppContext) -> Result<serde_json::Value, String> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let full_path = resolve_safe_path(&ctx.data_dir, path_str)?;

    tokio::fs::create_dir_all(&full_path)
        .await
        .map_err(|e| format!("mkdir error: {}", e))?;

    Ok(serde_json::json!({ "ok": true }))
}

async fn cmd_stat(params: serde_json::Value, ctx: AppContext) -> Result<serde_json::Value, String> {
    let path_str = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let full_path = resolve_safe_path(&ctx.data_dir, path_str)?;

    if !full_path.exists() {
        return Err(format!("not found: {}", path_str));
    }

    let meta = tokio::fs::metadata(&full_path)
        .await
        .map_err(|e| format!("stat error: {}", e))?;

    Ok(serde_json::json!({
        "path": path_str,
        "is_dir": meta.is_dir(),
        "is_file": meta.is_file(),
        "size": meta.len(),
        "readonly": meta.permissions().readonly(),
    }))
}
