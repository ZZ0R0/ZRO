#!/usr/bin/env bash
set -euo pipefail

echo "=== Building zro workspace (release) ==="
cargo build --release --workspace

echo ""
echo "=== Build complete ==="
echo "Binaries:"
ls -lh target/release/zro-runtime target/release/zro-app-* 2>/dev/null || echo "(no binaries found)"
