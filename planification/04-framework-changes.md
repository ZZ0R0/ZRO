# ZRO — Modifications du Framework : du plus bas au plus haut niveau

> Analyse croisée entre les plans du DE (planification/) et le code source réel
> Chaque point identifie un manque concret dans le framework actuel qui bloque la réalisation du desktop.

---

## Table des matières

1. [Niveau 0 — Protocol (zro-protocol)](#niveau-0--protocol-zro-protocol)
2. [Niveau 1 — Storage / Migrations (runtime/storage)](#niveau-1--storage--migrations)
3. [Niveau 2 — Runtime core (config, registry, supervisor)](#niveau-2--runtime-core)
4. [Niveau 3 — IPC Router (runtime/ipc)](#niveau-3--ipc-router)
5. [Niveau 4 — Gateway HTTP / WebSocket (runtime/gateway)](#niveau-4--gateway-http--websocket)
6. [Niveau 5 — SDK backend Rust](#niveau-5--sdk-backend-rust)
7. [Niveau 6 — SDK backend Node.js](#niveau-6--sdk-backend-nodejs)
8. [Niveau 7 — SDK backend Python](#niveau-7--sdk-backend-python)
9. [Niveau 8 — SDK frontend (zro-client.js)](#niveau-8--sdk-frontend-zro-clientjs)
10. [Niveau 9 — Shared Worker (zro-shared-worker.js)](#niveau-9--shared-worker)
11. [Niveau 10 — Design System (zro-base.css)](#niveau-10--design-system-zro-basecss)
12. [Résumé : matrice des dépendances](#résumé--matrice-des-dépendances)

---

## Niveau 0 — Protocol (`zro-protocol`)

Le protocol crate définit les types fondamentaux partagés entre runtime, SDKs et apps. Toute modification ici impacte **tout le système**.

### 0.1 — Manifest enrichi (`manifest.rs`)

**Problème** : Le `AppManifest` actuel n'a que `slug`, `name`, `version`, `description`. Le DE a besoin de métadonnées riches pour le launcher, la recherche, les associations MIME, et le window manager.

**Fichier** : `protocol/src/manifest.rs`

**Struct `AppInfo` actuelle** :
```rust
pub struct AppInfo {
    pub slug: String,
    pub name: String,
    pub version: String,
    pub description: String,  // default ""
}
```

**Struct `AppInfo` nécessaire** :
```rust
pub struct AppInfo {
    pub slug: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,               // Emoji ou chemin vers SVG/PNG
    #[serde(default)]
    pub category: AppCategory,      // Enum : system, tools, internet, multimedia, productivity
    #[serde(default)]
    pub keywords: Vec<String>,      // Pour la recherche dans le launcher
    #[serde(default)]
    pub mime_types: Vec<String>,    // Types MIME supportés ("text/*", "image/png", etc.)
    #[serde(default)]
    pub single_instance: bool,      // Si true, une seule instance autorisée
}
```

**Nouveau bloc `[window]` dans le manifest** :
```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WindowConfig {
    #[serde(default = "default_width")]
    pub default_width: u32,        // 800
    #[serde(default = "default_height")]
    pub default_height: u32,       // 600
    #[serde(default = "default_min_width")]
    pub min_width: u32,            // 360
    #[serde(default = "default_min_height")]
    pub min_height: u32,           // 240
    #[serde(default = "default_resizable")]
    pub resizable: bool,           // true
}
```

**Nouveau enum `AppCategory`** :
```rust
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppCategory {
    System,
    Tools,
    Internet,
    Multimedia,
    Productivity,
    #[default]
    Other,
}
```

**Impact** : Le launcher utilise `category` pour grouper, `keywords` pour la recherche, `icon` pour l'affichage, `mime_types` pour les associations de fichiers. Le WM utilise `WindowConfig` pour le dimensionnement initial. `single_instance` empêche d'ouvrir Calculator 2 fois.

**Exemple manifest.toml résultant** :
```toml
[app]
slug = "files"
name = "Fichiers"
version = "2.0.0"
description = "Gestionnaire de fichiers"
icon = "📁"
category = "system"
keywords = ["fichier", "dossier", "explorer", "naviguer", "file"]
mime_types = ["inode/directory"]

[window]
default_width = 900
default_height = 600
min_width = 400
min_height = 300

[backend]
executable = "zro-app-files"

[frontend]
directory = "frontend"

[permissions]
roles = ["user", "admin"]
```

---

### 0.2 — Types enrichis (`types.rs`)

**Problème** : `SessionInfo` ne contient que `session_id`, `user_id`, `username`, `role`, `groups`. Le DE a besoin d'informations utilisateur étendues pour le panel, le lock screen, le quick settings, et le profil.

**Fichier** : `protocol/src/types.rs`

**Ajout** :
```rust
/// Extended user profile information attached to sessions.
/// Carried alongside SessionInfo for apps that need display data.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UserProfile {
    #[serde(default)]
    pub display_name: Option<String>,  // "Jean Dupont" (sinon username)
    #[serde(default)]
    pub avatar: Option<String>,         // URL relative ou base64
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,         // "fr-FR"
    #[serde(default)]
    pub timezone: Option<String>,       // "Europe/Paris"
}
```

**Modifier `SessionInfo`** :
```rust
pub struct SessionInfo {
    pub session_id: SessionId,
    pub user_id: String,
    pub username: String,
    pub role: String,
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub profile: Option<UserProfile>,  // ← NOUVEAU
}
```

**Impact** : Toutes les apps reçoivent le profil utilisateur dans chaque requête. Le panel affiche le display_name et l'avatar. Le lock screen affiche l'avatar. Les formats de date/heure utilisent le locale et le timezone.

**Note** : `SessionInfo` est transporté dans **chaque** message IPC (HttpRequestPayload, CommandRequestPayload, WsInPayload, ClientConnectedPayload). Ajouter `profile` optionnel reste compatible car il est `Option` + `serde(default)`.

---

### 0.3 — Nouvelles cibles d'événement (`messages.rs`)

**Problème** : `EventTarget` n'a que `Instance` et `Broadcast` (broadcast = tous les clients de la même app). Le DE a besoin de diffuser des événements **inter-app au sein d'une session** (ex: changement de thème → toutes les apps de l'utilisateur doivent réagir).

**Fichier** : `protocol/src/messages.rs`

**`EventTarget` actuel** :
```rust
pub enum EventTarget {
    Instance { instance_id: String },
    Broadcast,  // all instances of THIS app
}
```

**`EventTarget` nécessaire** :
```rust
pub enum EventTarget {
    /// Send to a specific instance.
    Instance { instance_id: String },
    /// Broadcast to all connected clients of this app.
    Broadcast,
    /// Broadcast to ALL apps of a specific user session.
    /// Used for system-wide events (theme change, lock, DND toggle).
    Session { session_id: String },
    /// Broadcast to ALL connected clients of ALL apps (system event).
    /// Only the shell/runtime should use this.
    System,
}
```

**Cas d'usage** :
- `Session` : Le shell change le thème → toutes les apps de l'utilisateur reçoivent `__theme:changed`
- `Session` : Le clipboard manager copie → toutes les apps reçoivent `__clipboard:updated`
- `System` : Le runtime émet `__system:shutdown_imminent` → toutes les sessions

**Impact sur le IPC router** : Le dispatch doit être modifié pour gérer `Session` (lookup toutes les instances d'un user) et `System` (broadcast total). Voir Niveau 3.

---

### 0.4 — Messages de streaming (`messages.rs`)

**Problème** : Le protocole actuel est strictement requête/réponse. Le System Monitor a besoin de pousser des métriques en continu (CPU, RAM toutes les 2s). Actuellement, le frontend devrait faire du polling via `conn.invoke()` toutes les 2s, ce qui crée N requêtes IPC/s.

**Fichier** : `protocol/src/messages.rs`

**Option A — Event-based (recommandé, minimal changes)** :
Le backend utilise `EventEmit` pour pousser des données en continu. Le frontend s'abonne via `conn.on("metrics:update", ...)`. Pas de changement de protocole nécessaire, mais le backend doit avoir une boucle interne qui pousse les événements.

→ **Pas de modification du protocole pour le streaming.** Les `EventEmit` existants suffisent. Le backend spawne un `tokio::spawn` qui émet périodiquement.

**Option B — Streaming response (futur, si besoin)** :
Ajouter un `StreamStart` / `StreamChunk` / `StreamEnd` pour les réponses en plusieurs parties. Utile pour les gros téléchargements de fichiers. Reporté — les fichiers sont servis via HTTP statique, pas IPC.

**Décision** : Pas de modification du protocole pour le streaming. On utilise l'architecture EventEmit existante.

---

### 0.5 — Support binaire pour les uploads (`messages.rs`)

**Problème** : `HttpResponsePayload.body` est `Option<String>` en base64. Pour les uploads de fichiers (wallpaper, avatar, photos camera), le base64 augmente la taille de 33%. Pour un wallpaper 4K (5 MB), ça fait 6.7 MB en transit IPC.

**Analyse** : Le MAX_MESSAGE_SIZE est 16 MiB, donc un fichier de 12 MB raw (16 MB base64) passerait à la limite. Pour des wallpapers et avatars (< 5 MB), le base64 reste acceptable.

**Décision** : Pas de modification maintenant. Le base64 via HttpRequest/HttpResponse suffit pour les uploads raisonnables (< 10 MB). Si besoin futur, on pourra ajouter un mode binaire au framing.

**Mais** : Ajouter une constante `MAX_UPLOAD_SIZE` :
```rust
/// Maximum uploaded file size: 10 MiB.
pub const MAX_UPLOAD_SIZE: usize = 10 * 1024 * 1024;
```

---

### Résumé Niveau 0

| Modif | Fichier | Criticité | Rétro-compatible |
|-------|---------|-----------|-----------------|
| AppInfo + icon, category, keywords, mime_types, single_instance | manifest.rs | 🔴 Bloquant | ✅ Oui (tous defaults) |
| WindowConfig | manifest.rs | 🔶 Important | ✅ Oui (nouveau bloc) |
| AppCategory enum | manifest.rs | 🔶 Important | ✅ Oui |
| UserProfile struct | types.rs | 🔶 Important | ✅ Oui (Option) |
| SessionInfo + profile | types.rs | 🔶 Important | ✅ Oui (serde default) |
| EventTarget + Session, System | messages.rs | 🔴 Bloquant | ✅ Oui (nouveau variants) |
| MAX_UPLOAD_SIZE | constants.rs | 🟢 Mineur | ✅ Oui |

---

## Niveau 1 — Storage / Migrations

La couche de persistance SQLite doit supporter de nouvelles données pour le DE.

### 1.1 — Table `user_preferences` (NOUVELLE)

**Problème** : Les préférences utilisateur globales (thème, wallpaper, accent color, locale) n'ont pas de stockage dédié. La table `app_states` est scopée par app — les préférences transversales n'ont pas de place.

**Fichier** : `runtime/src/migrations/002_desktop.sql` (nouveau fichier de migration)

```sql
-- User-wide preferences (cross-app)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
```

**Clés prévues** :
- `theme` → `"catppuccin-mocha"` / `"catppuccin-latte"` / ...
- `accent_color` → `"#89b4fa"` (hex)
- `wallpaper` → `"/wallpapers/default-01.jpg"` ou chemin custom
- `wallpaper_mode` → `"fill"` / `"fit"` / `"center"`
- `locale` → `"fr-FR"`
- `timezone` → `"Europe/Paris"`
- `lock_timeout_minutes` → `"15"` / `"0"` (disabled)
- `dnd_enabled` → `"true"` / `"false"`
- `notifications_position` → `"top-right"`
- `ui_density` → `"normal"` / `"compact"` / `"spacious"`
- `border_radius` → `"8"` / `"0"` / `"16"`
- `font_size` → `"14"`
- `display_name` → `"Jean Dupont"`
- `avatar` → path ou base64
- `clock_format` → `"24h"` / `"12h"`
- `animations_enabled` → `"true"` / `"false"`

**Impact** : Le runtime expose ces préférences via de nouvelles routes gateway (voir Niveau 4). Les SDKs frontend les reçoivent au boot.

---

### 1.2 — Table `notifications` (NOUVELLE)

**Problème** : Les notifications toast actuelles sont éphémères (JS in-memory). Le centre de notifications a besoin de persistance.

```sql
-- Persistent notification history
CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    app_slug    TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT DEFAULT '',
    icon        TEXT DEFAULT '',
    urgency     TEXT DEFAULT 'normal',  -- low, normal, critical
    read        INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT (datetime('now')),
    expires_at  DATETIME,               -- NULL = never expires
    actions     TEXT DEFAULT '[]'        -- JSON array of {label, command, params}
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
```

**Cleanup** : Les notifications expirées sont nettoyées par le même processus de cleanup existant.

---

### 1.3 — Table `active_windows` : ajout workspace (`ALTER`)

**Problème** : La table `active_windows` existe mais n'a pas de champ `workspace_id`. Les espaces de travail virtuels nécessitent de persister quel workspace contient quelle fenêtre.

```sql
ALTER TABLE active_windows ADD COLUMN workspace_id INTEGER DEFAULT 0;
```

---

### 1.4 — Table `mime_associations` (NOUVELLE)

**Problème** : Les associations MIME par défaut viennent des manifestes, mais l'utilisateur doit pouvoir les personnaliser (choisir son éditeur de texte par défaut, etc.).

```sql
-- User-customized MIME type associations (overrides manifest defaults)
CREATE TABLE IF NOT EXISTS mime_associations (
    user_id   TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    app_slug  TEXT NOT NULL,
    updated_at DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, mime_type)
);
```

---

### 1.5 — Couche storage Rust (`storage/mod.rs`)

**Fichier** : `runtime/src/storage/mod.rs`

**Nouvelles méthodes sur `StoragePool`** :
```rust
// User preferences
pub fn get_user_preference(&self, user_id: &str, key: &str) -> Option<String>;
pub fn set_user_preference(&self, user_id: &str, key: &str, value: &str);
pub fn get_all_user_preferences(&self, user_id: &str) -> HashMap<String, String>;
pub fn delete_user_preference(&self, user_id: &str, key: &str);

// Notifications
pub fn insert_notification(&self, notif: &Notification) -> Result<()>;
pub fn get_notifications(&self, user_id: &str, unread_only: bool, limit: u32) -> Vec<Notification>;
pub fn mark_notification_read(&self, id: &str, user_id: &str);
pub fn mark_all_notifications_read(&self, user_id: &str);
pub fn delete_notification(&self, id: &str, user_id: &str);
pub fn count_unread_notifications(&self, user_id: &str) -> u32;

// MIME associations
pub fn get_mime_association(&self, user_id: &str, mime_type: &str) -> Option<String>;
pub fn set_mime_association(&self, user_id: &str, mime_type: &str, app_slug: &str);
pub fn get_all_mime_associations(&self, user_id: &str) -> HashMap<String, String>;
```

---

### Résumé Niveau 1

| Modif | Fichier | Criticité |
|-------|---------|-----------|
| Table user_preferences | 002_desktop.sql | 🔴 Bloquant |
| Table notifications | 002_desktop.sql | 🔴 Bloquant |
| active_windows + workspace_id | 002_desktop.sql | 🟡 Phase 3 |
| Table mime_associations | 002_desktop.sql | 🟡 Phase 3 |
| StoragePool: preference methods | storage/mod.rs | 🔴 Bloquant |
| StoragePool: notification methods | storage/mod.rs | 🔴 Bloquant |
| StoragePool: MIME methods | storage/mod.rs | 🟡 Phase 3 |

---

## Niveau 2 — Runtime core

### 2.1 — Config : section `[desktop]` (`config.rs`)

**Problème** : Pas de configuration globale pour les aspects bureau (thème par défaut, timeout lock screen, wallpaper par défaut, etc.).

**Fichier** : `runtime/src/config.rs`

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopConfig {
    /// Default theme for new users.
    #[serde(default = "default_theme")]
    pub default_theme: String,         // "catppuccin-mocha"
    
    /// Default wallpaper path (relative to static/).
    #[serde(default)]
    pub default_wallpaper: Option<String>,
    
    /// Directory containing wallpaper images.
    #[serde(default = "default_wallpapers_dir")]
    pub wallpapers_dir: String,        // "./static/wallpapers"
    
    /// Lock screen timeout in minutes (0 = disabled).
    #[serde(default = "default_lock_timeout")]
    pub lock_timeout_minutes: u32,     // 15
    
    /// Maximum avatar file size in bytes.
    #[serde(default = "default_max_avatar_size")]
    pub max_avatar_size: usize,        // 2 * 1024 * 1024 (2 MB)
    
    /// Maximum wallpaper file size in bytes.
    #[serde(default = "default_max_wallpaper_size")]
    pub max_wallpaper_size: usize,     // 10 * 1024 * 1024 (10 MB)
    
    /// Default shell app (replaces apps.default_app for the DE context).
    #[serde(default = "default_shell")]
    pub shell_app: String,             // "custom-shell"
}
```

**Ajout dans `RuntimeConfig`** :
```rust
pub struct RuntimeConfig {
    pub server: ServerConfig,
    pub apps: AppsConfig,
    pub auth: AuthConfig,
    pub storage: StorageConfig,
    pub logging: LoggingConfig,
    pub supervisor: SupervisorConfig,
    pub control: ControlConfig,
    pub desktop: DesktopConfig,       // ← NOUVEAU
}
```

---

### 2.2 — Registry : index MIME et catégories (`registry.rs`)

**Problème** : `AppRegistry` est un simple `HashMap<slug, AppEntry>`. Le launcher a besoin de chercher par catégorie, le file manager par MIME type, et le launcher par mot-clé. Ajouter des index inversés.

**Fichier** : `runtime/src/registry.rs`

```rust
pub struct AppRegistry {
    apps: HashMap<String, AppEntry>,
    
    // ── Nouveaux index ──────────────────────────
    /// MIME type → list of app slugs that handle it.
    mime_index: HashMap<String, Vec<String>>,
    /// Category → list of app slugs.
    category_index: HashMap<AppCategory, Vec<String>>,
}
```

**Nouvelles méthodes** :
```rust
impl AppRegistry {
    /// Get all apps that can handle a MIME type.
    /// Supports wildcards: "text/*" matches "text/plain", "text/html", etc.
    pub fn apps_for_mime(&self, mime_type: &str) -> Vec<&AppEntry>;
    
    /// Get the default app for a MIME type (first registered handler).
    pub fn default_app_for_mime(&self, mime_type: &str) -> Option<&AppEntry>;
    
    /// Get all apps in a category.
    pub fn apps_in_category(&self, category: &AppCategory) -> Vec<&AppEntry>;
    
    /// Search apps by keyword (fuzzy match on name, description, keywords).
    pub fn search_apps(&self, query: &str) -> Vec<&AppEntry>;
    
    /// Get manifest metadata for all apps (for launcher).
    pub fn all_app_metadata(&self) -> Vec<AppMetadata>;
    
    /// Rebuild indexes (called after register/unregister).
    fn rebuild_indexes(&mut self);
}

/// Lightweight metadata struct for launcher/gateway responses.
#[derive(Serialize)]
pub struct AppMetadata {
    pub slug: String,
    pub name: String,
    pub icon: String,
    pub category: AppCategory,
    pub description: String,
    pub keywords: Vec<String>,
    pub mime_types: Vec<String>,
    pub single_instance: bool,
    pub window: WindowConfig,
    pub state: AppState,
}
```

**Impact** : Le gateway peut servir `/api/apps/metadata` avec toutes les infos dont le launcher a besoin. Le file manager peut faire `/api/apps/for-mime?type=text/plain` pour le menu "Ouvrir avec...".

---

### 2.3 — Supervisor : restart automatique (`supervisor.rs`)

**Problème** : Si une app crash, elle reste en état `Error`. Pas de tentative de redémarrage. Pour un DE en production, le file manager ou le terminal qui crash doit redémarrer automatiquement.

**Fichier** : `runtime/src/supervisor.rs`

```rust
/// Configuration for automatic restart behavior.
pub struct RestartPolicy {
    pub max_restarts: u32,          // Max restarts in the window (default 3)
    pub restart_window_secs: u64,   // Time window for counting restarts (default 60)
    pub restart_delay_ms: u64,      // Delay before restart attempt (default 1000)
}
```

**Modification dans `backend_reader_loop`** :
- Quand le channel se ferme (backend crash) :
  1. Incrémenter le compteur de crash
  2. Si < max_restarts dans la fenêtre de temps → `tokio::time::sleep(delay)` → `start_single_backend()`
  3. Si >= max_restarts → rester en `Error(reason)`, log d'erreur

**Impact** : Fiabilité du DE. Sans cela, un crash de l'app Files laisse l'utilisateur sans file manager jusqu'à un restart manuel.

---

### 2.4 — Registry : exposer le manifest complet aux apps (`registry.rs`)

**Problème** : Le shell (custom-shell) a besoin d'accéder aux manifests de toutes les apps pour :
- Le launcher (icône, catégorie, nom)
- Le window manager (dimensions par défaut, resizable)
- Les associations MIME (pour "Ouvrir avec...")

Actuellement, le shell n'a pas de moyen d'obtenir ces informations. Il doit passer par le gateway.

**Solution** : Le gateway expose un endpoint `/api/apps/metadata` (voir Niveau 4). Pas de changement dans le registry lui-même, juste les nouvelles méthodes de 2.2.

---

### Résumé Niveau 2

| Modif | Fichier | Criticité |
|-------|---------|-----------|
| DesktopConfig dans RuntimeConfig | config.rs | 🔶 Important |
| Index MIME + catégories dans Registry | registry.rs | 🔴 Bloquant |
| AppMetadata struct | registry.rs | 🔴 Bloquant |
| search_apps() | registry.rs | 🔶 Important |
| RestartPolicy + auto-restart | supervisor.rs | 🔶 Important |

---

## Niveau 3 — IPC Router

### 3.1 — Dispatch `EventTarget::Session` et `EventTarget::System`

**Problème** : Le router ne sait dispatcher qu'à une instance ou à toutes les instances d'une app. Pour les événements système (thème, clipboard, lock), on a besoin de dispatcher à toutes les apps d'un utilisateur.

**Fichier** : `runtime/src/ipc/router.rs`

**Modification du dispatch dans `handle_event_emit()`** :

```rust
match event.target {
    EventTarget::Instance { instance_id } => {
        ws_manager.send_to_instance(&instance_id, &msg);
    }
    EventTarget::Broadcast => {
        // Broadcast to all instances of the SAME app (existant)
        ws_manager.broadcast_to_app(&slug, &msg);
    }
    EventTarget::Session { session_id } => {
        // NEW: Broadcast to ALL instances of ALL apps in this session
        ws_manager.broadcast_to_session(&session_id, &msg);
    }
    EventTarget::System => {
        // NEW: Broadcast to ALL connected clients
        ws_manager.broadcast_to_all(&msg);
    }
}
```

**Impact sur `WsSessionManager`** : Ajouter deux méthodes :

```rust
impl WsSessionManager {
    /// Send to all instances in a specific session (all apps of the user).
    pub fn broadcast_to_session(&self, session_id: &str, msg: &str);
    
    /// Send to all connected clients of all sessions.
    pub fn broadcast_to_all(&self, msg: &str);
}
```

`broadcast_to_session` itère sur `sessions[session_id].instances` et envoie à chacun.  
`broadcast_to_all` itère sur toutes les sessions et envoie à tous.

---

### 3.2 — Événements système émis par le runtime (pas par une app)

**Problème** : Certains événements systèmes doivent être émis directement par le runtime, pas par une app backend. Exemples :
- `__app:started` / `__app:stopped` → quand une app change d'état
- `__session:locked` / `__session:unlocked` → quand le lock screen s'active

**Solution** : Le runtime peut créer des `IpcMessage` de type `EventEmit` et les injecter directement dans le `WsSessionManager` sans passer par un backend app. Ça n'est pas un changement de protocole — juste un usage interne du router.

**Ajout dans `ipc/router.rs`** :
```rust
impl IpcRouter {
    /// Emit a system event directly from the runtime (not from any app backend).
    pub fn emit_system_event(&self, event: &str, payload: Value, target: EventTarget);
}
```

---

### Résumé Niveau 3

| Modif | Fichier | Criticité |
|-------|---------|-----------|
| EventTarget::Session dispatch | ipc/router.rs | 🔴 Bloquant |
| EventTarget::System dispatch | ipc/router.rs | 🔶 Important |
| broadcast_to_session() | gateway/handlers/websocket.rs | 🔴 Bloquant |
| broadcast_to_all() | gateway/handlers/websocket.rs | 🔶 Important |
| emit_system_event() | ipc/router.rs | 🔶 Important |

---

## Niveau 4 — Gateway HTTP / WebSocket

### 4.1 — Nouvelles routes API

**Fichier** : `runtime/src/gateway/router.rs`

```
Nouvelles routes protégées (JWT requis) :

GET  /api/desktop/preferences         → Toutes les préférences DE de l'utilisateur
PUT  /api/desktop/preferences/{key}   → Modifier une préférence
GET  /api/desktop/themes              → Liste des thèmes disponibles
GET  /api/desktop/wallpapers          → Liste des wallpapers disponibles
POST /api/desktop/wallpapers          → Upload un wallpaper custom
GET  /api/desktop/wallpapers/{name}   → Servir un wallpaper (image)

GET  /api/apps/metadata               → Métadonnées de toutes les apps (pour le launcher)
GET  /api/apps/for-mime/{type}        → Apps capables d'ouvrir ce type MIME

GET  /api/notifications               → Notifications non lues (+ read avec ?all=true)
POST /api/notifications/{id}/read     → Marquer comme lue
POST /api/notifications/read-all      → Tout marquer comme lu
DELETE /api/notifications/{id}        → Supprimer une notification

GET  /api/system/info                 → CPU, RAM, disk, uptime, hostname, IP
GET  /api/user/profile                → Profil utilisateur (avatar, display_name)
PUT  /api/user/profile                → Modifier le profil
POST /api/user/avatar                 → Upload avatar
PUT  /api/user/password               → Changer le mot de passe
POST /api/auth/verify                 → Vérifier le mot de passe (pour le lock screen)
```

**Impact** : Chaque route nécessite un handler dans `gateway/handlers/`. Les préférences et notifications utilisent la couche storage (Niveau 1). Les métadonnées apps utilisent le registry (Niveau 2). Le system info lit `/proc` et `/sys`.

---

### 4.2 — Endpoint `/api/system/info` pour le tray/quick settings

**Fichier** : `runtime/src/gateway/handlers/system.rs` (nouveau)

Ce endpoint est **géré par le runtime directement** (pas par une app), car les infos système sont transversales :

```rust
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,               // "Linux 6.x.x"
    pub arch: String,             // "x86_64"
    pub cpu_count: u32,
    pub cpu_usage_percent: f32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub uptime_seconds: u64,
    pub load_average: [f32; 3],
    pub ip_addresses: Vec<String>,
    pub runtime_version: String,
    pub app_count: u32,
    pub active_sessions: u32,
}
```

**Lecture depuis Linux** :
- CPU : parse `/proc/stat` (deux lectures séparées de 100ms pour le delta)
- RAM : parse `/proc/meminfo`
- Disk : `statvfs("/")`
- Uptime : `/proc/uptime`
- Load : `/proc/loadavg`
- Hostname : `gethostname()`
- IP : `getifaddrs()` filtré

**Note** : L'app System Monitor (apps/monitor) aura ses **propres** endpoints plus détaillés (processus, graphiques, etc.) via son backend. L'endpoint runtime est pour le quick settings du shell (données légères, < 100 octets).

---

### 4.3 — Endpoint `/api/auth/verify` pour le lock screen

**Fichier** : `runtime/src/gateway/handlers/auth.rs`

Le lock screen a besoin de **vérifier le mot de passe** sans créer une nouvelle session :

```rust
// POST /api/auth/verify
// Body: { "password": "..." }
// Uses the current session's username (from JWT)
// Returns: { "valid": true/false }
```

Utilise le même pipeline d'auth (local/PAM/LDAP) que le login, mais ne crée pas de session.

---

### 4.4 — Service des wallpapers et avatars (fichiers statiques)

**Problème** : Le gateway sert les fichiers statiques depuis `static/` et les frontends depuis `apps/{slug}/frontend/`. Les wallpapers et avatars ont besoin de chemins dédiés.

**Fichier** : `runtime/src/gateway/handlers/static_files.rs`

**Nouvelles routes** :
```
GET /static/wallpapers/{name}  → Sert depuis {wallpapers_dir}/{name}
GET /static/avatars/{user_id}  → Sert depuis {data_dir}/avatars/{user_id}.*
```

**Sécurité** : Validation du chemin (anti path-traversal, déjà existante), vérification de l'extension (images uniquement : jpg, png, webp, svg).

---

### 4.5 — WebSocket : dispatch de `__state:*` enrichi

**Problème** : Le handler WebSocket intercept déjà les commandes `__state:*` (save/restore) et les traite côté runtime au lieu de les envoyer au backend. Il faut ajouter la même interception pour les nouvelles commandes système.

**Fichier** : `runtime/src/gateway/handlers/websocket.rs`

**Commandes système interceptées par le runtime (pas envoyées aux backends)** :
```
__state:save, __state:restore, __state:delete, __state:keys  (existant ✅)
__pref:get, __pref:set, __pref:get_all                       (NOUVEAU — préférences)
__notify:list, __notify:read, __notify:read_all               (NOUVEAU — notifications)
__desktop:app_metadata                                         (NOUVEAU — liste des apps)
__desktop:apps_for_mime                                        (NOUVEAU — association MIME)
__desktop:system_info                                          (NOUVEAU — infos système)
```

**Pourquoi intercepter côté runtime plutôt qu'envoyer à un backend ?**
- Ces données sont **transversales** (pas spécifiques à une app)
- Les préférences et notifications sont dans la DB du runtime
- Le registre des apps est dans le runtime
- Ça évite que chaque app implémente son propre accès à ces données

---

### 4.6 — WebSocket : envoyer les préférences au boot

**Problème** : Quand une app se connecte, elle ne connaît pas le thème, la locale, ni les préférences de l'utilisateur. Actuellement, la seule donnée envoyée est le `HelloAck` (pour le backend) et rien de spécifique pour le frontend.

**Solution** : Après le `register` d'une instance, le runtime envoie un événement system :
```json
{
  "type": "event",
  "event": "__desktop:init",
  "data": {
    "preferences": {
      "theme": "catppuccin-mocha",
      "accent_color": "#89b4fa",
      "locale": "fr-FR",
      "animations_enabled": true,
      ...
    },
    "profile": {
      "display_name": "Jean",
      "avatar": "/static/avatars/u-123.png"
    },
    "unread_notifications": 3
  }
}
```

Cela permet à chaque app de s'initialiser avec le bon thème dès le chargement, sans requête supplémentaire.

---

### Résumé Niveau 4

| Modif | Fichier | Criticité |
|-------|---------|-----------|
| Routes /api/desktop/* | router.rs, handlers/ | 🔴 Bloquant |
| Routes /api/notifications/* | router.rs, handlers/ | 🔴 Bloquant |
| Route /api/apps/metadata | router.rs, handlers/ | 🔴 Bloquant |
| Route /api/system/info | handlers/system.rs | 🔶 Important |
| Route /api/auth/verify | handlers/auth.rs | 🔶 Important |
| Service wallpapers/avatars | handlers/static_files.rs | 🔶 Important |
| WS interception commandes système | handlers/websocket.rs | 🔴 Bloquant |
| WS __desktop:init au boot | handlers/websocket.rs | 🔶 Important |

---

## Niveau 5 — SDK backend Rust

### 5.1 — AppContext enrichi

**Fichier** : `sdks/rust/src/context.rs`

`AppContext` actuel expose `session`, `instance_id`, `slug`, `data_dir`, `emit`, `emit_to`.

**Ajouts** :
```rust
impl AppContext {
    /// Emit an event to all apps in the user's session (cross-app).
    pub async fn emit_to_session(&self, event: &str, payload: Value);
    
    /// Access the user's profile (display_name, avatar, locale, timezone).
    pub fn profile(&self) -> &UserProfile;
}
```

L'`emit_to_session` crée un `EventEmit` avec `EventTarget::Session { session_id }`, en utilisant le `session_id` du contexte courant.

---

### 5.2 — Nouveau module `files` (opérations filesystem)

**Fichier** : `sdks/rust/src/modules/files.rs` (nouveau)

Les apps Files, Notes, et Terminal utilisent toutes des opérations filesystem. Plutôt que chaque app réimplémente, un module SDK fournit les primitives sécurisées.

```rust
/// Built-in module providing safe filesystem operations.
/// All paths are sandboxed to the app's data_dir by default,
/// with an option to access the user's home directory.
pub struct FilesModule {
    sandbox: PathBuf,         // Racine de sandbox (data_dir ou home)
    allow_home_access: bool,  // Si true, peut accéder à ~/ de l'utilisateur
}
```

**Commandes exposées** :
```
__fs:ls(path)                    → Vec<FileEntry> (name, size, modified, is_dir, mime_type)
__fs:read(path)                  → String (contenu texte)
__fs:read_bytes(path)            → String (base64)
__fs:write(path, content)        → ()
__fs:write_bytes(path, base64)   → ()
__fs:mkdir(path)                 → ()
__fs:rm(path, recursive)         → ()
__fs:copy(src, dst)              → ()
__fs:move(src, dst)              → ()
__fs:rename(path, new_name)      → ()
__fs:stat(path)                  → FileInfo (size, permissions, owner, modified, mime)
__fs:search(path, query)         → Vec<FileEntry>
__fs:exists(path)                → bool
__fs:thumbnail(path, max_size)   → String (base64 image redimensionnée)
```

**Sécurité** :
- Path traversal protection (canonical path must start with sandbox)
- Pas de liens symboliques sortant de la sandbox
- Taille maximale de lecture/écriture configurable

---

### 5.3 — Nouveau module `system` (info système)

**Fichier** : `sdks/rust/src/modules/system.rs` (nouveau)

Pour l'app System Monitor. Fournit l'accès structuré aux métriques Linux.

```
__sys:cpu_usage()           → { total: f32, per_core: [f32] }
__sys:memory()              → { total, used, free, buffers, cached, swap_total, swap_used }
__sys:disk()                → [{ device, mount, fs_type, total, used, available }]
__sys:network()             → [{ interface, rx_bytes, tx_bytes, rx_rate, tx_rate }]
__sys:processes()           → [{ pid, name, cpu, mem, state, user, cmd }]
__sys:process_detail(pid)   → { pid, name, cmd, cwd, env, fd_count, threads }
__sys:signal(pid, signal)   → () (TERM, KILL, STOP, CONT)
__sys:temperature()         → [{ label, temp_celsius }]
__sys:load_average()        → [f32; 3]
__sys:uptime()              → u64 (seconds)
```

**Lecture** : Parse `/proc/stat`, `/proc/meminfo`, `/proc/[pid]/stat`, `/sys/class/thermal/`, `statvfs()`.

**Sécurité** : `signal()` ne peut envoyer de signal qu'aux processus de l'utilisateur courant (vérification UID via `/proc/[pid]/status`).

---

### 5.4 — Support des événements périodiques dans l'app

**Problème** : Le System Monitor doit pousser des métriques toutes les 2s. Actuellement, le SDK ne fournit pas de mécanisme pour les tâches périodiques côté backend.

**Fichier** : `sdks/rust/src/app.rs`

**Ajout** :
```rust
impl ZroAppBuilder {
    /// Register a periodic task that runs at a fixed interval.
    /// The task can emit events to connected clients.
    pub fn periodic(
        self,
        name: &str,
        interval: Duration,
        handler: impl Fn(AppContext) + Send + Sync + 'static,
    ) -> Self;
}
```

Le runtime interne spawne un `tokio::spawn` par tâche périodique. La tâche reçoit un `AppContext` générique (pas d'instance spécifique) et peut émettre des événements en broadcast.

---

### Résumé Niveau 5

| Modif | Fichier | Criticité |
|-------|---------|-----------|
| emit_to_session() dans AppContext | context.rs | 🔴 Bloquant |
| profile() dans AppContext | context.rs | 🔶 Important |
| Module files (fs sécurisé) | modules/files.rs | 🔴 Bloquant |
| Module system (métriques Linux) | modules/system.rs | 🔶 Phase 2 |
| Tâches périodiques (.periodic()) | app.rs | 🔶 Phase 2 |

---

## Niveau 6 — SDK backend Node.js

Mêmes modifications que le Rust SDK (les 3 SDKs doivent maintenir la parité fonctionnelle).

### 6.1 — AppContext enrichi

```typescript
class AppContext {
    // Existant
    session: SessionInfo;
    instanceId: string | null;
    slug: string;
    dataDir: string;
    
    // NOUVEAU
    async emitToSession(event: string, data: any): Promise<void>;
    get profile(): UserProfile;
}
```

### 6.2 — Module `files`

```typescript
// Mêmes commandes __fs:* que le Rust SDK
// Utilise fs/promises de Node.js en interne
// Sandboxing via path.resolve + vérification prefix
```

### 6.3 — Module `system`

```typescript
// Mêmes commandes __sys:* que le Rust SDK
// Parse /proc via fs/promises
// Utilise child_process pour certaines infos si nécessaire
```

### 6.4 — Tâches périodiques

```typescript
class ZroApp {
    periodic(name: string, intervalMs: number, handler: (ctx: AppContext) => Promise<void>): this;
}
// Utilise setInterval en interne
```

---

## Niveau 7 — SDK backend Python

Mêmes modifications que les autres SDKs.

### 7.1 — AppContext enrichi

```python
class AppContext:
    # Existant
    session: SessionInfo
    instance_id: str | None
    slug: str
    data_dir: Path
    
    # NOUVEAU
    async def emit_to_session(self, event: str, payload: Any) -> None: ...
    
    @property
    def profile(self) -> UserProfile: ...
```

### 7.2-7.4 — Modules files, system, periodic

Mêmes interfaces que Rust/Node.js, adaptées à Python (pathlib, asyncio).

---

## Niveau 8 — SDK frontend (`zro-client.js`)

C'est ici que la majorité des changements visibles se concentrent.

### 8.1 — Module `connection` : commandes système

**Fichier** : `static/zro-client.js` (section connection)

Le module `connection` doit reconnaître les commandes système interceptées par le runtime :

```javascript
// Nouvelles méthodes de convenance sur le module connection
connection.getPreferences()                    // → invoke("__pref:get_all")
connection.setPreference(key, value)           // → invoke("__pref:set", {key, value})
connection.getAppMetadata()                    // → invoke("__desktop:app_metadata")
connection.getAppsForMime(mimeType)            // → invoke("__desktop:apps_for_mime", {type})
connection.getSystemInfo()                     // → invoke("__desktop:system_info")
connection.getNotifications(unreadOnly)        // → invoke("__notify:list", {unread_only})
connection.markNotificationRead(id)            // → invoke("__notify:read", {id})
connection.markAllNotificationsRead()          // → invoke("__notify:read_all")
```

Ce ne sont que des wrappers autour d'`invoke()`. Pas de changement de transport.

---

### 8.2 — Module `theme` : gestion multi-thème

**Fichier** : `static/zro-client.js` (section theme)

**Actuel** : Le module theme lit/écrit des CSS variables. Pas de notion de thème prédéfini ni de switching.

**Enrichissement** :
```javascript
const theme = {
    // Existant
    getVariables(),
    setVariables(vars),
    onChange(handler),
    
    // NOUVEAU
    async getAvailableThemes(),       // Liste des thèmes du runtime
    async getCurrentTheme(),          // Nom du thème actuel (depuis les prefs)
    async setTheme(themeName),        // Applique un thème + sauvegarde en pref
    async getAccentColor(),
    async setAccentColor(hex),
    applyThemeVariables(themeData),   // Applique un objet thème aux CSS vars
};
```

**Les thèmes sont définis dans le CSS** (voir Niveau 10), mais le module JS gère la sélection et la persistance.

---

### 8.3 — Module `shell` : API desktop enrichie

**Fichier** : `static/zro-client.js` (section shell)

**Actuel** : Le module shell communique avec le parent frame (custom-shell) via postMessage. API : setTitle, notify, setBadgeCount, requestFocus, minimize, maximize, restore, close, getWindowInfo.

**NOUVELLES API** :
```javascript
const shell = {
    // Existant
    setTitle(title),
    notify(opts),
    setBadgeCount(n),
    requestFocus(),
    minimize(), maximize(), restore(), close(),
    getWindowInfo(),
    
    // NOUVEAU : Desktop operations
    openFile(path),              // Demande au shell d'ouvrir le fichier avec l'app associée
    openApp(slug, params),       // Demande au shell de lancer une app
    openUrl(url),                // Demande au shell d'ouvrir l'URL dans le browser app
    setWallpaper(url),           // Demande au shell de changer le wallpaper
    lockScreen(),                // Demande au shell d'activer le lock screen
    showNotificationCenter(),    // Demande au shell d'ouvrir le centre de notifications
    
    // NOUVEAU : Clipboard proxy
    clipboardCopy(data, type),   // Envoie au shell pour le clipboard manager
    clipboardPaste(),            // Demande le contenu du clipboard au shell
    onClipboardChange(handler),  // Écoute les changements clipboard
    
    // NOUVEAU : DnD proxy  
    startDrag(data),             // Signale au shell qu'un drag commence
    onDrop(handler),             // Écoute les drops depuis d'autres apps
};
```

**Protocole postMessage** (shell ↔ iframe app) :
```javascript
// Nouveaux messages app → shell :
{ type: "zro:desktop:open-file", path }
{ type: "zro:desktop:open-app", slug, params }
{ type: "zro:desktop:open-url", url }
{ type: "zro:desktop:set-wallpaper", url }
{ type: "zro:desktop:lock" }
{ type: "zro:desktop:show-notifications" }
{ type: "zro:clipboard:copy", data, mimeType }
{ type: "zro:clipboard:request-paste" }
{ type: "zro:dnd:start", data }

// Nouveaux messages shell → app :
{ type: "zro:clipboard:paste-result", data, mimeType }
{ type: "zro:clipboard:changed" }
{ type: "zro:dnd:enter", data }
{ type: "zro:dnd:leave" }
{ type: "zro:dnd:drop", data }
{ type: "zro:desktop:init", preferences, profile }
{ type: "zro:theme:changed", theme }
```

---

### 8.4 — Module `notifications` : centre de notifications

**Fichier** : `static/zro-client.js` (section notifications)

**Actuel** : `show(opts)` crée un toast éphémère. `history()` et `unreadCount()` existent mais retournent des données in-memory.

**Enrichissement** :
```javascript
const notifications = {
    // Existant (toast)
    show(opts),              // Toast local  
    
    // NOUVEAU (persistent, via runtime)
    async send(opts),        // Envoie une notification persistante au runtime
                             // { title, body, icon, urgency, actions, timeout }
                             // Sera affichée en toast ET stockée dans le centre
    async list(unreadOnly),  // Liste depuis le runtime
    async markRead(id),
    async markAllRead(),
    async unreadCount(),     // Depuis le runtime (pas in-memory)
    onNotification(handler), // Écoute les nouvelles notifications push
};
```

---

### 8.5 — Module `keybindings` : raccourcis globaux

**Actuel** : Le module keybindings enregistre des raccourcis locaux à l'app + peut envoyer au shell via `registerGlobal()`.

**Le module est fonctionnel côté SDK**, mais le shell (custom-shell) ne gère pas encore les raccourcis globaux. Le changement principal est côté shell (Phase 1.6 du roadmap), pas dans le SDK.

**Mineur** : Ajouter des constantes pour les raccourcis standard :
```javascript
keybindings.SHORTCUTS = {
    SHOW_DESKTOP: "super+d",
    SNAP_LEFT: "super+arrowleft",
    SNAP_RIGHT: "super+arrowright",
    MAXIMIZE: "super+arrowup",
    MINIMIZE: "super+arrowdown",
    CLOSE_WINDOW: "alt+f4",
    SWITCH_WINDOW: "alt+tab",
    OPEN_TERMINAL: "ctrl+alt+t",
    LOCK_SCREEN: "super+l",
    OPEN_LAUNCHER: "super",
};
```

---

### 8.6 — Module `window-mode` : snap zones + workspace

**Actuel** : Le module permet move, resize, minimize, maximize, close, getWindowInfo. Communication via postMessage vers le shell.

**Ajouts** :
```javascript
const windowMode = {
    // Existant
    move(x, y), resize(w, h), minimize(), maximize(), restore(), close(),
    getWindowInfo(),
    
    // NOUVEAU
    snap(zone),              // "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
    setWorkspace(id),        // Déplacer vers un workspace
    getWorkspace(),          // Quel workspace cette fenêtre est-elle
    setAlwaysOnTop(bool),
    setOpacity(float),       // 0.0-1.0
    onSnapChanged(handler),  // Notification quand la fenêtre est snappée
};
```

---

### 8.7 — Nouveau module `desktop` (convenience)

**Fichier** : `static/zro-client.js` (nouvelle section)

Module de haut niveau qui agrège les fonctionnalités desktop pour une API simple :

```javascript
const desktop = {
    // Preferences
    async getPreferences(),
    async setPreference(key, value),
    onPreferenceChanged(handler),
    
    // Theme (delegation au module theme)
    async getTheme(),
    async setTheme(name),
    async getAccentColor(),
    async setAccentColor(hex),
    
    // System
    async getSystemInfo(),
    
    // Apps
    async getAppList(),                  // Toutes les apps avec métadonnées
    async getAppsForMime(mimeType),      // Apps pour "Ouvrir avec..."
    async openFile(path),                // Via shell
    async openApp(slug, params),         // Via shell
    
    // Lock
    async lock(),
    
    // Events
    on(event, handler),  // __desktop:*, __theme:*, __clipboard:*
};
```

**Dépendances** : `connection` (pour invoke), `shell` (pour postMessage), `theme` (pour les CSS vars).

---

### 8.8 — Événement `__desktop:init` au boot

**Fichier** : `static/zro-client.js` (section connection)

Quand l'app se connecte, le runtime envoie `__desktop:init` avec les préférences. Le SDK doit :

1. Capter l'événement `__desktop:init`
2. Appliquer automatiquement les CSS variables du thème
3. Stocker les préférences en mémoire pour un accès synchrone
4. Émettre un événement local `desktop:ready` pour signaler à l'app que le thème est prêt

```javascript
// Handling automatique dans le module connection
connection.on("__desktop:init", (data) => {
    theme.applyThemeVariables(data.preferences);
    desktop._cache = data;
    app.emit("desktop:ready", data);
});
```

---

### Résumé Niveau 8

| Modif | Module | Criticité |
|-------|--------|-----------|
| Commandes système (prefs, notifs, metadata) | connection | 🔴 Bloquant |
| Multi-thème (available, switch, accent) | theme | 🔴 Bloquant |
| API desktop (openFile, openApp, lock, clipboard) | shell | 🔴 Bloquant |
| Notifications persistantes (send, list, markRead) | notifications | 🔴 Bloquant |
| Snap zones + workspace | window-mode | 🔶 Phase 1 |
| Module desktop (convenience) | desktop (nouveau) | 🔶 Important |
| __desktop:init au boot | connection | 🔶 Important |
| Raccourcis constants | keybindings | 🟢 Mineur |

---

## Niveau 9 — Shared Worker (`zro-shared-worker.js`)

### 9.1 — Relay clipboard entre onglets

**Problème** : Le SharedWorker mutualise la connexion WebSocket pour toutes les apps dans des onglets séparés. Si l'utilisateur fait "pop-out" d'une fenêtre, cette app est dans un onglet séparé et n'a pas accès au clipboard du shell parent.

**Solution** : Le SharedWorker maintient un buffer clipboard partagé entre tous les ports connectés.

```javascript
// Ajout dans zro-shared-worker.js
let clipboardBuffer = { data: null, mimeType: "text/plain", timestamp: 0 };

// Quand un port envoie une copie :
port.onmessage = (e) => {
    if (e.data.type === "clipboard:copy") {
        clipboardBuffer = { data: e.data.data, mimeType: e.data.mimeType, timestamp: Date.now() };
        // Notifier tous les autres ports
        ports.forEach(p => p !== port && p.postMessage({ type: "clipboard:changed" }));
    }
    if (e.data.type === "clipboard:paste") {
        port.postMessage({ type: "clipboard:paste-result", ...clipboardBuffer });
    }
};
```

---

### 9.2 — Relay DnD ?

Le drag-and-drop inter-iframe ne peut PAS passer par le SharedWorker car le DnD est visuel (l'élément fantôme suit le curseur). Le DnD reste géré par le shell parent via postMessage (voir 8.3). Pas de changement dans le SharedWorker pour le DnD.

---

### Résumé Niveau 9

| Modif | Criticité |
|-------|-----------|
| Clipboard buffer partagé | 🟡 Phase 3 |

---

## Niveau 10 — Design System (`zro-base.css`)

### 10.1 — Thèmes multiples

**Problème** : `zro-base.css` ne définit que Catppuccin Mocha (dark). Le DE a besoin d'au moins 4-5 thèmes.

**Solution** : Chaque thème est un bloc de CSS variables sous un attribut `[data-theme]` :

```css
/* Thème par défaut (Catppuccin Mocha = dark) */
:root, [data-theme="catppuccin-mocha"] {
    --zro-base: #1e1e2e;
    --zro-surface0: #313244;
    /* ... (existant) */
}

/* Catppuccin Latte (light) */
[data-theme="catppuccin-latte"] {
    --zro-base: #eff1f5;
    --zro-surface0: #ccd0da;
    --zro-surface1: #bcc0cc;
    --zro-surface2: #acb0be;
    --zro-text: #4c4f69;
    --zro-subtext1: #5c5f77;
    --zro-subtext0: #6c6f85;
    --zro-overlay2: #7c7f93;
    --zro-overlay1: #8c8fa1;
    --zro-overlay0: #9ca0b0;
    --zro-blue: #1e66f5;
    --zro-lavender: #7287fd;
    /* ... toutes les variables */
}

/* Nord */
[data-theme="nord"] { ... }

/* Dracula */
[data-theme="dracula"] { ... }

/* Tokyo Night */
[data-theme="tokyo-night"] { ... }

/* Gruvbox Dark */
[data-theme="gruvbox-dark"] { ... }

/* Solarized Dark */
[data-theme="solarized-dark"] { ... }

/* Solarized Light */
[data-theme="solarized-light"] { ... }
```

**Application** : Le shell set `document.documentElement.setAttribute("data-theme", themeName)`. Toutes les iframes héritent via le postMessage `__desktop:init`.

---

### 10.2 — Variables d'accent color

```css
:root {
    /* Couleur d'accent override (priorité sur le thème) */
    --zro-accent: var(--zro-blue);     /* Par défaut = bleu du thème */
    --zro-accent-hover: ...;
    --zro-accent-active: ...;
    --zro-accent-text: ...;            /* Texte sur fond accent */
}
```

Le module `theme` du SDK change `--zro-accent` quand l'utilisateur choisit une couleur.

---

### 10.3 — Variables de densité et rayon

```css
:root {
    /* Density */
    --zro-density-compact: 0.75;
    --zro-density-normal: 1;
    --zro-density-spacious: 1.25;
    --zro-density: var(--zro-density-normal);
    
    --zro-spacing-xs: calc(4px * var(--zro-density));
    --zro-spacing-sm: calc(8px * var(--zro-density));
    --zro-spacing-md: calc(12px * var(--zro-density));
    --zro-spacing-lg: calc(16px * var(--zro-density));
    --zro-spacing-xl: calc(24px * var(--zro-density));
    
    /* Border radius */
    --zro-radius-sharp: 0px;
    --zro-radius-normal: 8px;
    --zro-radius-pill: 16px;
    --zro-radius: var(--zro-radius-normal);
}
```

---

### 10.4 — Transition entre thèmes

```css
/* Transition fluide lors du changement de thème */
:root {
    transition: 
        background-color 300ms ease,
        color 300ms ease,
        border-color 300ms ease;
}
```

---

### Résumé Niveau 10

| Modif | Criticité |
|-------|-----------|
| 5-8 thèmes en data-theme | 🔴 Bloquant (Phase 1) |
| Variables accent color | 🔶 Important |
| Variables densité/radius | 🟡 Phase 3 |
| Transitions inter-thème | 🟢 Mineur |

---

## Résumé — Matrice des dépendances

```
Niveau 0 (Protocol)
  │
  ├── 0.1 Manifest enrichi ──────────────┬──→ N2.2 Registry indexes
  │                                       ├──→ N4.1 /api/apps/metadata
  │                                       └──→ N8.7 Module desktop
  │
  ├── 0.2 SessionInfo + UserProfile ─────┬──→ N4.6 __desktop:init
  │                                       ├──→ N5.1 AppContext.profile()
  │                                       └──→ N8.3 Shell API
  │
  └── 0.3 EventTarget Session/System ───┬──→ N3.1 IPC dispatch Session
                                         ├──→ N3.2 Runtime system events
                                         └──→ N5.1 emit_to_session()
Niveau 1 (Storage)
  │
  ├── 1.1 user_preferences ─────────────┬──→ N4.1 /api/desktop/preferences
  │                                      └──→ N4.5 WS __pref:*
  │
  ├── 1.2 notifications ────────────────┬──→ N4.1 /api/notifications
  │                                      └──→ N4.5 WS __notify:*
  │
  └── 1.4 mime_associations ────────────┬──→ N2.2 Registry MIME index
                                         └──→ N4.1 /api/apps/for-mime

Niveau 2 (Runtime core)
  │
  └── 2.2 Registry indexes ─────────────→ N4.1 /api/apps/metadata

Niveau 3 (IPC)
  │
  └── 3.1 Session broadcast ────────────→ N5.1 emit_to_session()
                                          → N8.2 theme changed event

Niveau 4 (Gateway) ←── dépend de N1, N2, N3
  │
  └── 4.5 WS commandes système ────────→ N8.1 connection (prefs, notifs)
      4.6 __desktop:init ──────────────→ N8.8 auto-apply theme

Niveau 5-7 (SDKs backend)
  │
  └── Parallèle, dépendent de N0 + N3

Niveau 8 (SDK frontend)
  │
  └── Dépend de N4 (gateway) + N10 (CSS)

Niveau 10 (CSS)
  │
  └── Indépendant, peut commencer immédiatement
```

### Ordre d'exécution recommandé

```
Batch 1 (fondations, pas de dépendances) :
  ├── N0.1  Manifest enrichi
  ├── N0.2  UserProfile + SessionInfo
  ├── N0.3  EventTarget Session/System
  ├── N0.5  MAX_UPLOAD_SIZE
  └── N10.1 Thèmes CSS multiples

Batch 2 (dépend de Batch 1) :
  ├── N1.1  Table user_preferences
  ├── N1.2  Table notifications
  ├── N2.1  DesktopConfig
  ├── N2.2  Registry indexes + AppMetadata
  └── N3.1  IPC dispatch Session/System

Batch 3 (dépend de Batch 2) :
  ├── N4.1-4.6  Gateway : routes + WS interception
  └── N3.2      Runtime system events

Batch 4 (dépend de Batch 1-3) :
  ├── N5.1-5.4  Rust SDK enrichi
  ├── N6.1-6.4  Node.js SDK enrichi
  └── N7.1-7.4  Python SDK enrichi

Batch 5 (dépend de Batch 3-4) :
  ├── N8.1-8.8  Frontend SDK enrichi
  └── N9.1      SharedWorker clipboard

Batch 6 (polish, après tout) :
  ├── N2.3  Auto-restart supervisor
  ├── N1.3  active_windows workspace_id
  ├── N1.4  mime_associations
  ├── N10.2-10.4  CSS accent/density/transitions
  └── Tous les "Nice to have"
```
