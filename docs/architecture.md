# ZRO — Architecture & Protocol

## Architecture Overview

ZRO is a remote desktop framework for Linux. A single **runtime** process (Rust/axum) manages authentication, WebSocket multiplexing, session persistence, and routes requests to **backend processes** — one per app — via Unix Domain Socket IPC.

```
Browser (any number of tabs/windows)
    ↕  HTTPS + 1 WebSocket per session
ZRO Runtime (axum, port 8080)
├── Auth pipeline (Argon2id + JWT HS256)
├── WS Multiplexer (instance-routed frames)
├── Static file server (per-app frontends + shared assets)
├── HTTP API proxy (/{slug}/api/* → IPC)
├── SQLite (sessions, app state persistence)
├── Permissions engine (roles, groups, users)
└── IPC Router (Unix Domain Sockets)
        ↕  length-prefixed JSON
Backend processes (1 per app slug)
    echo | notes | files | terminal | tasks | shell | custom-shell
```

### Key Design Decisions

- **One backend process per app slug** (not per window). Multiple frontend windows connect to the same backend. Each request carries an `instance_id` so the backend can scope state per-window if needed.
- **Single WebSocket per browser session.** The client opens one WS to `/ws` and multiplexes all app traffic through it, routing by `instance` field.
- **Shell is just an app.** The window manager (custom-shell or shell) runs as a regular ZRO app — no special runtime support.
- **Tauri-inspired SDK.** Backend developers declare commands; the SDK handles IPC plumbing.

## Runtime Components

### Gateway (axum)

All routes are defined in `runtime/src/gateway/router.rs`:

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check (public) |
| `/auth/login` | GET, POST | Login page & credential submission |
| `/auth/logout` | POST | Clear session |
| `/auth/refresh` | POST | Refresh JWT token |
| `/auth/me` | GET | Current user info |
| `/` | GET | Redirect to default app |
| `/api/apps` | GET | List accessible apps (JSON) |
| `/apps` | GET | HTML app list |
| `/ws` | GET | WebSocket upgrade |
| `/static/{path}` | GET | Shared static assets (zro-client.js) |
| `/{slug}/` | GET | App index.html |
| `/{slug}/static/{path}` | GET | App static assets |
| `/{slug}/api/{path}` | ANY | HTTP API proxy to backend |
| `/{slug}/{instance_id}/` | GET | App index (multi-instance URL) |
| `/{slug}/{instance_id}/static/{path}` | GET | App static (multi-instance) |
| `/{slug}/{instance_id}/api/{path}` | ANY | API proxy (multi-instance) |

All routes except `/health` and `/auth/*` require authentication (JWT cookie middleware).

### Authentication

- **Password storage:** Argon2id hashes in `config/users.toml`
- **Session:** JWT (HS256) stored in `zro-session` HTTP-only cookie
- **Rate limiting:** 5 attempts per IP per 5 min, 15 min lockout
- **Auth providers:** Local (users.toml) — PAM and LDAP providers exist but are optional
- **Default dev credentials:** `dev` / `dev` (auto-created when `config/users.toml` is absent)

### Permissions

Configured in `config/permissions.toml`. Each app can restrict access by roles, groups, or specific users:

```toml
[global]
admin_bypass = true   # admins always have access

[apps.terminal]
roles = ["admin"]     # terminal restricted to admins

[apps.notes]
roles = ["admin", "user"]
```

Enforcement: static file serving, WS command routing, API proxy, `/api/apps` listing.

### Session Persistence (SQLite)

Apps can persist UI state across browser sessions:
- `state:save(key, value)` — store JSON blob per app+user
- `state:restore(key)` — retrieve stored state
- `state:delete(key)` / `state:keys()` — manage stored keys

Used by the shell to restore window positions on reconnect.

### Supervisor

`runtime/src/supervisor.rs` starts all app backends at launch:

1. Scan `apps/*/manifest.toml` → build registry
2. For each app: create Unix socket → spawn process → wait for Hello handshake
3. Register IPC channel in router → mark app as Running
4. Spawn reader loop for backend messages

Environment variables passed to backends: `ZRO_APP_SLUG`, `ZRO_IPC_SOCKET`, `ZRO_DATA_DIR`, `ZRO_LOG_LEVEL`.

## IPC Protocol

### Transport

Unix Domain Sockets with **length-prefixed JSON** framing:
```
[4 bytes: message length as big-endian u32][JSON payload bytes]
```

Max message size: 16 MiB. Protocol version: 1.

### Message Envelope

