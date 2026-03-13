"""Dev module — structured logging and diagnostics.

Provides conditional structured logging that respects a configurable
log level. Exposes ``__dev:log`` for frontend-originated log messages
and ``__dev:info`` for diagnostic information.

Example::

    from zro_sdk.modules import DevModule

    dev = DevModule(level="debug", prefix="my-app")
    app.module(dev)
"""

from __future__ import annotations

import logging
from enum import IntEnum
from typing import Any, Optional

from ..context import AppContext
from ..module import ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule

logger = logging.getLogger("zro.dev")

_LEVEL_MAP = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warn": logging.WARNING,
    "error": logging.ERROR,
    "silent": logging.CRITICAL + 10,
}

_LEVEL_ORDER = {"debug": 0, "info": 1, "warn": 2, "error": 3, "silent": 4}


class DevModule(ZroModule):
    """Dev module — structured logging and diagnostics."""

    def __init__(
        self,
        level: str = "info",
        prefix: Optional[str] = None,
    ) -> None:
        self._level = level.lower()
        self._prefix = prefix

    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="dev",
            version="0.1.0",
            description="Structured logging and diagnostics",
        )

    def register(self, r: ModuleRegistrar) -> None:
        min_level = self._level
        min_order = _LEVEL_ORDER.get(min_level, 1)
        prefix = self._prefix

        @r.on_init
        async def init(ctx: ModuleInitContext) -> None:
            tag = prefix or ctx.slug
            logger.info("[%s] Dev module initialized (data_dir=%s)", tag, ctx.data_dir)

        @r.command("__dev:log")
        async def dev_log(
            ctx: AppContext,
            level: str = "info",
            message: str = "",
            data: Any = None,
        ) -> dict[str, str]:
            lvl = level.lower()
            lvl_order = _LEVEL_ORDER.get(lvl, 1)
            if lvl_order < min_order:
                return {"status": "filtered"}

            tag = prefix or ctx.slug
            instance = ctx.instance_id or "unknown"
            py_level = _LEVEL_MAP.get(lvl, logging.INFO)

            extra = f" | data={data}" if data is not None else ""
            logger.log(
                py_level,
                "[%s] [%s] %s%s",
                tag,
                instance,
                message,
                extra,
            )
            return {"status": "ok"}

        @r.command("__dev:info")
        async def dev_info(ctx: AppContext) -> dict[str, Any]:
            return {
                "slug": ctx.slug,
                "instance_id": ctx.instance_id,
                "data_dir": str(ctx.data_dir),
                "session": {
                    "session_id": ctx.session.session_id,
                    "username": ctx.session.username,
                    "role": ctx.session.role,
                },
                "min_log_level": min_level,
            }
