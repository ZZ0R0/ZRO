"""Tests for the ZRO Python SDK."""

import json
import struct

import pytest

from zro_sdk.protocol import IpcMessage, SessionInfo
from zro_sdk.context import AppContext
from zro_sdk.app import ZroApp
from zro_sdk.module import (
    ModuleInitContext,
    ModuleMeta,
    ModuleRegistrar,
    ZroModule,
    resolve_module_order,
)


# ── IpcMessage tests ─────────────────────────────────────────────


class TestIpcMessage:
    def test_new_creates_valid_message(self):
        msg = IpcMessage.new("Hello", {"app_id": "abc"})
        assert msg.msg_type == "Hello"
        assert msg.payload == {"app_id": "abc"}
        assert len(msg.id) > 0
        assert len(msg.timestamp) > 0

    def test_reply_preserves_id(self):
        original = IpcMessage.new("Request", {})
        reply = IpcMessage.reply(original.id, "Response", {"ok": True})
        assert reply.id == original.id
        assert reply.msg_type == "Response"

    def test_to_json_has_type_field(self):
        msg = IpcMessage.new("Hello", {"key": "value"})
        data = json.loads(msg.to_json())
        assert data["type"] == "Hello"
        assert data["payload"] == {"key": "value"}
        assert "id" in data
        assert "timestamp" in data

    def test_from_dict(self):
        raw = {
            "type": "CommandRequest",
            "id": "123",
            "timestamp": "2025-01-01T00:00:00Z",
            "payload": {"command": "test"},
        }
        msg = IpcMessage.from_dict(raw)
        assert msg.msg_type == "CommandRequest"
        assert msg.id == "123"
        assert msg.payload == {"command": "test"}

    def test_roundtrip_bytes(self):
        original = IpcMessage.new("Test", {"data": [1, 2, 3]})
        raw = original.to_bytes()
        restored = IpcMessage.from_bytes(raw)
        assert restored.msg_type == original.msg_type
        assert restored.id == original.id
        assert restored.payload == original.payload

    def test_framing_format(self):
        """Verify the 4-byte big-endian length prefix framing."""
        msg = IpcMessage.new("Hello", {"app_id": "test"})
        payload_bytes = msg.to_bytes()
        frame = struct.pack(">I", len(payload_bytes)) + payload_bytes

        # Read back
        length = struct.unpack(">I", frame[:4])[0]
        assert length == len(payload_bytes)
        assert frame[4:] == payload_bytes

        # Parse the payload
        parsed = IpcMessage.from_bytes(frame[4:])
        assert parsed.msg_type == "Hello"


# ── SessionInfo tests ────────────────────────────────────────────


class TestSessionInfo:
    def test_from_dict(self):
        data = {
            "session_id": "s1",
            "user_id": "u1",
            "username": "alice",
            "role": "admin",
            "groups": ["dev", "ops"],
        }
        s = SessionInfo.from_dict(data)
        assert s.username == "alice"
        assert s.role == "admin"
        assert s.groups == ["dev", "ops"]

    def test_from_none(self):
        s = SessionInfo.from_dict(None)
        assert s.username == ""
        assert s.groups == []

    def test_from_empty_dict(self):
        s = SessionInfo.from_dict({})
        assert s.session_id == ""
        assert s.user_id == ""


# ── AppContext tests ─────────────────────────────────────────────


class TestAppContext:
    def test_construction(self):
        session = SessionInfo(username="bob", role="user")
        ctx = AppContext(
            session=session,
            instance_id="inst-1",
            slug="myapp",
        )
        assert ctx.session.username == "bob"
        assert ctx.instance_id == "inst-1"
        assert ctx.slug == "myapp"

    def test_state_without_app(self):
        ctx = AppContext(session=SessionInfo())
        assert ctx.state(dict) is None


# ── ZroApp registration tests ───────────────────────────────────


class TestZroApp:
    def test_command_registration(self):
        app = ZroApp()

        @app.command("greet")
        async def greet(ctx: AppContext, name: str) -> str:
            return f"Hello, {name}!"

        assert "greet" in app._commands
        assert app._commands["greet"] is greet

    def test_event_registration(self):
        app = ZroApp()

        @app.on("client:connected")
        async def on_connect(ctx: AppContext):
            pass

        assert "client:connected" in app._lifecycle_handlers

    def test_state_registration(self):
        app = ZroApp()

        class MyState:
            count: int = 0

        state = MyState()
        app.register_state(state)
        assert app._states[MyState] is state

    def test_multiple_commands(self):
        app = ZroApp()

        @app.command("cmd1")
        async def cmd1(ctx: AppContext):
            pass

        @app.command("cmd2")
        async def cmd2(ctx: AppContext):
            pass

        assert len(app._commands) == 2


# ── Handler calling tests ────────────────────────────────────────


