"""System module — expose Linux system metrics to the frontend.

Usage:
    from zro_sdk.modules.system import SystemModule
    app.module(SystemModule())

    # From frontend:
    # conn.invoke('__sys:info', {})
"""

from __future__ import annotations

from typing import Any

from ..context import AppContext
from ..module import ModuleMeta, ZroModule


class SystemModule(ZroModule):
    """Linux system metrics module."""

    def meta(self) -> ModuleMeta:
        return ModuleMeta(
            name="system",
            version="0.1.0",
            description="Linux system metrics",
            dependencies=[],
        )

    def register(self, reg) -> None:
        reg.command("__sys:info", self._cmd_sys_info)

    async def _cmd_sys_info(self, _ctx: AppContext, _params: Any) -> dict:
        info: dict[str, Any] = {}

        # Uptime
        try:
            with open("/proc/uptime") as f:
                content = f.read()
            secs = float(content.split()[0])
            info["uptime_secs"] = int(secs)
        except Exception:
            pass

        # Load average
        try:
            with open("/proc/loadavg") as f:
                parts = f.read().split()
            if len(parts) >= 3:
                info["load_avg"] = {
                    "1m": float(parts[0]),
                    "5m": float(parts[1]),
                    "15m": float(parts[2]),
                }
        except Exception:
            pass

        # Memory
        try:
            with open("/proc/meminfo") as f:
                content = f.read()
            mem_total = 0
            mem_available = 0
            for line in content.splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    if parts[0] == "MemTotal:":
                        mem_total = int(parts[1])
                    elif parts[0] == "MemAvailable:":
                        mem_available = int(parts[1])
            info["memory"] = {
                "total_kb": mem_total,
                "available_kb": mem_available,
                "used_kb": mem_total - mem_available,
                "usage_pct": round((mem_total - mem_available) / mem_total * 100) if mem_total > 0 else 0,
            }
        except Exception:
            pass

        # Hostname
        try:
            with open("/etc/hostname") as f:
                info["hostname"] = f.read().strip()
        except Exception:
            pass

        return info
