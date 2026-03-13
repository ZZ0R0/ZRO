# ZRO — Plan de migration : Service système + CLI

> Document de spécification — v1.0 — Mars 2026  
> Objectif : Remplacer Docker par un service natif Linux + un outil CLI pour piloter le runtime et gérer les applications déployées.
>
> **✅ IMPLÉMENTÉ** — Ce plan a été entièrement réalisé. Voir [deployment.md](deployment.md) pour la documentation opérationnelle et [architecture.md](architecture.md) pour la documentation technique.

---

## Table des matières

1. [Vision et philosophie](#1-vision-et-philosophie)
2. [Architecture actuelle (Docker)](#2-architecture-actuelle-docker)
3. [Architecture cible (Service natif)](#3-architecture-cible-service-natif)
4. [Le service `zro-runtime` (systemd)](#4-le-service-zro-runtime-systemd)
5. [L'outil CLI `zro`](#5-loutil-cli-zro)
6. [Gestion des applications — cycle de vie complet](#6-gestion-des-applications--cycle-de-vie-complet)
7. [Arborescence fichiers cible](#7-arborescence-fichiers-cible)
8. [API de contrôle interne](#8-api-de-contrôle-interne)
9. [Question root vs non-root](#9-question-root-vs-non-root)
10. [Sécurité](#10-sécurité)
11. [Modifications code par fichier](#11-modifications-code-par-fichier)
12. [Plan d'exécution](#12-plan-dexécution)

---

## 1. Vision et philosophie

ZRO est un **environnement de bureau web complet**, comparable à GNOME ou XFCE mais accessible depuis un navigateur. Comme tout environnement de bureau, il doit :

- Tourner **en tant que service système** (comme `gdm`, `sddm`, `lightdm`)
- Être installable via un **paquet** ou un simple `make install`
- Avoir un **outil CLI** unique pour administrer le tout (comme `systemctl`, `dpkg`, `flatpak`)
- Supporter le **déploiement d'applications à chaud** (comme `flatpak install`, `snap install`)
- Gérer les **mises à jour** sans tout casser

L'analogie exacte :

```
┌───────────────────────────────────────────────────────────┐
│         Environnement de bureau classique                 │
│                                                           │
│  systemd          →  lance le display manager             │
│  gdm/sddm        →  authentifie, lance la session        │
│  gnome-shell      →  le window manager (shell)            │
│  flatpak/snap     →  installe/gère les applications       │
│  gsettings        →  configure le bureau                  │
│                                                           │
├───────────────────────────────────────────────────────────┤
│         ZRO (équivalent web)                              │
│                                                           │
│  systemd          →  lance zro-runtime                    │
│  zro-runtime      →  authentifie (JWT), route HTTP/WS     │
│  shell app        →  window manager dans le navigateur     │
│  zro cli          →  installe/gère les applications        │
│  runtime.toml     →  configure le bureau                  │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Architecture actuelle (Docker)

### Ce que Docker fait aujourd'hui

```
docker-compose.yml
├── Image : debian:bookworm-slim
├── User : zro:zro (non-root, UID système)
├── Workdir : /opt/zro/
├── Port : 8080:8080
├── Volumes :
│   ├── zro-data:/opt/zro/data     (SQLite + données apps)
│   └── zro-ipc:/tmp/zro/ipc       (sockets Unix, éphémère)
├── Env :
│   ├── ZRO_CONFIG=/opt/zro/config/runtime.toml
│   └── RUST_LOG=info
├── Healthcheck : curl http://localhost:8080/health
└── CMD : zro-runtime
```

### Séquence de démarrage actuelle

```
[Container start]
  │
  ├── 1. Load config       ← runtime.toml (figé à la build)
  ├── 2. Init logging      ← tracing + RUST_LOG
  ├── 3. Load users        ← users.toml (local auth)
  ├── 4. Build auth pipe   ← local | pam | ldap
  ├── 5. Load permissions  ← permissions.toml (RBAC)
  ├── 6. Init JWT          ← Ed25519 keypair
  ├── 7. Scan manifests    ← apps/*/manifest.toml (TOUS d'un coup)
  ├── 8. Build registry    ← HashMap<slug, AppEntry>
  ├── 9. Create state      ← Arc<RwLock<...>> shared state
  ├── 10. Init SQLite      ← data/zro.db + migrations
  ├── 11. Spawn cleanup    ← sessions/tokens expirés
  ├── 12. Hot reload       ← (dev only) watch frontends
  ├── 13. Start backends   ← spawn 7 processus + IPC handshake
  ├── 14. Start HTTP       ← axum sur 0.0.0.0:8080
  └── 15. Signal handler   ← SIGINT → shutdown gracieux
```

### Limites de l'approche Docker

| Problème | Impact |
|----------|--------|
| **Pas d'auth PAM** | Impossible d'utiliser les comptes système Linux |
| **Pas d'accès PTY natif** | Terminal bridé, pas de vrai shell système |
| **Isolation excessive** | L'app Files ne voit pas le vrai FS |
| **Déploiement statique** | Toute modification = rebuild image |
| **Pas de CLI admin** | Administration par `docker exec` uniquement |
| **Pas de hot-deploy** | Impossible d'ajouter une app sans redémarrer |
| **Réseau isolé** | Pas d'accès aux services locaux (DBus, etc.) |

---

## 3. Architecture cible (Service natif)

```
                    ┌──────────────────────────────────┐
                    │          systemd                  │
                    │  zro-runtime.service (Type=notify)│
                    └──────────┬───────────────────────┘
                               │ ExecStart=/usr/bin/zro-runtime
                               │ User=zro  Group=zro
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      zro-runtime (PID unique)                    │
│                                                                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐   │
│  │ Gateway  │  │ Auth     │  │ IPC      │  │ Supervisor     │   │
│  │ (axum)  │  │ Pipeline │  │ Router   │  │ (backends)     │   │
│  │ :8080   │  │ PAM/LDAP │  │          │  │                │   │
│  └────┬────┘  └──────────┘  └─────┬────┘  └───────┬────────┘   │
│       │                           │                │             │
│       │  ┌────────────────────────┤                │             │
│       │  │  Control Socket        │                │             │
│       │  │  /run/zro/control.sock │                │             │
│       │  │  (CLI ↔ Runtime)       │                │             │
│       │  └────────────────────────┘                │             │
│       │                                            │             │
│       │    ┌─────────────────┐  ┌──────────────┐   │             │
│       │    │ App: terminal   │  │ App: files   │   │             │
│       │    │ PID: 4521       │  │ PID: 4522    │   │             │
│       │    │ IPC: slug.sock  │  │ IPC: slug.sock   │             │
│       │    └─────────────────┘  └──────────────┘   │             │
│       │                                            │             │
└───────┼────────────────────────────────────────────┼─────────────┘
        │                                            │
        ▼                                            ▼
   ┌─────────┐                              ┌──────────────┐
   │ Browser  │◄─── HTTP/WS ──────────────► │ Backend PIDs │
   │ (client) │                              │ (apps)       │
   └─────────┘                              └──────────────┘

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   ┌─────────────────────────────────────────────────┐
   │                  zro (CLI)                       │
   │                                                  │
   │  zro status          →  état du runtime          │
   │  zro app list        →  apps déployées           │
   │  zro app install X   →  déployer une app         │
   │  zro app remove X    →  retirer une app          │
   │  zro app start X     →  démarrer un backend      │
   │  zro app stop X      →  arrêter un backend       │
   │  zro logs X          →  voir les logs            │
   │  zro config show     →  lire la config           │
   │                                                  │
   │  Communique via /run/zro/control.sock            │
   └─────────────────────────────────────────────────┘
```

### Différence fondamentale avec Docker

| Aspect | Docker | Service natif |
|--------|--------|---------------|
| Auth | local uniquement | PAM → comptes système |
| FS | volume isolé | vrai filesystem |
| Terminal | bridé | PTY natif, vrai bash |
| Apps | figées dans l'image | installées/mises à jour à chaud |
| Admin | `docker exec` | `zro` CLI dédié |
| Logs | `docker logs` | journald natif |
| Réseau | NAT bridge | accès direct localhost |
| DBus | impossible | accès direct (future: notifications) |
| Startup | ~5s (container) | ~1s (process direct) |

---

## 4. Le service `zro-runtime` (systemd)

### 4.1 Fichier unit systemd

```ini
# /etc/systemd/system/zro-runtime.service
[Unit]
Description=ZRO Web Desktop Environment
Documentation=https://github.com/xxx/zro
After=network.target
Wants=network-online.target

[Service]
Type=notify
User=zro
Group=zro
SupplementaryGroups=tty video audio

# Chemins
WorkingDirectory=/opt/zro
ExecStart=/usr/bin/zro-runtime
ExecReload=/bin/kill -HUP $MAINPID

# Environnement
Environment=ZRO_CONFIG=/etc/zro/runtime.toml
Environment=RUST_LOG=info

# Sécurité (sandboxing léger)
ProtectSystem=strict
ReadWritePaths=/var/lib/zro /run/zro /tmp/zro
ProtectHome=read-only
NoNewPrivileges=true
PrivateTmp=false
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Restart
Restart=on-failure
RestartSec=5s
WatchdogSec=30s

# Limites
LimitNOFILE=65536
LimitNPROC=4096

# Journalisation
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zro

[Install]
WantedBy=multi-user.target
```

### 4.2 Modifications nécessaires dans `zro-runtime`

Le runtime doit supporter le **protocole sd_notify** pour informer systemd qu'il est prêt :

```
Startup amélioré :
1. Load config
2. Init logging
3. ...
13. Start backends (tous handshakes OK)
14. Start HTTP server
15. ★ sd_notify("READY=1")              ← NOUVEAU
16. ★ Watchdog loop (WATCHDOG=1)         ← NOUVEAU
17. Signal handler : SIGTERM → shutdown
                     SIGHUP  → reload config  ← NOUVEAU
```

### 4.3 Socket de contrôle (NOUVEAU)

Un **socket Unix** dédié à la communication CLI ↔ Runtime :

```
/run/zro/control.sock    (mode 0660, proprio zro:zro)
```

Protocole : **JSON lignes** (newline-delimited JSON), comme le protocole IPC existant mais pour l'administration.

```
Messages CLI → Runtime :

  {"cmd": "status"}
  {"cmd": "app.list"}
  {"cmd": "app.install", "slug": "my-app", "path": "/tmp/zro-upload/my-app"}
  {"cmd": "app.remove", "slug": "my-app"}
  {"cmd": "app.start", "slug": "my-app"}
  {"cmd": "app.stop", "slug": "my-app"}
  {"cmd": "app.info", "slug": "my-app"}
  {"cmd": "app.logs", "slug": "my-app", "lines": 50}
  {"cmd": "config.show"}
  {"cmd": "config.reload"}
  {"cmd": "user.list"}
  {"cmd": "user.add", "username": "alice", "role": "user"}
  {"cmd": "user.remove", "username": "alice"}

Réponses Runtime → CLI :

  {"ok": true, "data": {...}}
  {"ok": false, "error": "app 'xyz' not found"}
```

Ce socket est indépendant du gateway HTTP. C'est un canal de contrôle **local uniquement**, non exposé sur le réseau. Il remplace l'API REST `/api/apps/register` et `/api/apps/{slug}/unregister` qu'on vient d'ajouter (qui restent disponibles pour l'administration web, mais le CLI passe par le socket pour éviter de toucher à l'auth JWT).

### 4.4 Rechargement de configuration (SIGHUP)

```
SIGHUP → Runtime
  │
  ├── Recharger runtime.toml (certains champs seulement)
  │   ├── ✓ logging.level (changement à chaud)
  │   ├── ✓ permissions.toml (RBAC)
  │   ├── ✓ users.toml (comptes locaux)
  │   ├── ✓ supervisor.* (timeouts)
  │   ├── ✗ server.port (nécessite restart)
  │   ├── ✗ auth.jwt_algorithm (nécessite restart)
  │   └── ✗ storage.path (nécessite restart)
  │
  └── Log "Configuration reloaded"
```

---

## 5. L'outil CLI `zro`

### 5.1 Philosophie

Un **unique binaire** `zro` qui fait tout. Inspiré de `systemctl`, `flatpak`, `docker`.

```
/usr/bin/zro              ← binaire CLI (~2 MB)
/usr/bin/zro-runtime      ← le service (~15 MB)
/usr/bin/zro-app-*        ← backends des apps system
```

Le CLI communique avec le runtime **exclusivement** via le control socket `/run/zro/control.sock`. Aucun appel HTTP, aucun JWT.

### 5.2 Commandes complètes

```
zro — ZRO Web Desktop Manager

USAGE:
    zro <COMMAND>

COMMANDS:

  Statut et informatons :
  ──────────────────────
    zro status                 Vue globale : runtime up/down, version, uptime,
                               nombre d'apps, port, utilisateurs connectés

    zro version                Version du CLI et du runtime (via socket)

  Gestion des applications :
  ──────────────────────────
    zro app list               Liste toutes les apps installées avec leur état
                               (running/stopped/error), version, PID backend

    zro app info <slug>        Détail complet d'une app : manifest, état, PID,
                               mémoire utilisée, uptime, chemin frontend

    zro app install <source>   Installe une nouvelle application
                               <source> peut être :
                                 • Un chemin local : ./my-app/ ou /tmp/my-app.tar.gz
                                 • Un slug dans un dépôt (futur) : repo:my-app
                               Action :
                                 1. Valide manifest.toml
                                 2. Copie dans /opt/zro/apps/<slug>/
                                 3. Copie binaire backend dans /opt/zro/bin/
                                 4. Enregistre dans le registry
                                 5. Démarre le backend
                                 6. Affiche "✓ App 'my-app' installed and running"

    zro app remove <slug>      Arrête et supprime une application
                                 1. Stop le backend (gracieux)
                                 2. Retire du registry
                                 3. Supprime /opt/zro/apps/<slug>/
                                 4. Supprime le binaire /opt/zro/bin/<exe>
                                 5. Conserve /var/lib/zro/data/<slug>/ (données)
                                 ⚠ Demande confirmation (sauf --yes)

    zro app start <slug>       Démarre le backend d'une app arrêtée

    zro app stop <slug>        Arrête le backend d'une app (gracieux)

    zro app restart <slug>     Stop + Start

    zro app update <slug> <source>
                               Met à jour une app existante :
                                 1. Stop le backend
                                 2. Remplace les fichiers (manifest, frontend, binaire)
                                 3. Redémarre le backend
                                 ⚠ Conserve les données

    zro app logs <slug>        Affiche les logs récents du backend (via journald)
                               Options : --follow (-f), --lines (-n) 50

  Configuration :
  ───────────────
    zro config show            Affiche la config active (runtime.toml parsé)
    zro config edit            Ouvre $EDITOR sur /etc/zro/runtime.toml
    zro config reload          Envoie SIGHUP au runtime (recharge ce qui peut l'être)
    zro config path            Affiche le chemin du fichier de config actif

  Utilisateurs (auth locale) :
  ────────────────────────────
    zro user list              Liste les utilisateurs locaux (users.toml)
    zro user add <name>        Ajoute un utilisateur (prompt mot de passe)
                               Options : --role admin|user, --groups dev,ops
    zro user remove <name>     Supprime un utilisateur
    zro user passwd <name>     Change le mot de passe

  Logs et diagnostic :
  ────────────────────
    zro logs                   Raccourci : journalctl -u zro-runtime
    zro logs --follow          journalctl -fu zro-runtime
    zro doctor                 Vérifie l'installation :
                                 • Runtime joignable ? (control socket)
                                 • Config valide ?
                                 • JWT keys présentes ?
                                 • SQLite accessible ?
                                 • Toutes les apps en "running" ?
                                 • Port 8080 accessible ?

FLAGS GLOBAUX:
    --json                     Sortie JSON (pour scripting)
    --quiet (-q)               Sortie minimale
    --verbose (-v)             Détails supplémentaires
    --socket <path>            Socket de contrôle alternatif
                               (défaut : /run/zro/control.sock)
```

### 5.3 Exemples d'utilisation

```bash
# Installation du système
sudo apt install zro              # ou make install
sudo systemctl enable --now zro-runtime

# Voir l'état
zro status
# ┌─────────────────────────────────┐
# │ ZRO Web Desktop    v0.1.0      │
# │ Status: running    Uptime: 2h  │
# │ Port: 8080         PID: 1234   │
# │ Apps: 7 running / 0 stopped    │
# │ Users online: 2                │
# └─────────────────────────────────┘

# Lister les apps
zro app list
# SLUG           NAME          VERSION  STATE    PID
# echo           Echo          0.1.0    running  4501
# notes          Notes         0.1.0    running  4502
# files          Files         0.1.0    running  4503
# terminal       Terminal      0.1.0    running  4504
# tasks          Tasks         0.1.0    running  4505
# shell          Shell         0.1.0    running  4506
# custom-shell   Custom Shell  0.1.0    running  4507

# Installer une nouvelle app depuis un dossier
zro app install ./my-calculator-app/
# ✓ Manifest validated: calculator v1.0.0
# ✓ Files copied to /opt/zro/apps/calculator/
# ✓ Binary installed: /opt/zro/bin/zro-app-calculator
# ✓ Backend started (PID 4820)
# ✓ App 'calculator' is now running

# Installer depuis une archive
zro app install ./my-app.tar.gz
# ✓ Extracted to /tmp/zro-staging/my-app/
# ✓ Manifest validated: my-app v2.1.0
# ...

# Mettre à jour
zro app update notes ./notes-v2/
# ✓ Stopping notes backend...
# ✓ Files updated
# ✓ Backend restarted (PID 4830)

# Supprimer une app
zro app remove echo
# ⚠ This will remove app 'echo' (Echo v0.1.0)
#   Data in /var/lib/zro/data/echo/ will be preserved.
#   Continue? [y/N] y
# ✓ Backend stopped
# ✓ App files removed
# ✓ App 'echo' unregistered

# Gérer les utilisateurs
zro user add alice --role user --groups developers
# Password: ********
# Confirm:  ********
# ✓ User 'alice' created

# Diagnostic
zro doctor
# ✓ Runtime reachable via /run/zro/control.sock
# ✓ Configuration valid (/etc/zro/runtime.toml)
# ✓ JWT keys present (/etc/zro/jwt_keys/)
# ✓ SQLite database accessible (/var/lib/zro/zro.db)
# ✓ 7/7 apps running
# ✓ Port 8080 listening
# All checks passed.
```

### 5.4 Structure interne du CLI

```
src/
├── main.rs          ← clap::Parser, dispatch des commandes
├── client.rs        ← Connexion au control socket + send/recv JSON
├── commands/
│   ├── status.rs
│   ├── app.rs       ← install, remove, start, stop, list, info, update, logs
│   ├── config.rs    ← show, edit, reload, path
│   ├── user.rs      ← list, add, remove, passwd
│   ├── logs.rs      ← wrapper journalctl
│   └── doctor.rs    ← diagnostics
├── output.rs        ← Formatage table/json/quiet
└── staging.rs       ← Extraction archives, validation, copie fichiers
```

Le CLI sera un **crate supplémentaire** dans le workspace :

```toml
# cli/Cargo.toml
[package]
name = "zro-cli"
version = "0.1.0"

[[bin]]
name = "zro"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
tabled = "0.15"          # tableaux formatés terminal
indicatif = "0.17"       # barres de progression
argon2 = "0.5"           # hash password (user add)
dialoguer = "0.11"       # prompts interactifs (confirm, password)
flate2 = "1"             # décompression tar.gz
tar = "0.4"              # extraction archives
```

---

## 6. Gestion des applications — Cycle de vie complet

### 6.1 Structure d'un paquet application

Ce qu'un développeur fournit pour déployer une app :

```
my-app/
├── manifest.toml           ← OBLIGATOIRE : métadonnées
├── backend/
│   └── zro-app-my-app      ← Binaire backend (ou script Python/Node)
└── frontend/
    ├── index.html           ← OBLIGATOIRE : point d'entrée
    ├── app.js               ← JavaScript
    ├── app.css              ← Styles
    ├── icon.svg             ← Icône (pour le shell)
    └── ...                  ← Autres assets
```

Ou en archive :

```
my-app.tar.gz
└── my-app/
    ├── manifest.toml
    ├── backend/
    │   └── zro-app-my-app
    └── frontend/
        └── ...
```

### 6.2 Processus d'installation (`zro app install`)

```
zro app install ./my-app/
        │
        ▼
┌─ ÉTAPE 1 : Validation (côté CLI) ──────────────────────┐
│                                                          │
│  • Si archive (.tar.gz) → extraire dans /tmp/zro-stage/ │
│  • Lire manifest.toml                                    │
│  • Vérifier format : slug validé (regex [a-z0-9-]+)     │
│  • Vérifier pas de slug réservé (ws, api, auth, static) │
│  • Vérifier backend/ existe + binaire accessible         │
│  • Vérifier frontend/index.html existe                   │
│  • Vérifier le slug pas déjà installé (via socket)       │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌─ ÉTAPE 2 : Copie des fichiers (côté CLI) ───────────────┐
│                                                          │
│  Copier vers zone de staging temporaire :                │
│  /tmp/zro-staging/<slug>/                                │
│    ├── manifest.toml                                     │
│    ├── frontend/ (tout le dossier)                       │
│    └── backend/<executable>                              │
└──────────────┬───────────────────────────────────────────┘
               │
               ▼
┌─ ÉTAPE 3 : Envoyer au runtime (via control socket) ─────┐
│                                                          │
│  CLI → {"cmd": "app.install",                            │
│         "slug": "my-app",                                │
│         "staging_path": "/tmp/zro-staging/my-app"}       │
│                                                          │
│  Le runtime fait :                                       │
│    1. mv staging → /opt/zro/apps/<slug>/                 │
│    2. chmod +x backend binaire                           │
│    3. symlink /opt/zro/bin/<exe> → apps/<slug>/backend/  │
│    4. Load manifest.toml dans le registry                │
│    5. start_single_backend()                             │
│    6. Répondre {"ok": true, "pid": 4820}                 │
│                                                          │
│  Runtime → {"ok": true, "data": {"pid": 4820}}          │
└──────────────────────────────────────────────────────────┘
```

### 6.3 Processus de mise à jour (`zro app update`)

```
zro app update notes ./notes-v2/
  │
  ├── 1. Valider le nouveau paquet (même slug)
  ├── 2. CLI → runtime : {"cmd": "app.stop", "slug": "notes"}
  ├── 3. Runtime arrête le backend, confirme
  ├── 4. CLI staging des nouveaux fichiers
  ├── 5. CLI → runtime : {"cmd": "app.update",
  │                        "slug": "notes",
  │                        "staging_path": "/tmp/zro-staging/notes"}
  ├── 6. Runtime remplace les fichiers (manifest + frontend + binaire)
  │      ⚠ NE TOUCHE PAS à /var/lib/zro/data/notes/ (données)
  ├── 7. Runtime redémarre le backend
  └── 8. Runtime → CLI : {"ok": true, "data": {"pid": 4830}}
```

### 6.4 Processus de suppression (`zro app remove`)

```
zro app remove echo
  │
  ├── 1. CLI affiche confirmation
  ├── 2. CLI → runtime : {"cmd": "app.remove", "slug": "echo"}
  ├── 3. Runtime :
  │      a. stop_single_backend("echo")
  │      b. unregister_app("echo")
  │      c. Supprimer /opt/zro/apps/echo/
  │      d. Supprimer symlink /opt/zro/bin/zro-app-echo
  │      e. GARDER /var/lib/zro/data/echo/ (sécurité)
  └── 4. Runtime → CLI : {"ok": true}
```

### 6.5 Diagramme d'états d'une application

```
                     install
           ┌──────────────────────┐
           ▼                      │
     ┌──────────┐          ┌─────┴─────┐
     │ Loading  │────ok───►│  Running  │
     └──────────┘          └─────┬─────┘
           │                     │
         error              stop │ restart
           │                     │     │
           ▼               ┌─────▼─────┐
     ┌──────────┐          │  Stopping │
     │  Error   │          └─────┬─────┘
     └──────────┘                │
           ▲                     ▼
           │               ┌──────────┐
           └──error────────│  Stopped  │
                           └──────────┘
                                 │
                              remove
                                 │
                                 ▼
                           ┌──────────┐
                           │ (deleted)│
                           └──────────┘
```

---

## 7. Arborescence fichiers cible

### Installation système (paquets)

```
/usr/bin/
├── zro                     ← CLI (nouveau)
├── zro-runtime             ← Service
├── zro-app-echo            ← Apps système (fournies par défaut)
├── zro-app-notes
├── zro-app-files
├── zro-app-terminal
├── zro-app-tasks
├── zro-app-shell
└── zro-app-custom-shell

/etc/zro/                    ← Configuration (admin-editable)
├── runtime.toml
├── users.toml
├── permissions.toml
└── jwt_keys/
    ├── private.pem
    └── public.pem

/opt/zro/                    ← Applications installées
├── apps/
│   ├── echo/
│   │   ├── manifest.toml
│   │   ├── frontend/
│   │   │   └── index.html
│   │   └── backend/        ← NOUVEAU : binaire local (ou symlink)
│   │       └── zro-app-echo → /usr/bin/zro-app-echo
│   ├── notes/
│   │   ├── manifest.toml
│   │   ├── frontend/
│   │   └── backend/
│   ├── ... (7 apps système)
│   └── my-custom-app/      ← App installée dynamiquement
│       ├── manifest.toml
│       ├── frontend/
│       └── backend/
│           └── zro-app-my-custom-app
├── bin/                     ← Symlinks vers les exécutables (résolution rapide)
│   ├── zro-app-echo → /usr/bin/zro-app-echo
│   ├── zro-app-notes → /usr/bin/zro-app-notes
│   └── zro-app-my-custom-app → ../apps/my-custom-app/backend/zro-app-my-custom-app
└── static/                  ← Assets partagés (SDK frontend)
    ├── zro-client.js
    ├── zro-base.css
    └── zro-shared-worker.js

/var/lib/zro/                ← Données persistantes
├── zro.db                   ← SQLite (sessions, tokens, state)
└── data/
    ├── echo/                ← Données de chaque app
    ├── notes/
    │   └── notes/           ← Fichiers markdown
    ├── files/
    └── my-custom-app/

/run/zro/                    ← Données runtime (tmpfs, éphémère)
├── control.sock             ← Socket de contrôle CLI ↔ Runtime
└── ipc/
    ├── echo.sock            ← Sockets IPC backend
    ├── notes.sock
    └── ...

/var/log/                    ← (via journald, pas de fichiers directs)
```

### Comparaison avec la structure actuelle

```
ACTUEL (développement)         →  CIBLE (production)
──────────────────────         ────────────────────
./config/runtime.toml          →  /etc/zro/runtime.toml
./config/users.toml            →  /etc/zro/users.toml
./config/permissions.toml      →  /etc/zro/permissions.toml
./config/jwt_keys/             →  /etc/zro/jwt_keys/
./apps/                        →  /opt/zro/apps/
./bin/                         →  /opt/zro/bin/
./static/                      →  /opt/zro/static/
./data/                        →  /var/lib/zro/data/
./data/zro.db                  →  /var/lib/zro/zro.db
/tmp/zro-ipc/ ou /tmp/zro/ipc →  /run/zro/ipc/
(inexistant)                   →  /run/zro/control.sock
(inexistant)                   →  /usr/bin/zro (CLI)
```

---

## 8. API de contrôle interne

### 8.1 Protocole du control socket

Le control socket (`/run/zro/control.sock`) utilise le **même format** que le protocole IPC existant : préfixe de longueur 4 octets (big-endian) + JSON.

Cela permet de réutiliser le code `IpcChannel` déjà en place.

### 8.2 Messages — Spécification complète

#### status

```json
// Requête
{"cmd": "status"}

// Réponse
{
  "ok": true,
  "data": {
    "version": "0.1.0",
    "uptime_seconds": 7200,
    "pid": 1234,
    "port": 8080,
    "mode": "production",
    "apps_running": 7,
    "apps_stopped": 0,
    "apps_error": 0,
    "active_sessions": 2,
    "active_ws_connections": 3
  }
}
```

#### app.list

```json
// Requête
{"cmd": "app.list"}

// Réponse
{
  "ok": true,
  "data": {
    "apps": [
      {
        "slug": "terminal",
        "name": "Terminal",
        "version": "0.1.0",
        "state": "running",
        "pid": 4504,
        "uptime_seconds": 7180
      }
    ]
  }
}
```

#### app.info

```json
// Requête
{"cmd": "app.info", "slug": "terminal"}

// Réponse
{
  "ok": true,
  "data": {
    "slug": "terminal",
    "name": "Terminal",
    "version": "0.1.0",
    "description": "Web-based terminal emulator",
    "state": "running",
    "pid": 4504,
    "uptime_seconds": 7180,
    "executable": "zro-app-terminal",
    "frontend_dir": "/opt/zro/apps/terminal/frontend",
    "data_dir": "/var/lib/zro/data/terminal",
    "ipc_socket": "/run/zro/ipc/terminal.sock",
    "transport": "unix_socket"
  }
}
```

#### app.install

```json
// Requête
{"cmd": "app.install", "slug": "my-app", "staging_path": "/tmp/zro-staging/my-app"}

// Réponse (succès)
{"ok": true, "data": {"slug": "my-app", "pid": 4820}}

// Réponse (erreur)
{"ok": false, "error": "slug 'my-app' already registered"}
```

#### app.remove

```json
// Requête
{"cmd": "app.remove", "slug": "echo"}

// Réponse
{"ok": true, "data": {"slug": "echo"}}
```

#### app.start / app.stop / app.restart

```json
// Requête
{"cmd": "app.start", "slug": "notes"}

// Réponse
{"ok": true, "data": {"slug": "notes", "pid": 4830}}
```

#### config.show

```json
// Requête
{"cmd": "config.show"}

// Réponse
{
  "ok": true,
  "data": {
    "server": {"host": "0.0.0.0", "port": 8080},
    "apps": {"manifest_dir": "/opt/zro/apps", "data_dir": "/var/lib/zro/data"},
    "auth": {"providers": ["pam"]},
    "mode": "production"
  }
}
```

#### config.reload

```json
// Requête
{"cmd": "config.reload"}

// Réponse
{"ok": true, "data": {"reloaded": ["permissions", "users", "logging"]}}
```

#### user.list / user.add / user.remove

```json
// Requête
{"cmd": "user.add", "username": "alice", "password_hash": "$argon2id$...", "role": "user", "groups": ["dev"]}

// Réponse
{"ok": true, "data": {"username": "alice"}}
```

Note : Le hash Argon2id est calculé côté CLI (pas de mot de passe en clair sur le socket).

---

## 9. Question root vs non-root

### Analyse

| Besoin | Root nécessaire ? | Solution sans root |
|--------|-------------------|--------------------|
| Bind port 8080 | Non (>1024) | ✓ Direct |
| Bind port 443/80 | Oui | `CAP_NET_BIND_SERVICE` ou reverse proxy |
| Auth PAM | Dépend du module | Groupe `shadow` + PAM config |
| Lire /etc/shadow | Oui | Pas nécessaire avec PAM |
| Lancer des processus | Non | ✓ Direct (enfants du service) |
| PTY (terminal) | Non | ✓ Groupe `tty` |
| Accès fichiers utilisateur | Dépend | Groupe supplémentaire ou ACLs |
| Écrire /var/lib/zro | Non | ✓ Proprio `zro:zro` |
| Écrire /run/zro | Non | ✓ RuntimeDirectory= dans systemd |
| Installer paquets système | Oui | Hors périmètre (pas un gestionnaire de paquets) |

### Recommandation : **NON-ROOT avec capabilities**

```
Utilisateur système : zro
Groupe principal   : zro
Groupes supplémentaires : tty, video, audio

L'utilisateur 'zro' est un utilisateur système (comme 'www-data' pour nginx,
'postgres' pour PostgreSQL). Il ne peut pas se connecter via login.
```

**Pourquoi pas root :**

1. **Principe du moindre privilège** — un environnement de bureau web n'a pas besoin de contrôler le kernel
2. **Surface d'attaque réduite** — si le runtime est compromis, l'attaquant n'est que `zro`
3. **Analogie** — GNOME/Xorg tourne en tant que l'utilisateur connecté, pas root. `gdm` tourne en tant que `gdm`. ZRO tourne en tant que `zro`.
4. **Sandboxing systemd** — `ProtectSystem=strict` + `NoNewPrivileges=true` = le service ne peut pas escalader

**Cas particulier : auth PAM**

L'auth PAM a besoin de lire `/etc/shadow` (pour les mots de passe locaux). Deux solutions :

```
Option A (simple) :
  Ajouter l'utilisateur zro au groupe 'shadow'
  → Donne accès en lecture à /etc/shadow
  → Suffisant pour PAM authenticate()

Option B (propre) :
  Configurer PAM pour utiliser un module qui ne touche pas shadow
  Exemple : pam_unix avec helper setuid 'unix_chkpwd'
  → C'est déjà le comportement par défaut sur Debian/Ubuntu
  → unix_chkpwd est setuid root, pas besoin que zro soit root
  → ✓ RECOMMANDÉ
```

**Cas particulier : terminal / PTY**

L'app Terminal spawn des processus via PTY. Les PTYs (`/dev/pts/*`) sont accessibles au groupe `tty`. En ajoutant `zro` au groupe `tty` + `SupplementaryGroups=tty` dans le unit systemd, ça fonctionne.

Mais attention : les shells spawné seront exécutés en tant que `zro`, pas en tant que l'utilisateur connecté. C'est une différence avec un vrai DE où chaque session tourne en tant que l'utilisateur.

**Solution future (avancée) :**
Pour que le terminal exécute un shell en tant que l'utilisateur connecté, il faut :
- Soit `su - username` (nécessite root ou polkit)
- Soit un helper setuid dédié `zro-session-launcher`
- C'est exactement ce que font `gdm` / `sddm` avec `pam_systemd`

Pour la v1, le terminal tourne en tant que `zro`. C'est acceptable pour un usage personnel/petite équipe.

```
    ┌─────────────────────────────────────────────────────────┐
    │  Modèle de sécurité                                     │
    │                                                          │
    │  v1 (simple) :                                           │
    │    Tous les processus tournent en tant que 'zro'         │
    │    Terminal = bash en tant que 'zro'                      │
    │    → OK pour usage personnel, home server                │
    │                                                          │
    │  v2 (multi-user réel) :                                  │
    │    Helper setuid 'zro-session-launcher'                   │
    │    Chaque session terminal → shell en tant que $USER      │
    │    Isolation par cgroups / namespaces                     │
    │    → Nécessaire pour usage entreprise multi-utilisateurs │
    └─────────────────────────────────────────────────────────┘
```

---

## 10. Sécurité

### 10.1 Control socket

```
/run/zro/control.sock
├── Owner : zro:zro
├── Mode  : 0660
└── Seul l'utilisateur zro (et root) peut y accéder

Pour permettre à d'autres utilisateurs d'utiliser le CLI :
  → Ajouter au groupe zro
  → Ou utiliser sudo
  → Ou ajouter une option --socket à la CLI avec un socket user-space
```

### 10.2 Validation des paquets installés

```
Lors de zro app install :

1. Le manifest.toml est parsé et validé (même code que AppManifest::load())
2. Le slug est validé : [a-z0-9][a-z0-9-]*, pas dans la liste réservée
3. Le binaire backend est vérifié (existe, est exécutable)
4. Le frontend/index.html est vérifié (existe)
5. Le staging_path doit être sous /tmp/zro-staging/ (pas de path traversal)

Futur (v2) :
  → Signatures cryptographiques des paquets
  → Vérification d'intégrité (checksums)
  → Sandboxing des backends (seccomp, namespaces)
```

### 10.3 Hardening systemd

Le fichier unit inclut déjà :

```ini
ProtectSystem=strict          # FS en lecture seule sauf ReadWritePaths
ReadWritePaths=/var/lib/zro /run/zro /tmp/zro
ProtectHome=read-only         # /home en lecture seule
NoNewPrivileges=true          # Pas d'escalade via setuid
ProtectKernelTunables=true    # Pas de /proc/sys write
ProtectKernelModules=true     # Pas de chargement de modules
ProtectControlGroups=true     # Pas de modification cgroups
```

---

## 11. Modifications code par fichier

### NOUVEAUX FICHIERS

| Fichier | Description |
|---------|-------------|
| `cli/Cargo.toml` | Nouveau crate dans le workspace |
| `cli/src/main.rs` | Point d'entrée CLI (clap) |
| `cli/src/client.rs` | Client du control socket |
| `cli/src/commands/status.rs` | Commande `status` |
| `cli/src/commands/app.rs` | Commandes `app *` |
| `cli/src/commands/config.rs` | Commandes `config *` |
| `cli/src/commands/user.rs` | Commandes `user *` |
| `cli/src/commands/logs.rs` | Commande `logs` |
| `cli/src/commands/doctor.rs` | Commande `doctor` |
| `cli/src/output.rs` | Formatage sortie (table/json) |
| `cli/src/staging.rs` | Staging des paquets (validation, extraction, copie) |
| `runtime/src/control.rs` | **NOUVEAU** : serveur du control socket |
| `system/zro-runtime.service` | Fichier unit systemd |
| `system/zro.tmpfiles` | tmpfiles.d pour /run/zro |
| `system/zro.sysusers` | sysusers.d pour user zro |
| `scripts/install.sh` | Script d'installation système |

### FICHIERS MODIFIÉS

| Fichier | Modification |
|---------|-------------|
| `Cargo.toml` (root) | Ajouter `cli` au workspace members |
| `runtime/src/main.rs` | Ajouter démarrage du control socket listener + sd_notify + SIGHUP handler |
| `runtime/src/config.rs` | Ajouter section `[control]` (socket path), ajouter méthode `reload()` partielle |
| `runtime/src/supervisor.rs` | Ajouter `install_app()` (move staging → apps dir + start), `update_app()`, `remove_app_files()` |
| `runtime/src/registry.rs` | Déjà fait : `register_app()`, `unregister_app()`, `load_single_manifest()` |
| `runtime/src/gateway/state.rs` | Ajouter compteurs de sessions (pour `status`), ajouter champs uptime/PID par app |
| `runtime/src/gateway/handlers/apps.rs` | Déjà fait : les endpoints REST restent pour l'admin web |
| `runtime/src/gateway/router.rs` | Déjà fait : routes register/unregister |
| `runtime/src/ipc/server.rs` | Rendre le chemin des sockets configurable (pour `/run/zro/ipc/`) |
| `runtime/Cargo.toml` | Ajouter dépendance `sd-notify` (crate) |
| `scripts/build.sh` | Ajouter build du CLI |

### FICHIERS INCHANGÉS

Tout le reste : le protocole, les SDKs (Rust/Python/Node.js), les apps existantes, les tests — rien ne change. Le CLI et le control socket sont **additifs**.

---

## 12. Plan d'exécution

> **Toutes les phases ci-dessous sont terminées (mars 2026).** 173 tests passent (111 Rust + 29 Node.js + 33 Python) + 26 tests e2e.

### Phase 1 — Control socket dans le runtime (fondation) ✅

```
Fichiers créés/modifiés : runtime/src/control.rs (~770 lignes), runtime/src/main.rs, runtime/src/config.rs

Réalisé :
- ControlServer : écoute sur socket Unix configurable
- Accepte des connexions concurrentes (tokio::spawn par connexion)
- 16 commandes implémentées (status, app.*, config.*, user.*)
- Installation et mise à jour d'apps à chaud avec staging + rollback
- Gestion des utilisateurs (CRUD users.toml) via socket
```

### Phase 2 — CLI (la commande `zro`) ✅

```
Fichiers créés : cli/Cargo.toml, cli/src/{main.rs, client.rs, output.rs, staging.rs}

Réalisé :
- Binaire unique `zro` (clap + tabled)
- Toutes les commandes implémentées : status, version, app {list,info,start,stop,restart,install,remove,update,logs},
  config {show,edit,reload,path}, user {list,add,remove,passwd}, logs, doctor
- Modes de sortie : humain, --json, --quiet, --verbose
- Staging : extraction tar.gz, validation, copie vers /tmp/
```

### Phase 3 — Intégration systemd ✅

```
Fichiers créés : system/zro-runtime.service, scripts/install.sh
Fichiers modifiés : runtime/src/main.rs, runtime/Cargo.toml (dep sd-notify)

Réalisé :
- Type=notify avec sd_notify(READY=1)
- Watchdog heartbeat toutes les 10s (WatchdogSec=30s)
- SIGHUP → recharge users.toml + permissions.toml + sd_notify(RELOADING → READY)
- Script install.sh complet (binaires, config, service, tmpfiles)
```

### Phase 4 — Installation d'apps à chaud ✅

```
Fichiers : runtime/src/control.rs (cmd_app_install/update/remove), runtime/src/supervisor.rs,
           runtime/src/registry.rs, cli/src/staging.rs

Réalisé :
- app.install : staging /tmp/ → apps/, register, start backend
- app.update : stop, backup .bak, replace, start (rollback automatique en cas d'échec)
- app.remove : stop, unregister, suppression des fichiers (données préservées)
- register_app / unregister_app dynamiques dans le registre
- start_single_backend / stop_single_backend dans le supervisor
```

### Phase 5 — Chemins configurables (FHS compliance) ✅

```
Fichiers : runtime/src/config.rs (ControlConfig), runtime/src/ipc/server.rs

Réalisé :
- [control].socket_path configurable (défaut : /run/zro/control.sock)
- [control].ipc_dir configurable (défaut : /tmp/zro/ipc)
- Chemins relatifs et absolus supportés
- Déploiement user-level possible avec /tmp/zro/
```

### Phase 6 — Tests et documentation ✅

```
Réalisé :
- Tests unitaires : 111 tests Rust (protocol, SDK, macros, runtime)
- Tests SDK : 29 Node.js + 33 Python
- Tests e2e : 26 tests (health, auth, echo API, notes API, frontend serving)
- Documentation mise à jour : architecture.md, configuration.md, deployment.md
- Docker supprimé : Dockerfile, docker-compose.yml, .dockerignore retirés
```

### Résumé visuel du plan

```
Phase 1            Phase 2           Phase 3          Phase 4
Control Socket     CLI               systemd          Hot Deploy
═══════════       ═══════           ═══════          ══════════
control.rs ──────► client.rs ──────► .service ──────► staging.rs
main.rs mod        commands/*        sd_notify        app install/
config.rs          output.rs         SIGHUP           update/remove
                   staging.rs        tmpfiles.d

     │                 │                │                │
     └────────┬────────┴────────┬───────┴────────┬───────┘
              ▼                 ▼                 ▼
         Phase 5           Phase 6
         FHS paths         Tests & Docs
         ═════════         ═══════════
         config paths      integration tests
         ipc_dir           e2e tests
         static_dir        install guide
```

---

## Annexe : Ce qui ne changera PAS

- Le protocole IPC (zro-protocol) — inchangé
- Les 3 SDKs backend (Rust, Python, Node.js) — inchangés
- Le SDK frontend (zro-client.js) — inchangé
- Les 7 applications existantes — inchangées
- Le format manifest.toml — inchangé
- L'API HTTP (auth, proxy, websocket) — inchangée
- Le format de la base SQLite — inchangé

Le principe est **purement additif** : on ajoute un canal de contrôle (socket) et un outil CLI. Tout le reste continue de fonctionner exactement comme avant.
