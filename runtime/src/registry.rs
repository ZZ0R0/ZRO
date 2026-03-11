use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::RwLock;

use zro_protocol::manifest::AppManifest;


/// State of an application.
#[derive(Clone, Debug, PartialEq)]
pub enum AppState {
    Loading,
    Running,
    Stopping,
    Stopped,
    Error(String),
}

impl std::fmt::Display for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppState::Loading => write!(f, "loading"),
            AppState::Running => write!(f, "running"),
            AppState::Stopping => write!(f, "stopping"),
            AppState::Stopped => write!(f, "stopped"),
            AppState::Error(e) => write!(f, "error: {}", e),
        }
    }
}

/// Entry for a registered application.
#[derive(Clone, Debug)]
pub struct AppEntry {
    pub manifest: AppManifest,
    pub state: AppState,
}

/// Registry of all loaded applications.
#[derive(Clone)]
pub struct AppRegistry {
    apps: Arc<RwLock<HashMap<String, AppEntry>>>,      // slug -> entry
}

impl AppRegistry {
    /// Create a new registry from a list of manifests.
    pub fn new(manifests: Vec<AppManifest>) -> Self {
        let mut apps = HashMap::new();

        for manifest in manifests {
            let slug = manifest.app.slug.clone();
            apps.insert(slug, AppEntry {
                manifest,
                state: AppState::Loading,
            });
        }

        Self {
            apps: Arc::new(RwLock::new(apps)),
        }
    }

    /// Get an app entry by slug.
    pub async fn get_by_slug(&self, slug: &str) -> Option<AppEntry> {
        let apps = self.apps.read().await;
        apps.get(slug).cloned()
    }

    /// Update the state of an app (by slug).
    pub async fn set_state(&self, slug: &str, state: AppState) {
        let mut apps = self.apps.write().await;
        if let Some(entry) = apps.get_mut(slug) {
            tracing::info!(slug = slug, state = %state, "App state changed");
            entry.state = state;
        }
    }

    /// Get all app entries.
    pub async fn all(&self) -> Vec<AppEntry> {
        let apps = self.apps.read().await;
        apps.values().cloned().collect()
    }

    /// Get all app slugs.
    pub async fn all_slugs(&self) -> Vec<String> {
        let apps = self.apps.read().await;
        apps.keys().cloned().collect()
    }

    /// Get the manifest directory path for an app by slug.
    #[allow(dead_code)]
    pub async fn get_manifest_dir(&self, slug: &str) -> Option<String> {
        let entry = self.get_by_slug(slug).await?;
        Some(entry.manifest.app.slug.clone())
    }
}

/// Scan a directory for manifest.toml files and load them.
pub fn load_manifests(manifest_dir: &str) -> anyhow::Result<Vec<AppManifest>> {
    let dir = Path::new(manifest_dir);
    if !dir.exists() {
        tracing::warn!("Manifest directory {} does not exist", manifest_dir);
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let manifest_path = path.join("manifest.toml");
            if manifest_path.exists() {
                match AppManifest::load(&manifest_path) {
                    Ok(manifest) => {
                        tracing::info!(
                            slug = manifest.app.slug,
                            name = manifest.app.name,
                            "Loaded app manifest"
                        );
                        manifests.push(manifest);
                    }
                    Err(e) => {
                        tracing::error!("Failed to load manifest {}: {}", manifest_path.display(), e);
                    }
                }
            }
        }
    }

    Ok(manifests)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zro_protocol::manifest::*;

    fn test_manifest(slug: &str) -> AppManifest {
        AppManifest {
            app: AppInfo {
                slug: slug.to_string(),
                name: slug.to_string(),
                version: "0.1.0".to_string(),
                description: String::new(),
            },
            backend: BackendInfo {
                executable: format!("zro-app-{}", slug),
                transport: "unix_socket".to_string(),
                command: None,
                args: vec![],
            },
            frontend: FrontendInfo {
                directory: "frontend".to_string(),
                index: "index.html".to_string(),
                dev: None,
            },
            permissions: PermissionsInfo::default(),
        }
    }

    #[tokio::test]
    async fn test_registry_new_and_lookup() {
        let manifests = vec![
            test_manifest("notes"),
            test_manifest("files"),
        ];
        let registry = AppRegistry::new(manifests);

        let notes = registry.get_by_slug("notes").await;
        assert!(notes.is_some());
        assert_eq!(notes.unwrap().manifest.app.slug, "notes");

        let files = registry.get_by_slug("files").await;
        assert!(files.is_some());

        assert!(registry.get_by_slug("unknown").await.is_none());
    }

    #[tokio::test]
    async fn test_registry_state_change() {
        let manifests = vec![
            test_manifest("notes"),
        ];
        let registry = AppRegistry::new(manifests);

        let entry = registry.get_by_slug("notes").await.unwrap();
        assert_eq!(entry.state, AppState::Loading);

        registry.set_state("notes", AppState::Running).await;
        let entry = registry.get_by_slug("notes").await.unwrap();
        assert_eq!(entry.state, AppState::Running);
    }
}
