//! LDAP authentication provider.
//!
//! Enabled via `--features ldap`. Authenticates via LDAP bind and optionally
//! looks up user attributes (groups, display name) with a service account.

#[cfg(feature = "ldap")]
pub mod provider {
    use async_trait::async_trait;
    use ldap3::{LdapConnAsync, Scope, SearchEntry};

    use crate::auth_provider::{AuthProvider, AuthResult};
    use crate::config::LdapConfig;

    /// Authenticates users against an LDAP directory (Active Directory, OpenLDAP, etc.).
    pub struct LdapAuthProvider {
        url: String,
        bind_dn_template: String,
        search_base: String,
        user_filter: String,
        group_attribute: String,
        display_name_attr: String,
        admin_groups: Vec<String>,
        default_role: String,
        use_tls: bool,
        service_dn: Option<String>,
        service_password: Option<String>,
    }

    impl LdapAuthProvider {
        pub fn new(config: &LdapConfig) -> Self {
            Self {
                url: config.url.clone(),
                bind_dn_template: config.bind_dn_template.clone(),
                search_base: config.search_base.clone(),
                user_filter: config.user_filter.clone(),
                group_attribute: config
                    .group_attribute
                    .clone()
                    .unwrap_or_else(|| "memberOf".into()),
                display_name_attr: config
                    .display_name_attr
                    .clone()
                    .unwrap_or_else(|| "displayName".into()),
                admin_groups: config.admin_groups.clone(),
                default_role: config.default_role.clone(),
                use_tls: config.use_tls,
                service_dn: config.service_dn.clone(),
                service_password: config.service_password.clone(),
            }
        }

        async fn search_user(
            &self,
            ldap: &mut ldap3::Ldap,
            username: &str,
        ) -> Option<AuthResult> {
            let filter = self.user_filter.replace("{}", username);

            let (results, _) = match ldap
                .search(
                    &self.search_base,
                    Scope::Subtree,
                    &filter,
                    vec![
                        self.display_name_attr.as_str(),
                        self.group_attribute.as_str(),
                    ],
                )
                .await
            {
                Ok(r) => match r.success() {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::error!("LDAP search result error: {}", e);
                        return None;
                    }
                },
                Err(e) => {
                    tracing::error!("LDAP search error: {}", e);
                    return None;
                }
            };

            let entry = match results.into_iter().next() {
                Some(e) => SearchEntry::construct(e),
                None => return None,
            };

            let groups: Vec<String> = entry
                .attrs
                .get(&self.group_attribute)
                .cloned()
                .unwrap_or_default();

            let role = if groups.iter().any(|g| self.admin_groups.contains(g)) {
                "admin".to_string()
            } else {
                self.default_role.clone()
            };

            Some(AuthResult {
                user_id: format!("ldap:{}", username),
                username: username.to_string(),
                role,
                groups,
            })
        }
    }

    #[async_trait]
    impl AuthProvider for LdapAuthProvider {
        async fn authenticate(
            &self,
            username: &str,
            password: &str,
        ) -> Option<AuthResult> {
            // 1. Build user DN from template
            let user_dn = self.bind_dn_template.replace("{}", username);

            // 2. Connect
            let (conn, mut ldap) = match LdapConnAsync::new(&self.url).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("LDAP connect failed: {}", e);
                    return None;
                }
            };
            tokio::spawn(conn.drive());

            // 3. Bind with user credentials
            let bind_result = match ldap.simple_bind(&user_dn, password).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("LDAP bind error: {}", e);
                    return None;
                }
            };

            if bind_result.rc != 0 {
                tracing::debug!("LDAP bind failed for {}: rc={}", username, bind_result.rc);
                return None;
            }

            // 4. Search user attributes
            let result = self.search_user(&mut ldap, username).await;
            let _ = ldap.unbind().await;
            result
        }

        async fn get_groups(&self, username: &str) -> Vec<String> {
            // Use service account if available
            let (conn, mut ldap) = match LdapConnAsync::new(&self.url).await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("LDAP connect failed: {}", e);
                    return vec![];
                }
            };
            tokio::spawn(conn.drive());

            if let (Some(dn), Some(pass)) = (&self.service_dn, &self.service_password) {
                if ldap.simple_bind(dn, pass).await.is_err() {
                    return vec![];
                }
            }

            let result = self.search_user(&mut ldap, username).await;
            let _ = ldap.unbind().await;
            result.map(|r| r.groups).unwrap_or_default()
        }

        fn name(&self) -> &str {
            "ldap"
        }
    }
}
