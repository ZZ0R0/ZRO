//! App state persistence in SQLite (state:save / state:restore).

use anyhow::Result;
use rusqlite::params;

use super::SqliteStore;

/// SQLite-backed app state store.
#[derive(Clone)]
pub struct StateStore {
    store: SqliteStore,
}

impl StateStore {
    pub fn new(store: SqliteStore) -> Self {
        Self { store }
    }

    /// Save (upsert) a key-value pair for a user+app.
    pub fn save(&self, user_id: &str, app_slug: &str, key: &str, value: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "INSERT INTO app_states (user_id, app_slug, key, value, updated_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))
             ON CONFLICT(user_id, app_slug, key)
             DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            params![user_id, app_slug, key, value],
        )?;
        Ok(())
    }

    /// Restore a value by key for a user+app.
    pub fn restore(&self, user_id: &str, app_slug: &str, key: &str) -> Result<Option<String>> {
        let conn = self.store.conn()?;
        let result = conn.query_row(
            "SELECT value FROM app_states WHERE user_id = ?1 AND app_slug = ?2 AND key = ?3",
            params![user_id, app_slug, key],
            |row| row.get(0),
        );

        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Delete a key for a user+app.
    pub fn delete(&self, user_id: &str, app_slug: &str, key: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "DELETE FROM app_states WHERE user_id = ?1 AND app_slug = ?2 AND key = ?3",
            params![user_id, app_slug, key],
        )?;
        Ok(())
    }

    /// List all keys for a user+app.
    pub fn list_keys(&self, user_id: &str, app_slug: &str) -> Result<Vec<String>> {
        let conn = self.store.conn()?;
        let mut stmt = conn.prepare(
            "SELECT key FROM app_states WHERE user_id = ?1 AND app_slug = ?2 ORDER BY key",
        )?;

        let rows = stmt.query_map(params![user_id, app_slug], |row| row.get(0))?;
        let mut keys = Vec::new();
        for row in rows {
            keys.push(row?);
        }
        Ok(keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, StateStore) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let sqlite = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();
        (dir, StateStore::new(sqlite))
    }

    #[test]
    fn test_save_and_restore() {
        let (_dir, store) = setup();
        store.save("u1", "tasks", "activeTab", "\"done\"").unwrap();
        let val = store.restore("u1", "tasks", "activeTab").unwrap();
        assert_eq!(val, Some("\"done\"".to_string()));
    }

    #[test]
    fn test_upsert() {
        let (_dir, store) = setup();
        store.save("u1", "tasks", "tab", "\"a\"").unwrap();
        store.save("u1", "tasks", "tab", "\"b\"").unwrap();
        let val = store.restore("u1", "tasks", "tab").unwrap();
        assert_eq!(val, Some("\"b\"".to_string()));
    }

    #[test]
    fn test_delete() {
        let (_dir, store) = setup();
        store.save("u1", "tasks", "key", "val").unwrap();
        store.delete("u1", "tasks", "key").unwrap();
        assert!(store.restore("u1", "tasks", "key").unwrap().is_none());
    }

    #[test]
    fn test_list_keys() {
        let (_dir, store) = setup();
        store.save("u1", "tasks", "alpha", "1").unwrap();
        store.save("u1", "tasks", "beta", "2").unwrap();
        store.save("u1", "notes", "gamma", "3").unwrap();

        let keys = store.list_keys("u1", "tasks").unwrap();
        assert_eq!(keys, vec!["alpha", "beta"]);
    }

    #[test]
    fn test_isolation() {
        let (_dir, store) = setup();
        store.save("u1", "tasks", "key", "user1val").unwrap();
        store.save("u2", "tasks", "key", "user2val").unwrap();

        assert_eq!(store.restore("u1", "tasks", "key").unwrap(), Some("user1val".to_string()));
        assert_eq!(store.restore("u2", "tasks", "key").unwrap(), Some("user2val".to_string()));
    }
}
