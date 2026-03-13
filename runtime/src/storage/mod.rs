//! SQLite persistence layer for ZRO runtime.
//!
//! Provides a connection pool via `r2d2_sqlite` and sub-module stores
//! for sessions, app state, tokens, and JWT blacklist.

pub mod session_store;
pub mod state_store;
pub mod token_store;
pub mod preference_store;
pub mod notification_store;

use anyhow::Result;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::Path;

/// Central SQLite store wrapping an r2d2 connection pool.
#[derive(Clone)]
pub struct SqliteStore {
    pool: Pool<SqliteConnectionManager>,
}

impl SqliteStore {
    /// Open (or create) the database at `db_path` with the given pool size.
    /// Runs initial migrations and configures WAL mode.
    pub fn new(db_path: &str, pool_size: u32, wal_mode: bool) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = Path::new(db_path).parent() {
            std::fs::create_dir_all(parent)?;
        }

        let manager = SqliteConnectionManager::file(db_path);
        let pool = Pool::builder()
            .max_size(pool_size)
            .build(manager)?;

        // Run pragmas & migrations on first connection
        {
            let conn = pool.get()?;
            if wal_mode {
                conn.execute_batch("PRAGMA journal_mode = WAL;")?;
            }
            conn.execute_batch("PRAGMA synchronous = NORMAL;")?;
            conn.execute_batch("PRAGMA busy_timeout = 5000;")?;
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;

            // Apply schema migrations
            conn.execute_batch(include_str!("../migrations/001_init.sql"))?;
            conn.execute_batch(include_str!("../migrations/002_desktop.sql"))?;
        }

        Ok(Self { pool })
    }

    /// Get a pooled connection.
    pub fn conn(&self) -> Result<r2d2::PooledConnection<SqliteConnectionManager>> {
        Ok(self.pool.get()?)
    }

    /// Run periodic cleanup of expired rows across all tables.
    /// Returns (sessions, refresh_tokens, blacklist) counts removed.
    pub fn cleanup_expired(&self) -> Result<(usize, usize, usize)> {
        let conn = self.conn()?;

        let sessions = conn.execute(
            "DELETE FROM sessions WHERE expires_at < datetime('now') AND is_active = 1",
            [],
        )?;

        let tokens = conn.execute(
            "DELETE FROM refresh_tokens WHERE expires_at < datetime('now')",
            [],
        )?;

        let blacklist = conn.execute(
            "DELETE FROM jwt_blacklist WHERE expires_at < datetime('now')",
            [],
        )?;

        // Clean up windows for inactive sessions
        conn.execute(
            "DELETE FROM active_windows WHERE session_id NOT IN (SELECT id FROM sessions WHERE is_active = 1)",
            [],
        )?;

        // Clean up expired notifications
        conn.execute(
            "DELETE FROM notifications WHERE expires_at IS NOT NULL AND expires_at < datetime('now')",
            [],
        )?;

        Ok((sessions, tokens, blacklist))
    }

    /// Spawn a background task that runs cleanup periodically.
    pub fn spawn_cleanup_task(store: SqliteStore, interval_secs: u64) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
            loop {
                interval.tick().await;
                match store.cleanup_expired() {
                    Ok((s, t, b)) => {
                        if s > 0 || t > 0 || b > 0 {
                            tracing::info!(
                                "Storage cleanup: {} sessions, {} tokens, {} blacklist entries removed",
                                s, t, b
                            );
                        }
                    }
                    Err(e) => {
                        tracing::error!("Storage cleanup error: {}", e);
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_store_creation() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let store = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();

        // Verify we can get a connection and tables exist
        let conn = store.conn().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_sqlite_store_cleanup_empty() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let store = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();
        let (s, t, b) = store.cleanup_expired().unwrap();
        assert_eq!(s, 0);
        assert_eq!(t, 0);
        assert_eq!(b, 0);
    }
}
