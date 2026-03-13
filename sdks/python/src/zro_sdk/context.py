"""Application context provided to command handlers."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from .protocol import SessionInfo

if TYPE_CHECKING:
    from .app import ZroApp


@dataclass
class AppContext:
    """Context provided to every command handler and lifecycle hook.

    Attributes:
        session: The session of the invoking user.
        instance_id: The client instance that invoked the command (if any).
        slug: This app's slug.
        data_dir: Path to the app's persistent data directory.
    """

    session: SessionInfo
    instance_id: Optional[str] = None
    slug: str = ""
    data_dir: Path = field(default_factory=lambda: Path("/tmp"))
    _app: Optional[ZroApp] = field(default=None, repr=False)

    async def emit_to(self, instance_id: str, event: str, payload: Any = None) -> None:
        """Emit an event to a specific client instance."""
        if self._app:
            await self._app._emit(event, payload, target_instance=instance_id)

    async def emit(self, event: str, payload: Any = None) -> None:
        """Broadcast an event to all connected clients of this app."""
        if self._app:
            await self._app._emit(event, payload, broadcast=True)

    async def emit_to_session(self, event: str, payload: Any = None) -> None:
        """Emit an event to all apps within the current user session."""
        if self._app and self.session.session_id:
            await self._app._emit(event, payload, target_session=self.session.session_id)

    async def emit_system(self, event: str, payload: Any = None) -> None:
        """Emit a system-wide event to every connected client."""
        if self._app:
            await self._app._emit(event, payload, system=True)

    @property
    def profile(self):
        """Get the user profile (if available)."""
        return self.session.profile

    @property
    def username(self) -> str:
        """Get the current username."""
        return self.session.username

    @property
    def role(self) -> str:
        """Get the current user's role."""
        return self.session.role

    @property
    def groups(self) -> list[str]:
        """Get the current user's groups."""
        return self.session.groups

    def state(self, state_type: type):
        """Retrieve the shared state object registered for the given type."""
        if self._app:
            return self._app._states.get(state_type)
        return None
