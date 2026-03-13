# ZRO — Architecture

## Vue d'ensemble

ZRO est un environnement de bureau distant pour Linux. Un unique processus **runtime** (Rust/axum) gère l'authentification, le multiplexage WebSocket, la persistance de sessions et le routage vers des **processus backend** — un par application — via des sockets Unix (IPC).

```
Navigateur (n'importe quel appareil)
    ↕  HTTPS + 1 WebSocket par session
Runtime ZRO (axum, configurable — défaut 8080)
├── Pipeline d'auth      (Argon2id + JWT Ed25519)
├── Multiplexeur WS      (routage par instance)
├── Serveur de fichiers   (frontends par app + assets partagés)
├── Proxy HTTP API        (/{slug}/api/* → IPC)
├── SQLite               (sessions, état applicatif, tokens)
├── Moteur de permissions (rôles, groupes, utilisateurs)
├── Socket de contrôle    (CLI ↔ runtime, commandes admin)
└── Routeur IPC          (Unix Domain Sockets)
        ↕  JSON préfixé par longueur (4 octets big-endian)
Processus backend (1 par slug d'app)
    echo │ notes │ files │ terminal │ tasks │ shell │ custom-shell

    CLI `zro`  ──→  Socket de contrôle (/run/zro/control.sock)
    systemd    ──→  sd_notify (READY, WATCHDOG, RELOADING)
```

## Décisions de design

| Décision | Justification |
|----------|---------------|
| **Un process backend par slug** | Pas un par fenêtre. Plusieurs fenêtres frontend se connectent au même backend. Chaque requête porte un `instance_id` pour isoler l'état par fenêtre si nécessaire. |
| **Un seul WebSocket par session** | Le client ouvre une connexion WS vers `/ws` et multiplexe tout le trafic applicatif via le champ `instance`. |
| **Le shell est une app** | Le window manager (shell / custom-shell) tourne comme une app ZRO ordinaire — aucun support spécial dans le runtime. |
| **SDK inspiré de Tauri** | Le développeur déclare des commandes ; le SDK gère toute la plomberie IPC. |
| **Sessions stateless** | Les sessions sont dérivées des claims JWT — pas de lookup serveur pour la validation. |
| **Stockage optionnel** | Le runtime fonctionne même si SQLite n'est pas disponible (dégradation gracieuse). |

## Composants du runtime

### Séquence de démarrage

| Étape | Action |
|-------|--------|
| 1 | Charger `config/runtime.toml` (ou `$ZRO_CONFIG`) |
| 2 | Initialiser le logging (tracing_subscriber) |
| 3 | Charger les utilisateurs (`users.toml`) + construire la pipeline d'auth |
| 4 | Charger les permissions (`permissions.toml`) |
| 5 | Initialiser le `JwtManager` (charger ou générer la paire Ed25519) |
| 6 | Scanner les manifestes (`apps/*/manifest.toml`) |
| 7 | Créer le `AppRegistry` (état partagé du gateway) |
| 8 | Initialiser SQLite + stores (sessions, état, tokens) |
| 9 | Démarrer le hot-reload (dev uniquement) + nettoyage des instances déconnectées |
| 10 | Lancer tous les backends via le Supervisor (tâche asynchrone) |
| 10b | Démarrer le serveur de contrôle (socket Unix pour la CLI `zro`) |
| 11 | Démarrer le serveur HTTP (axum) |
| 11b | Notifier systemd : `sd_notify(READY=1)` |
| 11c | Démarrer le handler SIGHUP (rechargement de config) |
| 11d | Démarrer le watchdog systemd (heartbeat périodique) |
| 12 | Arrêt gracieux sur Ctrl+C → shutdown de tous les backends + nettoyage du socket de contrôle |

### Gateway (axum)

Toutes les routes sont définies dans `runtime/src/gateway/router.rs` :

