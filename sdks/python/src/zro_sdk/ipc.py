"""IPC client — communicates with the ZRO runtime over a Unix Domain Socket."""

from __future__ import annotations

import asyncio
import json
import struct
from typing import Any

from .protocol import IpcMessage


class IpcClient:
    """Length-prefixed JSON framing over a Unix Domain Socket (async)."""

    MAX_MESSAGE_SIZE = 16 * 1024 * 1024  # 16 MB

    def __init__(self, socket_path: str):
        self.socket_path = socket_path
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None

    async def connect(self) -> None:
        self._reader, self._writer = await asyncio.open_unix_connection(
            self.socket_path
        )

    async def send(self, msg: IpcMessage) -> None:
        """Send a length-prefixed JSON message."""
        if not self._writer:
            raise RuntimeError("Not connected")
        data = msg.to_bytes()
        if len(data) > self.MAX_MESSAGE_SIZE:
            raise ValueError(f"Message too large: {len(data)} bytes")
        frame = struct.pack(">I", len(data)) + data
        self._writer.write(frame)
        await self._writer.drain()

    async def recv(self) -> IpcMessage:
        """Read a length-prefixed JSON message."""
        if not self._reader:
            raise RuntimeError("Not connected")
        length_bytes = await self._reader.readexactly(4)
        length = struct.unpack(">I", length_bytes)[0]
        if length > self.MAX_MESSAGE_SIZE:
            raise ValueError(f"Message too large: {length} bytes")
        data = await self._reader.readexactly(length)
        return IpcMessage.from_bytes(data)

    async def close(self) -> None:
        if self._writer:
            self._writer.close()
            await self._writer.wait_closed()
            self._writer = None
            self._reader = None
