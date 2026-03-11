#!/usr/bin/env bash
set -e

echo "=== ZRO Runtime ==="
echo ""

# 1. Build
echo "[1/3] Building workspace..."
cargo build --workspace 2>&1 | tail -5
echo "      ✓ Build OK"

# 2. Symlinks
echo "[2/3] Creating symlinks..."
mkdir -p bin
for b in target/debug/zro-runtime target/debug/zro-app-*; do
    [ -f "$b" ] && ln -sf "$(pwd)/$b" "bin/$(basename $b)"
done
echo "      ✓ $(ls bin/ | wc -l) binaries linked"

# 3. Launch
echo "[3/3] Starting runtime on http://localhost:8080"
echo "      Login: dev / dev"
echo ""
exec ./bin/zro-runtime