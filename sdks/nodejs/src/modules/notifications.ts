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

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar } from '../module';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
    id: string;
    label: string;
}

export interface Notification {
    title: string;
    body?: string;
    level?: NotificationLevel;
    duration?: number;
    actions?: NotificationAction[];
}

export class NotificationsModule implements ZroModule {
    readonly meta: ModuleMeta = {
        name: 'notifications',
        version: '0.1.0',
        description: 'Emit structured notifications to frontend clients',
    };

    register(r: ModuleRegistrar): void {
        r.command('__notify', async (ctx: AppContext, params: any) => {
            const notification: Notification = {
                title: params.title,
                body: params.body,
                level: params.level ?? 'info',
                duration: params.duration ?? 5000,
                actions: params.actions,
            };

            if (ctx.instanceId) {
                ctx.emitTo(ctx.instanceId, 'zro:notification', notification);
            } else {
                ctx.emit('zro:notification', notification);
            }

            return { status: 'ok' };
        });

        r.command('__notify:broadcast', async (ctx: AppContext, params: any) => {
            const notification: Notification = {
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
