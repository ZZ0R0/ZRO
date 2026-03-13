"""Lifecycle module — grace-period management for client connections.

When a client disconnects, the module starts a configurable grace-period
timer. If the client reconnects before the timer expires, the timer is
cancelled and the session resumes normally. If the timer expires, a
configurable cleanup callback is invoked.

Example::

    from zro_sdk.modules import LifecycleModule

    lifecycle = LifecycleModule(grace_period=10.0)

    @lifecycle.on_timeout
    async def handle_timeout(ctx):
        print(f"Session {ctx.session.session_id} timed out")

    app.module(lifecycle)
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Coroutine, Optional

from ..context import AppContext
from ..module import ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule

logger = logging.getLogger("zro.lifecycle")

LifecycleCallback = Callable[[AppContext], Coroutine[Any, Any, None]]


class LifecycleModule(ZroModule):
    """Lifecycle module for managing client connection grace periods."""

    def __init__(self, grace_period: float = 5.0) -> None:
        self._grace_period = grace_period
        self._on_timeout_cb: Optional[LifecycleCallback] = None
        self._on_connect_cb: Optional[LifecycleCallback] = None
        self._on_disconnect_cb: Optional[LifecycleCallback] = None
        self._timers: dict[str, asyncio.Task[None]] = {}

    @property
    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="lifecycle",
            version="0.1.0",
            description="Grace-period management for client connections",
        )

    def on_timeout(self, func: LifecycleCallback) -> LifecycleCallback:
        """Decorator: register a callback for when the grace period expires."""
        self._on_timeout_cb = func
        return func

    def on_connect(self, func: LifecycleCallback) -> LifecycleCallback:
        """Decorator: register a callback for client connections."""
        self._on_connect_cb = func
        return func

    def on_disconnect(self, func: LifecycleCallback) -> LifecycleCallback:
        """Decorator: register a callback for client disconnections."""
        self._on_disconnect_cb = func
        return func

    def _cancel_timer(self, instance_id: str) -> bool:
        """Cancel a pending grace-period timer. Returns True if one was cancelled."""
        task = self._timers.pop(instance_id, None)
        if task is not None:
            task.cancel()
            logger.debug("Cancelled grace-period timer for %s", instance_id)
            return True
        return False

    async def _start_timer(self, ctx: AppContext) -> None:
        """Start a grace-period timer for the given context."""
        instance_id = ctx.instance_id
        if not instance_id:
            return

        async def _timer() -> None:
            await asyncio.sleep(self._grace_period)
            # Timer expired — run cleanup
            self._timers.pop(instance_id, None)
            logger.info(
                "Grace period expired for %s (%.1fs), running cleanup",
                instance_id,
                self._grace_period,
            )
            if self._on_timeout_cb:
                await self._on_timeout_cb(ctx)

        # Cancel any existing timer first
        self._cancel_timer(instance_id)
        self._timers[instance_id] = asyncio.create_task(_timer())

    def register(self, r: ModuleRegistrar) -> None:  # noqa: C901
        module = self

        @r.on("client:connected")
        async def on_connected(ctx: AppContext) -> None:
            if ctx.instance_id:
                module._cancel_timer(ctx.instance_id)
            if module._on_connect_cb:
                await module._on_connect_cb(ctx)

        @r.on("client:disconnected")
        async def on_disconnected(ctx: AppContext) -> None:
            if module._on_disconnect_cb:
                await module._on_disconnect_cb(ctx)
            await module._start_timer(ctx)

        @r.on("client:reconnected")
        async def on_reconnected(ctx: AppContext) -> None:
            if ctx.instance_id:
                module._cancel_timer(ctx.instance_id)
