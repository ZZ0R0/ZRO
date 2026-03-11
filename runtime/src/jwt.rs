//! JWT Ed25519 token management.
//!
//! Generates access tokens (signed JWT) and refresh tokens (random opaque).
//! Maintains an in-memory JTI blacklist for O(1) revocation checks.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use ed25519_dalek::SigningKey;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::auth_provider::AuthResult;

// ── JWT Claims ──────────────────────────────────────────────────────────────

/// Claims embedded in the access JWT.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (username)
    pub sub: String,
    /// User ID (UUID)
    pub uid: String,
    /// User role
    pub role: String,
    /// User groups
    #[serde(default)]
    pub groups: Vec<String>,
    /// Issued at (unix timestamp)
    pub iat: i64,
    /// Expiration (unix timestamp)
    pub exp: i64,
    /// JWT ID (unique, for blacklisting)
    pub jti: String,
}

// ── Refresh token store entry ───────────────────────────────────────────────

#[derive(Clone)]
#[allow(dead_code)]
struct RefreshEntry {
    token_hash: String,
    user_id: String,
    username: String,
    role: String,
    groups: Vec<String>,
    expires_at: i64,
}

// ── DER helpers for Ed25519 keys ────────────────────────────────────────────

/// Wrap a 32-byte Ed25519 seed in PKCS8 v1 DER format.
fn seed_to_pkcs8_der(seed: &[u8; 32]) -> Vec<u8> {
    let mut der = vec![
        0x30, 0x2e, // SEQUENCE (46 bytes)
        0x02, 0x01, 0x00, // INTEGER 0 (version)
        0x30, 0x05, // SEQUENCE (5 bytes)
        0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (Ed25519)
        0x04, 0x22, // OCTET STRING (34 bytes)
        0x04, 0x20, // OCTET STRING (32 bytes) — the seed
    ];
    der.extend_from_slice(seed);
    der
}

/// Wrap a 32-byte Ed25519 public key in SubjectPublicKeyInfo DER format.
fn pubkey_to_spki_der(pubkey: &[u8; 32]) -> Vec<u8> {
    let mut der = vec![
        0x30, 0x2a, // SEQUENCE (42 bytes)
        0x30, 0x05, // SEQUENCE (5 bytes)
        0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (Ed25519)
        0x03, 0x21, 0x00, // BIT STRING (33 bytes, 0 unused bits)
    ];
    der.extend_from_slice(pubkey);
    der
}

/// Encode DER bytes as PEM with the given label.
fn to_pem(der: &[u8], label: &str) -> String {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(der);
    let mut pem = format!("-----BEGIN {}-----\n", label);
    for chunk in b64.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap());
        pem.push('\n');
    }
    pem.push_str(&format!("-----END {}-----\n", label));
    pem
}

// ── JwtManager ──────────────────────────────────────────────────────────────

/// Manages JWT access tokens and opaque refresh tokens.
#[derive(Clone)]
pub struct JwtManager {
    encoding_key: Arc<EncodingKey>,
    decoding_key: Arc<DecodingKey>,
    access_ttl: Duration,
    refresh_ttl: Duration,
    /// JTI blacklist (revoked tokens). Stored in memory; will move to SQLite later.
    blacklist: Arc<RwLock<HashSet<String>>>,
    /// Refresh tokens: token_hash → RefreshEntry
    refresh_tokens: Arc<RwLock<HashMap<String, RefreshEntry>>>,
}

