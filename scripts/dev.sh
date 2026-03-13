#!/usr/bin/env bash
set -euo pipefail

echo "=== Starting zro runtime (development) ==="

# Ensure data dirs exist
mkdir -p data /tmp/zro-ipc

# Build frontend SDK first
if [ -f sdks/frontend/package.json ]; then
    echo "--- Building Frontend SDK ---"
    (cd sdks/frontend && npm install --silent && npm run build)
fi

# Build Rust
cargo build --workspace

# Export env for dev
export ZRO_CONFIG=./config/runtime.toml
export RUST_LOG=${RUST_LOG:-debug}

# Run
exec cargo run --bin zro-runtime
