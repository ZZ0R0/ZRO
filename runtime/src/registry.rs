use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::RwLock;

use zro_protocol::manifest::{AppCategory, AppManifest, WindowConfig};


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

/// Lightweight metadata struct for launcher/gateway responses.
#[derive(Clone, Debug, Serialize)]
pub struct AppMetadata {
    pub slug: String,
    pub name: String,
    pub icon: String,
    pub category: AppCategory,
    pub description: String,
    pub keywords: Vec<String>,
    pub mime_types: Vec<String>,
    pub single_instance: bool,
    pub window: WindowConfig,
    pub state: String,
}

impl AppMetadata {
    fn from_entry(entry: &AppEntry) -> Self {
        let app = &entry.manifest.app;
        Self {
            slug: app.slug.clone(),
            name: app.name.clone(),
            icon: app.icon.clone(),
            category: app.category.clone(),
            description: app.description.clone(),
            keywords: app.keywords.clone(),
            mime_types: app.mime_types.clone(),
            single_instance: app.single_instance,
            window: entry.manifest.window.clone(),
            state: entry.state.to_string(),
        }
    }
}

/// Internal state behind the RwLock.
struct RegistryInner {
    apps: HashMap<String, AppEntry>,
    /// MIME type → list of app slugs that handle it.
    mime_index: HashMap<String, Vec<String>>,
    /// Category → list of app slugs.
    category_index: HashMap<AppCategory, Vec<String>>,
}

impl RegistryInner {
    fn new(apps: HashMap<String, AppEntry>) -> Self {
        let mut inner = Self {
            apps,
            mime_index: HashMap::new(),
            category_index: HashMap::new(),
        };
        inner.rebuild_indexes();
        inner
    }

    /// Rebuild MIME and category indexes from the current app set.
    fn rebuild_indexes(&mut self) {
        self.mime_index.clear();
        self.category_index.clear();

        for (slug, entry) in &self.apps {
            // Index by MIME type
            for mime in &entry.manifest.app.mime_types {
                self.mime_index
                    .entry(mime.clone())
                    .or_default()
                    .push(slug.clone());
            }

            // Index by category
            self.category_index
                .entry(entry.manifest.app.category.clone())
                .or_default()
                .push(slug.clone());
        }
    }
}

