# ZRO — Guide de création d'apps

## Structure d'une app

```
apps/my-app/
├── manifest.toml           # Métadonnées, backend, frontend, permissions
├── backend/
│   └── src/
│       └── main.rs         # (ou main.py, main.ts)
└── frontend/
    ├── index.html          # Point d'entrée
    ├── app.js              # Logique frontend
    └── app.css             # Styles (optionnel)
```

## Manifeste

```toml
[app]
slug = "my-app"             # URL-safe, unique, 2-32 chars
name = "My App"             # Nom affiché
version = "0.1.0"
description = "Description"

[backend]
executable = "zro-app-my-app"    # Binaire dans ./bin/
transport = "unix_socket"

[frontend]
directory = "frontend"
index = "index.html"

[permissions]
roles = ["admin", "user"]        # Rôles autorisés
capabilities = []
```

### Backend en Python/Node.js

```toml
# Python
[backend]
command = "python3"
args = ["-u"]
executable = "backend/main.py"
transport = "unix_socket"

# Node.js
[backend]
command = "node"
executable = "backend/dist/main.js"
transport = "unix_socket"
```

### Règles de slug

- Regex : `^[a-z0-9]([a-z0-9\-]{0,30}[a-z0-9])?$`
- Réservés : `apps`, `auth`, `health`, `static`, `api`, `admin`, `system`, `_internal`, `ws`

## Backend minimal

### Rust

```rust
use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;
use zro_sdk::modules::state::StateModule;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .module(StateModule::new())
        .command("hello", |params, ctx: AppContext| {
            Box::pin(async move {
                Ok(serde_json::json!({ "hello": ctx.session.username }))
            })
        })
        .build().await?;
    app.run().await?;
    Ok(())
}
```

### Python

```python
from zro_sdk import ZroApp, AppContext

app = ZroApp()

@app.command("hello")
async def hello(ctx: AppContext):
    return {"hello": ctx.session.username}

app.run()
```

### Node.js

```typescript
import { ZroApp } from 'zro-sdk';

const app = new ZroApp();
app.command('hello', async (ctx, params) => {
    return { hello: ctx.session.username };
});
app.run();
```

## Frontend minimal

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>My App</title>
    <link rel="stylesheet" href="/static/zro-base.css">
</head>
<body>
    <div id="app"></div>
    <script src="/static/zro-client.js"></script>
    <script>
    (async function() {
        const app = await ZroClient.create({ slug: 'my-app' });
        const result = await app.invoke('hello');
        document.getElementById('app').textContent = result.hello;
    })();
    </script>
</body>
</html>
```

## Routage des URLs

| URL | Destination |
|-----|-------------|
| `/{slug}/` | Frontend `index.html` |
| `/{slug}/static/{file}` | Fichier statique du frontend |
| `/{slug}/api/{path}` | Proxy HTTP → backend (auto-routé vers commande) |
| `/{slug}/{instanceId}/` | Frontend avec instance ID dans l'URL |
| `/{slug}/{instanceId}/api/{path}` | Proxy HTTP avec instance ID |

### Auto-routage HTTP → Commandes

`POST /{slug}/api/task` génère les candidats suivants (premier match gagne) :
1. `task`
2. `post_task`
3. `task_create`, `create_task` (POST → create)
4. Combinaisons de segments

Voir la [documentation Backend SDK](backend-sdk.md) pour l'algorithme détaillé.

## Modèle d'instances

Chaque fenêtre frontend ouverte est une **instance** identifiée par `instanceId` (ex: `terminal-1`, `notes-2`).

- **Un seul process backend** par app, toutes les instances s'y connectent
- **`ctx.instance_id`** identifie l'instance dans chaque handler
- Pour le **WebSocket** : `instance_id` est toujours présent
- Pour le **HTTP** : `instance_id` est `None`/`null` (pas de session WS)

### État partagé vs par instance

| Pattern | Quand l'utiliser | Exemple |
|---------|-----------------|---------|
| **État global** (shared) | Données communes à tous les utilisateurs | Notes, tâches |
| **État par instance** | Ressources liées à une fenêtre spécifique | PTY terminal, session shell |

```rust
// État par instance — HashMap indexée par instance_id
type Sessions = Arc<RwLock<HashMap<String, PtySession>>>;

// Créer à la connexion
app.on("client:connected", |ctx| {
    sessions.insert(ctx.instance_id.unwrap(), create_pty());
});

// Nettoyer à la déconnexion (avec grace period)
LifecycleModule::new()
    .grace_period(Duration::from_secs(5))
    .on_timeout(|id| {
        sessions.remove(&id);  // Nettoyer après timeout
    });
```

## Patterns courants

### Persistance fichier JSON

```rust
// Charger au démarrage
let data = load_from_disk(&data_dir).await;
let db = Arc::new(RwLock::new(data));

// Sauvegarder à chaque mutation
async fn save(data_dir: &Path, db: &Db) {
    let data = db.read().await;
    let json = serde_json::to_string_pretty(&*data).unwrap();
    tokio::fs::write(data_dir.join("data.json"), json).await.ok();
}
```

### Broadcast d'événements

```rust
// Notifier tous les clients d'un changement
let emitter = app.emitter();  // Avant .run()

