#!/usr/bin/env python3
"""ZRO Module Scaffolding — Python SDK.

Creates a new module file with boilerplate.

Usage:
    python scripts/new_module.py <name> [--description "..."] [--deps dep1,dep2]

Example:
    python scripts/new_module.py kv --description "Key-value storage module"
    python scripts/new_module.py auth --deps kv
"""

import argparse
import re
import sys
from pathlib import Path


def to_class_name(name: str) -> str:
    """Convert module name to PascalCase class name."""
    return "".join(part.capitalize() for part in re.split(r"[-_]", name)) + "Module"


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a new ZRO module")
    parser.add_argument("name", help="Module name (lowercase, hyphens/underscores)")
    parser.add_argument("--description", default="", help="Module description")
    parser.add_argument("--deps", default="", help="Comma-separated dependencies")
    parser.add_argument(
        "--dir",
        default=None,
        help="Output directory (default: src/zro_sdk/modules/)",
    )
    args = parser.parse_args()

    name = args.name
    if not re.match(r"^[a-z][a-z0-9_-]*$", name):
        print(
            f'Error: Invalid module name "{name}". Use lowercase letters, numbers, hyphens, underscores.',
            file=sys.stderr,
        )
        sys.exit(1)

    class_name = to_class_name(name)
    deps = [d.strip() for d in args.deps.split(",") if d.strip()] if args.deps else []
    out_dir = Path(args.dir) if args.dir else Path(__file__).parent.parent / "src" / "zro_sdk" / "modules"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Build meta fields
    deps_str = f', dependencies={deps!r}' if deps else ""
    desc_str = f', description="{args.description}"' if args.description else ""

    py_name = name.replace("-", "_")
    content = f'''"""ZRO Module: {class_name}."""

from __future__ import annotations

from zro_sdk import AppContext, ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule


class {class_name}(ZroModule):
    """{args.description or f"{class_name} for ZRO."}"""

    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(name="{name}", version="0.1.0"{desc_str}{deps_str})

    def register(self, r: ModuleRegistrar) -> None:
        # Register commands
        # @r.command("{py_name}_example")
        # async def example(ctx: AppContext) -> dict:
        #     return {{"ok": True}}

        # Register WS event handlers
        # @r.on_event("{name}:event")
        # async def handle_event(ctx: AppContext, data):
        #     pass

        # Register lifecycle hooks
        # @r.on("client:connected")
        # async def on_connect(ctx: AppContext):
        #     pass

        # Register init/destroy hooks
        # @r.on_init
        # async def init(ctx: ModuleInitContext):
        #     pass

        # @r.on_destroy
        # async def cleanup():
        #     pass

        pass
'''

    file_path = out_dir / f"{py_name}.py"
    if file_path.exists():
        print(f"Error: File already exists: {file_path}", file=sys.stderr)
        sys.exit(1)

    file_path.write_text(content)
    print(f"✓ Created module: {file_path}")
    print(f"\nUsage in your app:\n")
    print(f"  from zro_sdk.modules.{py_name} import {class_name}")
    print(f"  app.module({class_name}())")

    # Create __init__.py if missing
    init_file = out_dir / "__init__.py"
    if not init_file.exists():
        init_file.write_text(f'"""ZRO SDK modules."""\n')
        print(f"✓ Created {init_file}")


if __name__ == "__main__":
    main()
