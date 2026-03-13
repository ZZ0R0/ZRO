#!/usr/bin/env bash
# ZRO Installation Script
# Installs zro-runtime + zro CLI as a native systemd service.
#
# Usage: sudo ./scripts/install.sh [--uninstall]

set -euo pipefail

INSTALL_PREFIX="${INSTALL_PREFIX:-/opt/zro}"
BIN_DIR="/usr/bin"
CONFIG_DIR="/etc/zro"
DATA_DIR="/var/lib/zro"
RUN_DIR="/run/zro"
SYSTEMD_DIR="/etc/systemd/system"
TMPFILES_DIR="/etc/tmpfiles.d"
SYSUSERS_DIR="/etc/sysusers.d"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[-]${NC} $*" >&2; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root (or with sudo)"
        exit 1
    fi
}

do_install() {
    check_root

    info "Installing ZRO Web Desktop Environment..."

    # Build if needed
    if [[ ! -f "target/release/zro-runtime" ]] || [[ ! -f "target/release/zro" ]]; then
        info "Building release binaries..."
        cargo build --release -p zro-runtime -p zro-cli
    fi

    # Create system user
    info "Creating system user 'zro'..."
    if ! id -u zro &>/dev/null; then
        useradd --system --home-dir "$INSTALL_PREFIX" --shell /usr/sbin/nologin --create-home zro
    else
        warn "User 'zro' already exists"
    fi

    # Create directories
    info "Creating directories..."
    mkdir -p "$INSTALL_PREFIX"/{apps,bin,static}
    mkdir -p "$CONFIG_DIR"/jwt_keys
    mkdir -p "$DATA_DIR"
    mkdir -p "$RUN_DIR"

    # Install binaries
    info "Installing binaries..."
    install -m 0755 target/release/zro-runtime "$BIN_DIR/zro-runtime"
    install -m 0755 target/release/zro "$BIN_DIR/zro"

    # Install app backends
    for backend in target/release/zro-app-*; do
        if [[ -f "$backend" && -x "$backend" ]]; then
            name=$(basename "$backend")
            # Skip .d files
            [[ "$name" == *.d ]] && continue
            install -m 0755 "$backend" "$INSTALL_PREFIX/bin/$name"
            info "  Installed $name"
        fi
    done

    # Install apps (manifests + frontends)
    if [[ -d "apps" ]]; then
        info "Installing applications..."
        for app_dir in apps/*/; do
            slug=$(basename "$app_dir")
            target_app="$INSTALL_PREFIX/apps/$slug"
            mkdir -p "$target_app"

            # Copy manifest
            if [[ -f "$app_dir/manifest.toml" ]]; then
                cp "$app_dir/manifest.toml" "$target_app/"
            fi

            # Copy frontend
            if [[ -d "$app_dir/frontend" ]]; then
                cp -r "$app_dir/frontend" "$target_app/"
            fi

            # Symlink backend binary
            if [[ -d "$app_dir/backend" ]]; then
                mkdir -p "$target_app/backend"
                # Find the executable name from manifest
                exe=$(grep 'executable' "$app_dir/manifest.toml" 2>/dev/null | head -1 | sed 's/.*= *"\(.*\)"/\1/')
                if [[ -n "$exe" && -f "$INSTALL_PREFIX/bin/$exe" ]]; then
                    ln -sf "$INSTALL_PREFIX/bin/$exe" "$target_app/backend/$exe"
                fi
            fi

            info "  Installed app: $slug"
        done
    fi

    # Install static files
    if [[ -d "static" ]]; then
        info "Installing static files..."
        cp -r static/* "$INSTALL_PREFIX/static/" 2>/dev/null || true
    fi

    # Install config (don't overwrite existing)
    info "Installing configuration..."
    if [[ ! -f "$CONFIG_DIR/runtime.toml" ]]; then
        if [[ -f "config/runtime.toml" ]]; then
            cp config/runtime.toml "$CONFIG_DIR/runtime.toml"
        fi
    else
        warn "Config already exists at $CONFIG_DIR/runtime.toml — not overwriting"
    fi

    if [[ ! -f "$CONFIG_DIR/users.toml" ]]; then
        if [[ -f "config/users.toml" ]]; then
            cp config/users.toml "$CONFIG_DIR/users.toml"
        fi
    fi

    if [[ ! -f "$CONFIG_DIR/permissions.toml" ]]; then
        if [[ -f "config/permissions.toml" ]]; then
            cp config/permissions.toml "$CONFIG_DIR/permissions.toml"
        fi
    fi

    # Install JWT keys (don't overwrite)
    if [[ -d "config/jwt_keys" ]]; then
        for key in config/jwt_keys/*; do
            target_key="$CONFIG_DIR/jwt_keys/$(basename "$key")"
            if [[ ! -f "$target_key" ]]; then
                cp "$key" "$target_key"
                chmod 0600 "$target_key"
            fi
        done
    fi

    # Install systemd files
    info "Installing systemd files..."
    cp system/zro-runtime.service "$SYSTEMD_DIR/"
    cp system/zro.tmpfiles "$TMPFILES_DIR/zro.conf"
    cp system/zro.sysusers "$SYSUSERS_DIR/zro.conf"

    # Create runtime directories via tmpfiles
    systemd-tmpfiles --create "$TMPFILES_DIR/zro.conf" 2>/dev/null || true
    systemd-sysusers "$SYSUSERS_DIR/zro.conf" 2>/dev/null || true

    # Set ownership
    info "Setting permissions..."
    chown -R zro:zro "$INSTALL_PREFIX"
    chown -R zro:zro "$CONFIG_DIR"
    chown -R zro:zro "$DATA_DIR"
    chown -R zro:zro "$RUN_DIR"
    chmod 0700 "$CONFIG_DIR/jwt_keys"

    # Reload systemd
    systemctl daemon-reload

    info ""
    info "Installation complete!"
    info ""
    info "Next steps:"
    info "  1. Review config:  sudo vim $CONFIG_DIR/runtime.toml"
    info "  2. Start service:  sudo systemctl enable --now zro-runtime"
    info "  3. Check status:   zro status"
    info "  4. Open browser:   http://localhost:8090"
}

do_uninstall() {
    check_root

    warn "Uninstalling ZRO..."

    # Stop service
    if systemctl is-active --quiet zro-runtime 2>/dev/null; then
        info "Stopping service..."
        systemctl stop zro-runtime
    fi
    systemctl disable zro-runtime 2>/dev/null || true

    # Remove systemd files
    info "Removing systemd files..."
    rm -f "$SYSTEMD_DIR/zro-runtime.service"
    rm -f "$TMPFILES_DIR/zro.conf"
    rm -f "$SYSUSERS_DIR/zro.conf"
    systemctl daemon-reload

    # Remove binaries
    info "Removing binaries..."
    rm -f "$BIN_DIR/zro-runtime"
    rm -f "$BIN_DIR/zro"

    # Remove installation (but preserve data)
    info "Removing installation..."
    rm -rf "$INSTALL_PREFIX"
    rm -rf "$RUN_DIR"

    warn "Config preserved at $CONFIG_DIR"
    warn "Data preserved at $DATA_DIR"
    warn "User 'zro' preserved (remove manually with: userdel zro)"
    warn ""
    warn "To remove all data: sudo rm -rf $CONFIG_DIR $DATA_DIR"

    info "Uninstall complete."
}

# Parse arguments
case "${1:-}" in
    --uninstall)
        do_uninstall
        ;;
    *)
        do_install
        ;;
esac