app.command("create_task", move |params, ctx| {
    // ... créer la tâche ...
    emitter.emit("tasks:updated", json!({"action": "created", "task": task}));
    Ok(json!(task))
});
```

### Sécurité : validation de chemins (Files)

```rust
fn resolve_safe_path(root: &Path, requested: &str) -> Option<PathBuf> {
    let requested = requested.trim_start_matches('/');
    let candidate = root.join(requested);
    let canonical_root = root.canonicalize().ok()?;
    let canonical = candidate.canonicalize().ok()?;
    if canonical.starts_with(&canonical_root) {
        Some(canonical)
    } else {
        None  // Tentative de path traversal
    }
}
```

---

## Référence des 7 apps incluses

### Echo (test)

App de test complète qui exerce toutes les fonctionnalités du SDK.

**Commandes :** `status`, `echo`, `kv_set`, `kv_get`, `kv_list`, `kv_delete`, `log`, `ping`, `counter`, `get_clients`

**Backend :** Rust, utilise les 5 modules built-in  
**Frontend :** Interface de test avec boutons pour chaque commande  
**État :** Compteur atomique, logs en mémoire, clients connectés

### Notes

Éditeur de notes avec sauvegarde automatique.

**Commandes :** `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `search_notes`

**Backend :** Rust. Persistance fichier JSON par note (`data/notes/notes/{id}.json`)  
**Frontend :** Liste latérale + éditeur. Auto-save avec debounce  
**Pattern :** État global partagé (toutes les instances voient les mêmes notes)

### Tasks

Gestionnaire de tâches avec vue Kanban.

**Commandes :** `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `move_task`, `list_categories`, `create_category`, `update_category`, `delete_category`

**Backend :** Rust. Persistance `data/tasks/tasks.json`. Catégories + priorités + dates d'échéance  
**Frontend :** Kanban 3 colonnes (todo/in_progress/done) avec drag-and-drop, filtres, modale d'édition  
**Pattern :** Broadcast d'événements `tasks:updated` à chaque modification

### Files

Explorateur de fichiers.

**Commandes :** `ls`, `read_file`, `write_file`, `create_dir`, `delete`, `rename`, `stat`

**Backend :** Rust. Exploration de `data/files/`. Protection path traversal. Détection binaire. Limite de lecture 1 Mo  
**Frontend :** Vue tableau avec breadcrumb, panneau de preview, menu contextuel  
**Pattern :** Aucun état persistant — lecture directe du filesystem

### Terminal

Terminal web avec xterm.js.

**Commandes :** `term_input`, `term_resize`

**Backend :** Rust. Utilise `portable_pty` pour spawner un shell par instance. Lecture async dans une tâche Tokio. Émission d'événements `term:output` et `term:exit`  
**Frontend :** xterm.js (Terminal + FitAddon + WebLinksAddon). Thème Catppuccin  
**Pattern :** État par instance. `LifecycleModule` avec grace period de 5s. PTY nettoyé au timeout

### Shell (Desktop)

Gestionnaire de fenêtres web — le "bureau" de ZRO.

**Commandes :** `get_apps`, `get_user_info`

**Backend :** Rust, minimal. La logique est dans le frontend  
**Frontend :** Desktop complet : fenêtres draggables/redimensionnables, taskbar avec horloge, lanceur d'apps, notifications. Les apps s'ouvrent dans des iframes. Persistence de l'état des fenêtres via `__state:save/restore`  
**Pattern :** Protocole postMessage `zro:shell:*` pour la communication shell↔apps

### Custom Shell

Template de desktop personnalisé — point de départ pour créer son propre shell.

**Commandes :** `get_apps`, `get_user_info` (identique à Shell)

**Backend :** Rust, identique au Shell standard  
**Frontend :** Implémentation simplifiée du desktop. Destiné à être forké et personnalisé  

---

## Compilation et ajout d'une app

### App Rust

1. Créer le dossier `apps/my-app/` avec `manifest.toml`
2. Ajouter le crate dans `Cargo.toml` (workspace)
3. `cargo build` → le binaire arrive dans `target/debug/`
4. Créer un symlink : `ln -s ../target/debug/zro-app-my-app bin/zro-app-my-app`
5. Redémarrer le runtime (ou attendre le hot-reload si activé)

### App Python/Node.js

1. Créer le dossier `apps/my-app/` avec `manifest.toml` (avec `command` et `args`)
2. Installer les dépendances du SDK
3. Écrire le backend (le runtime le lance automatiquement)

### Variables d'environnement

Le runtime fournit automatiquement au process backend :

| Variable | Exemple |
|----------|---------|
| `ZRO_APP_SLUG` | `my-app` |
| `ZRO_IPC_SOCKET` | `/tmp/zro/ipc/my-app.sock` |
| `ZRO_DATA_DIR` | `./data/my-app` |
| `ZRO_LOG_LEVEL` | `debug` |

## Fichiers statiques

Le contenu du dossier `frontend/` est servi sous `/{slug}/static/`.

Les fichiers globaux (`zro-client.js`, `zro-base.css`, etc.) sont servis sous `/static/`.
