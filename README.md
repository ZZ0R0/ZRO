# ZRO

**A structured remote-desktop environment for Linux — in the browser.**

A single Rust runtime turns a Linux server into a full desktop accessible from any web
browser. Each application runs as an **isolated backend process**; the runtime renders
them in a **window-manager shell** and multiplexes everything over **one WebSocket per
session**. Think "RDP for the web", but where every app is a tiny program talking a
Tauri-style command/event API.

<!-- TODO: add a screenshot / GIF of the desktop shell here -->
<!-- ![ZRO desktop shell](docs/img/desktop.png) -->

[![Rust](https://img.shields.io/badge/runtime-Rust%20%2F%20axum-orange)](runtime/)
[![SDKs](https://img.shields.io/badge/SDKs-Rust%20%C2%B7%20Python%20%C2%B7%20Node.js-blue)](sdks/)
[![systemd](https://img.shields.io/badge/deploy-systemd%20native-informational)]()
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Why

Running GUI apps on a remote Linux box usually means X11 forwarding, VNC, or a full RDP
stack — heavy, stateless, and awkward through a browser. ZRO takes a different angle:
the "desktop" is a web page, the "apps" are isolated processes, and the contract between
them is a small, well-defined IPC protocol. The result is a system that is **scriptable**
(an app is ~100 lines with the SDK), **multi-tenant** (role-based permissions per app),
and **session-persistent** (close the tab, come back, your windows are where you left them).

## Architecture

```mermaid
flowchart TB
    subgraph Client["Browser (any device)"]
        UI["Window-manager shell<br/>taskbar · launcher · draggable windows"]
        FSDK["Frontend SDK<br/>invoke() · listen() · emit()"]
        UI --- FSDK
    end

    FSDK <-->|"HTTPS + 1 multiplexed WebSocket / session"| RT

    subgraph RT["ZRO Runtime — Rust / axum :8090"]
        AUTH["Auth<br/>Argon2id + JWT"]
        MUX["WS Multiplexer<br/>instance-routed frames"]
        STATIC["Static server + HTTP API proxy"]
        DB[("SQLite<br/>sessions · app state")]
        CTRL["Control socket<br/>CLI ↔ runtime"]
        IPC["IPC Router<br/>Unix domain sockets<br/>length-prefixed JSON"]
        AUTH --- MUX --- IPC
        STATIC --- MUX
        DB --- MUX
        CTRL --- IPC
    end

    IPC <-->|"1 process per app slug"| APPS

    subgraph APPS["Backend processes"]
        A1["custom-shell"]
        A2["terminal (PTY)"]
        A3["notes"]
        A4["files"]
        A5["tasks"]
        A6["echo"]
    end

    CLI["zro CLI"] --> CTRL
```

**Key design decisions**

- **One backend per app *slug*, not per window** — multiple windows of "Notes" share a
  single `notes` process; each window is an *instance* with its own ID.
- **One WebSocket per session** — all app traffic is multiplexed and instance-routed over
  a single connection; no socket-per-window fan-out.
- **The shell is just an app** — the desktop/window-manager (`custom-shell`) uses the same
  SDK and IPC as every other app; nothing about it is privileged in the protocol.
- **Tauri-inspired SDK** — backends register `.command("name", handler)`; the frontend
  calls `invoke("name", args)` and subscribes with `listen()` / `emit()`. HTTP routes are
  auto-routed through the runtime's API proxy.
- **systemd-native** — `Type=notify`, watchdog, `SIGHUP` reload, journald logging.

### Request / frame flow

```mermaid
sequenceDiagram
    participant B as Browser (Frontend SDK)
    participant R as Runtime (axum + WS mux)
    participant A as App process (Backend SDK)
    B->>R: WS frame { instance, "invoke", cmd, args }
    R->>R: auth (JWT) + permissions.toml check
    R->>A: IPC (UDS, length-prefixed JSON) { instance, cmd, args }
    A-->>R: IPC result / error
    R-->>B: WS frame { instance, "result", payload }
    A-->>R: IPC event { instance, "emit", topic, data }
    R-->>B: WS frame { instance, "event", topic, data }
```

## Quick start

```bash
# Local development — builds everything, starts the runtime on http://localhost:8090
./run.sh
# default login: dev / dev

# Production (systemd)
sudo ./scripts/install.sh
sudo systemctl enable --now zro-runtime
zro --help          # manage apps, users, config against a live runtime
```

## Features

| Feature | Description |
|---|---|
| **Tauri-style backend SDK** | `.command("name", handler)` — define commands, the SDK handles IPC framing |
| **Frontend SDK** | `invoke()` / `listen()` / `emit()` — call the backend and stream events from JS |
| **Multi-language backends** | SDKs for **Rust**, **Python**, **Node.js** |
| **Window manager** | Desktop shell with draggable windows, taskbar, launcher |
| **Session persistence** | Close the browser → reopen → your apps are exactly where you left them |
| **Multi-instance** | Several windows per app, each with a unique instance ID |
| **Shell API** | Apps control their own window: title, badge, notifications, focus |
| **Permissions** | Role-based access per app via `permissions.toml` |
| **`zro` CLI** | Install / update / remove apps, manage users and config |
| **systemd native** | `Type=notify`, watchdog, `SIGHUP` reload, journald logs |

## Built-in apps

| App | Description | Roles |
|---|---|---|
| **custom-shell** | Desktop WM with taskbar & launcher | all |
| **terminal** | Full PTY terminal (per-window shell) | admin |
| **notes** | Markdown editor | admin, user |
| **files** | File browser | admin, user |
| **tasks** | Task manager | admin, user |
| **echo** | Reference app exercising every SDK feature | admin, user |

## Repository layout

```text
runtime/   Rust/axum runtime: auth, WS multiplexer, IPC router, static server
protocol/  zro-protocol crate: wire types shared by runtime ↔ apps ↔ SDKs
sdks/      Backend SDKs (rust, python, nodejs) + the frontend JS SDK
apps/      The built-in apps (custom-shell, terminal, notes, files, tasks, echo)
cli/       The `zro` command-line tool
config/    runtime.toml · users.toml · permissions.toml
system/    systemd unit + install assets
docs/      Architecture, IPC protocol, SDK references, app guide, deployment
```

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full architecture, IPC protocol, auth, gateway, storage |
| [docs/backend-sdk.md](docs/backend-sdk.md) | Rust / Python / Node.js reference, modules, HTTP auto-routing |
| [docs/frontend-sdk.md](docs/frontend-sdk.md) | `ZroClient`, the 20 frontend modules (transport, state, shell, …) |
| [docs/app-guide.md](docs/app-guide.md) | Building an app: manifest, patterns, reference of the 7 apps |
| [docs/configuration.md](docs/configuration.md) | `runtime.toml`, `users.toml`, `permissions.toml` |
| [docs/deployment.md](docs/deployment.md) | systemd service, CLI, production, reverse proxy |

## Testing

```bash
cargo test -p zro-protocol                      # protocol tests
cd sdks/python && python -m pytest tests/ -v    # Python SDK tests
cd sdks/nodejs && npm test                      # Node.js SDK tests
./test_e2e.sh                                   # end-to-end tests
```

## Status

Active. Single-binary runtime; production install via systemd. See `todo.md` for the
current backlog.

## License

[MIT](LICENSE)

---

<sub>Part of my work — more at <a href="https://zz0r0.fr">zz0r0.fr</a>.</sub>
