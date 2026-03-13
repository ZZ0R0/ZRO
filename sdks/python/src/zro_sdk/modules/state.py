"""State module — server-side key-value state management.

Provides convenient commands for managing per-app persistent state
via a JSON-backed KV store on disk.

Example::

    from zro_sdk.modules import StateModule

    app.module(StateModule())

    # From frontend:
    # conn.invoke('__kv:get', { key: 'theme' })
    # conn.invoke('__kv:set', { key: 'theme', value: 'dark' })
    # conn.invoke('__kv:delete', { key: 'theme' })
    # conn.invoke('__kv:list', {})
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from ..context import AppContext
from ..module import ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule

logger = logging.getLogger("zro.state")


class _KvStore:
    """In-memory KV store backed by a JSON file on disk."""

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._path: Optional[Path] = None

    def init(self, data_dir: Path) -> None:
        """Load persisted state from disk."""
        self._path = data_dir / "kv.json"
        if self._path.exists():
            try:
                self._data = json.loads(self._path.read_text(encoding="utf-8"))
                logger.debug(
                    "Loaded KV store from %s (%d entries)",
                    self._path,
                    len(self._data),
                )
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Failed to load KV store: %s", exc)

    def get(self, key: str) -> Any:
        return self._data.get(key)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self._persist()

    def delete(self, key: str) -> bool:
        removed = key in self._data
        self._data.pop(key, None)
        if removed:
            self._persist()
        return removed

    def list_keys(self) -> list[str]:
        return list(self._data.keys())

    def get_all(self) -> dict[str, Any]:
        return dict(self._data)

    def _persist(self) -> None:
        if self._path is None:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps(self._data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.error("Failed to persist KV store: %s", exc)


class StateModule(ZroModule):
    """State module — server-side KV state management."""

    def __init__(self) -> None:
        self._store = _KvStore()

    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="state",
            version="0.1.0",
            description="Server-side key-value state management",
        )

    def register(self, r: ModuleRegistrar) -> None:
        store = self._store

        @r.on_init
        async def init(ctx: ModuleInitContext) -> None:
            store.init(ctx.data_dir)

        @r.command("__kv:get")
        async def state_get(ctx: AppContext, key: str) -> dict[str, Any]:
            value = store.get(key)
            return {"key": key, "value": value}

        @r.command("__kv:set")
        async def state_set(ctx: AppContext, key: str, value: Any = None) -> dict[str, Any]:
            store.set(key, value)
            return {"key": key, "status": "ok"}

        @r.command("__kv:delete")
        async def state_delete(ctx: AppContext, key: str) -> dict[str, Any]:
            deleted = store.delete(key)
            return {"key": key, "deleted": deleted}

        @r.command("__kv:list")
        async def state_list(ctx: AppContext) -> dict[str, Any]:
            keys = store.list_keys()
            return {"keys": keys}

        @r.command("__kv:get_all")
        async def state_get_all(ctx: AppContext) -> dict[str, Any]:
            entries = store.get_all()
            return {"entries": entries}
