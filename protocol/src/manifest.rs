use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Application manifest parsed from TOML.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppManifest {
    pub app: AppInfo,
    pub backend: BackendInfo,
    pub frontend: FrontendInfo,
    #[serde(default)]
    pub permissions: PermissionsInfo,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub slug: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackendInfo {
    pub executable: String,
    #[serde(default = "default_transport")]
    pub transport: String,
    /// Optional command to invoke (e.g. "python3", "node").
    /// When set, the process is spawned as `command [args...] executable`.
    #[serde(default)]
    pub command: Option<String>,
    /// Extra arguments inserted between `command` and `executable`.
    #[serde(default)]
    pub args: Vec<String>,
}

fn default_transport() -> String {
    "unix_socket".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FrontendInfo {
    pub directory: String,
    #[serde(default = "default_index")]
    pub index: String,
    /// Development-mode configuration (proxy to a dev server).
    #[serde(default)]
    pub dev: Option<FrontendDevConfig>,
}

/// Optional dev-mode frontend configuration (e.g., Vite proxy).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FrontendDevConfig {
    /// URL of the dev server to proxy requests to (e.g., "http://localhost:5173").
    pub dev_url: Option<String>,
}

fn default_index() -> String {
    "index.html".to_string()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PermissionsInfo {
    #[serde(default)]
    pub roles: Vec<String>,
    #[serde(default)]
    pub capabilities: HashMap<String, bool>,
}

/// Slug validation regex pattern.
const SLUG_PATTERN: &str = r"^[a-z0-9]([a-z0-9\-]{0,30}[a-z0-9])?$";

/// Reserved slugs that cannot be used by applications.
const RESERVED_SLUGS: &[&str] = &[
    "apps", "auth", "health", "static", "api", "admin", "system", "_internal", "ws",
];

impl AppManifest {
    /// Load a manifest from a TOML file.
    pub fn load(path: &Path) -> Result<Self, crate::errors::ProtocolError> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            crate::errors::ProtocolError::ManifestLoadError {
                path: path.display().to_string(),
                reason: e.to_string(),
            }
        })?;
        let manifest: Self = toml::from_str(&content).map_err(|e| {
            crate::errors::ProtocolError::ManifestParseError {
                path: path.display().to_string(),
                reason: e.to_string(),
            }
        })?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// Validate the manifest fields.
    pub fn validate(&self) -> Result<(), crate::errors::ProtocolError> {
        // Validate slug format
        let re = regex_lite::Regex::new(SLUG_PATTERN).unwrap();
        if !re.is_match(&self.app.slug) {
            return Err(crate::errors::ProtocolError::InvalidSlug {
                slug: self.app.slug.clone(),
            });
        }

        // Check reserved slugs
        if RESERVED_SLUGS.contains(&self.app.slug.as_str()) {
            return Err(crate::errors::ProtocolError::ReservedSlug {
                slug: self.app.slug.clone(),
            });
        }

        Ok(())
    }
}
