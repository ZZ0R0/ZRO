# ZRO — Configuration

Trois fichiers de configuration dans `./config/` :

## `runtime.toml`

Configuration principale du runtime. Chemin modifiable via `ZRO_CONFIG` (env). Si absent, les valeurs par défaut s'appliquent.

### `[server]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `host` | `"0.0.0.0"` | Adresse d'écoute |
| `port` | `8080` | Port d'écoute (8090 recommandé en prod si 8080 est pris) |

### `[apps]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `manifest_dir` | `"./apps"` | Répertoire contenant les apps |
| `data_dir` | `"./data"` | Répertoire de données persistantes |
| `default_app` | `"shell"` | Slug de l'app pour la redirection de `/` |

### `[session]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `secret` | `"dev-secret-change-in-production"` | **Changer en production.** |
| `ttl_seconds` | `86400` (24h) | Durée de vie de la session |
| `cookie_name` | `"zro-session"` | Nom du cookie de session |

### `[auth]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `users_file` | `"./config/users.toml"` | Chemin du fichier utilisateurs |
| `providers` | `["local"]` | Providers d'auth dans l'ordre (`local`, `pam`, `ldap`) |
| `jwt_algorithm` | `"EdDSA"` | Algorithme JWT (seul Ed25519 supporté) |
| `jwt_ttl_seconds` | `86400` (24h) | Durée de vie du token d'accès |
| `jwt_refresh_ttl_seconds` | `604800` (7j) | Durée de vie du refresh token |
| `key_path` | `"./config/jwt_keys"` | Répertoire des clés Ed25519 |
| `token_cookie_name` | `"zro-token"` | Cookie du token d'accès |
| `refresh_cookie_name` | `"zro-refresh"` | Cookie du refresh token |

#### `[auth.pam]` (feature `pam`)

| Clé | Défaut | Description |
|-----|--------|-------------|
| `service_name` | `"zro"` | Service PAM (→ `/etc/pam.d/zro`) |
| `default_role` | `"user"` | Rôle par défaut |
| `admin_groups` | `["sudo", "wheel"]` | Groupes Linux qui donnent le rôle `admin` |

#### `[auth.ldap]` (feature `ldap`)

| Clé | Défaut | Description |
|-----|--------|-------------|
| `url` | `""` | URL du serveur LDAP (ex: `ldap://ad.company.com:389`) |
| `use_tls` | `false` | Activer TLS |
| `bind_dn_template` | `""` | Template DN (`{}` = username) |
| `search_base` | `""` | Base DN pour les recherches |
| `user_filter` | `"(uid={})"` | Filtre LDAP (`{}` = username) |
| `group_attribute` | `null` | Attribut contenant les groupes |
| `display_name_attr` | `null` | Attribut pour le nom d'affichage |
| `admin_groups` | `[]` | Groupes LDAP qui donnent le rôle `admin` |
| `default_role` | `"user"` | Rôle par défaut |
| `service_dn` | `null` | DN du compte de service (recherches sans bind user) |
| `service_password` | `null` | Mot de passe du compte de service |

### `[logging]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `level` | `"info"` | Niveau de log (`debug`, `info`, `warn`, `error`) |
| `format` | `"pretty"` | Format de sortie |

### `[supervisor]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `shutdown_timeout_seconds` | `10` | Timeout pour l'arrêt gracieux des apps |
| `health_check_interval_seconds` | `5` | Intervalle de check santé |
| `max_restart_attempts` | `3` | Tentatives de redémarrage automatique |

### `[control]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `socket_path` | `"/run/zro/control.sock"` | Chemin du socket Unix pour la CLI `zro` |
| `ipc_dir` | `"/tmp/zro/ipc"` | Répertoire des sockets IPC (runtime ↔ backends) |

> **Note :** Pour un déploiement user-level (sans root), utiliser des chemins sous `/tmp/zro/` :
> ```toml
> [control]
> socket_path = "/tmp/zro/control.sock"
> ipc_dir = "/tmp/zro/ipc"
> ```

### `[mode]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `mode` | `null` | `"development"` ou `"production"`. Auto-détecté si absent |

**Résolution du mode :** `ZRO_MODE` (env) > `mode.mode` (config) > auto-détection (presence of `Cargo.toml` → dev)

### `[development]`

Actif uniquement en mode développement.

| Clé | Défaut | Description |
|-----|--------|-------------|
| `hot_reload` | `true` | Rechargement automatique des manifestes |
| `cache` | `false` | Mise en cache des fichiers statiques |
| `verbose_errors` | `true` | Erreurs détaillées dans les réponses HTTP |

### `[production]`

Actif uniquement en mode production.

