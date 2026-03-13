use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Application manifest parsed from TOML.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppManifest {
    pub app: AppInfo,
    #[serde(default)]
    pub backend: Option<BackendInfo>,
    pub frontend: FrontendInfo,
    #[serde(default)]
    pub permissions: PermissionsInfo,
    #[serde(default)]
    pub window: WindowConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub slug: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Icon: emoji or relative path to an SVG/PNG asset.
    #[serde(default)]
    pub icon: String,
    /// Application category for launcher grouping.
    #[serde(default)]
    pub category: AppCategory,
    /// Search keywords for the launcher.
    #[serde(default)]
    pub keywords: Vec<String>,
    /// MIME types this application can open (e.g. "text/plain", "image/*").
    #[serde(default)]
    pub mime_types: Vec<String>,
    /// If true, only one instance of this app can be running at a time.
    #[serde(default)]
    pub single_instance: bool,
}

/// Application category for launcher grouping and filtering.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppCategory {
    System,
    Tools,
    Internet,
    Multimedia,
    Productivity,
    #[default]
    Other,
}

impl std::fmt::Display for AppCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::System => write!(f, "system"),
            Self::Tools => write!(f, "tools"),
            Self::Internet => write!(f, "internet"),
            Self::Multimedia => write!(f, "multimedia"),
            Self::Productivity => write!(f, "productivity"),
            Self::Other => write!(f, "other"),
        }
    }
}

/// Default window dimensions and constraints.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WindowConfig {
    #[serde(default = "default_window_width")]
    pub default_width: u32,
    #[serde(default = "default_window_height")]
    pub default_height: u32,
    #[serde(default = "default_min_width")]
    pub min_width: u32,
    #[serde(default = "default_min_height")]
    pub min_height: u32,
    #[serde(default = "default_resizable")]
    pub resizable: bool,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            default_width: default_window_width(),
            default_height: default_window_height(),
            min_width: default_min_width(),
            min_height: default_min_height(),
            resizable: default_resizable(),
        }
    }
}

fn default_window_width() -> u32 { 800 }
fn default_window_height() -> u32 { 600 }
fn default_min_width() -> u32 { 360 }
fn default_min_height() -> u32 { 240 }
fn default_resizable() -> bool { true }

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
