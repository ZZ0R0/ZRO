#!/usr/bin/env bash
set -euo pipefail

echo "=== Downloading xterm.js vendor files ==="

VENDOR_DIR="apps/terminal/frontend/vendor"
mkdir -p "$VENDOR_DIR"

XTERM_VERSION="5.5.0"
FIT_VERSION="0.10.0"
WEBLINKS_VERSION="0.11.0"

echo "Downloading xterm.js v${XTERM_VERSION}..."
curl -sL "https://cdn.jsdelivr.net/npm/xterm@${XTERM_VERSION}/lib/xterm.js" -o "${VENDOR_DIR}/xterm.js"
curl -sL "https://cdn.jsdelivr.net/npm/xterm@${XTERM_VERSION}/css/xterm.css" -o "${VENDOR_DIR}/xterm.css"

echo "Downloading xterm-addon-fit v${FIT_VERSION}..."
curl -sL "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@${FIT_VERSION}/lib/addon-fit.js" -o "${VENDOR_DIR}/xterm-addon-fit.js"

echo "Downloading xterm-addon-web-links v${WEBLINKS_VERSION}..."
curl -sL "https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@${WEBLINKS_VERSION}/lib/addon-web-links.js" -o "${VENDOR_DIR}/xterm-addon-web-links.js"

echo "=== Done ==="
ls -lh "$VENDOR_DIR"
