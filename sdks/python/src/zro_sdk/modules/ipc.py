"""IPC module — inter-app message routing.

Allows apps to send messages to other apps via the runtime's IPC
routing mechanism. The module registers ``__ipc:send`` for outgoing
messages and an ``__ipc:receive`` event handler for incoming messages.

Example::

    from zro_sdk.modules import IpcModule

    ipc = IpcModule()

    @ipc.on_receive("open-file")
    async def handle_open(ctx, data):
        path = data.get("path", "")
        print(f"Received request to open: {path}")
        return {"opened": True}

    app.module(ipc)
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Coroutine, Optional

from ..context import AppContext
from ..module import ModuleMeta, ModuleRegistrar, ZroModule

logger = logging.getLogger("zro.ipc")

IpcHandler = Callable[[AppContext, Any], Coroutine[Any, Any, Any]]


class IpcModule(ZroModule):
    """IPC module for inter-app communication."""

    def __init__(self) -> None:
        self._handlers: dict[str, IpcHandler] = {}

    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="ipc",
            version="0.1.0",
            description="Inter-app message routing",
        )

    def on_receive(self, channel: str) -> Callable[[IpcHandler], IpcHandler]:
        """Decorator: register a handler for incoming messages on a named channel."""

        def decorator(func: IpcHandler) -> IpcHandler:
            self._handlers[channel] = func
            return func

        return decorator

    def register(self, r: ModuleRegistrar) -> None:
        module = self

        @r.command("__ipc:send")
        async def ipc_send(ctx: AppContext, target: str, channel: str,
                           data: Any = None) -> dict[str, str]:
            """Send a message to another app via the runtime."""
            ipc_msg = {
                "source": ctx.slug,
                "target": target,
                "channel": channel,
                "data": data,
            }
            await ctx.emit("__ipc:route", ipc_msg)
            return {"status": "sent"}

        @r.on_event("__ipc:receive")
        async def ipc_receive(ctx: AppContext, source: str = "",
                              channel: str = "", data: Any = None) -> None:
            """Handle incoming IPC messages from other apps."""
            handler = module._handlers.get(channel)
            if handler:
                try:
                    await handler(ctx, data)
                    logger.debug("IPC message handled: %s from %s", channel, source)
                except Exception:
                    logger.exception(
                        "IPC handler error: channel=%s source=%s", channel, source
                    )
            else:
                logger.debug(
                    "No handler registered for IPC channel: %s (source=%s)",
                    channel,
                    source,
                )
