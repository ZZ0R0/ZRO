# ZRO — Référence SDK Backend

Trois implémentations de SDK avec une sémantique identique. Un seul processus backend par app, toutes les instances frontend s'y connectent.

## Concepts

| Concept | Description |
|---------|-------------|
| **Command** | Handler requête/réponse. Appelé via `conn.invoke()` (WS) ou requête HTTP. Doit retourner un résultat ou une erreur. |
| **Event handler** | Handler d'événement WS fire-and-forget depuis le client. Pas de réponse. |
| **Lifecycle hook** | Appelé quand une instance se connecte/déconnecte/reconnecte. |
| **AppContext** | Fourni à chaque handler. Contient la session, instance_id, méthodes d'émission d'événements. |
| **Instance ID** | String identifiant chaque fenêtre frontend (ex: `terminal-1`). Un backend sert N instances. |
| **Module** | Unité réutilisable de commandes, événements et hooks de cycle de vie. |

## SDK Rust

### Installation

```toml
[dependencies]
zro_sdk = { path = "../../sdks/rust" }
```

### Quick Start

```rust
use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .command("greet", |params, ctx: AppContext| {
            Box::pin(async move {
                let name = params.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("World");
                Ok(serde_json::json!({ "message": format!("Hello, {}!", name) }))
            })
        })
        .on("client:connected", |ctx: AppContext| {
            Box::pin(async move {
                println!("Client connected: {:?}", ctx.instance_id);
            })
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}
```

### Builder API

```rust
ZroApp::builder()
    // Modules (résolus en ordre topologique)
    .module(StateModule::new())
    .module(DevModule::new().level(LogLevel::Info))

    // Commandes (WS invoke + HTTP API)
    .command("name", handler)

    // Événements WS fire-and-forget
    .on_event("event", handler)

    // Hooks de cycle de vie
    .on("client:connected", handler)
    .on("client:disconnected", handler)
    .on("client:reconnected", handler)

    // Construction : connexion IPC + handshake
    .build().await?

    // Boucle principale (bloquant)
    .run().await?
```

### Signatures des handlers

```rust
// Command : reçoit params + context, retourne Result<Value, String>
type CommandFn = Arc<
    dyn Fn(Value, AppContext) -> BoxFuture<Result<Value, String>>
        + Send + Sync,
>;

// Event : reçoit data + context, pas de retour
type EventFn = Arc<
    dyn Fn(Value, AppContext) -> BoxFuture<()>
        + Send + Sync,
>;

// Lifecycle : reçoit context uniquement
type LifecycleHandler = Arc<
    dyn Fn(AppContext) -> BoxFuture<()>
        + Send + Sync,
>;
```

### AppContext

```rust
pub struct AppContext {
    pub session: SessionInfo,          // user_id, username, role, groups
    pub instance_id: Option<String>,   // Some("terminal-1") pour WS, None pour HTTP
    pub slug: String,                  // "terminal"
    pub data_dir: PathBuf,             // ./data/terminal/
}

impl AppContext {
    /// Broadcast un événement à toutes les instances connectées de cette app
    async fn emit(&self, event: &str, payload: Value) -> Result<()>

    /// Envoyer un événement à une instance spécifique
    async fn emit_to(&self, instance_id: &str, event: &str, payload: Value) -> Result<()>
}
```

### EventEmitter

Pour émettre des événements en dehors des handlers (ex: depuis une tâche background) :

```rust
let emitter = app.emitter(); // Appeler AVANT .run()

tokio::spawn(async move {
    emitter.emit("tick", json!({"time": "now"})).await.ok();
    emitter.emit_to("term-1", "output", json!({"data": "hello"})).await.ok();
});

app.run().await?;
```

### Macro `#[zro::command]`

Transforme une fonction async en handler compatible `CommandFn` :

```rust
use zro_sdk::command;

#[command]
async fn greet(ctx: AppContext, name: String) -> Result<Value, String> {
    Ok(json!({ "message": format!("Hello, {}!", name) }))
}

// Utilisation :
ZroApp::builder()
    .command("greet", greet)
```