| Route | Méthode | Description | Auth |
|-------|---------|-------------|:----:|
| `/health` | GET | Health check + état des apps | Non |
| `/auth/login` | GET | Page de login HTML | Non |
| `/auth/login` | POST | Soumission des credentials | Non |
| `/auth/logout` | POST | Déconnexion (blacklist JWT) | Non |
| `/auth/refresh` | POST | Rafraîchir le token d'accès | Non |
| `/auth/me` | GET | Info utilisateur courant | Oui |
| `/` | GET | Redirect → `/{default_app}/` ou `/auth/login` | Auto |
| `/api/apps` | GET | Liste des apps accessibles (JSON) | Oui |
| `/apps` | GET | Page HTML de liste des apps | Oui |
| `/ws` | GET | Upgrade WebSocket (multiplexé) | Oui |
| `/static/{path}` | GET | Assets partagés (`zro-client.js`, etc.) | Non |
| `/{slug}/` | GET | `index.html` de l'app | Oui |
| `/{slug}/static/{path}` | GET | Assets statiques de l'app | Oui |
| `/{slug}/api/{path}` | ANY | Proxy HTTP → backend via IPC | Oui |
| `/{slug}/{instance_id}/` | GET | `index.html` (URL multi-instance) | Oui |
| `/{slug}/{instance_id}/static/{path}` | GET | Assets (multi-instance) | Oui |
| `/{slug}/{instance_id}/api/{path}` | ANY | Proxy API (multi-instance) | Oui |
| `/{slug}` | GET | Redirect 301 → `/{slug}/` | — |

### Middlewares

| Middleware | Description |
|-----------|-------------|
| **Security headers** | CSP (`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:`), X-Frame-Options (SAMEORIGIN), X-Content-Type-Options (nosniff), X-XSS-Protection (0), Referrer-Policy (strict-origin-when-cross-origin) |
| **Auth** | Extraction JWT depuis cookie → vérification signature Ed25519 → check blacklist (mémoire + SQLite) → injection `Session` dans les extensions de la requête. Touch throttlé : mise à jour `last_active` en SQLite max 1×/60s par session |

Le middleware d'auth bypass automatiquement : `/health`, `/auth/*`, `/static/*`.

### Authentification

| Aspect | Détail |
|--------|--------|
| **Hash des mots de passe** | Argon2id avec salt aléatoire |
| **Tokens d'accès** | JWT signé Ed25519 (EdDSA), TTL configurable (défaut : 24h) |
| **Tokens de rafraîchissement** | 32 octets aléatoires, base64url. Stockés comme hash SHA-256 côté serveur |
| **Révocation** | Blacklist des JTI en mémoire (HashSet O(1)) + SQLite (persiste à travers les redémarrages) |
| **Rate limiting** | 5 tentatives par IP sur 5 min, lockout de 15 min |
| **Providers** | `local` (users.toml), `pam` (feature-gated), `ldap` (feature-gated). Pipeline first-match-wins |
| **Cookies** | `zro-token` (HttpOnly, SameSite=Strict, Path=/), `zro-refresh` (HttpOnly, SameSite=Strict, Path=/auth/refresh) |
| **Clés** | Ed25519 : `config/jwt_keys/private.pem` + `public.pem` (auto-générées au premier démarrage) |
| **Nettoyage** | Tâche périodique (600s) : suppression des refresh tokens expirés |

#### Claims JWT

```json
{
  "sub": "dev",
  "uid": "u-xxxx",
  "role": "admin",
  "groups": [],
  "iat": 1710000000,
  "exp": 1710086400,
  "jti": "uuid-v4"
}
```

#### Flux de login

1. `POST /auth/login` avec `{ username, password }`
2. Rate limit check (par IP)
3. `AuthPipeline.authenticate()` — itère les providers, premier `Some(AuthResult)` gagne
4. Créer token d'accès JWT (EdDSA) + token de rafraîchissement (opaque)
5. Persister session + hash du refresh token en SQLite
6. Retourner cookies HttpOnly

#### Flux de refresh

1. `POST /auth/refresh` avec cookie `zro-refresh`
2. Valider le refresh token (hash SHA-256 lookup en mémoire)
3. Blacklister l'ancien JTI d'accès
4. Émettre un nouveau token d'accès
5. Retourner le nouveau cookie

### Permissions

Configurées dans `config/permissions.toml`. Trois niveaux de contrôle d'accès :

```toml
[global]
admin_bypass = true     # les admins accèdent à tout

[apps.terminal]
roles = ["admin"]       # restreint par rôle

[apps.internal]
groups = ["devops"]     # restreint par groupe

[apps.secret]
users = ["alice"]       # restreint par utilisateur
```

**Algorithme `can_access(username, role, groups, slug)` :**

1. Si `admin_bypass` et rôle = `"admin"` → **accès**
2. Si aucune règle pour cette app → **accès** (ouvert par défaut)
3. Vérifier `roles` → `groups` → `users` (logique OR, tout match suffit)
4. Rien ne match → **refus**

**Points d'application** : serveur de fichiers statiques, routage WS invoke, listing `/api/apps`, proxy HTTP.

