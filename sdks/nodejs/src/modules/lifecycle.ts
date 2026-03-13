/**
 * Lifecycle module — grace-period management for client connections.
 *
 * When a client disconnects, the module starts a configurable grace-period
 * timer. If the client reconnects before the timer expires, the timer is
 * cancelled. If the timer expires, a cleanup callback is invoked.
 *
 * @example
 * ```ts
 * import { LifecycleModule } from '@zro/sdk';
 *
 * const lifecycle = new LifecycleModule({
 *     gracePeriod: 10_000,
 *     onTimeout: async (ctx) => {
 *         console.log(`Session ${ctx.session.session_id} timed out`);
 *     },
 * });
 * app.module(lifecycle);
 * ```
 */

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar } from '../module';

export interface LifecycleModuleOptions {
    /** Grace period in milliseconds (default: 5000). */
    gracePeriod?: number;
    /** Called when grace period expires without reconnection. */
    onTimeout?: (ctx: AppContext) => Promise<void>;
    /** Called when a client connects. */
    onConnect?: (ctx: AppContext) => Promise<void>;
    /** Called when a client disconnects (before grace period starts). */
    onDisconnect?: (ctx: AppContext) => Promise<void>;
}

export class LifecycleModule implements ZroModule {
    readonly meta: ModuleMeta = {
        name: 'lifecycle',
        version: '0.1.0',
        description: 'Grace-period management for client connections',
    };

    private _gracePeriod: number;
    private _onTimeout?: (ctx: AppContext) => Promise<void>;
    private _onConnect?: (ctx: AppContext) => Promise<void>;
    private _onDisconnect?: (ctx: AppContext) => Promise<void>;
    private _timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(options: LifecycleModuleOptions = {}) {
        this._gracePeriod = options.gracePeriod ?? 5000;
        this._onTimeout = options.onTimeout;
        this._onConnect = options.onConnect;
        this._onDisconnect = options.onDisconnect;
    }

    private _cancelTimer(instanceId: string): boolean {
        const timer = this._timers.get(instanceId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._timers.delete(instanceId);
            console.error(`[lifecycle] Cancelled grace-period timer for ${instanceId}`);
            return true;
        }
        return false;
    }

    private _startTimer(ctx: AppContext): void {
        const instanceId = ctx.instanceId;
        if (!instanceId) return;

        // Cancel any existing timer first
        this._cancelTimer(instanceId);

        const timer = setTimeout(async () => {
            this._timers.delete(instanceId);
            console.error(
                `[lifecycle] Grace period expired for ${instanceId} (${this._gracePeriod}ms), running cleanup`,
            );
            if (this._onTimeout) {
                await this._onTimeout(ctx);
            }
        }, this._gracePeriod);

        this._timers.set(instanceId, timer);
    }

    register(r: ModuleRegistrar): void {
        r.on('client:connected', async (ctx) => {
            if (ctx.instanceId) {
                this._cancelTimer(ctx.instanceId);
            }
            if (this._onConnect) {
                await this._onConnect(ctx);
            }
        });

        r.on('client:disconnected', async (ctx) => {
            if (this._onDisconnect) {
                await this._onDisconnect(ctx);
            }
            this._startTimer(ctx);
        });

        r.on('client:reconnected', async (ctx) => {
            if (ctx.instanceId) {
                this._cancelTimer(ctx.instanceId);
            }
        });
    }
}