/// Registry of all loaded applications.
#[derive(Clone)]
pub struct AppRegistry {
    inner: Arc<RwLock<RegistryInner>>,
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
            inner: Arc::new(RwLock::new(RegistryInner::new(apps))),
        }
    }

    /// Get an app entry by slug.
    pub async fn get_by_slug(&self, slug: &str) -> Option<AppEntry> {
        let inner = self.inner.read().await;
        inner.apps.get(slug).cloned()
    }

    /// Update the state of an app (by slug).
    pub async fn set_state(&self, slug: &str, state: AppState) {
        let mut inner = self.inner.write().await;
        if let Some(entry) = inner.apps.get_mut(slug) {
            tracing::info!(slug = slug, state = %state, "App state changed");
            entry.state = state;
        }
    }

    /// Get all app entries.
    pub async fn all(&self) -> Vec<AppEntry> {
        let inner = self.inner.read().await;
        inner.apps.values().cloned().collect()
    }

    /// Get all app slugs.
    pub async fn all_slugs(&self) -> Vec<String> {
        let inner = self.inner.read().await;
        inner.apps.keys().cloned().collect()
    }

    /// Get the manifest directory path for an app by slug.
    #[allow(dead_code)]
    pub async fn get_manifest_dir(&self, slug: &str) -> Option<String> {
        let entry = self.get_by_slug(slug).await?;
        Some(entry.manifest.app.slug.clone())
    }

    /// Register a new app at runtime. Returns false if the slug already exists.
    pub async fn register_app(&self, manifest: AppManifest) -> bool {
        let slug = manifest.app.slug.clone();
        let mut inner = self.inner.write().await;
        if inner.apps.contains_key(&slug) {
            return false;
        }
        tracing::info!(slug = %slug, name = %manifest.app.name, "Dynamically registered app");
        inner.apps.insert(slug, AppEntry {
            manifest,
            state: AppState::Loading,
        });
        inner.rebuild_indexes();
        true
    }

    /// Unregister an app from the registry. Returns the entry if it existed.
    pub async fn unregister_app(&self, slug: &str) -> Option<AppEntry> {
        let mut inner = self.inner.write().await;
        let entry = inner.apps.remove(slug);
        if entry.is_some() {
            tracing::info!(slug = slug, "App unregistered from registry");
            inner.rebuild_indexes();
        }
        entry
    }

    /// Get all apps that can handle a MIME type.
    /// Supports wildcards: "text/*" matches "text/plain", "text/html", etc.
    pub async fn apps_for_mime(&self, mime_type: &str) -> Vec<AppEntry> {
        let inner = self.inner.read().await;

        // Direct match first
        if let Some(slugs) = inner.mime_index.get(mime_type) {
            return slugs
                .iter()
                .filter_map(|s| inner.apps.get(s).cloned())
                .collect();
        }

        // Wildcard match: check registered patterns like "text/*" against the query,
        // and also check if query has a wildcard like "text/*"
        let query_type = mime_type.split('/').next().unwrap_or("");
        let mut results = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for (pattern, slugs) in &inner.mime_index {
            let matches = if pattern.ends_with("/*") {
                // Registered pattern is "text/*" — check if query starts with "text/"
                let pattern_type = &pattern[..pattern.len() - 2];
                query_type == pattern_type || mime_type.starts_with(&format!("{}/", pattern_type))
            } else if mime_type.ends_with("/*") {
                // Query is "text/*" — check if registered pattern starts with "text/"
                pattern.starts_with(&format!("{}/", query_type))
            } else {
                false
            };

            if matches {
                for slug in slugs {
                    if seen.insert(slug.clone()) {
                        if let Some(entry) = inner.apps.get(slug) {
                            results.push(entry.clone());
                        }
                    }
                }
            }
        }

        results
    }

    /// Get the default app for a MIME type (first registered handler).
    pub async fn default_app_for_mime(&self, mime_type: &str) -> Option<AppEntry> {
        let apps = self.apps_for_mime(mime_type).await;
        apps.into_iter().next()
    }

    /// Get all apps in a category.
    pub async fn apps_in_category(&self, category: &AppCategory) -> Vec<AppEntry> {
        let inner = self.inner.read().await;
        inner
            .category_index
            .get(category)
            .map(|slugs| {
                slugs
                    .iter()
                    .filter_map(|s| inner.apps.get(s).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Search apps by keyword (case-insensitive match on name, description, keywords).
    pub async fn search_apps(&self, query: &str) -> Vec<AppEntry> {
        let inner = self.inner.read().await;
        let q = query.to_lowercase();

        inner
            .apps
            .values()
            .filter(|entry| {
                let app = &entry.manifest.app;
                app.name.to_lowercase().contains(&q)
                    || app.description.to_lowercase().contains(&q)
                    || app.slug.to_lowercase().contains(&q)
                    || app.keywords.iter().any(|k| k.to_lowercase().contains(&q))
            })
            .cloned()
            .collect()
    }

    /// Get metadata for all apps (for launcher/gateway responses).
    pub async fn all_app_metadata(&self) -> Vec<AppMetadata> {
        let inner = self.inner.read().await;
        inner
            .apps
            .values()
            .map(AppMetadata::from_entry)
            .collect()
    }
}

/// Load a single manifest from an app subdirectory.
pub fn load_single_manifest(manifest_dir: &str, slug: &str) -> anyhow::Result<AppManifest> {
    let manifest_path = Path::new(manifest_dir).join(slug).join("manifest.toml");
    if !manifest_path.exists() {
        anyhow::bail!("manifest.toml not found at {}", manifest_path.display());
    }
    let manifest = AppManifest::load(&manifest_path).map_err(|e| anyhow::anyhow!("{}", e))?;
    if manifest.app.slug != slug {
        anyhow::bail!("slug mismatch: directory is '{}' but manifest slug is '{}'", slug, manifest.app.slug);
    }
    Ok(manifest)
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
                icon: String::new(),
                category: AppCategory::default(),
                keywords: vec![],
                mime_types: vec![],
                single_instance: false,
            },
            backend: Some(BackendInfo {
                executable: format!("zro-app-{}", slug),
                transport: "unix_socket".to_string(),
                command: None,
                args: vec![],
            }),
            frontend: FrontendInfo {
                directory: "frontend".to_string(),
                index: "index.html".to_string(),
                dev: None,
            },
            permissions: PermissionsInfo::default(),
            window: WindowConfig::default(),
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

    /// Helper to build a manifest with MIME types, category, and keywords.
    fn rich_manifest(slug: &str, category: AppCategory, mime_types: Vec<&str>, keywords: Vec<&str>) -> AppManifest {
        let mut m = test_manifest(slug);
        m.app.category = category;
        m.app.mime_types = mime_types.into_iter().map(String::from).collect();
        m.app.keywords = keywords.into_iter().map(String::from).collect();
        m.app.description = format!("{} app", slug);
        m
    }

    #[tokio::test]
    async fn test_apps_for_mime_exact() {
        let manifests = vec![
            rich_manifest("editor", AppCategory::Productivity, vec!["text/plain", "text/markdown"], vec![]),
            rich_manifest("viewer", AppCategory::Tools, vec!["image/png"], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        let apps = reg.apps_for_mime("text/plain").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].manifest.app.slug, "editor");

        let apps = reg.apps_for_mime("image/png").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].manifest.app.slug, "viewer");
    }

    #[tokio::test]
    async fn test_apps_for_mime_wildcard_pattern() {
        let manifests = vec![
            rich_manifest("editor", AppCategory::Productivity, vec!["text/*"], vec![]),
            rich_manifest("viewer", AppCategory::Tools, vec!["image/png"], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        // Query specific type, app registered with wildcard
        let apps = reg.apps_for_mime("text/plain").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].manifest.app.slug, "editor");

        let apps = reg.apps_for_mime("text/html").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].manifest.app.slug, "editor");
    }

    #[tokio::test]
    async fn test_apps_for_mime_wildcard_query() {
        let manifests = vec![
            rich_manifest("editor", AppCategory::Productivity, vec!["text/plain", "text/markdown"], vec![]),
            rich_manifest("viewer", AppCategory::Tools, vec!["image/png"], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        // Query with wildcard, apps registered with specific types
        let apps = reg.apps_for_mime("text/*").await;
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].manifest.app.slug, "editor");
    }

    #[tokio::test]
    async fn test_apps_for_mime_no_match() {
        let manifests = vec![
            rich_manifest("editor", AppCategory::Productivity, vec!["text/plain"], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        let apps = reg.apps_for_mime("video/mp4").await;
        assert!(apps.is_empty());
    }

    #[tokio::test]
    async fn test_default_app_for_mime() {
        let manifests = vec![
            rich_manifest("editor", AppCategory::Productivity, vec!["text/plain"], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        assert!(reg.default_app_for_mime("text/plain").await.is_some());
        assert!(reg.default_app_for_mime("video/mp4").await.is_none());
    }

    #[tokio::test]
    async fn test_apps_in_category() {
        let manifests = vec![
            rich_manifest("files", AppCategory::System, vec![], vec![]),
            rich_manifest("terminal", AppCategory::System, vec![], vec![]),
            rich_manifest("notes", AppCategory::Productivity, vec![], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        let system_apps = reg.apps_in_category(&AppCategory::System).await;
        assert_eq!(system_apps.len(), 2);

        let prod_apps = reg.apps_in_category(&AppCategory::Productivity).await;
        assert_eq!(prod_apps.len(), 1);

        let internet_apps = reg.apps_in_category(&AppCategory::Internet).await;
        assert!(internet_apps.is_empty());
    }

    #[tokio::test]
    async fn test_search_apps_by_name() {
        let manifests = vec![
            rich_manifest("notes", AppCategory::Productivity, vec![], vec!["note", "markdown"]),
            rich_manifest("files", AppCategory::System, vec![], vec!["file", "explorer"]),
        ];
        let reg = AppRegistry::new(manifests);

        let results = reg.search_apps("notes").await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].manifest.app.slug, "notes");
    }

    #[tokio::test]
    async fn test_search_apps_by_keyword() {
        let manifests = vec![
            rich_manifest("notes", AppCategory::Productivity, vec![], vec!["note", "markdown"]),
            rich_manifest("files", AppCategory::System, vec![], vec!["file", "explorer"]),
        ];
        let reg = AppRegistry::new(manifests);

        let results = reg.search_apps("markdown").await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].manifest.app.slug, "notes");
    }

    #[tokio::test]
    async fn test_search_apps_by_description() {
        let manifests = vec![
            rich_manifest("notes", AppCategory::Productivity, vec![], vec![]),
            rich_manifest("files", AppCategory::System, vec![], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        let results = reg.search_apps("notes app").await;
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_search_apps_case_insensitive() {
        let manifests = vec![
            rich_manifest("notes", AppCategory::Productivity, vec![], vec!["Markdown"]),
        ];
        let reg = AppRegistry::new(manifests);

        let results = reg.search_apps("MARKDOWN").await;
        assert_eq!(results.len(), 1);
    }

    #[tokio::test]
    async fn test_all_app_metadata() {
        let manifests = vec![
            rich_manifest("notes", AppCategory::Productivity, vec!["text/plain"], vec!["note"]),
        ];
        let reg = AppRegistry::new(manifests);

        let metadata = reg.all_app_metadata().await;
        assert_eq!(metadata.len(), 1);
        assert_eq!(metadata[0].slug, "notes");
        assert_eq!(metadata[0].category, AppCategory::Productivity);
        assert_eq!(metadata[0].state, "loading");
    }

    #[tokio::test]
    async fn test_register_rebuilds_indexes() {
        let reg = AppRegistry::new(vec![]);
        let m = rich_manifest("editor", AppCategory::Productivity, vec!["text/plain"], vec![]);
        assert!(reg.register_app(m).await);

        let apps = reg.apps_for_mime("text/plain").await;
        assert_eq!(apps.len(), 1);

        let cats = reg.apps_in_category(&AppCategory::Productivity).await;
        assert_eq!(cats.len(), 1);
    }

    #[tokio::test]
    async fn test_unregister_rebuilds_indexes() {
        let manifests = vec![
            rich_manifest("editor", AppCategory::Productivity, vec!["text/plain"], vec![]),
        ];
        let reg = AppRegistry::new(manifests);

        reg.unregister_app("editor").await;

        let apps = reg.apps_for_mime("text/plain").await;
        assert!(apps.is_empty());

        let cats = reg.apps_in_category(&AppCategory::Productivity).await;
        assert!(cats.is_empty());
    }
}
