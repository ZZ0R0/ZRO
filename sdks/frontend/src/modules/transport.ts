/**
 * @zro/transport — Core transport module.
 *
 * Encapsulates the SharedWorker + WebSocket transport layer.
 * Provides a pub/sub API: subscribe to instanceIds, send messages,
 * listen for state changes. Handles SharedWorker creation, fallback
 * to direct WebSocket, reconnection with exponential backoff, and
 * multi-port broadcasting.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  TransportAPI,
  TransportState,
  TransportCallback,
  TransportMessage,
} from '../core/types.js';

// ── SharedWorker singleton state ─────────────────────────

let _worker: SharedWorker | null = null;
let _workerPort: MessagePort | null = null;
let _workerSupported = typeof SharedWorker !== 'undefined';

const _portCallbacks = new Map<string, (msg: TransportMessage) => void>();
const _stateListeners = new Set<(state: TransportState) => void>();

function _getWorkerPort(debug: boolean): MessagePort | null {
  if (_workerPort) return _workerPort;
  if (!_workerSupported) return null;

  try {
    _worker = new SharedWorker('/static/zro-shared-worker.js', { name: 'zro' });
    _workerPort = _worker.port;

    _workerPort.onmessage = (e: MessageEvent) => {
      const data = e.data;

      if (data.type === 'log') {
        if (debug) console.log(data.msg);
        return;
      }

      if (data.type === 'state') {
        for (const cb of _stateListeners) {
          try { cb(data.state); } catch (_) { /* noop */ }
        }
        return;
      }

      if (data.type === 'registered' && data.instanceId) {
        const cb = _portCallbacks.get(data.instanceId);
        if (cb) {
          cb({ type: 'registered', reconnected: data.reconnected });
        }
        return;
      }

      if (data.type === 'message' && data.instanceId) {
        const cb = _portCallbacks.get(data.instanceId);
        if (cb) {
          cb({ type: 'ws_message', payload: data.payload });
        }
        return;
      }
    };

    _workerPort.start();
    return _workerPort;
  } catch (_) {
    _workerSupported = false;
    return null;
  }
}

// ── Direct WebSocket fallback ────────────────────────────

interface DirectWsState {
  ws: WebSocket | null;
  instanceId: string;
  slug: string;
  callback: TransportCallback | null;
  reconnectAttempts: number;
  closed: boolean;
}

function _connectDirect(ds: DirectWsState, debug: boolean): void {
  if (ds.closed) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws`;

  try {
    ds.ws = new WebSocket(url);
  } catch (_) {
    _scheduleDirectReconnect(ds, debug);
    return;
  }

  ds.ws.onopen = () => {
    ds.reconnectAttempts = 0;
    for (const cb of _stateListeners) {
      try { cb('connected'); } catch (_) { /* noop */ }
    }
    ds.ws!.send(JSON.stringify({
      type: 'register',
      instance: ds.instanceId,
      app: ds.slug,
    }));
  };

  ds.ws.onclose = () => {
    for (const cb of _stateListeners) {
      try { cb('disconnected'); } catch (_) { /* noop */ }
    }
    _scheduleDirectReconnect(ds, debug);
  };

  ds.ws.onerror = () => { /* handled by onclose */ };

  ds.ws.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'registered' && msg.instance === ds.instanceId) {
        ds.callback?.({ type: 'registered', reconnected: !!msg.reconnected });
        return;
      }
      if (msg.instance && msg.instance !== ds.instanceId) return;
      ds.callback?.({ type: 'ws_message', payload: msg });
    } catch (_) { /* malformed */ }
  };
}

function _scheduleDirectReconnect(ds: DirectWsState, debug: boolean): void {
  if (ds.closed) return;
  ds.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, ds.reconnectAttempts - 1), 30000);
  setTimeout(() => _connectDirect(ds, debug), delay);
}

// ── Module factory ───────────────────────────────────────

export const transportModule: ZroModuleFactory = () => {
  let _mode: 'worker' | 'direct' = 'worker';
  let _directState: DirectWsState | null = null;
  let _currentState: TransportState = 'disconnected';
  let _debug = false;

  const mod: ZroModule = {
    meta: {
      name: 'transport',
      version: '0.1.0',
      description: 'SharedWorker + WebSocket transport layer',
      category: 'core',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): TransportAPI {
      _debug = ctx.config.debug ?? false;
      const port = _getWorkerPort(_debug);

      if (port) {
        _mode = 'worker';
        ctx.log('Transport: SharedWorker mode');
      } else {
        _mode = 'direct';
        ctx.log('Transport: Direct WebSocket fallback');
      }

      // Track state
      _stateListeners.add((state) => {
        _currentState = state;
      });

      const api: TransportAPI = {
        send(instanceId: string, payload: unknown): void {
          if (_mode === 'worker') {
            const p = _getWorkerPort(_debug);
            if (p) {
              p.postMessage({ type: 'send', instanceId, payload });
            }
          } else if (_directState?.ws?.readyState === WebSocket.OPEN) {
            _directState.ws.send(JSON.stringify(payload));
          }
        },

        subscribe(instanceId: string, callback: TransportCallback): void {
          if (_mode === 'worker') {
            _portCallbacks.set(instanceId, callback);
            const p = _getWorkerPort(_debug);
            if (p) {
              p.postMessage({
                type: 'register',
                instanceId,
                slug: ctx.config.slug,
              });
            }
          } else {
            // Direct mode — create connection
            _directState = {
              ws: null,
              instanceId,
              slug: ctx.config.slug,
              callback,
              reconnectAttempts: 0,
              closed: false,
            };
            _connectDirect(_directState, _debug);
          }
        },

        unsubscribe(instanceId: string): void {
          if (_mode === 'worker') {
            _portCallbacks.delete(instanceId);
            const p = _getWorkerPort(_debug);
            if (p) {
              p.postMessage({ type: 'unregister', instanceId });
            }
          } else if (_directState) {
            _directState.closed = true;
            if (_directState.ws?.readyState === WebSocket.OPEN) {
              try {
                _directState.ws.send(JSON.stringify({
                  type: 'unregister',
                  instance: instanceId,
                }));
              } catch (_) { /* noop */ }
              _directState.ws.close();
            }
            _directState = null;
          }
        },

        onState(callback: (state: TransportState) => void): () => void {
          _stateListeners.add(callback);
          return () => _stateListeners.delete(callback);
        },

        get state(): TransportState {
          return _currentState;
        },
      };

      return api;
    },

    destroy(): void {
      // Clean up all subscriptions
      for (const id of _portCallbacks.keys()) {
        const p = _getWorkerPort(_debug);
        if (p) {
          p.postMessage({ type: 'unregister', instanceId: id });
        }
      }
      _portCallbacks.clear();
      _stateListeners.clear();

      if (_directState) {
        _directState.closed = true;
        _directState.ws?.close();
        _directState = null;
      }
    },
  };

  return mod;
};