```json
{
  "type": "CommandRequest",
  "id": "uuid-v4",
  "timestamp": "2026-03-11T12:00:00Z",
  "payload": { ... }
}
```

### Handshake

```
Backend → Runtime:  Hello     { slug, app_version, protocol_version }
Runtime → Backend:  HelloAck  { status: "ok", runtime_version }
```

### Three Communication Channels

#### 1. WS Invoke (request/response)

Client calls `conn.invoke("command", params)` → runtime wraps as `CommandRequest` → backend replies `CommandResponse`.

```
Client WS:  { type: "invoke", id, instance, command, params }
   → IPC:   CommandRequest { command, params, session, instance_id }
   ← IPC:   CommandResponse { result?, error? }
Client WS:  { type: "response", id, instance, result? | error? }
```

#### 2. WS Events (fire-and-forget)

**Client → Backend:** `conn.emit("event", data)` (no response expected)
```
Client WS:  { type: "emit", instance, event, data }
   → IPC:   WsIn { instance_id, session, event, data }
```

**Backend → Client:** `ctx.emit("event", payload)` (broadcast) or `ctx.emit_to(id, "event", payload)` (targeted)
```
   ← IPC:   EventEmit { event, payload, target: Broadcast | Instance { instance_id } }
Client WS:  { type: "event", event, payload, instance? }
```

#### 3. HTTP API (request/response)

Client calls `ZroClient.api(slug, "GET", "/status")` → runtime proxies to backend via IPC.

```
Client HTTP:  GET /{slug}/api/status
   → IPC:     HttpRequest { method, path, headers, query, body, session }
   ← IPC:     HttpResponse { status, headers, body }
Client HTTP:  200 OK { ... }
```

### Lifecycle Messages

```
Runtime → Backend:  ClientConnected    { instance_id, session }
Runtime → Backend:  ClientReconnected  { instance_id, session }
Runtime → Backend:  ClientDisconnected { instance_id, reason }
Runtime → Backend:  Shutdown           { reason, grace_period_ms }
Backend → Runtime:  ShutdownAck        { status }
```

### WebSocket Client Protocol

Single WS connection to `/ws`. Messages are JSON:

| Direction | Type | Fields |
|-----------|------|--------|
| Client → | `register` | `instance`, `app` |
| Client → | `unregister` | `instance` |
| Client → | `invoke` | `id`, `instance`, `command`, `params` |
| Client → | `emit` | `instance`, `event`, `data` |
| → Client | `registered` | `instance`, `reconnected?` |
| → Client | `response` | `id`, `instance`, `result?`, `error?` |
| → Client | `event` | `event`, `payload`, `instance?` |
| → Client | `error` | `error` |

Auto-reconnect with exponential backoff: 1s → 30s max.

## Configuration

### `config/runtime.toml`

```toml
[server]
host = "0.0.0.0"
port = 8080

[apps]
manifest_dir = "./apps"
data_dir = "./data"
default_app = "custom-shell"

[session]
secret = "dev-secret-change-in-production"
ttl_seconds = 86400
cookie_name = "zro-session"

[auth]
users_file = "./config/users.toml"

[logging]
level = "debug"
format = "pretty"

[supervisor]
shutdown_timeout_seconds = 10
health_check_interval_seconds = 5
max_restart_attempts = 3
```

### `config/users.toml`

```toml
[[users]]
username = "dev"
password_hash = "$argon2id$..."
role = "admin"
groups = []
```

## Repository Structure

```
ZRO/
├── protocol/              # Shared types: messages, manifest, errors
├── runtime/               # axum gateway, supervisor, auth, IPC, SQLite
│   └── src/
│       ├── gateway/       # router, middleware, handlers (ws, static, proxy, auth, apps)
│       ├── ipc/           # channel, router
│       ├── storage/       # SQLite (sessions, app state)
│       └── supervisor.rs  # Process lifecycle
├── sdks/
│   ├── rust/              # Rust SDK + proc macros
│   ├── python/            # Python SDK (asyncio, zero deps)
│   └── nodejs/            # Node.js SDK (TypeScript)
├── apps/
│   ├── echo/              # Test app (all SDK features)
│   ├── terminal/          # PTY terminal (per-instance)
│   ├── notes/             # Markdown notes
│   ├── files/             # File browser
│   ├── tasks/             # Task manager
│   ├── shell/             # Default WM shell
│   └── custom-shell/      # Advanced WM shell (taskbar, launcher)
├── static/                # Shared frontend assets (zro-client.js)
├── config/                # runtime.toml, users.toml, permissions.toml
├── bin/                   # Symlinks to built binaries
└── data/                  # Per-app data directories
```