class TestHandlerCalling:
    @pytest.mark.asyncio
    async def test_call_handler_with_params(self):
        app = ZroApp()

        @app.command("add")
        async def add(ctx: AppContext, a: int, b: int) -> dict:
            return {"sum": a + b}

        ctx = AppContext(session=SessionInfo(), _app=app)
        result = await app._call_handler(add, ctx, {"a": 3, "b": 4})
        assert result == {"sum": 7}

    @pytest.mark.asyncio
    async def test_call_handler_missing_param_raises(self):
        app = ZroApp()

        @app.command("greet")
        async def greet(ctx: AppContext, name: str) -> str:
            return f"Hello, {name}!"

        ctx = AppContext(session=SessionInfo(), _app=app)
        with pytest.raises(ValueError, match="Missing required parameter"):
            await app._call_handler(greet, ctx, {})

    @pytest.mark.asyncio
    async def test_call_handler_with_default(self):
        app = ZroApp()

        @app.command("greet")
        async def greet(ctx: AppContext, name: str = "World") -> str:
            return f"Hello, {name}!"

        ctx = AppContext(session=SessionInfo(), _app=app)
        result = await app._call_handler(greet, ctx, {})
        assert result == "Hello, World!"

    @pytest.mark.asyncio
    async def test_call_handler_ctx_has_session(self):
        app = ZroApp()

        @app.command("whoami")
        async def whoami(ctx: AppContext) -> str:
            return ctx.session.username

        session = SessionInfo(username="alice")
        ctx = AppContext(session=session, _app=app)
        result = await app._call_handler(whoami, ctx, {})
        assert result == "alice"


# ── Module system tests ──────────────────────────────────────────


class TestModuleMeta:
    def test_defaults(self):
        meta = ModuleMeta(name="test")
        assert meta.name == "test"
        assert meta.version == "0.1.0"
        assert meta.description is None
        assert meta.dependencies == []

    def test_with_values(self):
        meta = ModuleMeta(
            name="kv",
            version="1.0.0",
            description="Key-value store",
            dependencies=["auth"],
        )
        assert meta.name == "kv"
        assert meta.version == "1.0.0"
        assert meta.description == "Key-value store"
        assert meta.dependencies == ["auth"]


class TestModuleRegistrar:
    def test_command_registration(self):
        r = ModuleRegistrar()

        @r.command("greet")
        async def greet(ctx: AppContext, name: str):
            return f"Hello, {name}!"

        assert "greet" in r.commands
        assert r.commands["greet"] is greet

    def test_event_registration(self):
        r = ModuleRegistrar()

        @r.on_event("my:event")
        async def handler(ctx: AppContext, data):
            pass

        assert "my:event" in r.event_handlers

    def test_lifecycle_registration(self):
        r = ModuleRegistrar()

        @r.on("client:connected")
        async def on_connect(ctx: AppContext):
            pass

        assert "client:connected" in r.lifecycle_handlers

    def test_init_hook(self):
        r = ModuleRegistrar()

        @r.on_init
        async def init(ctx: ModuleInitContext):
            pass

        assert len(r.init_hooks) == 1

    def test_destroy_hook(self):
        r = ModuleRegistrar()

        @r.on_destroy
        async def cleanup():
            pass

        assert len(r.destroy_hooks) == 1


class TestZroModule:
    def test_module_registration(self):
        class GreetModule(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="greet")

            def register(self, r):
                @r.command("greet")
                async def greet(ctx: AppContext):
                    return "hello"

        mod = GreetModule()
        assert mod.meta.name == "greet"

        registrar = ModuleRegistrar()
        mod.register(registrar)
        assert "greet" in registrar.commands

    def test_app_module_method(self):
        class TestMod(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="test")

            def register(self, r):
                @r.command("test_cmd")
                async def test_cmd(ctx: AppContext):
                    return {"ok": True}

        app = ZroApp()
        result = app.module(TestMod())
        assert result is app
        assert len(app._modules) == 1


class TestModuleDependencyResolution:
    def test_no_deps(self):
        class A(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="a")

            def register(self, r):
                pass

        class B(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="b")

            def register(self, r):
                pass

        order = resolve_module_order([A(), B()])
        assert len(order) == 2

    def test_with_deps(self):
        class A(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="a")

            def register(self, r):
                pass

        class B(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="b", dependencies=["a"])

            def register(self, r):
                pass

        modules = [B(), A()]  # B first, but depends on A
        order = resolve_module_order(modules)
        a_pos = order.index(1)  # A is at index 1
        b_pos = order.index(0)  # B is at index 0
        assert a_pos < b_pos

    def test_chain_deps(self):
        class A(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="a")

            def register(self, r):
                pass

        class B(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="b", dependencies=["a"])

            def register(self, r):
                pass

        class C(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="c", dependencies=["b"])

            def register(self, r):
                pass

        modules = [C(), A(), B()]  # shuffled
        order = resolve_module_order(modules)
        a_pos = order.index(1)
        b_pos = order.index(2)
        c_pos = order.index(0)
        assert a_pos < b_pos < c_pos

    def test_circular_dep(self):
        class A(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="a", dependencies=["b"])

            def register(self, r):
                pass

        class B(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="b", dependencies=["a"])

            def register(self, r):
                pass

        with pytest.raises(ValueError, match="Circular dependency"):
            resolve_module_order([A(), B()])

    def test_missing_dep(self):
        class A(ZroModule):
            @property
            def meta(self):
                return ModuleMeta(name="a", dependencies=["nonexistent"])

            def register(self, r):
                pass

        with pytest.raises(ValueError, match="not registered"):
            resolve_module_order([A()])