impl JwtManager {
    /// Load or generate an Ed25519 keypair and create the manager.
    pub fn new(key_dir: &str, access_ttl_secs: u64, refresh_ttl_secs: u64) -> anyhow::Result<Self> {
        let key_path = Path::new(key_dir);
        std::fs::create_dir_all(key_path)?;

        let priv_path = key_path.join("private.pem");
        let pub_path = key_path.join("public.pem");

        let (enc_key, dec_key) = if priv_path.exists() && pub_path.exists() {
            // Load existing keys
            let priv_pem = std::fs::read(&priv_path)?;
            let pub_pem = std::fs::read(&pub_path)?;
            let enc = EncodingKey::from_ed_pem(&priv_pem)
                .map_err(|e| anyhow::anyhow!("Failed to load private key: {}", e))?;
            let dec = DecodingKey::from_ed_pem(&pub_pem)
                .map_err(|e| anyhow::anyhow!("Failed to load public key: {}", e))?;
            tracing::info!("Loaded Ed25519 keypair from {}", key_dir);
            (enc, dec)
        } else {
            // Generate new keypair
            let mut rng = rand::rngs::OsRng;
            let signing_key = SigningKey::generate(&mut rng);
            let verifying_key = signing_key.verifying_key();

            let seed = signing_key.to_bytes();
            let pubkey = verifying_key.to_bytes();

            let priv_der = seed_to_pkcs8_der(&seed);
            let pub_der = pubkey_to_spki_der(&pubkey);

            let priv_pem = to_pem(&priv_der, "PRIVATE KEY");
            let pub_pem = to_pem(&pub_der, "PUBLIC KEY");

            std::fs::write(&priv_path, &priv_pem)?;
            std::fs::write(&pub_path, &pub_pem)?;

            let enc = EncodingKey::from_ed_pem(priv_pem.as_bytes())
                .map_err(|e| anyhow::anyhow!("Failed to create encoding key: {}", e))?;
            let dec = DecodingKey::from_ed_pem(pub_pem.as_bytes())
                .map_err(|e| anyhow::anyhow!("Failed to create decoding key: {}", e))?;

            tracing::info!("Generated new Ed25519 keypair in {}", key_dir);
            (enc, dec)
        };

        let mgr = Self {
            encoding_key: Arc::new(enc_key),
            decoding_key: Arc::new(dec_key),
            access_ttl: Duration::from_secs(access_ttl_secs),
            refresh_ttl: Duration::from_secs(refresh_ttl_secs),
            blacklist: Arc::new(RwLock::new(HashSet::new())),
            refresh_tokens: Arc::new(RwLock::new(HashMap::new())),
        };

        // Periodic cleanup of expired blacklist entries and refresh tokens
        let mgr_clone = mgr.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(600));
            loop {
                interval.tick().await;
                mgr_clone.cleanup().await;
            }
        });

        Ok(mgr)
    }

    // ── Access Token ────────────────────────────────────────────────────

    /// Create a signed JWT access token from an AuthResult.
    pub fn create_access_token(&self, auth: &AuthResult) -> anyhow::Result<String> {
        let now = Utc::now().timestamp();
        let claims = Claims {
            sub: auth.username.clone(),
            uid: auth.user_id.clone(),
            role: auth.role.clone(),
            groups: auth.groups.clone(),
            iat: now,
            exp: now + self.access_ttl.as_secs() as i64,
            jti: Uuid::new_v4().to_string(),
        };

        let header = Header::new(Algorithm::EdDSA);
        let token = encode(&header, &claims, &self.encoding_key)
            .map_err(|e| anyhow::anyhow!("JWT encode error: {}", e))?;
        Ok(token)
    }

    /// Verify and decode a JWT access token.
    pub fn verify_access_token(&self, token: &str) -> Result<Claims, String> {
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.set_required_spec_claims(&["sub", "exp", "iat", "jti"]);

        let data = decode::<Claims>(token, &self.decoding_key, &validation)
            .map_err(|e| format!("JWT verification failed: {}", e))?;
        Ok(data.claims)
    }

    // ── Refresh Token ───────────────────────────────────────────────────

    /// Create a random refresh token and store its hash. Returns the raw token.
    pub async fn create_refresh_token(&self, auth: &AuthResult) -> String {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let token = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &bytes);
        let hash = hash_token(&token);

        let entry = RefreshEntry {
            token_hash: hash.clone(),
            user_id: auth.user_id.clone(),
            username: auth.username.clone(),
            role: auth.role.clone(),
            groups: auth.groups.clone(),
            expires_at: Utc::now().timestamp() + self.refresh_ttl.as_secs() as i64,
        };

        self.refresh_tokens.write().await.insert(hash, entry);
        token
    }

    /// Validate a refresh token and return a new AuthResult for issuing a fresh access token.
    pub async fn validate_refresh_token(&self, token: &str) -> Option<AuthResult> {
        let hash = hash_token(token);
        let tokens = self.refresh_tokens.read().await;
        let entry = tokens.get(&hash)?;

        if Utc::now().timestamp() > entry.expires_at {
            return None;
        }

        Some(AuthResult {
            user_id: entry.user_id.clone(),
            username: entry.username.clone(),
            role: entry.role.clone(),
            groups: entry.groups.clone(),
        })
    }

    /// Revoke a refresh token by its raw value.
    pub async fn revoke_refresh_token(&self, token: &str) {
        let hash = hash_token(token);
        self.refresh_tokens.write().await.remove(&hash);
    }

    // ── JTI Blacklist ───────────────────────────────────────────────────

    /// Add a JTI to the in-memory blacklist (on logout).
    pub async fn blacklist_jti(&self, jti: &str) {
        self.blacklist.write().await.insert(jti.to_string());
    }

    /// Check if a JTI has been blacklisted.
    pub async fn is_blacklisted(&self, jti: &str) -> bool {
        self.blacklist.read().await.contains(jti)
    }

    // ── Cleanup ─────────────────────────────────────────────────────────

    async fn cleanup(&self) {
        let now = Utc::now().timestamp();

        // Clean expired refresh tokens
        let mut tokens = self.refresh_tokens.write().await;
        let before = tokens.len();
        tokens.retain(|_, v| v.expires_at > now);
        let removed = before - tokens.len();
        if removed > 0 {
            tracing::debug!("Cleaned {} expired refresh tokens", removed);
        }

        // Note: blacklist entries are kept until related to expired JWTs.
        // Full cleanup requires tracking JTI expiry times — simplified for now.
    }
}