La macro :
- Injecte automatiquement `AppContext` si présent dans les paramètres
- Désérialise tous les autres paramètres depuis `params: Value`
- Gère les retours `Result<T, E>` et `T` (bare value)

### Types HTTP

```rust
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    pub query: HashMap<String, String>,
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    fn ok() -> Self                              // 200 vide
    fn json<T: Serialize>(data: &T) -> Self      // 200 JSON
    fn text(s: &str) -> Self                     // 200 text/plain
    fn not_found() -> Self                       // 404
    fn bad_request(msg: &str) -> Self            // 400
    fn internal_error(msg: &str) -> Self         // 500
    fn with_status(status: u16) -> Self          // status custom
}
```

### Auto-routage HTTP → Commandes

Quand une requête HTTP arrive sur `/{slug}/api/{path}`, le SDK tente automatiquement de la router vers une commande enregistrée.

**Algorithme :**

1. Retirer le préfixe `/api/`, découper en segments : `path.split('/')`
2. `base = segments[0]`, `method = method.to_lowercase()`
3. Générer les noms candidats dans cet ordre :
   - `base` (ex: `"status"`)
   - `{method}_{base}` (ex: `"get_status"`)
   - Mapping CRUD : `GET → [list, get]`, `POST → [create]`, `PUT → [update, set]`, `DELETE → [delete]`, `PATCH → [update]`
     - `{base}_{action}` + `{action}_{base}` (ex: `"tasks_list"`, `"list_tasks"`)
   - Si 2+ segments : `{base}_{segments[1]}` + `{segments[1]}_{base}`
4. Le premier candidat existant dans la map des commandes gagne

**Construction des params :**
- Body JSON (décodé base64) comme base
- Query params mergés (sans écraser le body)
- `id = segments[1..]` si présent
- `_method = méthode HTTP` ajouté

**Exemple :** avec `.command("create_task", handler)` :
- `POST /tasks/api/task` → candidates : `task`, `post_task`, `task_create`, `create_task` ✓

### Pattern état par instance

```rust
// Terminal : un PTY par instance
type Sessions = Arc<RwLock<HashMap<String, PtySession>>>;

app.on("client:connected", {
    let sessions = sessions.clone();
    move |ctx: AppContext| {
        let sessions = sessions.clone();
        Box::pin(async move {
            let id = ctx.instance_id.unwrap();
            let pty = spawn_pty();
            sessions.write().await.insert(id, pty);
        })
    }
});
```

### Erreurs SDK

```rust
pub enum ZroSdkError {
    IpcConnectionFailed(String),
    HandshakeFailed(String),
    SerializationError(String),
    IoError(std::io::Error),
    EnvMissing(String),
    HandlerError(String),
    Timeout(String),
    Protocol(ProtocolError),
}
```

---

## SDK Python

### Installation

```bash
pip install -e sdks/python
```

### Quick Start

```python
from zro_sdk import ZroApp, AppContext

app = ZroApp()

@app.command("greet")
async def greet(ctx: AppContext, name: str = "World"):
    return {"message": f"Hello, {name}!"}

@app.on("client:connected")
async def on_connect(ctx: AppContext):
    print(f"Client connected: {ctx.instance_id}")

if __name__ == "__main__":
    app.run()
```

### Décorateurs

```python
@app.command("name")            # WS invoke + HTTP API
@app.on_event("event_name")    # WS fire-and-forget event
@app.on("client:connected")    # Lifecycle hook
@app.on("client:disconnected")
@app.on("client:reconnected")
```

### Injection de paramètres

Le SDK inspecte la signature de chaque handler via `inspect.signature()` :

- Si l'annotation est `AppContext` ou le nom est `ctx` → injecté automatiquement
- Tous les autres paramètres → extraits du dict `params` par nom
- Les type hints servent à la coercion
- Les valeurs par défaut rendent les params optionnels
- Param manquant sans default → `ValueError`

