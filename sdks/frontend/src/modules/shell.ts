/**
 * @zro/shell — Shell integration module.
 *
 * Provides API for apps to communicate with the shell parent window
 * via postMessage. Auto-detects shell vs standalone mode.
 * All methods are no-op in standalone mode.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ShellAPI,
} from '../core/types.js';

export const shellModule: ZroModuleFactory = () => {
  const mod: ZroModule = {
    meta: {
      name: 'shell',
      version: '0.1.0',
      description: 'Shell integration (postMessage protocol)',
      category: 'shell',
      dependencies: [],
    },

    init(_ctx: ZroModuleContext): ShellAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      // Standalone stub — all methods are no-ops
      if (!isInShell) {
        return {
          isInShell: false,
          setTitle: () => Promise.resolve(),
          notify: () => Promise.resolve(),
          setBadgeCount: () => Promise.resolve(),
          requestFocus: () => Promise.resolve(),
          minimize: () => Promise.resolve(),
          maximize: () => Promise.resolve(),
          restore: () => Promise.resolve(),
          close: () => Promise.resolve(),
          getWindowInfo: () => Promise.resolve(null),
          on: () => {},
          off: () => {},
        };
      }

      // Shell mode — real postMessage communication
      const _pending = new Map<string, {
        resolve: (val: unknown) => void;
        reject: (err: Error) => void;
      }>();
      const _listeners = new Map<string, Array<(payload: unknown) => void>>();
      let _reqId = 0;

      const _messageHandler = (e: MessageEvent) => {
        if (!e.data || typeof e.data.type !== 'string') return;

        if (e.data.type === 'zro:shell:response' && e.data.requestId) {
          const resolver = _pending.get(e.data.requestId);
          if (resolver) {
            _pending.delete(e.data.requestId);
            if (e.data.success === false) {
              resolver.reject(new Error(e.data.payload?.error || 'Shell API error'));
            } else {
              resolver.resolve(e.data.payload);
            }
          }
        }

        if (e.data.type === 'zro:shell:event' && e.data.event) {
          const handlers = _listeners.get(e.data.event) || [];
          for (const h of handlers) {
            try { h(e.data.payload); } catch (_) { /* noop */ }
          }
        }
      };

      window.addEventListener('message', _messageHandler);

      function _send(method: string, payload?: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
          const requestId = `req_${++_reqId}`;
          _pending.set(requestId, { resolve, reject });
          parent.postMessage({
            type: `zro:shell:${method}`,
            requestId,
            payload: payload || {},
          }, '*');
          setTimeout(() => {
            if (_pending.has(requestId)) {
              _pending.delete(requestId);
              reject(new Error(`Shell API timeout: ${method}`));
            }
          }, 5000);
        });
      }

      const api: ShellAPI = {
        isInShell: true,
        setTitle: (title) => _send('setTitle', { title }) as Promise<void>,
        notify: (opts) => _send('notify', opts) as Promise<void>,
        setBadgeCount: (count) => _send('setBadgeCount', { count }) as Promise<void>,
        requestFocus: () => _send('requestFocus') as Promise<void>,
        minimize: () => _send('minimize') as Promise<void>,
        maximize: () => _send('maximize') as Promise<void>,
        restore: () => _send('restore') as Promise<void>,
        close: () => _send('close') as Promise<void>,
        getWindowInfo: () => _send('getWindowInfo'),

        on(event: string, handler: (payload: unknown) => void): void {
          if (!_listeners.has(event)) _listeners.set(event, []);
          _listeners.get(event)!.push(handler);
        },

        off(event: string, handler: (payload: unknown) => void): void {
          const arr = _listeners.get(event);
          if (arr) _listeners.set(event, arr.filter(h => h !== handler));
        },
      };

      return api;
    },
  };

  return mod;
};
