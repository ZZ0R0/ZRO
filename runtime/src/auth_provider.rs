//! AuthProvider trait and pipeline for extensible authentication.
//!
//! The pipeline evaluates providers in order; the first `Some(AuthResult)` wins.
//! Currently only `LocalAuthProvider` (users.toml + Argon2id) is implemented.
//! PAM and LDAP providers will be added in Phase 3E.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::auth;

// ── AuthResult ──────────────────────────────────────────────────────────────

/// Successful authentication result returned by a provider.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub user_id: String,
    pub username: String,
    pub role: String,
    pub groups: Vec<String>,
}

// ── Trait ────────────────────────────────────────────────────────────────────

/// An authentication provider that can verify credentials.
#[async_trait]
pub trait AuthProvider: Send + Sync {
    /// Attempt to authenticate. Returns `None` if this provider doesn't handle the user.
    async fn authenticate(&self, username: &str, password: &str) -> Option<AuthResult>;

    /// Return the groups for a given user (for JWT enrichment).
    async fn get_groups(&self, username: &str) -> Vec<String>;

    /// Human-readable provider name (for logs).
    fn name(&self) -> &str;
}

// ── LocalAuthProvider ───────────────────────────────────────────────────────

/// Local auth provider backed by `users.toml` + Argon2id verification.
pub struct LocalAuthProvider {
    users: Vec<auth::UserEntry>,
}

impl LocalAuthProvider {
    pub fn new(users: Vec<auth::UserEntry>) -> Self {
        Self { users }
    }
}

#[async_trait]
impl AuthProvider for LocalAuthProvider {
    async fn authenticate(&self, username: &str, password: &str) -> Option<AuthResult> {
        let user = self.users.iter().find(|u| u.username == username)?;

        // Argon2id verification (CPU-bound — runs synchronously, acceptable for login)
        if !auth::verify_password(password, &user.password_hash) {
            return None;
        }

        Some(AuthResult {
            user_id: user.user_id.clone(),
            username: user.username.clone(),
            role: user.role.clone(),
            groups: user.groups.clone(),
        })
    }

    async fn get_groups(&self, username: &str) -> Vec<String> {
        self.users
            .iter()
            .find(|u| u.username == username)
            .map(|u| u.groups.clone())
            .unwrap_or_default()
    }

    fn name(&self) -> &str {
        "local"
    }
}

// ── AuthPipeline ────────────────────────────────────────────────────────────

/// Executes authentication providers in order. First `Some(AuthResult)` wins.
pub struct AuthPipeline {
    providers: Vec<Box<dyn AuthProvider>>,
}

impl AuthPipeline {
    pub fn new(providers: Vec<Box<dyn AuthProvider>>) -> Self {
        Self { providers }
    }

    /// Run each provider in order until one succeeds.
    pub async fn authenticate(&self, username: &str, password: &str) -> Option<AuthResult> {
        for provider in &self.providers {
            match provider.authenticate(username, password).await {
                Some(result) => {
                    tracing::info!(
                        username = username,
                        provider = provider.name(),
                        "User authenticated via {}",
                        provider.name()
                    );
                    return Some(result);
                }
                None => {
                    tracing::debug!(
                        username = username,
                        provider = provider.name(),
                        "Provider {} did not authenticate user",
                        provider.name()
                    );
                }
            }
        }
        tracing::warn!(username = username, "All auth providers failed");
        None
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_local_provider_valid() {
        let hash = auth::hash_password("secret").unwrap();
        let users = vec![auth::UserEntry {
            username: "alice".into(),
            password_hash: hash,
            role: "admin".into(),
            user_id: "u-1".into(),
            groups: vec!["devs".into()],
        }];

        let provider = LocalAuthProvider::new(users);
        let result = provider.authenticate("alice", "secret").await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().role, "admin");
    }

    #[tokio::test]
    async fn test_local_provider_wrong_password() {
        let hash = auth::hash_password("secret").unwrap();
        let users = vec![auth::UserEntry {
            username: "alice".into(),
            password_hash: hash,
            role: "admin".into(),
            user_id: "u-1".into(),
            groups: vec![],
        }];

        let provider = LocalAuthProvider::new(users);
        assert!(provider.authenticate("alice", "wrong").await.is_none());
    }

    #[tokio::test]
    async fn test_local_provider_unknown_user() {
        let provider = LocalAuthProvider::new(vec![]);
        assert!(provider.authenticate("bob", "pass").await.is_none());
    }

    #[tokio::test]
    async fn test_pipeline_first_wins() {
        let hash = auth::hash_password("pass1").unwrap();
        let p1 = LocalAuthProvider::new(vec![auth::UserEntry {
            username: "alice".into(),
            password_hash: hash,
            role: "user".into(),
            user_id: "u-1".into(),
            groups: vec![],
        }]);

        let hash2 = auth::hash_password("pass2").unwrap();
        let p2 = LocalAuthProvider::new(vec![auth::UserEntry {
            username: "alice".into(),
            password_hash: hash2,
            role: "admin".into(),
            user_id: "u-2".into(),
            groups: vec![],
        }]);

        let pipeline = AuthPipeline::new(vec![Box::new(p1), Box::new(p2)]);

        // First provider matches with pass1
        let result = pipeline.authenticate("alice", "pass1").await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().role, "user"); // from first provider

        // First provider fails, second matches with pass2
        let result = pipeline.authenticate("alice", "pass2").await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().role, "admin"); // from second provider
    }
}
