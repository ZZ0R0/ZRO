//! User-wide preference persistence (cross-app).
//!
//! Stores global user preferences such as theme, wallpaper, locale, etc.
//! Unlike `StateStore` which is scoped per-app, preferences are user-global.

use std::collections::HashMap;

use anyhow::Result;
use rusqlite::params;

use super::SqliteStore;

/// SQLite-backed user preference store.
#[derive(Clone)]
pub struct PreferenceStore {
    store: SqliteStore,
}

impl PreferenceStore {
    pub fn new(store: SqliteStore) -> Self {
        Self { store }
    }

    /// Get a single preference value for a user.
    pub fn get(&self, user_id: &str, key: &str) -> Result<Option<String>> {
        let conn = self.store.conn()?;
        let result = conn.query_row(
            "SELECT value FROM user_preferences WHERE user_id = ?1 AND key = ?2",
            params![user_id, key],
            |row| row.get(0),
        );

        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Set (upsert) a preference for a user.
    pub fn set(&self, user_id: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "INSERT INTO user_preferences (user_id, key, value, updated_at)
             VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(user_id, key)
             DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![user_id, key, value],
        )?;
        Ok(())
    }

    /// Get all preferences for a user as a key-value map.
    pub fn get_all(&self, user_id: &str) -> Result<HashMap<String, String>> {
        let conn = self.store.conn()?;
        let mut stmt = conn.prepare(
            "SELECT key, value FROM user_preferences WHERE user_id = ?1 ORDER BY key",
        )?;

        let rows = stmt.query_map(params![user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut prefs = HashMap::new();
        for row in rows {
            let (k, v) = row?;
            prefs.insert(k, v);
        }
        Ok(prefs)
    }

    /// Delete a single preference for a user.
    pub fn delete(&self, user_id: &str, key: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "DELETE FROM user_preferences WHERE user_id = ?1 AND key = ?2",
            params![user_id, key],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PreferenceStore) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let sqlite = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();
        (dir, PreferenceStore::new(sqlite))
    }

    #[test]
    fn test_set_and_get() {
        let (_dir, store) = setup();
        store.set("u1", "theme", "catppuccin-mocha").unwrap();
        let val = store.get("u1", "theme").unwrap();
        assert_eq!(val, Some("catppuccin-mocha".to_string()));
    }

    #[test]
    fn test_get_missing_key() {
        let (_dir, store) = setup();
        let val = store.get("u1", "nonexistent").unwrap();
        assert!(val.is_none());
    }

    #[test]
    fn test_upsert() {
        let (_dir, store) = setup();
        store.set("u1", "theme", "nord").unwrap();
        store.set("u1", "theme", "dracula").unwrap();
        let val = store.get("u1", "theme").unwrap();
        assert_eq!(val, Some("dracula".to_string()));
    }

    #[test]
    fn test_get_all() {
        let (_dir, store) = setup();
        store.set("u1", "theme", "nord").unwrap();
        store.set("u1", "locale", "fr-FR").unwrap();
        store.set("u2", "theme", "dracula").unwrap();

        let prefs = store.get_all("u1").unwrap();
        assert_eq!(prefs.len(), 2);
        assert_eq!(prefs.get("theme"), Some(&"nord".to_string()));
        assert_eq!(prefs.get("locale"), Some(&"fr-FR".to_string()));

        // User 2 should have only their own
        let prefs2 = store.get_all("u2").unwrap();
        assert_eq!(prefs2.len(), 1);
    }

    #[test]
    fn test_delete() {
        let (_dir, store) = setup();
        store.set("u1", "theme", "nord").unwrap();
        store.delete("u1", "theme").unwrap();
        assert!(store.get("u1", "theme").unwrap().is_none());
    }

    #[test]
    fn test_delete_nonexistent_is_ok() {
        let (_dir, store) = setup();
        // Should not error when deleting a key that doesn't exist
        store.delete("u1", "nonexistent").unwrap();
    }

    #[test]
    fn test_user_isolation() {
        let (_dir, store) = setup();
        store.set("u1", "theme", "nord").unwrap();
        store.set("u2", "theme", "dracula").unwrap();

        assert_eq!(store.get("u1", "theme").unwrap(), Some("nord".to_string()));
        assert_eq!(store.get("u2", "theme").unwrap(), Some("dracula".to_string()));
    }
}
