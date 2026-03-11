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

    def state(self, state_type: type):
        """Retrieve the shared state object registered for the given type."""
        if self._app:
            return self._app._states.get(state_type)
        return None
