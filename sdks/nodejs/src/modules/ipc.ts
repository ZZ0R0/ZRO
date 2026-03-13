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

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar } from '../module';

export type IpcHandler = (ctx: AppContext, data: any) => Promise<any>;

export interface IpcSendPayload {
    target: string;
    channel: string;
    data?: any;
}

export interface IpcReceivePayload {
    source: string;
    channel: string;
    data?: any;
}

export class IpcModule implements ZroModule {
    readonly meta: ModuleMeta = {
        name: 'ipc',
        version: '0.1.0',
        description: 'Inter-app message routing',
    };

    private _handlers = new Map<string, IpcHandler>();

    /** Register a handler for incoming messages on a named channel. */
    onReceive(channel: string, handler: IpcHandler): this {
        this._handlers.set(channel, handler);
        return this;
    }

    register(r: ModuleRegistrar): void {
        const handlers = this._handlers;

        r.command('__ipc:send', async (ctx: AppContext, params: any) => {
            const payload: IpcSendPayload = {
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

        r.onEvent('__ipc:receive', async (ctx: AppContext, data: any) => {
            const payload: IpcReceivePayload = {
                source: data.source ?? '',
                channel: data.channel ?? '',
                data: data.data,
            };

            const handler = handlers.get(payload.channel);
            if (handler) {
                try {
                    await handler(ctx, payload.data);
                    console.error(
                        `[ipc] Message handled: ${payload.channel} from ${payload.source}`,
                    );
                } catch (err) {
                    console.error(
                        `[ipc] Handler error: channel=${payload.channel} source=${payload.source}`,
                        err,
                    );
                }
            } else {
                console.error(
                    `[ipc] No handler for channel: ${payload.channel} (source=${payload.source})`,
                );
            }
        });
    }
}
