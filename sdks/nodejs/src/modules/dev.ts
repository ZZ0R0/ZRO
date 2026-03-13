/**
 * Dev module — structured logging and diagnostics.
 *
 * Provides conditional structured logging that respects a configurable
 * log level. Exposes `__dev:log` for frontend-originated log messages
 * and `__dev:info` for diagnostic information.
 *
 * @example
 * ```ts
 * import { DevModule } from '@zro/sdk';
 *
 * app.module(new DevModule({ level: 'debug', prefix: 'my-app' }));
 * ```
 */

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar, ModuleInitContext } from '../module';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};

export interface DevModuleOptions {
    /** Minimum log level (default: 'info'). */
    level?: LogLevel;
    /** Prefix for log messages (defaults to app slug). */
    prefix?: string;
}

export class DevModule implements ZroModule {
    readonly meta: ModuleMeta = {
        name: 'dev',
        version: '0.1.0',
        description: 'Structured logging and diagnostics',
    };

    private _level: LogLevel;
    private _prefix?: string;

    constructor(options: DevModuleOptions = {}) {
        this._level = options.level ?? 'info';
        this._prefix = options.prefix;
    }

    register(r: ModuleRegistrar): void {
        const minLevel = this._level;
        const minOrder = LEVEL_ORDER[minLevel] ?? 1;
        const prefix = this._prefix;

        r.onInit(async (ctx: ModuleInitContext) => {
            const tag = prefix ?? ctx.slug;
            console.error(`[${tag}] Dev module initialized (dataDir=${ctx.dataDir})`);
        });

        r.command('__dev:log', async (ctx: AppContext, params: any) => {
            const level: string = (params.level ?? 'info').toLowerCase();
            const order = LEVEL_ORDER[level] ?? 1;
            if (order < minOrder) {
                return { status: 'filtered' };
            }

            const tag = prefix ?? ctx.slug;
            const instance = ctx.instanceId ?? 'unknown';
            const message: string = params.message ?? '';
            const data = params.data;

            const extra = data !== undefined ? ` | data=${JSON.stringify(data)}` : '';
            const logFn =
                level === 'error'
                    ? console.error
                    : level === 'warn'
                      ? console.warn
                      : level === 'debug'
                        ? console.debug
                        : console.info;

            logFn(`[${tag}] [${instance}] ${message}${extra}`);
            return { status: 'ok' };
        });

        r.command('__dev:info', async (ctx: AppContext, _params: any) => {
            return {
                slug: ctx.slug,
                instance_id: ctx.instanceId,
                data_dir: ctx.dataDir,
                session: {
                    session_id: ctx.session.session_id,
                    username: ctx.session.username,
                    role: ctx.session.role,
                },
                min_log_level: minLevel,
            };
        });
    }
}
