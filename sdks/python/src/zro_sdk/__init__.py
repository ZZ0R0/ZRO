"""ZRO SDK for Python — Build ZRO application backends in Python."""

from .app import ZroApp
from .context import AppContext, SessionInfo
from .module import ModuleInitContext, ModuleMeta, ModuleRegistrar, ZroModule
from .modules import (
    DevModule,
    IpcModule,
    LifecycleModule,
    NotificationsModule,
    StateModule,
)
from .protocol import IpcMessage

__all__ = [
    "ZroApp",
    "AppContext",
    "SessionInfo",
    "IpcMessage",
    "ZroModule",
    "ModuleMeta",
    "ModuleRegistrar",
    "ModuleInitContext",
    "DevModule",
    "IpcModule",
    "LifecycleModule",
    "NotificationsModule",
    "StateModule",
]
__version__ = "0.1.0"