| Clé | Défaut | Description |
|-----|--------|-------------|
| `cache` | `true` | Mise en cache des fichiers statiques |
| `verbose_errors` | `false` | Erreurs vagues (sécurité) |

### `[storage]`

| Clé | Défaut | Description |
|-----|--------|-------------|
| `path` | `"./data/zro.db"` | Chemin de la base SQLite |
| `wal_mode` | `true` | Activer WAL (Write-Ahead Logging) |
| `pool_size` | `10` | Taille du pool de connexions (r2d2) |
| `cleanup_interval_seconds` | `3600` | Intervalle de nettoyage des données expirées |

### Exemple complet

```toml
[server]
host = "0.0.0.0"
port = 8080

[apps]
manifest_dir = "./apps"
data_dir = "./data"
default_app = "shell"

[session]
secret = "change-me-in-production-use-a-long-random-string"
ttl_seconds = 86400
cookie_name = "zro-session"

[auth]
users_file = "./config/users.toml"
providers = ["local"]
jwt_ttl_seconds = 86400
jwt_refresh_ttl_seconds = 604800
key_path = "./config/jwt_keys"

[logging]
level = "info"
format = "pretty"

[supervisor]
shutdown_timeout_seconds = 10
health_check_interval_seconds = 5
max_restart_attempts = 3

[mode]
mode = "production"

[storage]
path = "./data/zro.db"
wal_mode = true
pool_size = 10

[control]
socket_path = "/run/zro/control.sock"
ipc_dir = "/tmp/zro/ipc"
```

---

## `users.toml`

Fichier des utilisateurs locaux. Utilisé par le provider `local`.

```toml
[[users]]
username = "dev"
password_hash = "$argon2id$v=19$m=19456,t=2,p=1$..."
role = "admin"

[[users]]
username = "alice"
password_hash = "$argon2id$v=19$m=19456,t=2,p=1$..."
role = "user"
groups = ["developers", "staff"]
```

### Champs

| Champ | Requis | Description |
|-------|--------|-------------|
| `username` | oui | Identifiant unique |
| `password_hash` | oui | Hash Argon2id |
| `role` | oui | `"admin"` ou `"user"` |
| `groups` | non | Liste de groupes |

### Génération d'un hash

```bash
cargo run --example gen_hash -p zro-runtime -- <mot_de_passe>
```

### Mode développement

Si le fichier `users.toml` est absent en mode dev, un utilisateur `dev`/`dev` (rôle `admin`) est créé automatiquement.

---

## `permissions.toml`

Contrôle d'accès par app. Si le fichier est absent, tous les utilisateurs authentifiés ont accès à toutes les apps.

```toml
[global]
admin_bypass = true    # Les admins passent tous les contrôles

[apps.terminal]
roles = ["admin"]
groups = ["developers", "sudo"]

[apps.files]
roles = ["admin", "user"]
groups = ["staff"]
users = ["alice", "charlie"]

# Pas de section pour "notes" → ouvert à tous
```

### Algorithme de résolution

1. Si `admin_bypass = true` et `role == "admin"` → **autorisé**
2. Si pas de section `[apps.{slug}]` → **autorisé** (par défaut ouvert)
3. Sinon, vérifier :
   - `users` : username dans la liste ?
   - `roles` : rôle de l'utilisateur dans la liste ?
   - `groups` : intersection non-vide entre groupes de l'utilisateur et groupes de la liste ?
4. Au moins un match → **autorisé**. Sinon → **refusé**

---

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `ZRO_CONFIG` | Chemin du fichier de config (défaut: `./config/runtime.toml`) |
| `ZRO_MODE` | Force le mode : `development` ou `production` |
| `RUST_LOG` | Niveau de log pour tracing (ex: `info`, `debug`, `zro_runtime=debug`) |
| `NOTIFY_SOCKET` | Socket systemd pour sd_notify (géré automatiquement par systemd) |
| `WATCHDOG_USEC` | Intervalle watchdog systemd en microsecondes (géré automatiquement) |

Variables fournies aux backends par le supervisor :

| Variable | Description |
|----------|-------------|
| `ZRO_APP_SLUG` | Slug de l'app |
| `ZRO_IPC_SOCKET` | Chemin du socket Unix IPC |
| `ZRO_DATA_DIR` | Répertoire de données de l'app |
| `ZRO_LOG_LEVEL` | Niveau de log configuré |

---

## Clés JWT

Répertoire `./config/jwt_keys/`. Le runtime génère automatiquement une paire Ed25519 au premier démarrage si les fichiers n'existent pas :

- `ed25519_private.pem` — Clé privée (signature)
- `ed25519_public.pem` — Clé publique (vérification)

⚠️ **En production**, copier les mêmes clés sur tous les nœuds pour que les tokens soient valides après un redéploiement.