```python
@app.command("add")
async def add(ctx: AppContext, a: int, b: int) -> dict:
    return {"sum": a + b}
# Appelé via : conn.invoke("add", { a: 2, b: 3 })
```

### AppContext

```python
@dataclass
class AppContext:
    session: SessionInfo        # session_id, user_id, username, role, groups
    instance_id: Optional[str]  # "notes-1" pour WS, None pour HTTP
    slug: str                   # "notes"
    data_dir: Path              # Path("./data/notes")

    async def emit(event, payload)                  # broadcast
    async def emit_to(instance_id, event, payload)  # ciblé
    def state(state_type) -> Any                    # accès état partagé par type
```

### État partagé

```python
class Counter:
    def __init__(self):
        self.value = 0

app = ZroApp()
app.register_state(Counter())

@app.command("increment")
async def increment(ctx: AppContext):
    counter = ctx.state(Counter)
    counter.value += 1
    return {"count": counter.value}
```

### IPC Client

```python
class IpcClient:
    MAX_MESSAGE_SIZE = 16 * 1024 * 1024  # 16 Mio

    async def connect(socket_path: str)     # asyncio.open_unix_connection
    async def send(msg: IpcMessage)         # struct.pack(">I", len) + JSON
    async def recv() -> IpcMessage          # readexactly(4) + readexactly(len)
    async def close()
```

---

## SDK Node.js

### Installation

```bash
npm link sdks/nodejs
```

### Quick Start

```typescript
import { ZroApp } from 'zro-sdk';
import { AppContext } from 'zro-sdk/context';

const app = new ZroApp();

app.command('greet', async (ctx: AppContext, params: any) => {
    return { message: `Hello, ${params.name || 'World'}!` };
});

app.on('client:connected', async (ctx: AppContext) => {
    console.log(`Client connected: ${ctx.instanceId}`);
});

app.run();
```

### API

```typescript
class ZroApp {
    command(name: string, handler: CommandHandler): this
    onEvent(event: string, handler: EventHandler): this     // WS fire-and-forget
    on(event: string, handler: LifecycleHandler): this      // Lifecycle hooks
    registerState(key: string, initial: any): this          // État partagé
    module(mod: ZroModule): this                            // Enregistrer un module
    run(): void                                             // Connect + boucle
}

type CommandHandler<T = any> = (ctx: AppContext, params: T) => Promise<any>;
type EventHandler = (ctx: AppContext, data: any) => Promise<void>;
type LifecycleHandler = (ctx: AppContext, data?: any) => Promise<void>;
```

### AppContext

```typescript
class AppContext {
    readonly session: SessionInfo;      // sessionId, userId, username, role, groups
    readonly instanceId: string | null; // "files-2" pour WS, null pour HTTP
    readonly slug: string;              // "files"
    readonly dataDir: string;           // "./data/files"

    emit(event: string, data: any): void                         // broadcast
    emitTo(instanceId: string, event: string, data: any): void   // ciblé
    state(key: string): any                                      // état partagé
}
```

### IPC Client

```typescript
class IpcClient {
    connect(socketPath: string): Promise<void>   // Socket Unix
    send(msg: IpcMessage): void                  // 4 octets BE length + JSON
    recv(): Promise<IpcMessage>                  // File d'attente promise-based
    close(): void
}
```

### IpcMessage

```typescript
class IpcMessage {
    type: string;
    id: string;       // UUID v4
    timestamp: string; // ISO 8601
    payload: any;

    static new(type: string, payload: any): IpcMessage
    static reply(originalId: string, type: string, payload: any): IpcMessage
    toJSON(): object
    toBuffer(): Buffer
    static fromData(data: object): IpcMessage
    static fromBuffer(buf: Buffer): IpcMessage
}
```

---

## Système de modules

Les trois SDKs partagent un système de modules identique. Les modules sont des unités autonomes qui contribuent des commandes, des handlers d'événements et des hooks de cycle de vie. Ils déclarent leurs dépendances et sont résolus en ordre topologique.

### Concepts

