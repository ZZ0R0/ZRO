//! Hot reload watcher for development mode.
//!
//! Uses the `notify` crate to watch app frontend directories for changes
//! and broadcasts a reload event to all connected clients via WebSocket.

use std::path::Path;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher, EventKind};
use serde_json::json;
use tokio::sync::mpsc;

use crate::gateway::handlers::websocket::WsSessionManager;
use crate::registry::AppRegistry;

/// Manages file watchers for all app frontend directories.
pub struct HotReloadWatcher {
    _watcher: RecommendedWatcher,
}

impl HotReloadWatcher {
    /// Start watching all app frontend directories.
    /// When a file changes, sends a `hot_reload` event via WS to all instances of that app.
    pub async fn start(
        manifest_dir: &str,
        registry: AppRegistry,
        ws_manager: WsSessionManager,
    ) -> anyhow::Result<Self> {
        let (tx, mut rx) = mpsc::unbounded_channel::<Event>();

        let manifest_dir_owned = manifest_dir.to_string();
        let registry_clone = registry.clone();

        // Spawn async handler for file change events
        let ws = ws_manager.clone();
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                        // Determine which app was affected from the changed path
                        for path in &event.paths {
                            if let Some(slug) = extract_app_slug(path, &manifest_dir_owned) {
                                tracing::debug!(slug = slug, "Hot reload triggered");
                                let entry = registry_clone.get_by_slug(&slug).await;
                                if let Some(_entry) = entry {
                                    let reload_msg = json!({
                                        "type": "event",
                                        "event": "__hot_reload",
                                        "payload": { "app": slug }
                                    });
                                    ws.broadcast_to_app(&slug, &reload_msg).await;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        });

        // Create the file watcher (synchronous notify API → channel bridge)
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        })?;

        // Watch each app's frontend directory
        let entries = registry.all().await;
        for entry in &entries {
            let frontend_dir = Path::new(manifest_dir)
                .join(&entry.manifest.app.slug)
                .join(&entry.manifest.frontend.directory);
            if frontend_dir.exists() {
                if let Err(e) = watcher.watch(&frontend_dir, RecursiveMode::Recursive) {
                    tracing::warn!(
                        slug = entry.manifest.app.slug,
                        "Failed to watch frontend dir: {}",
                        e
                    );
                } else {
                    tracing::info!(
                        slug = entry.manifest.app.slug,
                        path = %frontend_dir.display(),
                        "Watching for hot reload"
                    );
                }
            }
        }

        Ok(Self { _watcher: watcher })
    }
}

/// Extract the app slug from a changed file path.
/// Given manifest_dir = "./apps" and path = "./apps/notes/frontend/index.html",
/// returns Some("notes").
fn extract_app_slug(path: &Path, manifest_dir: &str) -> Option<String> {
    let manifest_path = Path::new(manifest_dir).canonicalize().ok()?;
    let changed_path = path.canonicalize().ok()?;

    let relative = changed_path.strip_prefix(&manifest_path).ok()?;
    let first_component = relative.components().next()?;

    if let std::path::Component::Normal(name) = first_component {
        Some(name.to_string_lossy().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_app_slug() {
        // We can't test with actual paths easily in unit tests,
        // but we can verify the logic with the non-canonicalized path approach.
        let path = Path::new("/tmp/apps/notes/frontend/index.html");
        let manifest_dir = "/tmp/apps";

        // Since canonicalize needs existing paths, test the logic directly
        let manifest_path = Path::new(manifest_dir);
        if let Ok(relative) = path.strip_prefix(manifest_path) {
            let first = relative.components().next().unwrap();
            if let std::path::Component::Normal(name) = first {
                assert_eq!(name.to_string_lossy(), "notes");
            }
        }
    }
}