### Persistance SQLite

Le runtime utilise SQLite (WAL mode, pool r2d2, busy_timeout=5000, foreign_keys=ON) :

| Table | Usage | Colonnes clés |
|-------|-------|---------------|
| `sessions` | Sessions utilisateur | `id`, `user_id`, `username`, `role`, `groups` (JSON), `expires_at`, `ip_address`, `user_agent`, `is_active` |
| `app_states` | État UI par utilisateur/app | `user_id`, `app_slug`, `key`, `value` — UNIQUE(user_id, app_slug, key) |
| `refresh_tokens` | Hash des refresh tokens | `token_hash` (UNIQUE), `session_id` FK, `is_revoked`, `expires_at` |
| `jwt_blacklist` | JTI révoqués | `jti` PK, `expires_at` |
| `active_windows` | État des fenêtres WM | `session_id` FK, `app_slug`, `window_id`, position/taille/z_index/minimized/maximized |

**Nettoyage automatique** : tâche en arrière-plan qui supprime les sessions expirées, tokens révoqués, entrées de blacklist expirées, fenêtres orphelines (intervalle configurable, défaut : 1h).

### Supervisor

Le supervisor gère le cycle de vie des backends :

**Démarrage par app :**

1. Créer le socket Unix (`/tmp/zro/ipc/{slug}.sock`)
2. Résoudre l'exécutable : `./bin/{exe}` puis `$PATH`
3. Créer le répertoire de données (`data/{slug}/`)
4. Spawner le process avec les variables d'environnement
5. Attendre la connexion IPC (timeout : 10s) + handshake Hello/HelloAck
6. Valider la version du protocole
7. Enregistrer le canal IPC, marquer l'app comme `Running`
8. Lancer la boucle de lecture des messages backend

**Variables d'environnement injectées :**

| Variable | Exemple | Description |
|----------|---------|-------------|
| `ZRO_APP_SLUG` | `terminal` | Slug de l'app |
| `ZRO_IPC_SOCKET` | `/tmp/zro/ipc/terminal.sock` | Chemin du socket Unix |
| `ZRO_DATA_DIR` | `./data/terminal` | Répertoire de données persistantes |
| `ZRO_LOG_LEVEL` | `debug` | Niveau de log |

**Boucle de lecture backend — messages gérés :**

| Message | Action |
|---------|--------|
| `HttpResponse` | Livrer à la requête en attente (corrélation par ID) |
| `CommandResponse` | Livrer à la requête WS en attente |
| `EventEmit` | Router vers les clients WS — `Instance` (ciblé) ou `Broadcast` (tous) |
| `Log` | Router vers tracing au niveau spécifié |
| `ShutdownAck` | Terminer la boucle |

**Arrêt gracieux :**

1. Envoyer `Shutdown` via IPC (avec période de grâce)
2. Attendre `ShutdownAck`
3. Supprimer le canal IPC + fichier socket
4. Kill le processus restant

### App Registry

Registre en mémoire de toutes les apps :

**États possibles :** `Loading` → `Running` → `Stopping` → `Stopped` | `Error(String)`

Chargement : scan du répertoire de manifestes → `AppManifest::load()` pour chaque sous-répertoire contenant `manifest.toml`.

### Hot Reload (dev)

En mode développement, le runtime surveille (via `notify`) les répertoires `frontend/` de chaque app. Sur modification de fichier → broadcast d'un événement `__hot_reload` à tous les clients WebSocket de l'app concernée.

### Socket de contrôle (CLI ↔ Runtime)

Le runtime expose un socket Unix (`/run/zro/control.sock` par défaut, configurable via `[control].socket_path`) pour l'administration à chaud. La CLI `zro` communique avec le runtime via ce socket.

**Transport :** Même framing JSON préfixé par longueur que le protocole IPC (4 octets big-endian + JSON UTF-8).

**Commandes disponibles :**

| Commande | Description |
|----------|-------------|
| `status` | État du runtime : version, uptime, PID, port, nombre d'apps, connexions WS |
| `app.list` | Liste de toutes les apps avec nom, version, état |
| `app.info` | Détails d'une app (slug, exe, frontend, data_dir, transport) |
| `app.start` | Démarrer un backend arrêté |
| `app.stop` | Arrêter un backend (gracieux avec SIGTERM) |
| `app.restart` | Stop + Start d'un backend |
| `app.install` | Installer une nouvelle app depuis un répertoire staging (sous `/tmp/`) |
| `app.remove` | Désinstaller une app (stop + unregister + suppression des fichiers, données préservées) |
| `app.update` | Mise à jour atomique avec backup/rollback automatique |
| `config.show` | Afficher la configuration active |
| `config.reload` | Recharger users.toml + permissions.toml |
| `user.list` | Lister les utilisateurs locaux |
| `user.add` | Ajouter un utilisateur (avec hash Argon2id) |
| `user.remove` | Supprimer un utilisateur |
| `user.passwd` | Changer le mot de passe d'un utilisateur |

