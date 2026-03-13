use serde::Deserialize;
use std::path::Path;

/// Runtime operating mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeMode {
    Development,
    Production,
}

impl Default for RuntimeMode {
    fn default() -> Self {
        Self::Development
    }
}

impl std::fmt::Display for RuntimeMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Development => write!(f, "development"),
            Self::Production => write!(f, "production"),
        }
    }
}

impl RuntimeMode {
    /// Detect mode from environment, config, or binary path.
    pub fn detect() -> Self {
        // 1. ZRO_MODE env var
        if let Ok(val) = std::env::var("ZRO_MODE") {
            return match val.to_lowercase().as_str() {
                "production" | "prod" => Self::Production,
                _ => Self::Development,
            };
        }
        // 2. Auto-detect: if binary is in target/debug/ → development
        if let Ok(exe) = std::env::current_exe() {
            if exe.to_string_lossy().contains("target/debug") {
                return Self::Development;
            }
        }
        // 3. Default to production if nothing else matched
        Self::Production
    }

    pub fn is_dev(self) -> bool {
        self == Self::Development
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct RuntimeConfig {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub apps: AppsConfig,
    #[serde(default)]
    pub session: SessionConfig,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub supervisor: SupervisorConfig,
    #[serde(default)]
    pub mode: ModeConfig,
    #[serde(default)]
    pub development: DevelopmentConfig,
    #[serde(default)]
    pub production: ProductionConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub control: ControlConfig,
    #[serde(default)]
    pub desktop: DesktopConfig,
    /// Resolved runtime mode (set after loading).
    #[serde(skip)]
    pub runtime_mode: RuntimeMode,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct AppsConfig {
    #[serde(default = "default_manifest_dir")]
    pub manifest_dir: String,
    #[serde(default = "default_data_dir")]
    pub data_dir: String,
    /// Slug of the app to redirect `/` to. Defaults to "shell".
    #[serde(default = "default_default_app")]
    pub default_app: String,
}

fn default_default_app() -> String {
    "shell".to_string()
}

impl Default for AppsConfig {
    fn default() -> Self {
        Self {
            manifest_dir: default_manifest_dir(),
            data_dir: default_data_dir(),
            default_app: default_default_app(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct SessionConfig {
    #[serde(default = "default_session_secret")]
    pub secret: String,
    #[serde(default = "default_ttl")]
    pub ttl_seconds: u64,
    #[serde(default = "default_cookie_name")]
    pub cookie_name: String,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            secret: default_session_secret(),
            ttl_seconds: default_ttl(),
            cookie_name: default_cookie_name(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct AuthConfig {
    #[serde(default = "default_users_file")]
    pub users_file: String,
    /// Ordered list of auth providers to try.
    #[serde(default = "default_providers")]
    pub providers: Vec<String>,
    /// JWT algorithm (only "EdDSA" supported).
    #[serde(default = "default_jwt_algorithm")]
    pub jwt_algorithm: String,
    /// Access token TTL in seconds (default 24h).
    #[serde(default = "default_jwt_ttl")]
    pub jwt_ttl_seconds: u64,
    /// Refresh token TTL in seconds (default 7 days).
    #[serde(default = "default_jwt_refresh_ttl")]
    pub jwt_refresh_ttl_seconds: u64,
    /// Directory for Ed25519 keypair files.
    #[serde(default = "default_key_path")]
    pub key_path: String,
    /// Cookie name for access token.
    #[serde(default = "default_token_cookie")]
    pub token_cookie_name: String,
    /// Cookie name for refresh token.
    #[serde(default = "default_refresh_cookie")]
    pub refresh_cookie_name: String,
    /// PAM provider configuration (used when "pam" is in providers list).
    #[serde(default)]
    pub pam: PamConfig,
    /// LDAP provider configuration (used when "ldap" is in providers list).
    #[serde(default)]
    pub ldap: LdapConfig,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            users_file: default_users_file(),
            providers: default_providers(),
            jwt_algorithm: default_jwt_algorithm(),
            jwt_ttl_seconds: default_jwt_ttl(),
            jwt_refresh_ttl_seconds: default_jwt_refresh_ttl(),
            key_path: default_key_path(),
            token_cookie_name: default_token_cookie(),
            refresh_cookie_name: default_refresh_cookie(),
            pam: PamConfig::default(),
            ldap: LdapConfig::default(),
        }
    }
}

// ── PAM config ──────────────────────────────────────────────────────────────

/// Configuration for the PAM auth provider (feature = "pam").
#[derive(Clone, Debug, Deserialize)]
pub struct PamConfig {
    /// PAM service name (maps to /etc/pam.d/{name}).
    #[serde(default = "default_pam_service")]
    pub service_name: String,
    /// Default role for PAM-authenticated users.
    #[serde(default = "default_pam_role")]
    pub default_role: String,
    /// Linux groups that grant "admin" role.
    #[serde(default)]
    pub admin_groups: Vec<String>,
}

impl Default for PamConfig {
    fn default() -> Self {
        Self {
            service_name: default_pam_service(),
            default_role: default_pam_role(),
            admin_groups: vec!["sudo".into(), "wheel".into()],
        }
    }
}

fn default_pam_service() -> String { "zro".to_string() }
fn default_pam_role() -> String { "user".to_string() }

// ── LDAP config ─────────────────────────────────────────────────────────────

/// Configuration for the LDAP auth provider (feature = "ldap").
#[derive(Clone, Debug, Deserialize)]
pub struct LdapConfig {
    /// LDAP server URL (e.g. "ldap://ad.company.com:389").
    #[serde(default)]
    pub url: String,
    /// Use TLS (LDAPS / StartTLS).
    #[serde(default)]
    pub use_tls: bool,
    /// Template for constructing the user DN. `{}` is replaced by the username.
    #[serde(default)]
    pub bind_dn_template: String,
    /// Base DN for user searches.
    #[serde(default)]
    pub search_base: String,
    /// LDAP filter for user lookup. `{}` is replaced by the username.
    #[serde(default = "default_ldap_user_filter")]
    pub user_filter: String,
    /// Attribute containing group memberships.
    #[serde(default)]
    pub group_attribute: Option<String>,
    /// Attribute for the display name.
    #[serde(default)]
    pub display_name_attr: Option<String>,
    /// Groups that grant the "admin" role.
    #[serde(default)]
    pub admin_groups: Vec<String>,
    /// Default role for LDAP-authenticated users.
    #[serde(default = "default_ldap_role")]
    pub default_role: String,
    /// Service account DN (for searches without user bind).
    #[serde(default)]
    pub service_dn: Option<String>,
    /// Service account password.
    #[serde(default)]
    pub service_password: Option<String>,
}

impl Default for LdapConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            use_tls: false,
            bind_dn_template: String::new(),
            search_base: String::new(),
            user_filter: default_ldap_user_filter(),
            group_attribute: None,
            display_name_attr: None,
            admin_groups: vec![],
            default_role: default_ldap_role(),
            service_dn: None,
            service_password: None,
        }
    }
}

fn default_ldap_user_filter() -> String { "(uid={})".to_string() }
fn default_ldap_role() -> String { "user".to_string() }

#[derive(Clone, Debug, Deserialize)]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_log_format")]
    #[allow(dead_code)]
    pub format: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            format: default_log_format(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct SupervisorConfig {
    #[serde(default = "default_shutdown_timeout")]
    pub shutdown_timeout_seconds: u64,
    #[serde(default = "default_health_interval")]
    #[allow(dead_code)]
    pub health_check_interval_seconds: u64,
    #[serde(default = "default_max_restart")]
    pub max_restart_attempts: u32,
    /// Base delay in seconds between restart attempts (doubles each attempt).
    #[serde(default = "default_restart_delay")]
    pub restart_delay_seconds: u64,
}

impl Default for SupervisorConfig {
    fn default() -> Self {
        Self {
            shutdown_timeout_seconds: default_shutdown_timeout(),
            health_check_interval_seconds: default_health_interval(),
            max_restart_attempts: default_max_restart(),
            restart_delay_seconds: default_restart_delay(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct ModeConfig {
    #[serde(default)]
    pub mode: Option<String>,
}

impl Default for ModeConfig {
    fn default() -> Self {
        Self { mode: None }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct DevelopmentConfig {
    #[serde(default = "default_true")]
    pub hot_reload: bool,
    #[serde(default)]
    pub cache: bool,
    #[serde(default = "default_true")]
    pub verbose_errors: bool,
}

impl Default for DevelopmentConfig {
    fn default() -> Self {
        Self {
            hot_reload: true,
            cache: false,
            verbose_errors: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct ProductionConfig {
    #[serde(default = "default_true")]
    pub cache: bool,
    #[serde(default)]
    pub verbose_errors: bool,
}

impl Default for ProductionConfig {
    fn default() -> Self {
        Self {
            cache: true,
            verbose_errors: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_db_path")]
    pub path: String,
    #[serde(default = "default_true")]
    pub wal_mode: bool,
    #[serde(default = "default_pool_size")]
    pub pool_size: u32,
    #[serde(default = "default_cleanup_interval")]
    pub cleanup_interval_seconds: u64,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            path: default_db_path(),
            wal_mode: true,
            pool_size: default_pool_size(),
            cleanup_interval_seconds: default_cleanup_interval(),
        }
    }
}

fn default_true() -> bool { true }
fn default_db_path() -> String { "./data/zro.db".to_string() }
fn default_pool_size() -> u32 { 10 }
fn default_cleanup_interval() -> u64 { 3600 }

// ── Control socket config ───────────────────────────────────────

#[derive(Clone, Debug, Deserialize)]
pub struct ControlConfig {
    /// Path for the control Unix socket.
    #[serde(default = "default_control_socket")]
    pub socket_path: String,
    /// Directory for IPC sockets (backend ↔ runtime).
    #[serde(default = "default_ipc_dir")]
    pub ipc_dir: String,
}

impl Default for ControlConfig {
    fn default() -> Self {
        Self {
            socket_path: default_control_socket(),
            ipc_dir: default_ipc_dir(),
        }
    }
}

fn default_control_socket() -> String { "/run/zro/control.sock".to_string() }
fn default_ipc_dir() -> String { zro_protocol::constants::IPC_SOCKET_DIR.to_string() }

// ── Desktop config ──────────────────────────────────────────────

/// Desktop environment configuration.
#[derive(Clone, Debug, Deserialize)]
pub struct DesktopConfig {
    /// Default theme for new users.
    #[serde(default = "default_theme")]
    pub default_theme: String,
    /// Default wallpaper path (relative to static/).
    #[serde(default)]
    pub default_wallpaper: Option<String>,
    /// Directory containing wallpaper images.
    #[serde(default = "default_wallpapers_dir")]
    pub wallpapers_dir: String,
    /// Lock screen timeout in minutes (0 = disabled).
    #[serde(default = "default_lock_timeout")]
    pub lock_timeout_minutes: u32,
    /// Maximum avatar file size in bytes (default 2 MiB).
    #[serde(default = "default_max_avatar_size")]
    pub max_avatar_size: usize,
    /// Maximum wallpaper file size in bytes (default 10 MiB).
    #[serde(default = "default_max_wallpaper_size")]
    pub max_wallpaper_size: usize,
    /// Default shell app slug for the desktop environment.
    #[serde(default = "default_shell_app")]
    pub shell_app: String,
    /// Unique workspace identifier (auto-generated if not set).
    #[serde(default = "default_workspace_id")]
    pub workspace_id: String,
    /// MIME type → app slug overrides (e.g. "text/plain" → "notes").
    #[serde(default)]
    pub mime_associations: std::collections::HashMap<String, String>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            default_theme: default_theme(),
            default_wallpaper: None,
            wallpapers_dir: default_wallpapers_dir(),
            lock_timeout_minutes: default_lock_timeout(),
            max_avatar_size: default_max_avatar_size(),
            max_wallpaper_size: default_max_wallpaper_size(),
            shell_app: default_shell_app(),
            workspace_id: default_workspace_id(),
            mime_associations: std::collections::HashMap::new(),
        }
    }
}

fn default_theme() -> String { "catppuccin-mocha".to_string() }
fn default_wallpapers_dir() -> String { "./static/wallpapers".to_string() }
fn default_lock_timeout() -> u32 { 15 }
fn default_max_avatar_size() -> usize { 2 * 1024 * 1024 }
fn default_max_wallpaper_size() -> usize { 10 * 1024 * 1024 }
fn default_shell_app() -> String { "custom-shell".to_string() }
fn default_workspace_id() -> String {
    // Deterministic ID based on the executable path — stable across restarts
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    std::env::current_dir().unwrap_or_default().hash(&mut h);
    format!("zro-{:016x}", h.finish())
}

// Default value functions
fn default_host() -> String { "0.0.0.0".to_string() }
fn default_port() -> u16 { 8080 }
fn default_manifest_dir() -> String { "./apps".to_string() }
fn default_data_dir() -> String { "./data".to_string() }
fn default_session_secret() -> String { "dev-secret-change-in-production".to_string() }
fn default_ttl() -> u64 { 86400 }
fn default_cookie_name() -> String { "zro-session".to_string() }
fn default_users_file() -> String { "./config/users.toml".to_string() }
fn default_providers() -> Vec<String> { vec!["local".to_string()] }
fn default_jwt_algorithm() -> String { "EdDSA".to_string() }
fn default_jwt_ttl() -> u64 { 86400 }
fn default_jwt_refresh_ttl() -> u64 { 604800 }
fn default_key_path() -> String { "./config/jwt_keys".to_string() }
fn default_token_cookie() -> String { "zro-token".to_string() }
fn default_refresh_cookie() -> String { "zro-refresh".to_string() }
fn default_log_level() -> String { "info".to_string() }
fn default_log_format() -> String { "pretty".to_string() }
fn default_shutdown_timeout() -> u64 { 10 }
fn default_health_interval() -> u64 { 5 }
fn default_max_restart() -> u32 { 3 }
fn default_restart_delay() -> u64 { 2 }

impl RuntimeConfig {
    /// Load configuration from file. Falls back to defaults if file doesn't exist.
    pub fn load() -> anyhow::Result<Self> {
        let config_path = std::env::var("ZRO_CONFIG")
            .unwrap_or_else(|_| "./config/runtime.toml".to_string());

        let mut config = if Path::new(&config_path).exists() {
            let content = std::fs::read_to_string(&config_path)?;
            let config: RuntimeConfig = toml::from_str(&content)?;
            config
        } else {
            tracing::warn!("Config file {} not found, using defaults", config_path);
            RuntimeConfig {
                server: ServerConfig::default(),
                apps: AppsConfig::default(),
                session: SessionConfig::default(),
                auth: AuthConfig::default(),
                logging: LoggingConfig::default(),
                supervisor: SupervisorConfig::default(),
                mode: ModeConfig::default(),
                development: DevelopmentConfig::default(),
                production: ProductionConfig::default(),
                storage: StorageConfig::default(),
                control: ControlConfig::default(),
                desktop: DesktopConfig::default(),
                runtime_mode: RuntimeMode::default(),
            }
        };

        // Resolve runtime mode: env > config > auto-detect
        config.runtime_mode = if let Ok(val) = std::env::var("ZRO_MODE") {
            match val.to_lowercase().as_str() {
                "production" | "prod" => RuntimeMode::Production,
                _ => RuntimeMode::Development,
            }
        } else if let Some(ref m) = config.mode.mode {
            match m.to_lowercase().as_str() {
                "production" | "prod" => RuntimeMode::Production,
                _ => RuntimeMode::Development,
            }
        } else {
            RuntimeMode::detect()
        };

        Ok(config)
    }

    /// Whether caching is enabled for the current mode.
    pub fn cache_enabled(&self) -> bool {
        match self.runtime_mode {
            RuntimeMode::Development => self.development.cache,
            RuntimeMode::Production => self.production.cache,
        }
    }

    /// Whether verbose errors are enabled for the current mode.
    pub fn verbose_errors(&self) -> bool {
        match self.runtime_mode {
            RuntimeMode::Development => self.development.verbose_errors,
            RuntimeMode::Production => self.production.verbose_errors,
        }
    }

    /// Whether hot reload is enabled (only in development).
    pub fn hot_reload_enabled(&self) -> bool {
        self.runtime_mode.is_dev() && self.development.hot_reload
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RuntimeConfig {
            server: ServerConfig::default(),
            apps: AppsConfig::default(),
            session: SessionConfig::default(),
            auth: AuthConfig::default(),
            logging: LoggingConfig::default(),
            supervisor: SupervisorConfig::default(),
            mode: ModeConfig::default(),
            development: DevelopmentConfig::default(),
            production: ProductionConfig::default(),
            storage: StorageConfig::default(),
            control: ControlConfig::default(),
            desktop: DesktopConfig::default(),
            runtime_mode: RuntimeMode::default(),
        };
        assert_eq!(config.server.port, 8080);
        assert_eq!(config.session.ttl_seconds, 86400);
        assert!(config.development.hot_reload);
        assert!(!config.development.cache);
        assert!(config.production.cache);
    }

    #[test]
    fn test_runtime_mode() {
        assert!(RuntimeMode::Development.is_dev());
        assert!(!RuntimeMode::Production.is_dev());
        assert_eq!(format!("{}", RuntimeMode::Development), "development");
        assert_eq!(format!("{}", RuntimeMode::Production), "production");
    }

    #[test]
    fn test_parse_config() {
        let toml_str = r#"
[server]
host = "127.0.0.1"
port = 9090

[apps]
manifest_dir = "/custom/apps"
data_dir = "/custom/data"

[session]
secret = "test-secret"
ttl_seconds = 3600

[logging]
level = "debug"
"#;
        let config: RuntimeConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.server.port, 9090);
        assert_eq!(config.apps.manifest_dir, "/custom/apps");
        assert_eq!(config.session.secret, "test-secret");
        assert_eq!(config.logging.level, "debug");
    }
}