/// Hash a refresh token with SHA-256 for storage.
fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_auth_result() -> AuthResult {
        AuthResult {
            user_id: "u-test-1234".into(),
            username: "alice".into(),
            role: "admin".into(),
            groups: vec!["devs".into()],
        }
    }

    #[tokio::test]
    async fn test_jwt_sign_and_verify() {
        let tmp = TempDir::new().unwrap();
        let mgr = JwtManager::new(tmp.path().to_str().unwrap(), 3600, 86400).unwrap();

        let token = mgr.create_access_token(&test_auth_result()).unwrap();
        let claims = mgr.verify_access_token(&token).unwrap();

        assert_eq!(claims.sub, "alice");
        assert_eq!(claims.uid, "u-test-1234");
        assert_eq!(claims.role, "admin");
        assert_eq!(claims.groups, vec!["devs"]);
    }

    #[tokio::test]
    async fn test_jwt_blacklist() {
        let tmp = TempDir::new().unwrap();
        let mgr = JwtManager::new(tmp.path().to_str().unwrap(), 3600, 86400).unwrap();

        let token = mgr.create_access_token(&test_auth_result()).unwrap();
        let claims = mgr.verify_access_token(&token).unwrap();

        assert!(!mgr.is_blacklisted(&claims.jti).await);
        mgr.blacklist_jti(&claims.jti).await;
        assert!(mgr.is_blacklisted(&claims.jti).await);
    }

    #[tokio::test]
    async fn test_refresh_token() {
        let tmp = TempDir::new().unwrap();
        let mgr = JwtManager::new(tmp.path().to_str().unwrap(), 3600, 86400).unwrap();

        let auth = test_auth_result();
        let refresh = mgr.create_refresh_token(&auth).await;

        let result = mgr.validate_refresh_token(&refresh).await;
        assert!(result.is_some());
        let r = result.unwrap();
        assert_eq!(r.username, "alice");

        // Revoke
        mgr.revoke_refresh_token(&refresh).await;
        assert!(mgr.validate_refresh_token(&refresh).await.is_none());
    }

    #[tokio::test]
    async fn test_keypair_persistence() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().to_str().unwrap();

        // First creation generates keys
        let mgr1 = JwtManager::new(dir, 3600, 86400).unwrap();
        let token = mgr1.create_access_token(&test_auth_result()).unwrap();

        // Second creation loads existing keys
        let mgr2 = JwtManager::new(dir, 3600, 86400).unwrap();
        let claims = mgr2.verify_access_token(&token).unwrap();
        assert_eq!(claims.sub, "alice");
    }
}
