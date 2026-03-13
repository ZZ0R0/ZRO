"""Files module — sandboxed filesystem operations within the app's data directory.

Usage:
    from zro_sdk.modules.files import FilesModule
    app.module(FilesModule())

    # From frontend:
    # conn.invoke('__fs:read', { path: 'notes/hello.md' })
    # conn.invoke('__fs:write', { path: 'notes/hello.md', content: '# Hello' })
    # conn.invoke('__fs:list', { path: 'notes' })
    # conn.invoke('__fs:delete', { path: 'notes/hello.md' })
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from ..context import AppContext
from ..module import ModuleMeta, ZroModule


class FilesModule(ZroModule):
    """Sandboxed filesystem operations."""

    def __init__(self) -> None:
        self._data_dir: Path = Path("/tmp")

    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="files",
            version="0.1.0",
            description="Sandboxed filesystem operations",
            dependencies=[],
        )

    def register(self, reg) -> None:
        async def init(init_ctx):
            self._data_dir = Path(init_ctx.data_dir)

        reg.on_init(init)
        reg.command("__fs:read", self._cmd_read)
        reg.command("__fs:write", self._cmd_write)
        reg.command("__fs:list", self._cmd_list)
        reg.command("__fs:delete", self._cmd_delete)
        reg.command("__fs:mkdir", self._cmd_mkdir)
        reg.command("__fs:stat", self._cmd_stat)

    def _safe_path(self, relative: str) -> Path:
        if not relative:
            raise ValueError("path is required")
        cleaned = relative.lstrip("/")
        if ".." in cleaned:
            raise ValueError("path traversal not allowed")
        full = (self._data_dir / cleaned).resolve()
        base = self._data_dir.resolve()
        if not str(full).startswith(str(base)):
            raise ValueError("path outside data directory")
        return full

    async def _cmd_read(self, ctx: AppContext, params: Any) -> dict:
        full = self._safe_path(params.get("path", ""))
        if not full.is_file():
            raise ValueError(f"not a file: {params.get('path', '')}")
        content = full.read_text(encoding="utf-8")
        return {"content": content}

    async def _cmd_write(self, ctx: AppContext, params: Any) -> dict:
        full = self._safe_path(params.get("path", ""))
        full.parent.mkdir(parents=True, exist_ok=True)
        content = params.get("content", "")
        full.write_text(content, encoding="utf-8")
        return {"ok": True, "bytes": len(content.encode("utf-8"))}

    async def _cmd_list(self, ctx: AppContext, params: Any) -> dict:
        rel = params.get("path", ".")
        full = self._safe_path(rel)
        if not full.is_dir():
            raise ValueError(f"not a directory: {rel}")
        entries = []
        for entry in full.iterdir():
            entries.append({
                "name": entry.name,
                "is_dir": entry.is_dir(),
                "is_file": entry.is_file(),
                "size": entry.stat().st_size if entry.exists() else 0,
            })
        return {"entries": entries}

    async def _cmd_delete(self, ctx: AppContext, params: Any) -> dict:
        full = self._safe_path(params.get("path", ""))
        if full.is_dir():
            import shutil
            shutil.rmtree(full)
        else:
            full.unlink()
        return {"ok": True}

    async def _cmd_mkdir(self, ctx: AppContext, params: Any) -> dict:
        full = self._safe_path(params.get("path", ""))
        full.mkdir(parents=True, exist_ok=True)
        return {"ok": True}

    async def _cmd_stat(self, ctx: AppContext, params: Any) -> dict:
        full = self._safe_path(params.get("path", ""))
        if not full.exists():
            raise ValueError(f"not found: {params.get('path', '')}")
        stat = full.stat()
        return {
            "path": params.get("path", ""),
            "is_dir": full.is_dir(),
            "is_file": full.is_file(),
            "size": stat.st_size,
        }
