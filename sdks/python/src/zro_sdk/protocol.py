"""IPC message types and serialization for the ZRO protocol."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional


@dataclass
class IpcMessage:
    """Envelope wrapping all IPC messages (matches Rust IpcMessage)."""

    msg_type: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    payload: Any = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(
            {
                "type": self.msg_type,
                "id": self.id,
                "timestamp": self.timestamp,
                "payload": self.payload,
            }
        )

    def to_bytes(self) -> bytes:
        return self.to_json().encode("utf-8")

    @classmethod
    def from_dict(cls, data: dict) -> IpcMessage:
        return cls(
            msg_type=data.get("type", ""),
            id=data.get("id", ""),
            timestamp=data.get("timestamp", ""),
            payload=data.get("payload", {}),
        )

    @classmethod
    def from_bytes(cls, raw: bytes) -> IpcMessage:
        data = json.loads(raw.decode("utf-8"))
        return cls.from_dict(data)

    @classmethod
    def new(cls, msg_type: str, payload: Any = None) -> IpcMessage:
        return cls(msg_type=msg_type, payload=payload or {})

    @classmethod
    def reply(cls, original_id: str, msg_type: str, payload: Any = None) -> IpcMessage:
        return cls(
            msg_type=msg_type,
            id=original_id,
            payload=payload or {},
        )


@dataclass
class UserProfile:
    """User profile with display information."""

    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    email: Optional[str] = None
    locale: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> Optional[UserProfile]:
        if not data:
            return None
        return cls(
            display_name=data.get("display_name"),
            avatar_url=data.get("avatar_url"),
            email=data.get("email"),
            locale=data.get("locale"),
        )


@dataclass
class SessionInfo:
    """Session information attached to IPC commands."""

    session_id: str = ""
    user_id: str = ""
    username: str = ""
    role: str = ""
    groups: list[str] = field(default_factory=list)
    profile: Optional[UserProfile] = None

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> SessionInfo:
        if not data:
            return cls()
        return cls(
            session_id=data.get("session_id", ""),
            user_id=data.get("user_id", ""),
            username=data.get("username", ""),
            role=data.get("role", ""),
            groups=data.get("groups", []),
            profile=UserProfile.from_dict(data.get("profile")),
        )
