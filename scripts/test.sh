#!/usr/bin/env bash
set -euo pipefail

echo "=== Running workspace tests ==="
cargo test --workspace "$@"

echo ""
echo "=== All tests passed ==="