| Concept | Description |
|---------|-------------|
| **ModuleMeta** | Identité (nom, version), description et liste de dépendances |
| **ModuleRegistrar** | Builder passé à `register()` — même API que le builder d'app |
| **Résolution de dépendances** | Tri topologique (algorithme de Kahn) pour l'ordre d'initialisation |
| **Init Hook** | Callback async exécuté après le handshake IPC, avant la boucle principale |
| **Destroy Hook** | Callback async exécuté au shutdown, en ordre inverse d'initialisation |

### Rust

```rust
use zro_sdk::module::{ZroModule, ModuleMeta, ModuleRegistrar};

struct MyModule;

impl ZroModule for MyModule {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("my-module", "0.1.0")
            .description("Description du module")
            .dependencies(vec!["state"])  // Dépend du module "state"
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        r.command("my_command", |params, ctx| Box::pin(async move {
            Ok(serde_json::json!({"ok": true}))
        }));

        r.on_init(|ctx| async move {
            println!("Module initialisé : data_dir = {:?}", ctx.data_dir);
            Ok(())
        });

        r.on_destroy(|| async {
            println!("Module détruit");
        });
    }
}
```

### Python

```python
from zro_sdk import ZroModule, ModuleMeta, ModuleRegistrar, AppContext

class MyModule(ZroModule):
    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="my-module",
            version="0.1.0",
            description="Description du module",
            dependencies=["state"],
        )

    def register(self, r: ModuleRegistrar) -> None:
        @r.command("my_command")
        async def my_command(ctx: AppContext) -> dict:
            return {"ok": True}

        @r.on_init
        async def init(ctx):
            print(f"Module initialisé : data_dir = {ctx.data_dir}")

        @r.on_destroy
        async def destroy():
            print("Module détruit")
```

### Node.js

```typescript
import { ZroModule, ModuleRegistrar } from 'zro-sdk';

const myModule: ZroModule = {
    meta: {
        name: 'my-module',
        version: '0.1.0',
        description: 'Description du module',
        dependencies: ['state'],
    },
    register(r: ModuleRegistrar) {
        r.command('my_command', async (ctx, params) => {
            return { ok: true };
        });

        r.onInit(async (ctx) => {
            console.log(`Module initialisé : dataDir = ${ctx.dataDir}`);
        });

        r.onDestroy(async () => {
            console.log('Module détruit');
        });
    },
};
```

### Utilisation

```rust
// Rust
ZroApp::builder()
    .module(StateModule::new())
    .module(MyModule)
    .build().await?;
```

```python
# Python
app = ZroApp()
app.module(StateModule())
app.module(MyModule())
app.run()
```

```typescript
// Node.js
const app = new ZroApp();
app.module(stateModule);
app.module(myModule);
app.run();
```

---

## 5 modules built-in

Les trois SDKs fournissent les mêmes 5 modules prêts à l'emploi :

### StateModule — Stockage clé/valeur persistant

Store KV en mémoire avec persistance JSON sur disque (`{data_dir}/kv.json`). Chargé à l'init, sauvegardé à chaque mutation.

| Commande | Params | Retour |
|----------|--------|--------|
| `__kv:get` | `{ key }` | `{ key, value, found }` |
| `__kv:set` | `{ key, value }` | `{ key, value }` |
| `__kv:delete` | `{ key }` | `{ key, deleted }` |
| `__kv:list` | — | `{ keys: [...] }` |
| `__kv:get_all` | — | `{ entries: {...} }` |

> **Note :** Ces commandes `__kv:*` sont distinctes des commandes `__state:*` du runtime. Le runtime gère l'état SQLite par utilisateur/app (persistance UI). Les modules `__kv:*` gèrent un store KV par app (partagé entre tous les utilisateurs).

### IpcModule — Communication inter-apps

Permet aux apps de s'envoyer des messages via le runtime.

| Commande | Params | Retour |
|----------|--------|--------|
| `__ipc:send` | `{ target, channel, data }` | `{ sent: true }` |

| Event handler | Description |
|---------------|-------------|
| `__ipc:receive` | Dispatche vers les handlers par canal enregistrés |