**Sécurité :** Le socket est créé avec les permissions `0660`. Seul l'utilisateur propriétaire du process runtime (ou les membres de son groupe) peuvent s'y connecter.

**Protocole :**
```json
// Requête CLI → Runtime
{ "type": "ControlRequest", "id": "uuid", "payload": { "cmd": "status" } }

// Réponse Runtime → CLI
{ "type": "ControlResponse", "id": "uuid", "payload": { "ok": true, "data": { ... } } }
```

### CLI `zro`

Binaire unique (`cli/src/main.rs`) pour administrer le runtime à distance via le socket de contrôle. Inspiré de `systemctl` et `flatpak`.

```
zro [OPTIONS] <COMMANDE>

OPTIONS:
  --json        Sortie JSON (pour scripting)
  -q, --quiet   Sortie minimale
  -v, --verbose Sortie détaillée
  --socket PATH Socket de contrôle (défaut: /run/zro/control.sock)

COMMANDES:
  status              État du runtime
  version             Version CLI + runtime
  app list            Lister les apps
  app info <slug>     Détails d'une app
  app install <src>   Installer une app (.tar.gz ou répertoire)
  app remove <slug>   Désinstaller une app
  app start <slug>    Démarrer un backend
  app stop <slug>     Arrêter un backend
  app restart <slug>  Redémarrer un backend
  app update <slug> <src>  Mettre à jour une app
  app logs <slug>     Logs d'une app (via journalctl)
  config show         Configuration active
  config edit         Ouvrir dans $EDITOR
  config reload       Recharger users/permissions (SIGHUP)
  config path         Afficher le chemin du fichier de config
  user list           Lister les utilisateurs
  user add <name>     Ajouter un utilisateur
  user remove <name>  Supprimer un utilisateur
  user passwd <name>  Changer un mot de passe
  logs [-f] [-n 50]   Logs du runtime (via journalctl)
  doctor              Diagnostic complet
```

### Intégration systemd

Le runtime s'intègre nativement avec systemd :

| Fonctionnalité | Mécanisme |
|----------------|-----------|
| **Notification de démarrage** | `sd_notify(READY=1)` — permet `Type=notify` dans l'unit systemd |
| **Watchdog** | Heartbeat périodique (`sd_notify(WATCHDOG=1)`) toutes les 10s, `WatchdogSec=30s` dans l'unit |
| **Rechargement** | SIGHUP → recharge users.toml + permissions.toml → `sd_notify(RELOADING)` → `sd_notify(READY)` |
| **Arrêt gracieux** | SIGTERM → shutdown des backends → nettoyage des sockets → exit |

**Unit systemd :**

