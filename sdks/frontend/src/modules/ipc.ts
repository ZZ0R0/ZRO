/**
 * @zro/ipc — Inter-app communication module.
 *
 * Allows apps to send messages to other apps. Two paths:
 * 1. Frontend-to-frontend via SharedWorker (fast, no server)
 * 2. Server-routed via backend invoke (with permission checks)
 *
 * Each app can register handlers on named channels.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ConnectionAPI,
  TransportAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface IpcMessage {
  /** Source app slug. */
  from: string;
  /** Channel name. */
  channel: string;
  /** Message payload. */
  data: unknown;
}

export interface IpcAPI {
  /** Send a message to another app (frontend-to-frontend). */
  send(targetSlug: string, channel: string, data: unknown): void;

  /** Send a message via the backend (server-routed with permission checks). */
  sendViaBackend(targetSlug: string, channel: string, data: unknown): Promise<unknown>;

  /** Register a handler for incoming messages on a channel. */
  on(channel: string, handler: (message: IpcMessage) => void): () => void;

  /** Remove all handlers for a channel. */
  off(channel: string): void;

  /** List all registered channels. */
  channels(): string[];
}

// ── Module factory ───────────────────────────────────────

export const ipcModule: ZroModuleFactory = () => {
  let _handlers: Map<string, Array<(msg: IpcMessage) => void>> = new Map();
  let _messageHandler: ((e: MessageEvent) => void) | null = null;
  let _slug = '';

  const mod: ZroModule = {
    meta: {
      name: 'ipc',
      version: '0.1.0',
      description: 'Inter-app communication (frontend + backend)',
      category: 'data',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): IpcAPI {
      _slug = ctx.config.slug;

      const connection = ctx.hasModule('connection')
        ? ctx.getModule<ConnectionAPI>('connection')
        : null;

      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      // Listen for IPC messages from shell/worker
      _messageHandler = (e: MessageEvent) => {
        if (!e.data || e.data.type !== 'zro:ipc:message') return;

        const msg: IpcMessage = {
          from: e.data.from ?? 'unknown',
          channel: e.data.channel ?? '',
          data: e.data.data,
        };

        const handlers = _handlers.get(msg.channel);
        if (handlers) {
          for (const handler of handlers) {
            try { handler(msg); } catch (_) { /* noop */ }
          }
        }
      };
      window.addEventListener('message', _messageHandler);

      // Also listen for IPC via connection events (server-routed)
      if (connection) {
        connection.on('__ipc:receive', (payload: unknown) => {
          const p = payload as { from?: string; channel?: string; data?: unknown };
          const msg: IpcMessage = {
            from: p.from ?? 'unknown',
            channel: p.channel ?? '',
            data: p.data,
          };
          const handlers = _handlers.get(msg.channel);
          if (handlers) {
            for (const handler of handlers) {
              try { handler(msg); } catch (_) { /* noop */ }
            }
          }
        });
      }

      const api: IpcAPI = {
        send(targetSlug: string, channel: string, data: unknown): void {
          if (isInShell) {
            parent.postMessage({
              type: 'zro:ipc:send',
              from: _slug,
              target: targetSlug,
              channel,
              data,
            }, '*');
          }
        },

        async sendViaBackend(targetSlug: string, channel: string, data: unknown): Promise<unknown> {
          if (!connection) {
            throw new Error('IPC.sendViaBackend requires the connection module');
          }
          return connection.invoke('__ipc:send', {
            target: targetSlug,
            channel,
            data,
          });
        },

        on(channel: string, handler: (message: IpcMessage) => void): () => void {
          if (!_handlers.has(channel)) {
            _handlers.set(channel, []);
          }
          _handlers.get(channel)!.push(handler);
          return () => {
            const arr = _handlers.get(channel);
            if (arr) {
              _handlers.set(channel, arr.filter(h => h !== handler));
            }
          };
        },

        off(channel: string): void {
          _handlers.delete(channel);
        },

        channels(): string[] {
          return [..._handlers.keys()];
        },
      };

      return api;
    },

    destroy(): void {
      if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
      }
      _handlers.clear();
    },
  };

  return mod;
};
