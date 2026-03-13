#!/usr/bin/env bash
set -euo pipefail

echo "=== Building zro workspace ==="

# 1. Frontend SDK
echo ""
echo "--- Frontend SDK ---"
if [ -f sdks/frontend/package.json ]; then
    (cd sdks/frontend && npm install --silent && npm run build)
else
    echo "  (skipped — sdks/frontend not found)"
fi

# 2. Rust workspace
echo ""
echo "--- Rust workspace (release) ---"
cargo build --release --workspace

echo ""
echo "=== Build complete ==="
echo "Binaries:"
ls -lh target/release/zro-runtime target/release/zro-app-* 2>/dev/null || echo "(no binaries found)"
