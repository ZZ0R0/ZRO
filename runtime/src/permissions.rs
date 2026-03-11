//! Application-level permissions.
//!
//! Loaded from `config/permissions.toml` (optional). When no file exists,
//! all authenticated users can access all apps (v2 behaviour).
//!
//! The `can_access` check is enforced at:
//! 1. Static file serving (`/a/{slug}/`)
//! 2. WebSocket invoke routing
//! 3. `/api/apps` listing (filtering)

use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

/// Global permissions configuration.
#[derive(Clone, Debug, Deserialize)]
pub struct PermissionsConfig {
    #[serde(default = "default_global")]
    pub global: GlobalPermissions,
    #[serde(default)]
    pub apps: HashMap<String, AppPermissions>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GlobalPermissions {
    /// If true, users with role "admin" bypass all per-app checks.
    #[serde(default = "default_true")]
    pub admin_bypass: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AppPermissions {
    /// Roles that can access this app.
    #[serde(default)]
    pub roles: Option<Vec<String>>,
    /// Groups that can access this app.
    #[serde(default)]
    pub groups: Option<Vec<String>>,
    /// Explicit usernames that can access this app.
    #[serde(default)]
    pub users: Option<Vec<String>>,
}

fn default_true() -> bool {
    true
}

fn default_global() -> GlobalPermissions {
    GlobalPermissions {
        admin_bypass: true,
    }
}

impl Default for PermissionsConfig {
    fn default() -> Self {
        Self {
            global: default_global(),
            apps: HashMap::new(),
        }
    }
}

impl PermissionsConfig {
    /// Load permissions from a TOML file. Returns default (allow-all) if the file
    /// doesn't exist or can't be parsed.
    pub fn load(path: &str) -> Self {
        if !Path::new(path).exists() {
            return Self::default();
        }
        match std::fs::read_to_string(path) {
            Ok(content) => match toml::from_str(&content) {
                Ok(config) => config,
                Err(e) => {
                    tracing::error!("Failed to parse {}: {} — using default (allow-all)", path, e);
                    Self::default()
                }
            },
            Err(e) => {
                tracing::error!("Failed to read {}: {} — using default (allow-all)", path, e);
                Self::default()
            }
        }
    }

    /// Check whether a user can access a given app.
    pub fn can_access(&self, username: &str, role: &str, groups: &[String], app_slug: &str) -> bool {
        // Admin bypass
        if self.global.admin_bypass && role == "admin" {
            return true;
        }

        // No config for this app → open access
        let perms = match self.apps.get(app_slug) {
            Some(p) => p,
            None => return true,
        };

        // Check roles
        if let Some(ref roles) = perms.roles {
            if roles.iter().any(|r| r == role) {
                return true;
            }
        }

        // Check groups
        if let Some(ref allowed_groups) = perms.groups {
            if groups.iter().any(|g| allowed_groups.contains(g)) {
                return true;
            }
        }

        // Check explicit users
        if let Some(ref users) = perms.users {
            if users.iter().any(|u| u == username) {
                return true;
            }
        }

        // Nothing matched → denied
        false
    }

    /// Whether any app-level rules are configured.
    pub fn has_rules(&self) -> bool {
        !self.apps.is_empty()
    }

    /// Number of apps with explicit permissions.
    pub fn app_count(&self) -> usize {
        self.apps.len()
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn default_perms() -> PermissionsConfig {
        PermissionsConfig::default()
    }

    #[test]
    fn test_no_rules_allows_everything() {
        let perms = default_perms();
        assert!(perms.can_access("alice", "user", &[], "notes"));
        assert!(perms.can_access("bob", "guest", &[], "terminal"));
    }

    #[test]
    fn test_admin_bypass() {
        let mut perms = default_perms();
        perms.apps.insert("terminal".into(), AppPermissions {
            roles: Some(vec!["developer".into()]),
            groups: None,
            users: None,
        });
        // Admin bypasses
        assert!(perms.can_access("root", "admin", &[], "terminal"));
        // Regular user without matching role → denied
        assert!(!perms.can_access("alice", "user", &[], "terminal"));
    }

    #[test]
    fn test_admin_bypass_disabled() {
        let mut perms = default_perms();
        perms.global.admin_bypass = false;
        perms.apps.insert("terminal".into(), AppPermissions {
            roles: Some(vec!["developer".into()]),
            groups: None,
            users: None,
        });
        // Admin does NOT bypass
        assert!(!perms.can_access("root", "admin", &[], "terminal"));
    }

    #[test]
    fn test_role_match() {
        let mut perms = default_perms();
        perms.apps.insert("notes".into(), AppPermissions {
            roles: Some(vec!["user".into(), "editor".into()]),
            groups: None,
            users: None,
        });
        assert!(perms.can_access("alice", "user", &[], "notes"));
        assert!(perms.can_access("bob", "editor", &[], "notes"));
        assert!(!perms.can_access("charlie", "guest", &[], "notes"));
    }

    #[test]
    fn test_group_match() {
        let mut perms = default_perms();
        perms.apps.insert("files".into(), AppPermissions {
            roles: None,
            groups: Some(vec!["staff".into(), "developers".into()]),
            users: None,
        });
        assert!(perms.can_access("alice", "user", &["staff".into()], "files"));
        assert!(perms.can_access("bob", "user", &["developers".into()], "files"));
        assert!(!perms.can_access("charlie", "user", &["marketing".into()], "files"));
    }

    #[test]
    fn test_explicit_user() {
        let mut perms = default_perms();
        perms.apps.insert("tasks".into(), AppPermissions {
            roles: None,
            groups: None,
            users: Some(vec!["alice".into(), "charlie".into()]),
        });
        assert!(perms.can_access("alice", "user", &[], "tasks"));
        assert!(!perms.can_access("bob", "user", &[], "tasks"));
        assert!(perms.can_access("charlie", "user", &[], "tasks"));
    }

    #[test]
    fn test_unrestricted_app_alongside_restricted() {
        let mut perms = default_perms();
        perms.apps.insert("terminal".into(), AppPermissions {
            roles: Some(vec!["admin".into()]),
            groups: None,
            users: None,
        });
        // "terminal" is restricted, but "notes" has no rules → open
        assert!(perms.can_access("alice", "user", &[], "notes"));
        assert!(!perms.can_access("alice", "user", &[], "terminal"));
    }

    #[test]
    fn test_load_nonexistent_returns_default() {
        let perms = PermissionsConfig::load("/nonexistent/permissions.toml");
        assert!(!perms.has_rules());
        assert!(perms.can_access("anyone", "any", &[], "any_app"));
    }

    #[test]
    fn test_combined_rules() {
        let mut perms = default_perms();
        perms.apps.insert("files".into(), AppPermissions {
            roles: Some(vec!["editor".into()]),
            groups: Some(vec!["staff".into()]),
            users: Some(vec!["charlie".into()]),
        });
        // Matches by role
        assert!(perms.can_access("alice", "editor", &[], "files"));
        // Matches by group
        assert!(perms.can_access("bob", "user", &["staff".into()], "files"));
        // Matches by explicit user
        assert!(perms.can_access("charlie", "guest", &[], "files"));
        // No match
        assert!(!perms.can_access("dave", "guest", &["marketing".into()], "files"));
    }
}
