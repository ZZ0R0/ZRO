# ZRO — Déploiement

## Développement local

### Prérequis

- Rust 1.83+ (avec `cargo`)
- Node.js 18+ (pour le frontend SDK)
- Python 3.10+ (optionnel, pour les apps Python)

### Démarrage rapide

```bash
./run.sh
```

Ce script :
1. Compile le frontend SDK (`sdks/frontend/`)
2. Build le workspace Rust (`cargo build --workspace`)
3. Crée les symlinks `bin/` → `target/debug/`
4. Lance le runtime sur `http://localhost:8090`
5. Login : `dev` / `dev`

### Build seul

```bash
./scripts/build.sh      # Build release (--release)
./scripts/dev.sh         # Build dev + watch (si disponible)
```

### Tests

```bash
./scripts/test.sh        # Tous les tests unitaires
./test_e2e.sh            # Tests end-to-end (curl)

# Tests par composant
cargo test -p zro-protocol           # 15 tests protocol
cargo test -p zro-sdk                # Tests SDK Rust
cd sdks/nodejs && npm test           # 29 tests Node.js
cd sdks/python && python -m pytest   # 33 tests Python
```

---

## Service natif (systemd)

### Installation

```bash
# Build release et installer les binaires
cargo build --release
sudo ./scripts/install.sh
```

Le script `install.sh` :
1. Copie les binaires dans `/usr/bin/` (`zro`, `zro-runtime`, `zro-app-*`)
2. Crée la configuration dans `/etc/zro/`
3. Installe le service systemd `zro-runtime.service`
4. Crée les répertoires de données (`/var/lib/zro/`)

### Gestion du service

```bash
# Démarrer / arrêter / redémarrer
sudo systemctl start zro-runtime
sudo systemctl stop zro-runtime
sudo systemctl restart zro-runtime

# Rechargement de la configuration (SIGHUP)
sudo systemctl reload zro-runtime

# Logs en temps réel
journalctl -u zro-runtime -f

# État du service
systemctl status zro-runtime
```

### CLI

La CLI `zro` permet d'administrer le runtime sans redémarrage :

```bash
# État du runtime
zro status

# Lister les applications
zro app list

# Détails d'une application
zro app info terminal

# Gestion du cycle de vie
zro app start echo
zro app stop echo
zro app restart echo

# Installation / mise à jour / suppression à chaud
zro app install ./mon-app/             # depuis un répertoire
zro app install ./mon-app.tar.gz       # depuis une archive
zro app update echo ./echo-v2.tar.gz   # mise à jour atomique
zro app remove echo                    # désinstallation

# Configuration
zro config show                        # configuration active
zro config edit                        # ouvrir dans $EDITOR
zro config reload                      # recharger users + permissions

# Gestion des utilisateurs
zro user list
zro user add alice --role user --groups dev,staff
zro user remove alice
zro user passwd alice

# Logs
zro logs -f                            # journalctl runtime -f
zro app logs terminal -f               # logs d'une app

# Santé globale
zro doctor
```

> **Astuce :** Ajouter `--json` pour une sortie machine-readable, ou `-q` pour un mode silencieux.

### Déploiement user-level (sans root)

```bash
# Copier les binaires dans le projet
cp target/release/zro-runtime bin/
cp target/release/zro-app-* bin/

# Créer le service utilisateur
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/zro-runtime.service <<'EOF'
[Unit]
Description=ZRO Web Desktop Environment

[Service]
Type=notify
WorkingDirectory=/path/to/ZRO
ExecStart=bin/zro-runtime
ExecReload=/bin/kill -HUP $MAINPID
Environment=ZRO_MODE=production
Environment=RUST_LOG=info
WatchdogSec=30s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now zro-runtime
```

---

## Production

### Checklist

1. **Secret de session** : Changer `session.secret` dans `runtime.toml` (chaîne longue et aléatoire)
2. **Mode production** : `ZRO_MODE=production` ou `mode.mode = "production"` dans le TOML
3. **Clés JWT** : Conserver les mêmes fichiers `config/jwt_keys/` entre les déploiements
4. **Users** : Configurer les vrais utilisateurs dans `users.toml` (pas de user `dev`)
5. **Permissions** : Configurer `permissions.toml` selon les besoins
6. **Reverse proxy** : Mettre Nginx/Caddy devant avec TLS (important pour les cookies Secure)

### Reverse proxy Nginx

```nginx
server {
    listen 443 ssl;
    server_name zro.example.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### Structure des fichiers (FHS)

```
/usr/bin/
├── zro                    # CLI
├── zro-runtime            # Runtime
└── zro-app-*              # Backends

/etc/zro/
├── runtime.toml
├── users.toml
├── permissions.toml
└── jwt_keys/

/var/lib/zro/
├── apps/          # Manifestes + frontends
├── data/          # Persistance
└── static/        # SDK frontend compilé

/run/zro/
├── control.sock   # Socket CLI ↔ runtime
└── ipc/           # Sockets IPC runtime ↔ backends
```

### Configuration production recommandée

```toml
[server]
host = "0.0.0.0"
port = 8090

[session]
secret = "votre-secret-aleatoire-de-64-caracteres-minimum"
ttl_seconds = 86400

[auth]
providers = ["local"]
jwt_ttl_seconds = 3600       # 1h pour les tokens d'accès
jwt_refresh_ttl_seconds = 604800

[mode]
mode = "production"

[logging]
level = "info"

[storage]
path = "/var/lib/zro/data/zro.db"
wal_mode = true
pool_size = 20

[control]
socket_path = "/run/zro/control.sock"
ipc_dir = "/run/zro/ipc"
```

### Santé

```bash
curl http://localhost:8090/health
# {"status":"ok","apps":{...},"uptime_seconds":...,"version":"0.1.0"}

# Ou via la CLI
zro doctor
```
