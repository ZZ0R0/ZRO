/**
 * ZroClient — Main entry point for the ZRO Frontend SDK.
 *
 * Usage (ES modules):
 *   import { ZroClient } from '@zro/frontend-sdk';
 *   const app = await ZroClient.create({ slug: 'my-app' });
 *   const result = await app.connection.invoke('my_command', { key: 'value' });
 *
 * Usage (browser global, backward-compatible):
 *   <script src="/static/zro-client.js"></script>
 *   const app = await ZroClient.create({ slug: 'my-app' });
 *   // or the legacy API:
 *   const conn = ZroClient.connect({ slug: 'my-app' });
 *
 * The client auto-registers all core modules and initializes them in
 * dependency order. Developers can also register custom modules.
 */

import { ModuleRegistry } from './core/registry.js';
import type {
  ZroConfig,
  ZroModuleFactory,
  ConnectionAPI,
  TransportAPI,
  StateAPI,
  ShellAPI,
  HttpAPI,
  LifecycleAPI,
  ReplayBufferAPI,
  ThemeAPI,
  ClipboardAPI,
  DndAPI,
  KeybindingsAPI,
  NotificationsAPI,
  IpcAPI,
  StorageAPI,
  RouterAPI,
  FormAPI,
  WindowModeAPI,
  TaskbarAPI,
  LauncherAPI,
  DevAPI,
} from './core/types.js';

// Built-in modules
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

// ── Default modules (registered automatically) ──────────

const DEFAULT_MODULES: ZroModuleFactory[] = [
  // Core
  transportModule,
  connectionModule,
  stateModule,
  lifecycleModule,
  replayBufferModule,
  // Shell
  shellModule,
  windowModeModule,
  taskbarModule,
  launcherModule,
  // Data
  httpModule,
  storageModule,
  ipcModule,
  // UX
  themeModule,
  clipboardModule,
  dndModule,
  keybindingsModule,
  notificationsModule,
  // Util
  routerModule,
  formModule,
  // Dev
  devModule,
];

// ── ZroApp — Initialized SDK instance ────────────────────

export class ZroApp {
  private _registry: ModuleRegistry;
  private _config: ZroConfig;

  constructor(registry: ModuleRegistry, config: ZroConfig) {
    this._registry = registry;
    this._config = config;
  }

  /** Access the transport module API. */
  get transport(): TransportAPI {
    return this._registry.get<TransportAPI>('transport');
  }

  /** Access the connection module API (invoke/on/emit). */
  get connection(): ConnectionAPI {
    return this._registry.get<ConnectionAPI>('connection');
  }

  /** Access the persistent state module API. */
  get state(): StateAPI {
    return this._registry.get<StateAPI>('state');
  }

  /** Access the shell integration module API. */
  get shell(): ShellAPI {
    return this._registry.get<ShellAPI>('shell');
  }

  /** Access the HTTP client module API. */
  get http(): HttpAPI {
    return this._registry.get<HttpAPI>('http');
  }

  /** Access the lifecycle module API. */
  get lifecycle(): LifecycleAPI {
    return this._registry.get<LifecycleAPI>('lifecycle');
  }

  /** Access the replay buffer module API. */
  get replayBuffer(): ReplayBufferAPI {
    return this._registry.get<ReplayBufferAPI>('replay-buffer');
  }

  /** Access the theme module API. */
  get theme(): ThemeAPI {
    return this._registry.get<ThemeAPI>('theme');
  }

  /** Access the clipboard module API. */
  get clipboard(): ClipboardAPI {
    return this._registry.get<ClipboardAPI>('clipboard');
  }

  /** Access the drag-and-drop module API. */
  get dnd(): DndAPI {
    return this._registry.get<DndAPI>('dnd');
  }

  /** Access the keybindings module API. */
  get keybindings(): KeybindingsAPI {
    return this._registry.get<KeybindingsAPI>('keybindings');
  }

  /** Access the notifications module API. */
  get notifications(): NotificationsAPI {
    return this._registry.get<NotificationsAPI>('notifications');
  }

  /** Access the IPC module API. */
  get ipc(): IpcAPI {
    return this._registry.get<IpcAPI>('ipc');
  }

  /** Access the scoped storage module API. */
  get storage(): StorageAPI {
    return this._registry.get<StorageAPI>('storage');
  }

  /** Access the router module API. */
  get router(): RouterAPI {
    return this._registry.get<RouterAPI>('router');
  }

  /** Access the form module API. */
  get form(): FormAPI {
    return this._registry.get<FormAPI>('form');
  }

  /** Access the window mode module API. */
  get windowMode(): WindowModeAPI {
    return this._registry.get<WindowModeAPI>('window-mode');
  }

