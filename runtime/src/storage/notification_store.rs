//! Persistent notification storage.
//!
//! Stores notification history so users can review past notifications
//! in the notification center, even after the toast has disappeared.

use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::SqliteStore;

/// Urgency level for a notification.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Urgency {
    Low,
    #[default]
    Normal,
    Critical,
}

impl std::fmt::Display for Urgency {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Low => write!(f, "low"),
            Self::Normal => write!(f, "normal"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

impl Urgency {
    fn from_str(s: &str) -> Self {
        match s {
            "low" => Self::Low,
            "critical" => Self::Critical,
            _ => Self::Normal,
        }
    }
}

/// A persisted notification entry.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub user_id: String,
    pub app_slug: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub urgency: Urgency,
    #[serde(default)]
    pub read: bool,
    pub created_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    /// JSON array of action objects: [{label, command, params}]
    #[serde(default)]
    pub actions: String,
}

/// SQLite-backed notification store.
#[derive(Clone)]
pub struct NotificationStore {
    store: SqliteStore,
}

impl NotificationStore {
    pub fn new(store: SqliteStore) -> Self {
        Self { store }
    }

    /// Insert a new notification.
    pub fn insert(&self, notif: &Notification) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "INSERT INTO notifications (id, user_id, app_slug, title, body, icon, urgency, read, created_at, expires_at, actions)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                notif.id,
                notif.user_id,
                notif.app_slug,
                notif.title,
                notif.body,
                notif.icon,
                notif.urgency.to_string(),
                notif.read as i32,
                notif.created_at,
                notif.expires_at,
                notif.actions,
            ],
        )?;
        Ok(())
    }

    /// Get notifications for a user, optionally filtered to unread only.
    pub fn get(&self, user_id: &str, unread_only: bool, limit: u32) -> Result<Vec<Notification>> {
        let conn = self.store.conn()?;

        let (sql, params_vec): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if unread_only {
            (
                "SELECT id, user_id, app_slug, title, body, icon, urgency, read, created_at, expires_at, actions
                 FROM notifications WHERE user_id = ?1 AND read = 0
                 ORDER BY created_at DESC LIMIT ?2",
                vec![Box::new(user_id.to_string()), Box::new(limit)],
            )
        } else {
            (
                "SELECT id, user_id, app_slug, title, body, icon, urgency, read, created_at, expires_at, actions
                 FROM notifications WHERE user_id = ?1
                 ORDER BY created_at DESC LIMIT ?2",
                vec![Box::new(user_id.to_string()), Box::new(limit)],
            )
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params_vec.iter()), |row| {
            Ok(Notification {
                id: row.get(0)?,
                user_id: row.get(1)?,
                app_slug: row.get(2)?,
                title: row.get(3)?,
                body: row.get(4)?,
                icon: row.get(5)?,
                urgency: Urgency::from_str(&row.get::<_, String>(6)?),
                read: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
                expires_at: row.get(9)?,
                actions: row.get(10)?,
            })
        })?;

        let mut notifs = Vec::new();
        for row in rows {
            notifs.push(row?);
        }
        Ok(notifs)
    }

    /// Mark a single notification as read (scoped to user for safety).
    pub fn mark_read(&self, id: &str, user_id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "UPDATE notifications SET read = 1 WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(())
    }

    /// Mark all notifications as read for a user.
    pub fn mark_all_read(&self, user_id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "UPDATE notifications SET read = 1 WHERE user_id = ?1 AND read = 0",
            params![user_id],
        )?;
        Ok(())
    }

    /// Delete a single notification (scoped to user for safety).
    pub fn delete(&self, id: &str, user_id: &str) -> Result<()> {
        let conn = self.store.conn()?;
        conn.execute(
            "DELETE FROM notifications WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(())
    }

    /// Count unread notifications for a user.
    pub fn count_unread(&self, user_id: &str) -> Result<u32> {
        let conn = self.store.conn()?;
        let count: u32 = conn.query_row(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ?1 AND read = 0",
            params![user_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, NotificationStore) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let sqlite = SqliteStore::new(db_path.to_str().unwrap(), 2, true).unwrap();
        (dir, NotificationStore::new(sqlite))
    }

    fn make_notif(id: &str, user_id: &str, app_slug: &str, title: &str) -> Notification {
        Notification {
            id: id.to_string(),
            user_id: user_id.to_string(),
            app_slug: app_slug.to_string(),
            title: title.to_string(),
            body: String::new(),
            icon: String::new(),
            urgency: Urgency::Normal,
            read: false,
            created_at: "2025-01-01T00:00:00".to_string(),
            expires_at: None,
            actions: "[]".to_string(),
        }
    }

    #[test]
    fn test_insert_and_get() {
        let (_dir, store) = setup();
        let notif = make_notif("n1", "u1", "tasks", "New task assigned");
        store.insert(&notif).unwrap();

        let all = store.get("u1", false, 50).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "New task assigned");
        assert!(!all[0].read);
    }

    #[test]
    fn test_unread_filter() {
        let (_dir, store) = setup();
        store.insert(&make_notif("n1", "u1", "tasks", "Task 1")).unwrap();
        store.insert(&make_notif("n2", "u1", "tasks", "Task 2")).unwrap();
        store.mark_read("n1", "u1").unwrap();

        let unread = store.get("u1", true, 50).unwrap();
        assert_eq!(unread.len(), 1);
        assert_eq!(unread[0].id, "n2");

        let all = store.get("u1", false, 50).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_mark_all_read() {
        let (_dir, store) = setup();
        store.insert(&make_notif("n1", "u1", "tasks", "Task 1")).unwrap();
        store.insert(&make_notif("n2", "u1", "files", "File uploaded")).unwrap();
        store.mark_all_read("u1").unwrap();

        let unread = store.get("u1", true, 50).unwrap();
        assert_eq!(unread.len(), 0);
    }

    #[test]
    fn test_count_unread() {
        let (_dir, store) = setup();
        store.insert(&make_notif("n1", "u1", "tasks", "Task 1")).unwrap();
        store.insert(&make_notif("n2", "u1", "tasks", "Task 2")).unwrap();
        store.insert(&make_notif("n3", "u1", "files", "File 1")).unwrap();

        assert_eq!(store.count_unread("u1").unwrap(), 3);
        store.mark_read("n1", "u1").unwrap();
        assert_eq!(store.count_unread("u1").unwrap(), 2);
    }

    #[test]
    fn test_delete() {
        let (_dir, store) = setup();
        store.insert(&make_notif("n1", "u1", "tasks", "Task 1")).unwrap();
        store.delete("n1", "u1").unwrap();
        let all = store.get("u1", false, 50).unwrap();
        assert_eq!(all.len(), 0);
    }

    #[test]
    fn test_user_isolation() {
        let (_dir, store) = setup();
        store.insert(&make_notif("n1", "u1", "tasks", "User 1 task")).unwrap();
        store.insert(&make_notif("n2", "u2", "tasks", "User 2 task")).unwrap();

        let u1 = store.get("u1", false, 50).unwrap();
        assert_eq!(u1.len(), 1);
        assert_eq!(u1[0].title, "User 1 task");

        let u2 = store.get("u2", false, 50).unwrap();
        assert_eq!(u2.len(), 1);
        assert_eq!(u2[0].title, "User 2 task");
    }

    #[test]
    fn test_urgency_levels() {
        let (_dir, store) = setup();
        let mut notif = make_notif("n1", "u1", "system", "Critical alert");
        notif.urgency = Urgency::Critical;
        store.insert(&notif).unwrap();

        let all = store.get("u1", false, 50).unwrap();
        assert_eq!(all[0].urgency, Urgency::Critical);
    }

    #[test]
    fn test_limit() {
        let (_dir, store) = setup();
        for i in 0..10 {
            store.insert(&make_notif(&format!("n{}", i), "u1", "tasks", &format!("Task {}", i))).unwrap();
        }

        let limited = store.get("u1", false, 3).unwrap();
        assert_eq!(limited.len(), 3);
    }

    #[test]
    fn test_delete_wrong_user_is_safe() {
        let (_dir, store) = setup();
        store.insert(&make_notif("n1", "u1", "tasks", "Task 1")).unwrap();
        // Trying to delete another user's notification should do nothing
        store.delete("n1", "u2").unwrap();
        let all = store.get("u1", false, 50).unwrap();
        assert_eq!(all.len(), 1);
    }
}
