//! PAM authentication provider.
//!
//! Enabled via `--features pam`. Delegates credential verification to the
//! system PAM stack, reads groups from `/etc/group` via libc/nix.

#[cfg(feature = "pam")]
pub mod provider {
    use async_trait::async_trait;
    use nix::unistd::User;

    use crate::auth_provider::{AuthProvider, AuthResult};
    use crate::config::PamConfig;

    /// Authenticates users through the Linux PAM subsystem.
    pub struct PamAuthProvider {
        service_name: String,
        default_role: String,
        admin_groups: Vec<String>,
    }

    impl PamAuthProvider {
        pub fn new(config: &PamConfig) -> Self {
            Self {
                service_name: config.service_name.clone(),
                default_role: config.default_role.clone(),
                admin_groups: config.admin_groups.clone(),
            }
        }
    }

    #[async_trait]
    impl AuthProvider for PamAuthProvider {
        async fn authenticate(&self, username: &str, password: &str) -> Option<AuthResult> {
            let service = self.service_name.clone();
            let user = username.to_string();
            let pass = password.to_string();

            let ok = tokio::task::spawn_blocking(move || {
                let mut auth = match pam::Authenticator::with_password(&service) {
                    Ok(a) => a,
                    Err(e) => {
                        tracing::error!("PAM init failed: {}", e);
                        return false;
                    }
                };
                auth.get_handler().set_credentials(&user, &pass);
                auth.authenticate().is_ok()
            })
            .await
            .unwrap_or(false);

            if !ok {
                return None;
            }

            // Auth succeeded — build AuthResult
            let groups = get_user_groups(username);
            let role = if groups.iter().any(|g| self.admin_groups.contains(g)) {
                "admin".to_string()
            } else {
                self.default_role.clone()
            };

            let display_name = get_gecos_name(username);
            let _ = display_name; // reserved for future use

            Some(AuthResult {
                user_id: format!("pam:{}", username),
                username: username.to_string(),
                role,
                groups,
            })
        }

        async fn get_groups(&self, username: &str) -> Vec<String> {
            get_user_groups(username)
        }

        fn name(&self) -> &str {
            "pam"
        }
    }

    /// Read the list of supplementary groups for a user from the system.
    fn get_user_groups(username: &str) -> Vec<String> {
        use std::ffi::CString;

        let user = match User::from_name(username) {
            Ok(Some(u)) => u,
            _ => return vec![],
        };

        let c_user = match CString::new(username) {
            Ok(c) => c,
            Err(_) => return vec![],
        };

        // getgrouplist
        let mut ngroups: libc::c_int = 32;
        let mut groups_buf: Vec<libc::gid_t> = vec![0; ngroups as usize];

        unsafe {
            let ret = libc::getgrouplist(
                c_user.as_ptr(),
                user.gid.as_raw(),
                groups_buf.as_mut_ptr(),
                &mut ngroups,
            );
            if ret == -1 {
                // Retry with the real count
                groups_buf.resize(ngroups as usize, 0);
                libc::getgrouplist(
                    c_user.as_ptr(),
                    user.gid.as_raw(),
                    groups_buf.as_mut_ptr(),
                    &mut ngroups,
                );
            }
        }

        groups_buf.truncate(ngroups as usize);

        groups_buf
            .iter()
            .filter_map(|&gid| {
                nix::unistd::Group::from_gid(nix::unistd::Gid::from_raw(gid))
                    .ok()
                    .flatten()
                    .map(|g| g.name)
            })
            .collect()
    }

    /// Read the GECOS (display name) field from /etc/passwd.
    #[allow(dead_code)]
    fn get_gecos_name(username: &str) -> Option<String> {
        let user = User::from_name(username).ok()??;
        let gecos = user.gecos.to_str().ok()?;
        let name = gecos.split(',').next()?;
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }
}
