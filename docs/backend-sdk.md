# ZRO — Backend SDK Reference

Three SDK implementations with identical semantics. One backend process per app, handling all instances.

## Concepts

| Concept | Description |
|---------|-------------|
| **Command** | Request/response handler. Called via WS `invoke()` or HTTP API. Must return a result or error. |
| **Event handler** | Fire-and-forget WS event from client. No response. |
| **Lifecycle hook** | Called when an instance connects/disconnects/reconnects. |
| **AppContext** | Provided to every handler. Contains session info, instance_id, emit methods. |
| **Instance ID** | String identifying each frontend window (e.g., `terminal-1`). One backend serves many instances. |

## Rust SDK

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
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("World");
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
    .command(name, handler)       // WS invoke + HTTP API handler
    .on_event(event, handler)     // WS fire-and-forget event handler
    .on(event, handler)           // Lifecycle: "client:connected", "client:disconnected", "client:reconnected"
    .build().await?               // Connects IPC, performs handshake
    .run().await?                 // Message loop (blocking)
```

### Handler Signatures

```rust
// Command: receives params + context, returns Result<Value, String>
type CommandFn = Arc<dyn Fn(Value, AppContext) -> BoxFuture<Result<Value, String>> + Send + Sync>;

// Event: receives data + context, no return
type EventFn = Arc<dyn Fn(Value, AppContext) -> BoxFuture<()> + Send + Sync>;

// Lifecycle: receives context only
type LifecycleHandler = Arc<dyn Fn(AppContext) -> BoxFuture<()> + Send + Sync>;
```

### AppContext

```rust
pub struct AppContext {
    pub session: SessionInfo,          // user_id, username, role, groups
    pub instance_id: Option<String>,   // Some("terminal-1") for WS, None for HTTP
    pub slug: String,                  // "terminal"
    pub data_dir: PathBuf,             // ./data/terminal/
}

impl AppContext {
    /// Broadcast event to all connected instances of this app
    async fn emit(&self, event: &str, payload: Value) -> Result<()>

    /// Send event to a specific instance
    async fn emit_to(&self, instance_id: &str, event: &str, payload: Value) -> Result<()>
}
```

### Per-Instance State Pattern

```rust
// Example: terminal app — one PTY per instance
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

---

## Python SDK

### Installation

```bash
pip install zro-sdk   # or: pip install -e sdks/python
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

### Decorators

```python
@app.command("name")            # WS invoke + HTTP API
@app.on_event("event_name")    # WS fire-and-forget event
@app.on("client:connected")    # Lifecycle hook
@app.on("client:disconnected")
@app.on("client:reconnected")
```

### Parameter Injection

The SDK auto-injects `AppContext` as the first parameter. Remaining parameters are extracted from the JSON `params` dict by name. Type hints are used for coercion. Default values make params optional.

```python
@app.command("add")
async def add(ctx: AppContext, a: int, b: int) -> dict:
    return {"sum": a + b}
# Called as: conn.invoke("add", { a: 2, b: 3 })
```

### AppContext

```python
@dataclass
class AppContext:
    session: SessionInfo        # session_id, user_id, username, role, groups
    instance_id: Optional[str]  # "notes-1" for WS, None for HTTP
    slug: str                   # "notes"
    data_dir: Path              # Path("./data/notes")

    async def emit(event, payload)              # broadcast
    async def emit_to(instance_id, event, payload)  # targeted
    def state(state_type) -> Any                # shared state access
```

### Shared State

```python
class Counter:
    def __init__(self):
        self.value = 0

app = ZroApp()
app.state("counter", Counter())

@app.command("increment")
async def increment(ctx: AppContext):
    counter = ctx.state(Counter)
    counter.value += 1
    return {"count": counter.value}
```

---

## Node.js SDK

### Installation

```bash
npm install zro-sdk   # or: npm link sdks/nodejs
```

### Quick Start

```typescript
import { ZroApp } from 'zro-sdk';
import { AppContext } from 'zro-sdk/context';

const app = new ZroApp();

app.command('greet', async (params: any, ctx: AppContext) => {
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
    registerState(key: string, initial: any): this          // Shared state
    run(): void                                             // Connect + loop
}

// Handler types:
type CommandHandler = (params: any, ctx: AppContext) => Promise<any>;
type EventHandler = (data: any, ctx: AppContext) => Promise<void>;
type LifecycleHandler = (ctx: AppContext) => Promise<void>;
```

### AppContext

```typescript
class AppContext {
    readonly session: SessionInfo;      // sessionId, userId, username, role, groups
    readonly instanceId: string | null; // "files-2" for WS, null for HTTP
    readonly slug: string;              // "files"
    readonly dataDir: string;           // "./data/files"

    emit(event: string, data: any): void          // broadcast
    emitTo(instanceId: string, event: string, data: any): void  // targeted
    state(key: string): any                        // shared state
}
```

---

## Manifest

Every app requires `manifest.toml` in its directory:

```toml
[app]
name = "My App"
slug = "myapp"                  # URL-safe, unique
version = "0.1.0"
description = "What this app does"

[backend]
executable = "zro-app-myapp"    # binary name in ./bin/
transport = "unix_socket"

# For Python/Node.js apps:
# command = "python3"
# args = ["-u"]
# executable = "backend/main.py"

[frontend]
directory = "frontend"
index = "index.html"

[permissions]
roles = ["admin", "user"]       # who can access
capabilities = []               # e.g., "process_spawn", "fs_read_system"
```

Slug rules: `^[a-z0-9]([a-z0-9\-]{0,30}[a-z0-9])?$`. Reserved: `apps, auth, health, static, api, admin, system, _internal, ws`.

## Environment Variables

Set by the runtime for each backend process:

| Variable | Example | Description |
|----------|---------|-------------|
| `ZRO_APP_SLUG` | `terminal` | App slug |
| `ZRO_IPC_SOCKET` | `/tmp/zro/ipc/terminal.sock` | Unix socket path |
| `ZRO_DATA_DIR` | `./data/terminal` | Persistent data directory |
| `ZRO_LOG_LEVEL` | `debug` | Log level |
