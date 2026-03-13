"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleModule = void 0;
class LifecycleModule {
    meta = {
        name: 'lifecycle',
        version: '0.1.0',
        description: 'Grace-period management for client connections',
    };
    _gracePeriod;
    _onTimeout;
    _onConnect;
    _onDisconnect;
    _timers = new Map();
    constructor(options = {}) {
        this._gracePeriod = options.gracePeriod ?? 5000;
        this._onTimeout = options.onTimeout;
        this._onConnect = options.onConnect;
        this._onDisconnect = options.onDisconnect;
    }
    _cancelTimer(instanceId) {
        const timer = this._timers.get(instanceId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._timers.delete(instanceId);
            console.error(`[lifecycle] Cancelled grace-period timer for ${instanceId}`);
            return true;
        }
        return false;
    }
    _startTimer(ctx) {
        const instanceId = ctx.instanceId;
        if (!instanceId)
            return;
        // Cancel any existing timer first
        this._cancelTimer(instanceId);
        const timer = setTimeout(async () => {
            this._timers.delete(instanceId);
            console.error(`[lifecycle] Grace period expired for ${instanceId} (${this._gracePeriod}ms), running cleanup`);
            if (this._onTimeout) {
                await this._onTimeout(ctx);
            }
        }, this._gracePeriod);
        this._timers.set(instanceId, timer);
    }
    register(r) {
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
exports.LifecycleModule = LifecycleModule;
