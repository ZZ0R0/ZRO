use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::SaltString;
use rand::rngs::OsRng;
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::config::RuntimeConfig;

#[derive(Clone, Debug, Deserialize)]
pub struct UserEntry {
    pub username: String,
    pub password_hash: String,
    pub role: String,
    /// Unique user ID. Auto-generated if absent in users.toml.
    #[serde(default = "generate_user_id")]
    pub user_id: String,
    /// Groups for access control.
    #[serde(default)]
    pub groups: Vec<String>,
}

fn generate_user_id() -> String {
    format!("u-{}", uuid::Uuid::new_v4())
}

#[derive(Deserialize)]
struct UsersFile {
    #[serde(default)]
    users: Vec<UserEntry>,
}

/// Load users from the users.toml file.
/// If the file doesn't exist, create a default dev user.
pub fn load_users(config: &RuntimeConfig) -> anyhow::Result<Vec<UserEntry>> {
    let path = &config.auth.users_file;

    if Path::new(path).exists() {
        let content = std::fs::read_to_string(path)?;
        let file: UsersFile = toml::from_str(&content)?;
        Ok(file.users)
    } else {
        // H6: Create default dev/dev user in dev mode
        tracing::warn!("Users file not found at {}, creating default dev user", path);
        let hash = hash_password("dev")?;
        Ok(vec![UserEntry {
            username: "dev".to_string(),
            password_hash: hash,
            role: "admin".to_string(),
            user_id: format!("u-{}", uuid::Uuid::new_v4()),
            groups: vec!["admins".to_string()],
        }])
    }
}

/// Hash a password with Argon2id.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?;
    Ok(hash.to_string())
}

/// Verify a password against an Argon2id hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Simple in-memory rate limiter for login attempts.
#[derive(Clone)]
pub struct RateLimiter {
    attempts: Arc<RwLock<HashMap<String, Vec<Instant>>>>,
    max_attempts: usize,
    window: Duration,
    lockout: Duration,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            attempts: Arc::new(RwLock::new(HashMap::new())),
            max_attempts: 5,
            window: Duration::from_secs(300),    // 5 minutes
            lockout: Duration::from_secs(900),   // 15 minutes
        }
    }

    /// Check if an IP is rate-limited. Returns true if the request should be blocked.
    pub async fn is_limited(&self, ip: &str) -> bool {
        let attempts = self.attempts.read().await;
        if let Some(times) = attempts.get(ip) {
            let now = Instant::now();
            let recent: Vec<_> = times.iter()
                .filter(|t| now.duration_since(**t) < self.lockout)
                .collect();
            recent.len() >= self.max_attempts
        } else {
            false
        }
    }

    /// Record a failed login attempt.
    pub async fn record_attempt(&self, ip: &str) {
        let mut attempts = self.attempts.write().await;
        let entry = attempts.entry(ip.to_string()).or_insert_with(Vec::new);
        entry.push(Instant::now());
        // Clean up old entries
        let window = self.window;
        let now = Instant::now();
        entry.retain(|t| now.duration_since(*t) < window);
    }

    /// Clear attempts for an IP (on successful login).
    pub async fn clear(&self, ip: &str) {
        let mut attempts = self.attempts.write().await;
        attempts.remove(ip);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let hash = hash_password("test123").unwrap();
        assert!(verify_password("test123", &hash));
        assert!(!verify_password("wrong", &hash));
    }

    #[tokio::test]
    async fn test_rate_limiter() {
        let limiter = RateLimiter::new();
        let ip = "127.0.0.1";
        assert!(!limiter.is_limited(ip).await);

        for _ in 0..5 {
            limiter.record_attempt(ip).await;
        }
        assert!(limiter.is_limited(ip).await);

        limiter.clear(ip).await;
        assert!(!limiter.is_limited(ip).await);
    }
}
