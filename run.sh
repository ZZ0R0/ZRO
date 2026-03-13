#!/usr/bin/env bash
set -e

echo "=== ZRO Runtime ==="
echo ""

# 1. Frontend SDK
echo "[1/4] Building Frontend SDK..."
if [ -f sdks/frontend/package.json ]; then
    (cd sdks/frontend && npm install --silent 2>&1 | tail -1 && npm run build 2>&1 | tail -3)
    echo "      ✓ Frontend SDK OK"
else
    echo "      (skipped)"
fi

# 2. Rust build
echo "[2/4] Building workspace..."
cargo build --workspace 2>&1 | tail -5
echo "      ✓ Build OK"

# 3. Symlinks
echo "[3/4] Creating symlinks..."
mkdir -p bin
for b in target/debug/zro-runtime target/debug/zro-app-*; do
    [ -f "$b" ] && ln -sf "$(pwd)/$b" "bin/$(basename $b)"
done
echo "      ✓ $(ls bin/ | wc -l) binaries linked"

# 4. Launch
echo "[4/4] Starting runtime on http://localhost:8090"
echo "      Login: dev / dev"
echo ""
exec ./bin/zro-runtime