//! Session persistence in SQLite.

use anyhow::Result;
use rusqlite::params;

use super::SqliteStore;

/// A persisted session record.
#[derive(Clone, Debug)]
pub struct SessionRecord {
    pub id: String,
    pub user_id: String,
    pub username: String,
    pub role: String,
    pub groups: Vec<String>,
    pub created_at: String,
    pub last_active: String,
    pub expires_at: String,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub is_active: bool,
}

/// SQLite-backed session store.
#[derive(Clone)]
pub struct SessionStore {
    store: SqliteStore,
}

impl SessionStore {
    pub fn new(store: SqliteStore) -> Self {
        Self { store }
    }

    /// Create a new session record.
    pub fn create(&self, session: &SessionRecord) -> Result<()> {
        let conn = self.store.conn()?;
        let groups_json = serde_json::to_string(&session.groups)?;
        conn.execute(
            "INSERT INTO sessions (id, user_id, username, role, groups, expires_at, ip_address, user_agent)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session.id,
                session.user_id,
                session.username,
                session.role,
                groups_json,
                session.expires_at,
                session.ip_address,
                session.user_agent,
            ],
        )?;
        Ok(())
    }

    /// Get an active, non-expired session by ID.
    pub fn get(&self, id: &str) -> Result<Option<SessionRecord>> {
        let conn = self.store.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, username, role, groups, created_at, last_active, expires_at, ip_address, user_agent, is_active
             FROM sessions WHERE id = ?1 AND is_active = 1 AND expires_at > datetime('now')"
        )?;

        let result = stmt.query_row(params![id], |row| {
            let groups_json: String = row.get(4)?;
            Ok(SessionRecord {
                id: row.get(0)?,
                user_id: row.get(1)?,
                username: row.get(2)?,
                role: row.get(3)?,
                groups: serde_json::from_str(&groups_json).unwrap_or_default(),
                created_at: row.get(5)?,
                last_active: row.get(6)?,
                expires_at: row.get(7)?,
                ip_address: row.get(8)?,
                user_agent: row.get(9)?,
                is_active: row.get::<_, i32>(10)? != 0,
            })
        });

        match result {
            Ok(record) => Ok(Some(record)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Update `last_active` timestamp.
    pub fn touch(&self, id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "UPDATE sessions SET last_active = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Mark a session as inactive.
    pub fn revoke(&self, id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "UPDATE sessions SET is_active = 0 WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Get all active sessions for a user.
    pub fn get_active_for_user(&self, user_id: &str) -> Result<Vec<SessionRecord>> {
        let conn = self.store.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, username, role, groups, created_at, last_active, expires_at, ip_address, user_agent, is_active
             FROM sessions WHERE user_id = ?1 AND is_active = 1 AND expires_at > datetime('now')"
        )?;

        let rows = stmt.query_map(params![user_id], |row| {
            let groups_json: String = row.get(4)?;
            Ok(SessionRecord {
                id: row.get(0)?,
                user_id: row.get(1)?,
                username: row.get(2)?,
                role: row.get(3)?,
                groups: serde_json::from_str(&groups_json).unwrap_or_default(),
                created_at: row.get(5)?,
                last_active: row.get(6)?,
                expires_at: row.get(7)?,
                ip_address: row.get(8)?,
                user_agent: row.get(9)?,
                is_active: row.get::<_, i32>(10)? != 0,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Count active sessions.
    #[allow(dead_code)]
    pub fn count_active(&self) -> Result<i64> {
        let conn = self.store.conn()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE is_active = 1 AND expires_at > datetime('now')",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, SessionStore) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let sqlite = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();
        (dir, SessionStore::new(sqlite))
    }

    fn make_session(id: &str, user_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            user_id: user_id.to_string(),
            username: "testuser".to_string(),
            role: "admin".to_string(),
            groups: vec!["admins".to_string()],
            created_at: String::new(),
            last_active: String::new(),
            expires_at: "2099-12-31T23:59:59".to_string(),
            ip_address: Some("127.0.0.1".to_string()),
            user_agent: Some("test-agent".to_string()),
            is_active: true,
        }
    }

    #[test]
    fn test_create_and_get() {
        let (_dir, store) = setup();
        let session = make_session("s1", "u1");
        store.create(&session).unwrap();

        let found = store.get("s1").unwrap().unwrap();
        assert_eq!(found.username, "testuser");
        assert_eq!(found.groups, vec!["admins"]);
    }

    #[test]
    fn test_revoke() {
        let (_dir, store) = setup();
        let session = make_session("s2", "u1");
        store.create(&session).unwrap();

        store.revoke("s2").unwrap();
        assert!(store.get("s2").unwrap().is_none());
    }

    #[test]
    fn test_get_active_for_user() {
        let (_dir, store) = setup();
        store.create(&make_session("s3", "u1")).unwrap();
        store.create(&make_session("s4", "u1")).unwrap();
        store.create(&make_session("s5", "u2")).unwrap();

        let sessions = store.get_active_for_user("u1").unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn test_touch() {
        let (_dir, store) = setup();
        store.create(&make_session("s6", "u1")).unwrap();
        // Should not fail
        store.touch("s6").unwrap();
    }
}