```ini
[Unit]
Description=ZRO Web Desktop Environment

[Service]
Type=notify
ExecStart=/usr/bin/zro-runtime
ExecReload=/bin/kill -HUP $MAINPID
Environment=ZRO_MODE=production
Environment=RUST_LOG=info
WatchdogSec=30s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### WS Session Manager

Gère les connexions WebSocket et le routage des instances :

- **`sessions`** : HashMap de toutes les connexions WS actives
- **`instance_routes`** : Routage O(1) instance_id → session_id
- **`disconnected_instances`** : Tracker pour la détection de reconnexion

Fonctionnalités :

- **Transfert d'instance** entre sessions (reconnexion après perte de connexion)
- **Nettoyage automatique** des instances déconnectées (délai de grâce configurable, défaut : 5 min)
- **Routage ciblé** : `send_to_instance()` pour un client spécifique
- **Broadcast par app** : `broadcast_to_app()` pour tous les clients d'une app
- **Broadcast par utilisateur** : `broadcast_to_user()` pour toutes les sessions d'un user

### Serveur de fichiers statiques

| Fonction | Route | Description |
|----------|-------|-------------|
| `serve_app_index` | `/{slug}/` | Sert `index.html` de l'app, vérifie les permissions |
| `serve_app_static` | `/{slug}/static/{path}` | Assets de l'app, protection traversée de chemin |
| `serve_shared_static` | `/static/{path}` | Sert depuis `./static/` |

**Sécurité :** `is_safe_path()` rejette `..`, composants `ParentDir` et `RootDir`.

**Cache :**
- Développement : `Cache-Control: no-store`
- Production : `Cache-Control: public, max-age=31536000, immutable` + ETag (SHA-256) + support `If-None-Match` → 304

**Dev Proxy :** Si `manifest.frontend.dev.dev_url` est défini en mode dev → proxy vers un serveur externe (ex: Vite).

### Proxy HTTP → IPC

Le handler `proxy_api` convertit les requêtes HTTP en messages IPC :

1. Lookup de l'app dans le registre (404 si absente, 503 si pas `Running`)
2. Extraire la session depuis les extensions
3. Parser méthode, query string, headers, body (max 16 Mio)
4. Encoder le body en base64 → `HttpRequestPayload`
5. Envoyer via `ipc_router.send_request()` avec timeout de 30s
6. Parser `HttpResponsePayload` → mapper status code, décoder body base64, copier headers

## Protocole IPC

### Transport

Sockets Unix avec framing **JSON préfixé par longueur** :

```
[4 octets : longueur du message en big-endian u32][payload JSON en UTF-8]
```

Taille max : 16 Mio. Version du protocole : 1.

### Enveloppe

```json
{
  "type": "CommandRequest",
  "id": "uuid-v4",
  "timestamp": "2026-03-11T12:00:00Z",
  "payload": { ... }
}
```

Le champ `id` est partagé entre la requête et la réponse pour la corrélation.

### Handshake

```
Backend → Runtime :  Hello     { slug, app_version, protocol_version }
Runtime → Backend :  HelloAck  { status: "ok", runtime_version }
```

### Trois canaux de communication

#### 1. WS Invoke (requête/réponse)

```
Client WS  →  { type: "invoke", id, instance, command, params }
       IPC →  CommandRequest { command, params, session, instance_id }
       IPC ←  CommandResponse { result?, error? }
Client WS  ←  { type: "response", id, instance, result? | error? }
```

#### 2. WS Events (fire-and-forget)

**Client → Backend :**
```
Client WS  →  { type: "emit", instance, event, data }
       IPC →  WsIn { instance_id, session, event, data }
```

**Backend → Client :**
```
       IPC ←  EventEmit { event, payload, target: Broadcast | Instance { instance_id } }
Client WS  ←  { type: "event", event, payload, instance? }
```

#### 3. HTTP API (requête/réponse)

```
HTTP  →  GET /{slug}/api/status
IPC  →   HttpRequest { method, path, headers, query, body (base64), session }
IPC  ←   HttpResponse { status, headers, body (base64) }
HTTP  ←  200 OK { ... }
```

### Messages de cycle de vie

| Message | Direction | Payload |
|---------|-----------|---------|
| `ClientConnected` | runtime → backend | `{ instance_id, session }` |
| `ClientReconnected` | runtime → backend | `{ instance_id, session }` |
| `ClientDisconnected` | runtime → backend | `{ instance_id, reason }` |
| `Shutdown` | runtime → backend | `{ reason, grace_period_ms }` |
| `ShutdownAck` | backend → runtime | `{ status }` |
| `Log` | backend → runtime | `{ level, message, fields }` |

### Protocole WebSocket client

Connexion unique vers `/ws`. Messages JSON :

| Direction | Type | Champs |
|-----------|------|--------|
| Client → | `register` | `instance`, `app` |
| Client → | `unregister` | `instance` |
| Client → | `invoke` | `id`, `instance`, `command`, `params` |
| Client → | `emit` | `instance`, `event`, `data` |
| → Client | `registered` | `instance`, `reconnected?` |
| → Client | `response` | `id`, `instance`, `result?`, `error?` |
| → Client | `event` | `event`, `payload`, `instance?` |
| → Client | `error` | `error` |

### Commandes runtime interceptées

Ces commandes sont gérées directement par le runtime et **ne sont pas transmises au backend** :

| Commande | Description |
|----------|-------------|
| `__state:save` | Sauvegarder clé/valeur dans SQLite (limite 1 Mio par valeur) |
| `__state:restore` | Récupérer une valeur sauvegardée |
| `__state:delete` | Supprimer une clé |
| `__state:keys` | Lister les clés pour utilisateur + app |

### Types partagés (crate `protocol`)

```rust
// Enveloppe de message
IpcMessage { msg_type, id, timestamp, payload }

