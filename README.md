# ZRO

**ZRO** is a structured remote desktop environment for Linux.

A single runtime turns a Linux server into a full desktop accessible via any web browser — each app runs as an isolated backend process, rendered in a window manager shell.

## Architecture

```
Browser (any device)
    ↕  HTTPS + 1 multiplexed WebSocket per session
ZRO Runtime (Rust/axum, port 8080)
├── Auth (Argon2id + JWT)
├── WS Multiplexer (instance-routed)
├── Static file server + HTTP API proxy
├── SQLite (sessions, app state)
└── IPC Router (Unix Domain Sockets, length-prefixed JSON)
        ↕
Backend processes (1 per app)
    echo │ terminal │ notes │ files │ tasks │ shell │ custom-shell
```

**Key decisions:** one backend per app slug (not per window), single WS per session, shell is just an app, Tauri-inspired SDK.

## Quick Start

```bash
# Local development
./run.sh
# → Builds everything, starts runtime on http://localhost:8080
# → Login: dev / dev

# Docker
docker compose up -d
```

## Features

| Feature | Description |
|---------|-------------|
| **Tauri-style SDK** | `.command("name", handler)` — define commands, SDK handles IPC |
| **Frontend SDK** | `invoke()` / `listen()` / `emit()` — call backend from JS |
| **Multi-language** | Backend SDKs for Rust, Python, Node.js |
| **Window Manager** | Desktop shell with draggable windows, taskbar, launcher |
| **Session persistence** | RDP-like: close browser → reopen → find your apps as you left them |
| **Multi-instance** | Multiple windows per app, each with unique instance ID |
| **Shell API** | Apps control their window: title, badge, notifications, focus |
| **Permissions** | Role-based access per app via `permissions.toml` |

## Apps

| App | Description | Roles |
|-----|-------------|-------|
| **Custom Shell** | Desktop WM with taskbar & launcher | all |
| **Terminal** | Full PTY terminal (per-window shell) | admin |
| **Notes** | Markdown editor | admin, user |
| **Files** | File browser | admin, user |
| **Tasks** | Task manager | admin, user |
| **Echo** | Test app (all SDK features) | admin, user |

## Documentation

| Doc | Description |
|-----|-------------|
| [Architecture](docs/architecture.md) | Architecture, protocol, IPC, auth, config, repo structure |
| [Backend SDK](docs/backend-sdk.md) | Rust + Python + Node.js SDK reference |
| [Frontend SDK](docs/frontend-sdk.md) | zro-client.js API, Shell API, state persistence |
| [App Guide](docs/app-guide.md) | Create apps, manifests, URL routing, reference apps |

## Testing

```bash
cargo test                                         # 102 Rust tests
cd sdks/python && python -m pytest tests/ -v       # 19 Python tests
cd sdks/nodejs && npm test                         # 16 Node.js tests
```

## License

MIT — see [LICENSE](LICENSE).
