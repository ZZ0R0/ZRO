# ZRO — App Development Guide

## Creating a New App

### 1. Directory Structure

```
apps/myapp/
├── manifest.toml              # App metadata & config
├── backend/
│   ├── Cargo.toml             # (Rust) or package.json (Node) or requirements.txt (Python)
│   └── src/main.rs            # Backend entry point
└── frontend/
    ├── index.html             # App UI entry
    ├── style.css
    └── app.js
```

### 2. Manifest (`manifest.toml`)

```toml
[app]
name = "My App"
slug = "myapp"
version = "0.1.0"
description = "A new ZRO application"

[backend]
executable = "zro-app-myapp"
transport = "unix_socket"

[frontend]
directory = "frontend"
index = "index.html"

[permissions]
roles = ["admin", "user"]
capabilities = []
```

For Python:
```toml
[backend]
command = "python3"
args = ["-u"]
executable = "backend/main.py"
transport = "unix_socket"
```

For Node.js:
```toml
[backend]
command = "node"
executable = "backend/dist/main.js"
transport = "unix_socket"
```

### 3. Backend (Rust example)

Add to workspace `Cargo.toml`:
```toml
members = [
    # ...
    "apps/myapp/backend",
]
```

Create `apps/myapp/backend/Cargo.toml`:
```toml
[package]
name = "zro-app-myapp"
version.workspace = true
edition.workspace = true

[[bin]]
name = "zro-app-myapp"
path = "src/main.rs"

[dependencies]
zro_sdk = { path = "../../../sdks/rust" }
tokio = { workspace = true }
serde_json = { workspace = true }
anyhow = { workspace = true }
```

Create `apps/myapp/backend/src/main.rs`:
```rust
use zro_sdk::app::ZroApp;
use zro_sdk::context::AppContext;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = ZroApp::builder()
        .command("hello", |params, ctx: AppContext| {
            Box::pin(async move {
                Ok(serde_json::json!({ "message": "Hello from myapp!" }))
            })
        })
        .build()
        .await?;

    app.run().await?;
    Ok(())
}
```

### 4. Frontend

Create `apps/myapp/frontend/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>My App</title>
</head>
<body>
    <div id="output"></div>
    <script src="/static/zro-client.js"></script>
    <script>
        const conn = ZroClient.connect({
            slug: 'myapp',
            onConnect: async () => {
                const result = await conn.invoke('hello', {});
                document.getElementById('output').textContent = result.message;
            },
        });
    </script>
</body>
</html>
```

### 5. Build & Run

```bash
./run.sh
# Builds all workspace members, symlinks binaries, starts runtime
# Open http://localhost:8080/myapp/
```

---

## URL Routing

Each app is served at `/{slug}/`. Multi-instance URLs use `/{slug}/{instance_id}/`.

| URL | Purpose |
|-----|---------|
| `/{slug}/` | App index.html (default instance) |
| `/{slug}/static/{path}` | App static assets |
| `/{slug}/api/{path}` | HTTP API (proxied to backend) |
| `/{slug}/{instance_id}/` | App index.html (specific instance) |
| `/{slug}/{instance_id}/static/{path}` | Static assets (same files) |
| `/{slug}/{instance_id}/api/{path}` | HTTP API proxy |

The `instance_id` in the URL is used by `zro-client.js` to auto-assign the instance identity. The runtime serves the same files regardless of instance_id — isolation happens at the WebSocket level.

---

## Instance Model

**Key concept:** One backend process handles ALL instances of an app. Every handler receives `instance_id` so the backend can scope state.

### Shared State (default)

All instances share the same data. Example: a chat app — every window sees the same messages.

```rust
// Echo app — shared counter
.command("counter", move |_params, _ctx| {
    let n = state.counter.fetch_add(1, Ordering::SeqCst) + 1;
    Ok(json!({ "count": n }))
})
```

### Per-Instance State

Each window has its own isolated state. Example: terminal — each window is a separate shell.

```rust
// Terminal app — per-instance PTY
type Sessions = Arc<RwLock<HashMap<String, PtySession>>>;

.on("client:connected", move |ctx: AppContext| {
    let id = ctx.instance_id.unwrap();
    sessions.write().await.insert(id, spawn_pty());
})

.command("term_input", move |params, ctx: AppContext| {
    let id = ctx.instance_id.unwrap();
    let session = sessions.read().await.get(&id);
    session.write(params["data"].as_str());
})
```

---

## Reference Apps

### Echo (`echo`)
Test/demo app exercising all SDK features: commands, events, lifecycle, persistence, counters.
- **Backend:** Rust — commands: `status`, `echo`, `counter`, `kv_set/get/list/delete`, `log`, `ping`, `get_clients`
- **Frontend:** Single-page test UI with buttons for each feature

### Terminal (`terminal`)
Full PTY terminal emulator.
- **Backend:** Rust — spawns one PTY per instance using `portable-pty`. Commands: `term_input`, `term_resize`
- **Frontend:** xterm.js terminal emulator + fit addon
- **Pattern:** Per-instance state (each window = separate shell)

### Notes (`notes`)
Markdown notes editor.
- **Backend:** Rust — CRUD on markdown files stored in data_dir. Commands: `list`, `get`, `save`, `delete`
- **Frontend:** Split-pane editor (textarea + rendered preview)

### Files (`files`)
File browser.
- **Backend:** Rust — browse filesystem, read files. Commands: `list_dir`, `read_file`, `get_info`
- **Frontend:** Directory tree + file viewer
- **Capability:** `fs_read_system = true`

### Tasks (`tasks`)
Task/todo manager.
- **Backend:** Rust — JSON-file persistence. Commands: `list`, `add`, `update`, `delete`, `clear_completed`
- **Frontend:** Task list with add/complete/delete

### Shell (`shell`)
Default window manager.
- **Backend:** Rust — minimal (serves app list). Commands: `list_apps`
- **Frontend:** Window manager with taskbar, iframes for apps

### Custom Shell (`custom-shell`)
Advanced window manager with taskbar, launcher, notifications.
- **Backend:** Rust — same as shell. Commands: `list_apps`
- **Frontend:** Full desktop environment:
  - `window-manager.js` — draggable/resizable windows (GPU-composited drag via CSS transform + requestAnimationFrame)
  - `taskbar.js` — bottom taskbar with window buttons + clock
  - `launcher.js` — app grid launcher
  - `desktop.js` — orchestrator (WS connection, state persistence, Shell API handler)
  - State persistence: window positions/sizes saved to SQLite on every change

---

## Docker

### Development

```bash
docker compose -f docker-compose.dev.yml up --build
```

### Production

```bash
docker compose up -d
```

The Dockerfile uses a multi-stage build:
1. **Build stage:** Rust builder compiles all workspace members
2. **Runtime stage:** Debian bookworm-slim with Node.js + Python3, copies binaries + frontends + configs

Environment: `ZRO_CONFIG=/opt/zro/config/runtime.toml`

---

## Testing

```bash
# All Rust tests (protocol + runtime + SDK + apps)
cargo test

# Python SDK tests
cd sdks/python && python -m pytest tests/ -v

# Node.js SDK tests
cd sdks/nodejs && npm test
```

Current: 102 Rust tests + 19 Python tests + 16 Node.js tests = **137 tests**.
