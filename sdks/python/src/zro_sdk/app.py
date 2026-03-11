"""ZroApp — main application class for building ZRO backends in Python."""

from __future__ import annotations

import asyncio
import base64
import inspect
import json
import os
import signal
import sys
from pathlib import Path
from typing import Any, Callable, Coroutine, Optional
from urllib.parse import unquote

from .context import AppContext
from .ipc import IpcClient
from .protocol import IpcMessage, SessionInfo

CommandHandler = Callable[..., Coroutine[Any, Any, Any]]
EventHandler = Callable[..., Coroutine[Any, Any, None]]
LifecycleHandler = Callable[[AppContext], Coroutine[Any, Any, None]]


class ZroApp:
    """ZRO Application builder and runner.

    Usage::

        app = ZroApp()

        @app.command("greet")
        async def greet(ctx: AppContext, name: str) -> str:
            return f"Hello, {name}!"

        app.run()
    """

    def __init__(self) -> None:
        self._commands: dict[str, CommandHandler] = {}
        self._ws_event_handlers: dict[str, EventHandler] = {}
        self._lifecycle_handlers: dict[str, LifecycleHandler] = {}
        self._states: dict[type, Any] = {}
        self._ipc: Optional[IpcClient] = None
        self._slug: str = ""
        self._data_dir: Path = Path("/tmp")

    # ── Registration decorators ──────────────────────────

    def command(self, name: str):
        """Register a command handler.

        The function signature is inspected to extract parameter names.
        The first parameter matching `AppContext` or `ctx` is injected automatically.
        Remaining parameters are extracted from the JSON `params` object.
        """

        def decorator(func: CommandHandler):
            self._commands[name] = func
            return func

        return decorator

    def on(self, event: str):
        """Register a lifecycle event handler.

        Supported events: ``client:connected``, ``client:disconnected``,
        ``client:reconnected``.
        """

        def decorator(func: LifecycleHandler):
            self._lifecycle_handlers[event] = func
            return func

        return decorator

    def on_event(self, event: str):
        """Register a WS event handler (fire-and-forget, from client conn.emit()).

        The handler receives the event data and an AppContext.
        It does not return a result since events are fire-and-forget.

        Usage::

            @app.on_event("term:input")
            async def handle_input(ctx: AppContext, data: str):
                # process incoming terminal keystrokes
                pass
        """

        def decorator(func: EventHandler):
            self._ws_event_handlers[event] = func
            return func

        return decorator

    def register_state(self, initial: Any) -> None:
        """Register a shared state object accessible via ``ctx.state(Type)``."""
        self._states[type(initial)] = initial

    # ── Run ──────────────────────────────────────────────

    def run(self) -> None:
        """Start the application (blocking). Reads env vars and enters the IPC loop."""
        try:
            asyncio.run(self._main())
        except KeyboardInterrupt:
            pass

    async def _main(self) -> None:
        socket_path = os.environ.get("ZRO_IPC_SOCKET", "")
        self._slug = os.environ.get("ZRO_APP_SLUG", "")
        self._data_dir = Path(
            os.environ.get("ZRO_DATA_DIR", f"/tmp/zro-{self._slug}")
        )

        if not socket_path:
            print("[ZRO SDK] ERROR: ZRO_IPC_SOCKET environment variable not set", file=sys.stderr)
            sys.exit(1)

        self._ipc = IpcClient(socket_path)
        await self._ipc.connect()

        # Handshake
        hello = IpcMessage.new(
            "Hello",
            {
                "slug": self._slug,
                "app_version": "0.1.0",
                "protocol_version": 1,
            },
        )
        await self._ipc.send(hello)
        ack = await self._ipc.recv()
        if ack.msg_type != "HelloAck":
            print(f"[ZRO SDK] Handshake failed: {ack.msg_type}", file=sys.stderr)
            sys.exit(1)

        print(f"[ZRO SDK] App {self._slug} connected", file=sys.stderr)

        # Handle SIGTERM gracefully
        loop = asyncio.get_running_loop()
        loop.add_signal_handler(signal.SIGTERM, lambda: asyncio.ensure_future(self._shutdown()))

        # Message loop
        try:
            while True:
                msg = await self._ipc.recv()
                asyncio.create_task(self._handle_message(msg))
        except asyncio.IncompleteReadError:
            print("[ZRO SDK] IPC connection closed", file=sys.stderr)
        except Exception as e:
            print(f"[ZRO SDK] IPC error: {e}", file=sys.stderr)

    async def _shutdown(self) -> None:
        if self._ipc:
            ack = IpcMessage.new("ShutdownAck", {"status": "ok"})
            try:
                await self._ipc.send(ack)
                await self._ipc.close()
            except Exception:
                pass
        sys.exit(0)

    # ── Message dispatch ─────────────────────────────────

    async def _handle_message(self, msg: IpcMessage) -> None:
        try:
            if msg.msg_type == "CommandRequest":
                await self._handle_command(msg)
            elif msg.msg_type == "WsMessage":
                await self._handle_ws_message(msg)
            elif msg.msg_type == "HttpRequest":
                await self._handle_http_request(msg)
            elif msg.msg_type == "ClientConnected":
                await self._dispatch_lifecycle("client:connected", msg)
            elif msg.msg_type == "ClientDisconnected":
                await self._dispatch_lifecycle("client:disconnected", msg)
            elif msg.msg_type == "ClientReconnected":
                await self._dispatch_lifecycle("client:reconnected", msg)
            elif msg.msg_type == "Shutdown":
                await self._shutdown()
            else:
                print(f"[ZRO SDK] Unknown message type: {msg.msg_type}", file=sys.stderr)
        except Exception as e:
            print(f"[ZRO SDK] Error handling {msg.msg_type}: {e}", file=sys.stderr)

    async def _handle_command(self, msg: IpcMessage) -> None:
        payload = msg.payload
        command_name = payload.get("command", "")
        params = payload.get("params", {})
        session = SessionInfo.from_dict(payload.get("session"))
        instance_id = payload.get("instance_id")

        handler = self._commands.get(command_name)
        if not handler:
            response = IpcMessage.reply(
                msg.id,
                "CommandResponse",
                {"error": f"Unknown command: {command_name}"},
            )
            await self._ipc.send(response)
            return

        ctx = AppContext(
            session=session,
            instance_id=instance_id,
            slug=self._slug,
            data_dir=self._data_dir,
            _app=self,
        )

        try:
            # Extract parameters from params dict and pass as kwargs
            result = await self._call_handler(handler, ctx, params)
            response = IpcMessage.reply(
                msg.id,
                "CommandResponse",
                {"result": result},
            )
        except Exception as e:
            response = IpcMessage.reply(
                msg.id,
                "CommandResponse",
                {"error": str(e)},
            )

        await self._ipc.send(response)

    async def _call_handler(
        self, handler: CommandHandler, ctx: AppContext, params: dict
    ) -> Any:
        """Call a command handler, injecting ctx and extracting params as kwargs."""
        sig = inspect.signature(handler)
        kwargs: dict[str, Any] = {}

        for name, param in sig.parameters.items():
            annotation = param.annotation
            # Inject AppContext
            if annotation is AppContext or name == "ctx":
                kwargs[name] = ctx
            elif name in params:
                kwargs[name] = params[name]
            elif param.default is not inspect.Parameter.empty:
                kwargs[name] = param.default
            else:
                raise ValueError(f"Missing required parameter: {name}")

        return await handler(**kwargs)

    async def _dispatch_lifecycle(self, event: str, msg: IpcMessage) -> None:
        handler = self._lifecycle_handlers.get(event)
        if not handler:
            return
        payload = msg.payload
        session = SessionInfo.from_dict(payload.get("session"))
        ctx = AppContext(
            session=session,
            instance_id=payload.get("instance_id"),
            slug=self._slug,
            data_dir=self._data_dir,
            _app=self,
        )
        await handler(ctx)

    async def _handle_ws_message(self, msg: IpcMessage) -> None:
        """Handle WsMessage (fire-and-forget event from client conn.emit())."""
        payload = msg.payload
        event = payload.get("event", "")
        data = payload.get("data")
        session = SessionInfo.from_dict(payload.get("session"))
        instance_id = payload.get("instance_id")

        ctx = AppContext(
            session=session,
            instance_id=instance_id,
            slug=self._slug,
            data_dir=self._data_dir,
            _app=self,
        )

        # 1. Try dedicated WS event handlers first
        handler = self._ws_event_handlers.get(event)
        if not handler:
            # Try ':' → '_' replacement (e.g. term:input → term_input)
            alt = event.replace(":", "_")
            handler = self._ws_event_handlers.get(alt)

        if handler:
            try:
                await self._call_handler(handler, ctx, data if isinstance(data, dict) else {"data": data})
            except Exception as e:
                print(f"[ZRO SDK] WS event handler error ({event}): {e}", file=sys.stderr)
            return

        # 2. Fall back to command handlers (for backward compat)
        cmd_handler = self._commands.get(event) or self._commands.get(event.replace(":", "_"))
        if cmd_handler:
            try:
                await self._call_handler(cmd_handler, ctx, data if isinstance(data, dict) else {"data": data})
            except Exception as e:
                print(f"[ZRO SDK] WS→command fallback error ({event}): {e}", file=sys.stderr)
        else:
            print(f"[ZRO SDK] No handler for WS event: {event}", file=sys.stderr)

    async def _handle_http_request(self, msg: IpcMessage) -> None:
        """Handle HttpRequest (HTTP API proxy, auto-route to commands)."""
        payload = msg.payload
        method = payload.get("method", "GET").upper()
        path = payload.get("path", "")
        body_b64 = payload.get("body")
        query = payload.get("query", {})
        session = SessionInfo.from_dict(payload.get("session"))

        ctx = AppContext(
            session=session,
            instance_id=None,
            slug=self._slug,
            data_dir=self._data_dir,
            _app=self,
        )

        # Strip /api/ prefix
        clean_path = path.lstrip("/")
        if clean_path.startswith("api/"):
            clean_path = clean_path[4:]
        clean_path = clean_path.strip("/")
        segments = [s for s in clean_path.split("/") if s]
        base = segments[0] if segments else ""
        method_lower = method.lower()

        # Build candidate command names
        candidates = [base, f"{method_lower}_{base}"]
        crud_map = {
            "get": ["list", "get"],
            "post": ["create"],
            "put": ["update", "set"],
            "delete": ["delete"],
            "patch": ["update"],
        }
        for action in crud_map.get(method_lower, []):
            candidates.append(f"{base}_{action}")
            candidates.append(f"{action}_{base}")
        if len(segments) > 1:
            candidates.append(f"{base}_{segments[1]}")
            candidates.append(f"{segments[1]}_{base}")

        command_name = None
        for name in candidates:
            if name in self._commands:
                command_name = name
                break

        if not command_name:
            body_json = json.dumps({"error": f"No handler for {method} {path}"})
            response = IpcMessage.reply(msg.id, "HttpResponse", {
                "status": 404,
                "headers": {"content-type": "application/json"},
                "body": base64.b64encode(body_json.encode()).decode(),
            })
            await self._ipc.send(response)
            return

        # Build params from body + query + path id
        params = {}
        if body_b64:
            try:
                decoded = base64.b64decode(body_b64)
                params = json.loads(decoded)
            except Exception:
                params = {}
        if not isinstance(params, dict):
            params = {}
        params.update(query)
        if len(segments) > 1:
            params.setdefault("id", "/".join(segments[1:]))
        params.setdefault("_method", method)

        handler = self._commands[command_name]
        try:
            result = await self._call_handler(handler, ctx, params)
            body_json = json.dumps(result)
            response = IpcMessage.reply(msg.id, "HttpResponse", {
                "status": 200,
                "headers": {"content-type": "application/json"},
                "body": base64.b64encode(body_json.encode()).decode(),
            })
        except Exception as e:
            body_json = json.dumps({"error": str(e)})
            response = IpcMessage.reply(msg.id, "HttpResponse", {
                "status": 500,
                "headers": {"content-type": "application/json"},
                "body": base64.b64encode(body_json.encode()).decode(),
            })

        await self._ipc.send(response)

    # ── Event emission ───────────────────────────────────

    async def _emit(
        self,
        event: str,
        payload: Any = None,
        target_instance: Optional[str] = None,
        broadcast: bool = False,
    ) -> None:
        if not self._ipc:
            return
        if broadcast:
            target = {"type": "broadcast"}
        elif target_instance:
            target = {"type": "instance", "instance_id": target_instance}
        else:
            return

        msg = IpcMessage.new(
            "EventEmit",
            {
                "event": event,
                "payload": payload,
                "target": target,
            },
        )
        await self._ipc.send(msg)
