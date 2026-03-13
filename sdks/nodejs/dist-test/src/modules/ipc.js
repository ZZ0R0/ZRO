"use strict";
/**
 * IPC module — inter-app message routing.
 *
 * Allows apps to send messages to other apps via the runtime's IPC
 * routing mechanism. Registers `__ipc:send` for outgoing messages
 * and `__ipc:receive` event handler for incoming messages.
 *
 * @example
 * ```ts
 * import { IpcModule } from '@zro/sdk';
 *
 * const ipc = new IpcModule();
 * ipc.onReceive('open-file', async (ctx, data) => {
 *     console.log(`Open file: ${data.path}`);
 *     return { opened: true };
 * });
 * app.module(ipc);
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcModule = void 0;
class IpcModule {
    meta = {
        name: 'ipc',
        version: '0.1.0',
        description: 'Inter-app message routing',
    };
    _handlers = new Map();
    /** Register a handler for incoming messages on a named channel. */
    onReceive(channel, handler) {
        this._handlers.set(channel, handler);
        return this;
    }
    register(r) {
        const handlers = this._handlers;
        r.command('__ipc:send', async (ctx, params) => {
            const payload = {
                target: params.target,
                channel: params.channel,
                data: params.data,
            };
            const ipcMsg = {
                source: ctx.slug,
                target: payload.target,
                channel: payload.channel,
                data: payload.data,
            };
            ctx.emit('__ipc:route', ipcMsg);
            return { status: 'sent' };
        });
        r.onEvent('__ipc:receive', async (ctx, data) => {
            const payload = {
                source: data.source ?? '',
                channel: data.channel ?? '',
                data: data.data,
            };
            const handler = handlers.get(payload.channel);
            if (handler) {
                try {
                    await handler(ctx, payload.data);
                    console.error(`[ipc] Message handled: ${payload.channel} from ${payload.source}`);
                }
                catch (err) {
                    console.error(`[ipc] Handler error: channel=${payload.channel} source=${payload.source}`, err);
                }
            }
            else {
                console.error(`[ipc] No handler for channel: ${payload.channel} (source=${payload.source})`);
            }
        });
    }
}
exports.IpcModule = IpcModule;
