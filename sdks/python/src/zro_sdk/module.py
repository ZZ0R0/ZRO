"""Module system for ZRO backend applications.

Modules are self-contained units that contribute commands, event handlers,
and lifecycle hooks to a ZRO app. They declare dependencies, are resolved
in topological order, and have optional init/destroy lifecycle hooks.

Example::

    from zro_sdk import ZroModule, ModuleMeta, ModuleRegistrar, AppContext

    class GreetModule(ZroModule):
        @property
        def meta(self) -> ModuleMeta:
            return ModuleMeta(name="greet", version="0.1.0")

        def register(self, r: ModuleRegistrar) -> None:
            @r.command("greet")
            async def greet(ctx: AppContext, name: str = "world") -> str:
                return f"Hello, {name}!"

    # Usage:
    app = ZroApp()
    app.module(GreetModule())
    app.run()
"""

from __future__ import annotations

import abc
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Coroutine, Optional

from .context import AppContext

CommandHandler = Callable[..., Coroutine[Any, Any, Any]]
EventHandler = Callable[..., Coroutine[Any, Any, None]]
LifecycleHandler = Callable[[AppContext], Coroutine[Any, Any, None]]
InitHook = Callable[["ModuleInitContext"], Coroutine[Any, Any, None]]
DestroyHook = Callable[[], Coroutine[Any, Any, None]]


# ── Module Metadata ──────────────────────────────────────────────

@dataclass
class ModuleMeta:
    """Metadata describing a module: identity, version, and dependencies."""

    name: str
    version: str = "0.1.0"
    description: Optional[str] = None
    dependencies: list[str] = field(default_factory=list)


# ── Module Init Context ─────────────────────────────────────────

@dataclass
class ModuleInitContext:
    """Context available during module initialization (after IPC handshake)."""

    slug: str
    data_dir: Path


# ── Module Registrar ─────────────────────────────────────────────

class ModuleRegistrar:
    """Builder passed to :meth:`ZroModule.register` for contributing handlers.

    Mirrors the ``ZroApp`` decorator API so modules register in the same way.
    """

    def __init__(self) -> None:
        self.commands: dict[str, CommandHandler] = {}
        self.event_handlers: dict[str, EventHandler] = {}
        self.lifecycle_handlers: dict[str, LifecycleHandler] = {}
        self.init_hooks: list[InitHook] = []
        self.destroy_hooks: list[DestroyHook] = []

    def command(self, name: str):
        """Register a command handler (WS invoke + HTTP API).

        Usage::

            @r.command("greet")
            async def greet(ctx: AppContext, name: str) -> str:
                return f"Hello, {name}!"
        """

        def decorator(func: CommandHandler):
            self.commands[name] = func
            return func

        return decorator

    def on_event(self, event: str):
        """Register a WS event handler (fire-and-forget).

        Usage::

            @r.on_event("term:input")
            async def handle_input(ctx: AppContext, data: str):
                pass
        """

        def decorator(func: EventHandler):
            self.event_handlers[event] = func
            return func

        return decorator

    def on(self, event: str):
        """Register a lifecycle handler (``client:connected``, etc.).

        Usage::

            @r.on("client:connected")
            async def on_connect(ctx: AppContext):
                pass
        """

        def decorator(func: LifecycleHandler):
            self.lifecycle_handlers[event] = func
            return func

        return decorator

    def on_init(self, handler: InitHook) -> InitHook:
        """Register an init hook, called after IPC handshake.

        Usage::

            @r.on_init
            async def init(ctx: ModuleInitContext):
                pass
        """
        self.init_hooks.append(handler)
        return handler

    def on_destroy(self, handler: DestroyHook) -> DestroyHook:
        """Register a destroy hook, called during shutdown (reverse order).

        Usage::

            @r.on_destroy
            async def cleanup():
                pass
        """
        self.destroy_hooks.append(handler)
        return handler


# ── Module Base Class ────────────────────────────────────────────

class ZroModule(abc.ABC):
    """A ZRO backend module. Subclass this to package reusable
    commands, event handlers, and lifecycle hooks."""

    @property
    @abc.abstractmethod
    def meta(self) -> ModuleMeta:
        """Module metadata (name, version, dependencies)."""
        ...

    @abc.abstractmethod
    def register(self, registrar: ModuleRegistrar) -> None:
        """Register handlers on the provided registrar.

        Called once during app setup, in dependency order.
        """
        ...


# ── Dependency Resolution ────────────────────────────────────────

def resolve_module_order(modules: list[ZroModule]) -> list[int]:
    """Resolve module initialization order via topological sort.

    Returns indices into *modules* in the order they should be initialized.

    Raises:
        ValueError: on missing dependencies or circular references.
    """
    name_to_idx: dict[str, int] = {}
    for i, m in enumerate(modules):
        name_to_idx[m.meta.name] = i

    n = len(modules)
    in_degree = [0] * n
    adj: list[list[int]] = [[] for _ in range(n)]

    for i, m in enumerate(modules):
        for dep in m.meta.dependencies:
            dep_idx = name_to_idx.get(dep)
            if dep_idx is None:
                raise ValueError(
                    f"Module '{m.meta.name}' depends on '{dep}' which is not registered"
                )
            adj[dep_idx].append(i)
            in_degree[i] += 1

    # Kahn's algorithm
    queue = deque(i for i in range(n) if in_degree[i] == 0)
    order: list[int] = []

    while queue:
        node = queue.popleft()
        order.append(node)
        for nxt in adj[node]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    if len(order) != n:
        raise ValueError("Circular dependency detected among modules")

    return order
