use serde::{Deserialize, Serialize};

/// Unique identifier for an app instance ("{slug}-{N}" format).
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct InstanceId(pub String);

/// Unique identifier for a session (UUID v4 string).
#[derive(Clone, Debug, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub struct SessionId(pub String);

impl std::fmt::Display for InstanceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Session information attached to IPC messages.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: SessionId,
    pub user_id: String,
    pub username: String,
    pub role: String,
    /// User groups for access control.
    #[serde(default)]
    pub groups: Vec<String>,
}
