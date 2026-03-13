"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevModule = void 0;
const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    silent: 4,
};
class DevModule {
    meta = {
        name: 'dev',
        version: '0.1.0',
        description: 'Structured logging and diagnostics',
    };
    _level;
    _prefix;
    constructor(options = {}) {
        this._level = options.level ?? 'info';
        this._prefix = options.prefix;
    }
    register(r) {
        const minLevel = this._level;
        const minOrder = LEVEL_ORDER[minLevel] ?? 1;
        const prefix = this._prefix;
        r.onInit(async (ctx) => {
            const tag = prefix ?? ctx.slug;
            console.error(`[${tag}] Dev module initialized (dataDir=${ctx.dataDir})`);
        });
        r.command('__dev:log', async (ctx, params) => {
            const level = (params.level ?? 'info').toLowerCase();
            const order = LEVEL_ORDER[level] ?? 1;
            if (order < minOrder) {
                return { status: 'filtered' };
            }
            const tag = prefix ?? ctx.slug;
            const instance = ctx.instanceId ?? 'unknown';
            const message = params.message ?? '';
            const data = params.data;
            const extra = data !== undefined ? ` | data=${JSON.stringify(data)}` : '';
            const logFn = level === 'error'
                ? console.error
                : level === 'warn'
                    ? console.warn
                    : level === 'debug'
                        ? console.debug
                        : console.info;
            logFn(`[${tag}] [${instance}] ${message}${extra}`);
            return { status: 'ok' };
        });
        r.command('__dev:info', async (ctx, _params) => {
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
exports.DevModule = DevModule;