  /** Access the taskbar module API. */
  get taskbar(): TaskbarAPI {
    return this._registry.get<TaskbarAPI>('taskbar');
  }

  /** Access the launcher module API. */
  get launcher(): LauncherAPI {
    return this._registry.get<LauncherAPI>('launcher');
  }

  /** Access the dev tools module API. */
  get dev(): DevAPI {
    return this._registry.get<DevAPI>('dev');
  }

  /** Get any module by name. */
  module<T = unknown>(name: string): T {
    return this._registry.get<T>(name);
  }

  /** Check if a module is available. */
  hasModule(name: string): boolean {
    return this._registry.has(name);
  }

  /** List all initialized modules. */
  modules(): string[] {
    return this._registry.list();
  }

  /** App config. */
  get config(): ZroConfig {
    return this._config;
  }

  /** Shortcut: invoke a backend command. */
  invoke<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T> {
    return this.connection.invoke<T>(command, params);
  }

  /** Shortcut: listen for a backend event. */
  on(event: string, handler: (payload: unknown) => void): void {
    this.connection.on(event, handler);
  }

  /** Shortcut: remove a backend event listener. */
  off(event: string, handler: (payload: unknown) => void): void {
    this.connection.off(event, handler);
  }

  /** Shortcut: fire-and-forget event to backend. */
  emit(event: string, data?: unknown): void {
    this.connection.emit(event, data);
  }

  /** Destroy the app and all modules. */
  async destroy(): Promise<void> {
    await this._registry.destroy();
  }
}

// ── ZroClient — Static factory ───────────────────────────

/**
 * URL path parser — extract slug and instanceId from current URL.
 */
function _parseUrlPath(): { slug: string | null; instanceId: string | null } {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const slug = parts[0] || null;
  const second = parts[1] || null;
  const instanceId = (second && second !== 'static' && second !== 'api') ? second : null;
  return { slug, instanceId };
}

export const ZroClient = {
  /**
   * Create a new ZRO app instance with all modules initialized.
   * This is the recommended modern API.
   *
   * @example
   *   const app = await ZroClient.create({
   *     slug: 'my-app',
   *     onConnect: (info) => console.log('Connected!', info),
   *   });
   */
  async create(
    config: ZroConfig,
    extraModules?: ZroModuleFactory[]
  ): Promise<ZroApp> {
    const registry = new ModuleRegistry();

    // Register default modules
    registry.registerAll(DEFAULT_MODULES);

    // Register any extra modules
    if (extraModules) {
      registry.registerAll(extraModules);
    }

    // Initialize all in dependency order
    await registry.init(config);

    return new ZroApp(registry, config);
  },

  /**
   * Legacy-compatible connect() — returns a Promise<ZroApp> that
   * resolves when connected. Wraps create() for backward compatibility.
   *
   * @example
   *   const app = await ZroClient.connect({ slug: 'echo' });
   *   const result = await app.invoke('ping');
   */
  async connect(
    options: ZroConfig & {
      onConnect?: (info: { reconnected: boolean }) => void;
      onDisconnect?: () => void;
      onError?: (err: unknown) => void;
    }
  ): Promise<ZroApp> {
    return this.create(options);
  },

  /** Whether the app is running inside the Shell (in an iframe). */
  get isInShell(): boolean {
    try { return window !== window.parent; } catch (_) { return true; }
  },

  /** Auto-detect the app slug from the current URL. */
  slugFromUrl(): string | null {
    return _parseUrlPath().slug;
  },

  /** Auto-detect the instance ID from the current URL. */
  instanceIdFromUrl(): string | null {
    return _parseUrlPath().instanceId;
  },

  /** Whether SharedWorker transport is available. */
  get hasSharedWorker(): boolean {
    return typeof SharedWorker !== 'undefined';
  },

  /**
   * HTTP API call (standalone, no app instance needed).
   * Preserved for backward compatibility.
   */
  async api<T = unknown>(
    slug: string,
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>
  ): Promise<T> {
    const urlInfo = _parseUrlPath();
    const prefix = (urlInfo.slug === slug && urlInfo.instanceId)
      ? `/${slug}/${urlInfo.instanceId}`
      : `/${slug}`;
    let url = `${prefix}/api${path}`;
    if (query) {
      const params = new URLSearchParams(query);
      url += `?${params.toString()}`;
    }
    const opts: RequestInit = {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (body && method.toUpperCase() !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text = await resp.text();
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
      const err = new Error((parsed.error as string) || `HTTP ${resp.status}`) as Error & { status: number; data: unknown };
      err.status = resp.status;
      err.data = parsed;
      throw err;
    }
    const text = await resp.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  },
};
