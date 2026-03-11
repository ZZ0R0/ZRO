//! Token and JWT blacklist persistence in SQLite.

use anyhow::Result;
use rusqlite::params;

use super::SqliteStore;

/// Information about a stored refresh token.
#[derive(Clone, Debug)]
pub struct RefreshTokenInfo {
    pub id: String,
    pub session_id: String,
    pub expires_at: String,
}

/// SQLite-backed token store for refresh tokens and JWT blacklist.
#[derive(Clone)]
pub struct TokenStore {
    store: SqliteStore,
}

impl TokenStore {
    pub fn new(store: SqliteStore) -> Self {
        Self { store }
    }

    // ── Refresh tokens ──────────────────────────────────────

    /// Store a new refresh token hash.
    pub fn store_refresh(
        &self,
        token_id: &str,
        session_id: &str,
        hash: &str,
        expires_at: &str,
    ) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "INSERT INTO refresh_tokens (id, session_id, token_hash, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![token_id, session_id, hash, expires_at],
        )?;
        Ok(())
    }

    /// Verify a refresh token by its hash. Returns info if valid (not revoked, not expired).
    pub fn verify_refresh(&self, hash: &str) -> Result<Option<RefreshTokenInfo>> {
        let conn = self.store.conn()?;
        let result = conn.query_row(
            "SELECT id, session_id, expires_at FROM refresh_tokens
             WHERE token_hash = ?1 AND is_revoked = 0 AND expires_at > datetime('now')",
            params![hash],
            |row| {
                Ok(RefreshTokenInfo {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    expires_at: row.get(2)?,
                })
            },
        );

        match result {
            Ok(info) => Ok(Some(info)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Revoke a specific refresh token.
    pub fn revoke_refresh(&self, token_id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "UPDATE refresh_tokens SET is_revoked = 1 WHERE id = ?1",
            params![token_id],
        )?;
        Ok(())
    }

    /// Revoke all refresh tokens for a session.
    pub fn revoke_all_for_session(&self, session_id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "UPDATE refresh_tokens SET is_revoked = 1 WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    // ── JWT blacklist ───────────────────────────────────────

    /// Add a JTI to the blacklist with its expiration time.
    pub fn blacklist_jti(&self, jti: &str, expires_at: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "INSERT OR IGNORE INTO jwt_blacklist (jti, expires_at) VALUES (?1, ?2)",
            params![jti, expires_at],
        )?;
        Ok(())
    }

    /// Check if a JTI is blacklisted.
    pub fn is_blacklisted(&self, jti: &str) -> Result<bool> {
        let conn = self.store.conn()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM jwt_blacklist WHERE jti = ?1",
            params![jti],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, TokenStore) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let sqlite = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();

        // We need a session for FK constraint
        let conn = sqlite.conn().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, user_id, username, role, expires_at)
             VALUES ('sess1', 'u1', 'test', 'admin', '2099-12-31T23:59:59')",
            [],
        ).unwrap();

        (dir, TokenStore::new(sqlite))
    }

    #[test]
    fn test_store_and_verify_refresh() {
        let (_dir, store) = setup();
        store.store_refresh("rt1", "sess1", "hash123", "2099-12-31T23:59:59").unwrap();

        let info = store.verify_refresh("hash123").unwrap().unwrap();
        assert_eq!(info.id, "rt1");
        assert_eq!(info.session_id, "sess1");
    }

    #[test]
    fn test_revoke_refresh() {
        let (_dir, store) = setup();
        store.store_refresh("rt2", "sess1", "hash456", "2099-12-31T23:59:59").unwrap();
        store.revoke_refresh("rt2").unwrap();
        assert!(store.verify_refresh("hash456").unwrap().is_none());
    }

    #[test]
    fn test_revoke_all_for_session() {
        let (_dir, store) = setup();
        store.store_refresh("rt3", "sess1", "h1", "2099-12-31T23:59:59").unwrap();
        store.store_refresh("rt4", "sess1", "h2", "2099-12-31T23:59:59").unwrap();
        store.revoke_all_for_session("sess1").unwrap();
        assert!(store.verify_refresh("h1").unwrap().is_none());
        assert!(store.verify_refresh("h2").unwrap().is_none());
    }

    #[test]
    fn test_blacklist_jti() {
        let (_dir, store) = setup();
        assert!(!store.is_blacklisted("jti-1").unwrap());
        store.blacklist_jti("jti-1", "2099-12-31T23:59:59").unwrap();
        assert!(store.is_blacklisted("jti-1").unwrap());
    }

    #[test]
    fn test_blacklist_idempotent() {
        let (_dir, store) = setup();
        store.blacklist_jti("jti-2", "2099-12-31T23:59:59").unwrap();
        store.blacklist_jti("jti-2", "2099-12-31T23:59:59").unwrap(); // Should not fail
        assert!(store.is_blacklisted("jti-2").unwrap());
    }
}
