"""Notifications module — emit structured notifications to frontend clients.

Provides a ``__notify`` command for emitting notifications to connected
clients, plus a ``__notify:broadcast`` command that always broadcasts.

Example::

    from zro_sdk.modules import NotificationsModule

    app.module(NotificationsModule())

    # From frontend:
    # conn.invoke('__notify', { title: 'Done', body: 'Build complete', level: 'success' })
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from ..context import AppContext
from ..module import ModuleMeta, ModuleRegistrar, ZroModule


class NotificationLevel(str, Enum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


@dataclass
class Notification:
    """A structured notification payload."""

    title: str
    body: Optional[str] = None
    level: str = "info"
    duration: int = 5000
    actions: list[dict[str, str]] = field(default_factory=list)


class NotificationsModule(ZroModule):
    """Notifications module — registers ``__notify`` commands."""

    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="notifications",
            version="0.1.0",
            description="Emit structured notifications to frontend clients",
        )

    def register(self, r: ModuleRegistrar) -> None:
        @r.command("__notify")
        async def notify(ctx: AppContext, title: str, body: str = "",
                         level: str = "info", duration: int = 5000,
                         actions: list[dict[str, str]] | None = None) -> dict[str, str]:
            payload = {
                "title": title,
                "body": body,
                "level": level,
                "duration": duration,
            }
            if actions:
                payload["actions"] = actions

            if ctx.instance_id:
                await ctx.emit_to(ctx.instance_id, "zro:notification", payload)
            else:
                await ctx.emit("zro:notification", payload)

            return {"status": "ok"}

        @r.command("__notify:broadcast")
        async def notify_broadcast(ctx: AppContext, title: str, body: str = "",
                                   level: str = "info", duration: int = 5000,
                                   actions: list[dict[str, str]] | None = None) -> dict[str, str]:
            payload = {
                "title": title,
                "body": body,
                "level": level,
                "duration": duration,
            }
            if actions:
                payload["actions"] = actions

            await ctx.emit("zro:notification", payload)
            return {"status": "ok"}
