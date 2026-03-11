use zro_protocol::types::{SessionId, SessionInfo};

use crate::jwt::Claims;

/// Session data extracted from a verified JWT. Injected into request extensions.
#[derive(Clone, Debug)]
pub struct Session {
    pub session_id: SessionId,
    pub user_id: String,
    pub username: String,
    pub role: String,
    pub groups: Vec<String>,
    pub jti: String,
}

impl Session {
    /// Build a Session from verified JWT claims.
    pub fn from_claims(claims: &Claims) -> Self {
        Self {
            session_id: SessionId(claims.jti.clone()),
            user_id: claims.uid.clone(),
            username: claims.sub.clone(),
            role: claims.role.clone(),
            groups: claims.groups.clone(),
            jti: claims.jti.clone(),
        }
    }

    pub fn to_session_info(&self) -> SessionInfo {
        SessionInfo {
            session_id: self.session_id.clone(),
            user_id: self.user_id.clone(),
            username: self.username.clone(),
            role: self.role.clone(),
            groups: self.groups.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_from_claims() {
        let claims = Claims {
            sub: "alice".into(),
            uid: "u-123".into(),
            role: "admin".into(),
            groups: vec!["devs".into()],
            iat: 1000,
            exp: 2000,
            jti: "jti-abc".into(),
        };

        let session = Session::from_claims(&claims);
        assert_eq!(session.username, "alice");
        assert_eq!(session.jti, "jti-abc");
        assert_eq!(session.groups, vec!["devs"]);

        let info = session.to_session_info();
        assert_eq!(info.username, "alice");
        assert_eq!(info.groups, vec!["devs"]);
    }
}
