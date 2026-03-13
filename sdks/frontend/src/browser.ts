/**
 * Browser entry point — creates the global `window.ZroClient`.
 *
 * This file is the entry point for the IIFE browser bundle.
 * It wraps the modular SDK into the legacy global API so that
 * existing apps continue to work without changes.
 *
 * Existing apps use:
 *   const conn = ZroClient.connect({ slug: 'my-app', onConnect: ... });
 *   conn.invoke('cmd', { ... });
 *
 * The new modular API is:
 *   const app = await ZroClient.create({ slug: 'my-app' });
 *   app.invoke('cmd', { ... });
 *
 * Both APIs are supported in the browser bundle.
 */

import { ZroClient, ZroApp } from './client.js';
import { ModuleRegistry } from './core/registry.js';
import type { ZroModuleFactory, ZroConfig } from './core/types.js';
import {
  transportModule,
  connectionModule,
  stateModule,
  shellModule,
  httpModule,
  lifecycleModule,
  replayBufferModule,
  themeModule,
  clipboardModule,
  dndModule,
  keybindingsModule,
  notificationsModule,
  ipcModule,
  storageModule,
  routerModule,
  formModule,
  windowModeModule,
  taskbarModule,
  launcherModule,
  devModule,
} from './modules/index.js';

// ── Legacy connection wrapper ────────────────────────────

/**
 * LegacyConnection wraps ZroApp to provide the old sync-style API.
 * `ZroClient.connect()` used to return a connection object synchronously.
 * Now it creates modules async, but we provide a proxy that queues calls.
 */
class LegacyConnection {
  private _app: ZroApp | null = null;
  private _queue: Array<() => void> = [];
  private _listeners: Record<string, Array<(payload: unknown) => void>> = {};
  private _slug: string;
  private _instanceId: string | null = null;
  private _connectionState: string = 'connecting';

  constructor(options: ZroConfig) {
    this._slug = options.slug;

    // Initialize async — queue operations until ready
    ZroClient.create(options).then((app) => {
      this._app = app;
      this._instanceId = app.connection.instanceId;
      this._connectionState = app.connection.connectionState;

      // Re-attach listeners that were registered before init completed
      for (const [event, handlers] of Object.entries(this._listeners)) {
        for (const handler of handlers) {
          app.connection.on(event, handler);
        }
      }

      // Flush queued operations
      for (const fn of this._queue) fn();
      this._queue = [];
    });
  }

  get connectionState(): string { return this._app?.connection.connectionState ?? this._connectionState; }
  get instanceId(): string | null { return this._app?.connection.instanceId ?? this._instanceId; }

  invoke(command: string, params?: Record<string, unknown>, options?: { timeout?: number }): Promise<unknown> {
    if (this._app) {
      return this._app.connection.invoke(command, params, options);
    }
    return new Promise((resolve, reject) => {
      this._queue.push(() => {
        this._app!.connection.invoke(command, params, options).then(resolve, reject);
      });
    });
  }

  listen(event: string, handler: (payload: unknown) => void): void {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    if (this._app) {
      this._app.connection.on(event, handler);
    }
  }

  unlisten(event: string, handler: (payload: unknown) => void): void {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(fn => fn !== handler);
    }
    if (this._app) {
      this._app.connection.off(event, handler);
    }
  }

  on(event: string, handler: (payload: unknown) => void): void { this.listen(event, handler); }
  off(event: string, handler: (payload: unknown) => void): void { this.unlisten(event, handler); }

  emit(event: string, data?: unknown): void {
    if (this._app) {
      this._app.connection.emit(event, data);
    } else {
      this._queue.push(() => this._app!.connection.emit(event, data));
    }
  }

  send(event: string, data?: unknown): void { this.emit(event, data); }

  get state() {
    const self = this;
    return {
      save(key: string, value: unknown): Promise<void> {
        if (self._app) return self._app.state.save(key, value);
        return new Promise((resolve, reject) => {
          self._queue.push(() => self._app!.state.save(key, value).then(resolve, reject));
        });
      },
      restore(key: string): Promise<unknown> {
        if (self._app) return self._app.state.restore(key);
        return new Promise((resolve, reject) => {
          self._queue.push(() => self._app!.state.restore(key).then(resolve, reject));
        });
      },
      delete(key: string): Promise<void> {
        if (self._app) return self._app.state.delete(key);
        return new Promise((resolve, reject) => {
          self._queue.push(() => self._app!.state.delete(key).then(resolve, reject));
        });
      },
      keys(): Promise<string[]> {
        if (self._app) return self._app.state.keys();
        return new Promise((resolve, reject) => {
          self._queue.push(() => self._app!.state.keys().then(resolve, reject));
        });
      },
    };
  }

  close(): void {
    if (this._app) {
      this._app.connection.close();
    } else {
      this._queue.push(() => this._app!.connection.close());
    }
  }
}

// ── Browser global ───────────────────────────────────────

function _parseUrlPath(): { slug: string | null; instanceId: string | null } {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const slug = parts[0] || null;
  const second = parts[1] || null;
  const instanceId = (second && second !== 'static' && second !== 'api') ? second : null;
  return { slug, instanceId };
}

let _shellInstance: unknown = null;

const BrowserZroClient = {
  /**
   * Modern API — create with all modules.
   */
  create: ZroClient.create.bind(ZroClient),

  /**
   * Legacy API — returns a LegacyConnection that handles async init.
   * Backward-compatible: returns synchronously with queued operations.
   */
  connect(options: ZroConfig): LegacyConnection {
    return new LegacyConnection(options);
  },

  get isInShell(): boolean {
    try { return window !== window.parent; } catch (_) { return true; }
  },

  get shell() {
    if (!_shellInstance) {
      // Create a temporary shell module instance
      const mod = shellModule();
      _shellInstance = mod.init({
        getModule: () => { throw new Error('No modules in standalone shell'); },
        hasModule: () => false,
        config: { slug: '' },
        log: () => {},
      });
    }
    return _shellInstance;
  },

  slugFromUrl(): string | null {
    return _parseUrlPath().slug;
  },

  instanceIdFromUrl(): string | null {
    return _parseUrlPath().instanceId;
  },

  get hasSharedWorker(): boolean {
    return typeof SharedWorker !== 'undefined';
  },

  api: ZroClient.api.bind(ZroClient),

  // Expose module system for advanced usage
  ModuleRegistry,
  modules: {
    transport: transportModule,
    connection: connectionModule,
    state: stateModule,
    shell: shellModule,
    http: httpModule,
    lifecycle: lifecycleModule,
    replayBuffer: replayBufferModule,
    theme: themeModule,
    clipboard: clipboardModule,
    dnd: dndModule,
    keybindings: keybindingsModule,
    notifications: notificationsModule,
    ipc: ipcModule,
    storage: storageModule,
    router: routerModule,
    form: formModule,
    windowMode: windowModeModule,
    taskbar: taskbarModule,
    launcher: launcherModule,
    dev: devModule,
  },
};

// Set as global
(window as unknown as Record<string, unknown>).ZroClient = BrowserZroClient;

// Also export for ES module bundlers
export { BrowserZroClient as ZroClient };
