/**
 * System module — expose Linux system metrics to the frontend.
 *
 * @example
 * ```ts
 * import { SystemModule } from '@zro/sdk';
 *
 * app.module(new SystemModule());
 *
 * // From frontend:
 * // conn.invoke('__sys:info', {})
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar } from '../module';

export class SystemModule implements ZroModule {
    meta(): ModuleMeta {
        return {
            name: 'system',
            version: '0.1.0',
            description: 'Linux system metrics',
            dependencies: [],
        };
    }

    register(reg: ModuleRegistrar): void {
        reg.command('__sys:info', async (_ctx: AppContext, _params: any) => {
            return gatherSysInfo();
        });
    }
}

function gatherSysInfo(): Record<string, any> {
    const info: Record<string, any> = {};

    // Uptime
    try {
        const uptime = fs.readFileSync('/proc/uptime', 'utf-8');
        const secs = parseFloat(uptime.split(/\s+/)[0]);
        if (!isNaN(secs)) info.uptime_secs = Math.floor(secs);
    } catch {}

    // Load average
    try {
        const loadavg = fs.readFileSync('/proc/loadavg', 'utf-8');
        const parts = loadavg.split(/\s+/);
        if (parts.length >= 3) {
            info.load_avg = {
                '1m': parseFloat(parts[0]) || 0,
                '5m': parseFloat(parts[1]) || 0,
                '15m': parseFloat(parts[2]) || 0,
            };
        }
    } catch {}

    // Memory
    try {
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
        let memTotal = 0;
        let memAvailable = 0;
        for (const line of meminfo.split('\n')) {
            const parts = line.split(/\s+/);
            if (parts[0] === 'MemTotal:') memTotal = parseInt(parts[1]) || 0;
            if (parts[0] === 'MemAvailable:') memAvailable = parseInt(parts[1]) || 0;
        }
        info.memory = {
            total_kb: memTotal,
            available_kb: memAvailable,
            used_kb: memTotal - memAvailable,
            usage_pct: memTotal > 0 ? Math.round(((memTotal - memAvailable) / memTotal) * 100) : 0,
        };
    } catch {}

    // Hostname
    try {
        info.hostname = fs.readFileSync('/etc/hostname', 'utf-8').trim();
    } catch {}

    return info;
}
