"use strict";
/**
 * Notifications module — emit structured notifications to frontend clients.
 *
 * Registers `__notify` and `__notify:broadcast` commands for sending
 * notifications to connected frontend instances.
 *
 * @example
 * ```ts
 * import { NotificationsModule } from '@zro/sdk';
 *
 * app.module(new NotificationsModule());
 *
 * // From frontend:
 * // conn.invoke('__notify', { title: 'Done', body: 'Build complete', level: 'success' })
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsModule = void 0;
class NotificationsModule {
    meta = {
        name: 'notifications',
        version: '0.1.0',
        description: 'Emit structured notifications to frontend clients',
    };
    register(r) {
        r.command('__notify', async (ctx, params) => {
            const notification = {
                title: params.title,
                body: params.body,
                level: params.level ?? 'info',
                duration: params.duration ?? 5000,
                actions: params.actions,
            };
            if (ctx.instanceId) {
                ctx.emitTo(ctx.instanceId, 'zro:notification', notification);
            }
            else {
                ctx.emit('zro:notification', notification);
            }
            return { status: 'ok' };
        });
        r.command('__notify:broadcast', async (ctx, params) => {
            const notification = {
                title: params.title,
                body: params.body,
                level: params.level ?? 'info',
                duration: params.duration ?? 5000,
                actions: params.actions,
            };
            ctx.emit('zro:notification', notification);
            return { status: 'ok' };
        });
    }
}
exports.NotificationsModule = NotificationsModule;
