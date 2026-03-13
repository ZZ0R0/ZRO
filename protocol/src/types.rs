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

/// Extended user profile information (display name, avatar, locale…).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UserProfile {
    /// Human-readable display name (falls back to username if None).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Relative URL or base64-encoded avatar image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// Email address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// BCP-47 locale tag (e.g. "fr-FR").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// IANA timezone (e.g. "Europe/Paris").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
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
    /// Optional extended user profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<UserProfile>,
}