// Types fondamentaux
InstanceId(String)   // ex: "terminal-1"
SessionId(String)    // UUID v4
SessionInfo { session_id, user_id, username, role, groups }

// Manifeste
AppManifest { app: AppInfo, backend: BackendInfo, frontend: FrontendInfo, permissions: PermissionsInfo }

// Erreurs
ProtocolError { Io, Json, MessageTooLarge, ManifestLoadError, InvalidSlug, ReservedSlug, ... }
```

### Constantes du protocole

| Constante | Valeur |
|-----------|--------|
| `MAX_MESSAGE_SIZE` | 16 Mio (16 777 216 octets) |
| `PROTOCOL_VERSION` | 1 |
| `IPC_SOCKET_DIR` | `/tmp/zro/ipc` |
| `HANDSHAKE_TIMEOUT_SECS` | 10 |
| `HTTP_REQUEST_TIMEOUT_SECS` | 30 |
| `DEFAULT_SESSION_TTL_SECS` | 86400 (24h) |
| `DEFAULT_PORT` | 8080 (configurable via `[server].port`) |

## Structure du dépôt

```
ZRO/
├── protocol/              Crate partagée : messages, manifeste, erreurs, constantes
├── runtime/               Gateway axum, supervisor, auth, IPC, SQLite
│   └── src/
│       ├── main.rs        Point d'entrée, séquence de boot (15 étapes)
│       ├── config.rs      Structures de configuration (~500 lignes)
│       ├── control.rs     Socket de contrôle CLI ↔ runtime (~770 lignes)
│       ├── auth.rs        Chargement users, Argon2id, rate limiter
│       ├── auth_provider.rs  Trait AuthProvider, pipeline, LocalAuthProvider
│       ├── auth_pam.rs    Provider PAM (feature-gated)
│       ├── auth_ldap.rs   Provider LDAP (feature-gated)
│       ├── jwt.rs         Ed25519 JWT, refresh tokens, blacklist
│       ├── session.rs     Struct Session (dérivée des claims JWT)
│       ├── permissions.rs Moteur RBAC/GBAC
│       ├── registry.rs    Registre d'apps en mémoire (avec register/unregister dynamique)
│       ├── supervisor.rs  Cycle de vie des processes backend (start/stop individuels)
│       ├── hot_reload.rs  Surveillance fichiers frontend (dev)
│       ├── gateway/
│       │   ├── router.rs      Table de routes complète
│       │   ├── state.rs       AppState partagé (tout le gateway)
│       │   ├── handlers/
│       │   │   ├── auth.rs        Login/logout/refresh/me
│       │   │   ├── websocket.rs   Multiplexeur WS (~850 lignes)
│       │   │   ├── proxy.rs       Proxy HTTP → IPC
│       │   │   ├── static_files.rs  Serveur de fichiers + cache
│       │   │   ├── health.rs      Health check
│       │   │   └── apps.rs        Liste d'apps (JSON + HTML)
│       │   └── middleware/
│       │       ├── auth_mw.rs     Extraction + vérification JWT
│       │       └── security.rs    Headers de sécurité
│       ├── ipc/
│       │   ├── channel.rs    Canal bidirectionnel (read/write)
│       │   ├── router.rs     Routage + corrélation req/resp
│       │   └── server.rs     Création/suppression de sockets
│       ├── storage/
│       │   ├── mod.rs             Pool SQLite + migrations
│       │   ├── session_store.rs   CRUD sessions
│       │   ├── state_store.rs     KV par utilisateur/app
│       │   └── token_store.rs     Refresh tokens + blacklist
│       └── migrations/
│           └── 001_init.sql       Schéma initial
├── sdks/
│   ├── rust/              SDK Rust + macros procédurales + 5 modules built-in
│   ├── python/            SDK Python (asyncio, zéro dépendance externe)
│   ├── nodejs/            SDK Node.js (TypeScript)
│   └── frontend/          SDK frontend (TypeScript → esbuild → zro-client.js)
├── cli/                   CLI `zro` (clap, tabled, contrôle via socket Unix)
├── apps/                  7 applications incluses
├── static/                Assets frontend partagés
├── config/                Fichiers de configuration
├── bin/                   Binaires compilés (release ou symlinks debug)
├── data/                  Répertoires de données par app
├── scripts/               Scripts de build, dev, test, installation
└── tests/                 Tests d'intégration et e2e
```
