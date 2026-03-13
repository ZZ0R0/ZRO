# ZRO

**ZRO** is a structured remote desktop environment for Linux.

A single runtime turns a Linux server into a full desktop accessible via any web browser — each app runs as an isolated backend process, rendered in a window manager shell.

## Architecture

```
Browser (any device)
    ↕  HTTPS + 1 multiplexed WebSocket per session
ZRO Runtime (Rust/axum, port 8090)
├── Auth (Argon2id + JWT)
├── WS Multiplexer (instance-routed)
├── Static file server + HTTP API proxy
├── SQLite (sessions, app state)
├── Control socket (CLI ↔ runtime)
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
# → Builds everything, starts runtime on http://localhost:8090
# → Login: dev / dev

# Production (systemd)
sudo ./scripts/install.sh
sudo systemctl enable --now zro-runtime
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
| **CLI tool** | `zro` — manage apps, users, config at runtime (install, update, remove) |
| **systemd native** | `Type=notify`, watchdog, SIGHUP reload, journald logs |

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
| [Architecture](docs/architecture.md) | Architecture complète, protocole IPC, auth, gateway, stockage |
| [Backend SDK](docs/backend-sdk.md) | Référence Rust + Python + Node.js, modules, auto-routage HTTP |
| [Frontend SDK](docs/frontend-sdk.md) | ZroClient, 20 modules (transport, state, shell, etc.) |
| [App Guide](docs/app-guide.md) | Créer une app, manifeste, patterns, référence des 7 apps |
| [Configuration](docs/configuration.md) | runtime.toml, users.toml, permissions.toml |
| [Deployment](docs/deployment.md) | Systemd service, CLI, production, reverse proxy |

## Testing

```bash
cargo test -p zro-protocol                         # 15 protocol tests
cd sdks/python && python -m pytest tests/ -v       # 33 Python tests
cd sdks/nodejs && npm test                         # 29 Node.js tests
./test_e2e.sh                                      # 26 e2e tests
```

## License

MIT — see [LICENSE](LICENSE).
