#!/usr/bin/env bash
# ZRO Module Scaffolding — Rust SDK
#
# Creates a new module file with boilerplate.
#
# Usage:
#   ./scripts/new-module.sh <name> [--description "..."] [--deps dep1,dep2]
#
# Example:
#   ./scripts/new-module.sh kv --description "Key-value storage module"
#   ./scripts/new-module.sh auth --deps kv

set -euo pipefail

usage() {
    cat <<EOF
Usage: $0 <name> [options]

Options:
  --description "..."   Module description
  --deps dep1,dep2      Comma-separated dependencies
  --dir <path>          Output directory (default: src/modules/)

Example:
  $0 kv --description "Key-value store"
  $0 auth --deps kv,session
EOF
    exit 0
}

[[ $# -eq 0 || "$1" == "--help" || "$1" == "-h" ]] && usage

NAME="$1"; shift
DESCRIPTION=""
DEPS=""
OUT_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --description) DESCRIPTION="$2"; shift 2 ;;
        --deps) DEPS="$2"; shift 2 ;;
        --dir) OUT_DIR="$2"; shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Validate name
if ! [[ "$NAME" =~ ^[a-z][a-z0-9_-]*$ ]]; then
    echo "Error: Invalid module name \"$NAME\". Use lowercase letters, numbers, hyphens, underscores." >&2
    exit 1
fi

# Convert to snake_case for Rust
SNAKE_NAME="${NAME//-/_}"

# Convert to PascalCase for struct name
pascal_case() {
    echo "$1" | sed -E 's/(^|[-_])([a-z])/\U\2/g'
}
STRUCT_NAME="$(pascal_case "$SNAKE_NAME")Module"

# Determine output directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
if [[ -z "$OUT_DIR" ]]; then
    OUT_DIR="$SDK_DIR/src/modules"
fi

mkdir -p "$OUT_DIR"
FILE_PATH="$OUT_DIR/${SNAKE_NAME}.rs"

if [[ -f "$FILE_PATH" ]]; then
    echo "Error: File already exists: $FILE_PATH" >&2
    exit 1
fi

# Build meta deps
DEPS_CODE=""
if [[ -n "$DEPS" ]]; then
    IFS=',' read -ra DEP_ARRAY <<< "$DEPS"
    DEPS_ITEMS=""
    for dep in "${DEP_ARRAY[@]}"; do
        dep="$(echo "$dep" | xargs)"  # trim
        DEPS_ITEMS="${DEPS_ITEMS}\"${dep}\", "
    done
    DEPS_CODE=".dependencies(vec![${DEPS_ITEMS}])"
fi

DESC_CODE=""
if [[ -n "$DESCRIPTION" ]]; then
    DESC_CODE=".description(\"${DESCRIPTION}\")"
fi

cat > "$FILE_PATH" << RUST
//! ZRO Module: ${STRUCT_NAME}

use serde_json::Value;
use zro_sdk::module::{ModuleMeta, ModuleRegistrar, ZroModule};
use zro_sdk::context::AppContext;

pub struct ${STRUCT_NAME};

impl ZroModule for ${STRUCT_NAME} {
    fn meta(&self) -> ModuleMeta {
        ModuleMeta::new("${NAME}", "0.1.0")${DESC_CODE}${DEPS_CODE}
    }

    fn register(&self, r: &mut ModuleRegistrar) {
        // Register commands
        // r.command("${SNAKE_NAME}_example", |params: Value, ctx: AppContext| {
        //     Box::pin(async move {
        //         Ok(serde_json::json!({"ok": true}))
        //     })
        // });

        // Register WS event handlers
        // r.on_event("${NAME}:event", |data, ctx| async move {
        //     // handle event
        // });

        // Register lifecycle hooks
        // r.on("client:connected", |ctx| async move {
        //     // handle connection
        // });

        // Register init/destroy hooks
        // r.on_init(|ctx| async move {
        //     // initialize resources
        //     Ok(())
        // });
        // r.on_destroy(|| async {
        //     // cleanup resources
        // });
    }
}
RUST

echo "✓ Created module: $FILE_PATH"
echo ""
echo "Usage in your app:"
echo ""
echo "  mod modules;"
echo "  use modules::${SNAKE_NAME}::${STRUCT_NAME};"
echo ""
echo "  ZroApp::builder()"
echo "      .module(${STRUCT_NAME})"
echo "      .build().await?"
echo "      .run().await"