```rust
// Rust
IpcModule::new().on_receive("chat", |data, ctx| Box::pin(async move {
    println!("Message reçu sur canal chat: {:?}", data);
}))
```

### NotificationsModule — Notifications

| Commande | Params | Retour |
|----------|--------|--------|
| `__notify` | `{ title, body?, level?, duration?, actions? }` | `{ sent: true }` |
| `__notify:broadcast` | Idem | `{ sent: true }` |

`__notify` envoie à l'instance appelante (ou broadcast si pas d'instance_id). `__notify:broadcast` envoie toujours à toutes les instances.

```rust
// Types
enum NotificationLevel { Info, Success, Warning, Error }

struct Notification {
    title: String,
    body: Option<String>,
    level: NotificationLevel,  // défaut: Info
    duration: u64,             // défaut: 5000ms
    actions: Vec<NotificationAction>,
}

struct NotificationAction {
    id: String,
    label: String,
}
```

### DevModule — Outils de développement

| Commande | Params | Retour |
|----------|--------|--------|
| `__dev:log` | `{ level, message, data? }` | `{ logged: true }` |
| `__dev:info` | — | `{ slug, instance_id, data_dir, session, min_log_level }` |

Filtrage par niveau configurable. Init hook : log les infos de démarrage.

```rust
// Rust — configuration du niveau minimum
DevModule::new()
    .level(LogLevel::Info)    // Debug=0, Info=1, Warn=2, Error=3, Silent=4
    .prefix("my-app")        // Préfixe optionnel dans les logs
```

### LifecycleModule — Gestion du cycle de vie des instances

Pas de commandes — enregistre uniquement des hooks de cycle de vie. Gère une période de grâce avant le nettoyage des ressources après déconnexion.

```rust
// Rust
LifecycleModule::new()
    .grace_period(Duration::from_secs(5))  // Défaut: 5s
    .on_connect(|ctx| Box::pin(async move {
        println!("Connecté: {:?}", ctx.instance_id);
    }))
    .on_disconnect(|ctx| Box::pin(async move {
        println!("Déconnecté: {:?}", ctx.instance_id);
    }))
    .on_timeout(|instance_id| Box::pin(async move {
        println!("Timeout (nettoyage): {}", instance_id);
    }))
```

**Fonctionnement :** À la déconnexion, lance un timer de grâce. Si le client se reconnecte dans le délai → timer annulé. Sinon → callback `on_timeout` exécuté pour nettoyer les ressources (ex: fermer un PTY).

---

## Manifeste (`manifest.toml`)

Chaque app nécessite un fichier `manifest.toml` :

```toml
[app]
name = "My App"
slug = "myapp"                  # URL-safe, unique
version = "0.1.0"
description = "Description"

[backend]
executable = "zro-app-myapp"    # Nom du binaire dans ./bin/
transport = "unix_socket"

# Pour Python :
# command = "python3"
# args = ["-u"]
# executable = "backend/main.py"

# Pour Node.js :
# command = "node"
# executable = "backend/dist/main.js"

[frontend]
directory = "frontend"
index = "index.html"

# Dev proxy (optionnel, mode dev uniquement) :
# [frontend.dev]
# dev_url = "http://localhost:5173"

[permissions]
roles = ["admin", "user"]
capabilities = []
```

**Règles de slug :** `^[a-z0-9]([a-z0-9\-]{0,30}[a-z0-9])?$`

**Slugs réservés :** `apps`, `auth`, `health`, `static`, `api`, `admin`, `system`, `_internal`, `ws`

## Variables d'environnement

Définies par le runtime pour chaque process backend :

| Variable | Exemple | Description |
|----------|---------|-------------|
| `ZRO_APP_SLUG` | `terminal` | Slug de l'app |
| `ZRO_IPC_SOCKET` | `/tmp/zro/ipc/terminal.sock` | Chemin du socket Unix |
| `ZRO_DATA_DIR` | `./data/terminal` | Répertoire de données persistantes |
| `ZRO_LOG_LEVEL` | `debug` | Niveau de log |
