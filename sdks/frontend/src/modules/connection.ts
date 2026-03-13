/**
 * @zro/connection — Application-level connection module.
 *
 * Provides invoke/on/emit API on top of the transport layer.
 * Handles request/response matching, event dispatching, and lifecycle hooks.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ConnectionAPI,
  TransportAPI,
  TransportState,
} from '../core/types.js';

export const connectionModule: ZroModuleFactory = () => {
  let _transport: TransportAPI;
  let _instanceId: string;
  let _listeners: Record<string, Array<(payload: unknown) => void>> = {};
  let _pendingInvokes: Record<string, {
    resolve: (val: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = {};
  let _connectionState: TransportState = 'connecting';
  let _onConnect: (info: { reconnected: boolean }) => void = () => {};
  let _onDisconnect: () => void = () => {};
  let _closed = false;
  let _instanceCounter = 0;

  function _parseUrlPath(): { slug: string | null; instanceId: string | null } {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const slug = parts[0] || null;
    const second = parts[1] || null;
    const instanceId = (second && second !== 'static' && second !== 'api') ? second : null;
    return { slug, instanceId };
  }

  function _handleWsMessage(msg: Record<string, unknown>): void {
    if (_closed) return;

    // Command response
    if (msg.type === 'response' && msg.id) {
      const pending = _pendingInvokes[msg.id as string];
      if (pending) {
        clearTimeout(pending.timer);
        delete _pendingInvokes[msg.id as string];
        if (msg.error) {
          pending.reject(new Error(msg.error as string));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Backend event
    if (msg.type === 'event' && msg.event) {
      const handlers = _listeners[msg.event as string];
      if (handlers) {
        for (const fn of handlers) {
          try { fn(msg.payload); } catch (err) { console.error('Listener error:', err); }
        }
      }
      return;
    }
  }

  const mod: ZroModule = {
    meta: {
      name: 'connection',
      version: '0.1.0',
      description: 'Application-level invoke/on/emit connection',
      category: 'core',
      dependencies: ['transport'],
    },

    init(ctx: ZroModuleContext): ConnectionAPI {
      _transport = ctx.getModule<TransportAPI>('transport');
      _onConnect = ctx.config.onConnect || (() => {});
      _onDisconnect = ctx.config.onDisconnect || (() => {});

      // Resolve instance ID
      const urlInfo = _parseUrlPath();
      _instanceId = ctx.config.instanceId
        || (urlInfo.slug === ctx.config.slug ? urlInfo.instanceId : null)
        || `${ctx.config.slug}-${++_instanceCounter}`;

      ctx.log(`Connection: slug=${ctx.config.slug} instanceId=${_instanceId}`);

      // Listen for state changes
      _transport.onState((state) => {
        _connectionState = state;
        if (state === 'disconnected') {
          _onDisconnect();
        }
      });

      // Subscribe to transport messages
      _transport.subscribe(_instanceId, (msg) => {
        if (_closed) return;

        if (msg.type === 'registered') {
          _connectionState = 'connected';
          _onConnect({ reconnected: !!msg.reconnected });
          return;
        }

        if (msg.type === 'ws_message' && msg.payload) {
          _handleWsMessage(msg.payload as Record<string, unknown>);
        }
      });

      const api: ConnectionAPI = {
        invoke<T = unknown>(
          command: string,
          params?: Record<string, unknown>,
          options?: { timeout?: number }
        ): Promise<T> {
          const timeout = options?.timeout ?? 30000;
          const id = crypto.randomUUID();

          return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
              delete _pendingInvokes[id];
              reject(new Error(`invoke('${command}') timed out`));
            }, timeout);

            _pendingInvokes[id] = {
              resolve: resolve as (val: unknown) => void,
              reject,
              timer,
            };

            _transport.send(_instanceId, {
              type: 'invoke',
              id,
              instance: _instanceId,
              command,
              params: params || {},
            });
          });
        },

        on(event: string, handler: (payload: unknown) => void): void {
          if (!_listeners[event]) _listeners[event] = [];
          _listeners[event].push(handler);
        },

        off(event: string, handler: (payload: unknown) => void): void {
          if (!_listeners[event]) return;
          _listeners[event] = _listeners[event].filter(fn => fn !== handler);
        },

        emit(event: string, data?: unknown): void {
          _transport.send(_instanceId, {
            type: 'emit',
            instance: _instanceId,
            event,
            data: data ?? null,
          });
        },

        close(): void {
          _closed = true;
          _transport.unsubscribe(_instanceId);

          // Reject all pending invokes
          for (const [id, pending] of Object.entries(_pendingInvokes)) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Connection closed'));
            delete _pendingInvokes[id];
          }
        },

        get instanceId(): string {
          return _instanceId;
        },

        get connectionState(): TransportState {
          return _connectionState;
        },
      };

      return api;
    },

    destroy(): void {
      _closed = true;
      _listeners = {};
      for (const [id, pending] of Object.entries(_pendingInvokes)) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Connection destroyed'));
        delete _pendingInvokes[id];
      }
    },
  };

  return mod;
};
