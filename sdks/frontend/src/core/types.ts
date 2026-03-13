/**
 * @zro/core — Module system types and interfaces.
 *
 * Every ZRO frontend module implements ZroModule. The module registry
 * handles dependency resolution, initialization order, and lifecycle.
 */

// ── Module Metadata ──────────────────────────────────────

export interface ZroModuleMeta {
  /** Unique module name, e.g. 'transport', 'connection', 'state' */
  readonly name: string;

  /** Semver version string */
  readonly version: string;

  /** Human-readable description */
  readonly description?: string;

  /** Module category for organization */
  readonly category: 'core' | 'shell' | 'data' | 'ux' | 'util' | 'dev';

  /** Names of modules this module depends on (must be initialized first) */
  readonly dependencies?: string[];
}

// ── Module Lifecycle ─────────────────────────────────────

export interface ZroModuleContext {
  /** Retrieve another module's public API by name. */
  getModule<T = unknown>(name: string): T;

  /** Check if a module is available. */
  hasModule(name: string): boolean;

  /** The ZRO client configuration (slug, instanceId, etc.) */
  readonly config: ZroConfig;

  /** Log with module prefix. */
  log(...args: unknown[]): void;
}

export interface ZroModule {
  /** Module metadata — name, version, deps. */
  readonly meta: ZroModuleMeta;

  /**
   * Initialize the module. Called once, after all dependencies are ready.
   * Should return the module's public API (any object).
   */
  init(ctx: ZroModuleContext): unknown | Promise<unknown>;

  /**
   * Tear down the module. Called when the client is destroyed.
   * Optional — only needed if the module holds resources.
   */
  destroy?(): void | Promise<void>;
}

// ── Client Configuration ─────────────────────────────────

export interface ZroConfig {
  /** App slug, e.g. 'notes', 'terminal' */
  slug: string;

  /** Instance ID, auto-generated if not provided */
  instanceId?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Callbacks */
  onConnect?: (info: { reconnected: boolean }) => void;
  onDisconnect?: () => void;
  onError?: (err: unknown) => void;
}

// ── Transport Types ──────────────────────────────────────

export interface TransportAPI {
  /** Send a raw message payload through the transport. */
  send(instanceId: string, payload: unknown): void;

  /** Subscribe to messages for an instanceId. */
  subscribe(instanceId: string, callback: TransportCallback): void;

  /** Unsubscribe from messages for an instanceId. */
  unsubscribe(instanceId: string): void;

  /** Listen for connection state changes. */
  onState(callback: (state: TransportState) => void): () => void;

  /** Current connection state. */
  readonly state: TransportState;
}

export type TransportState = 'connecting' | 'connected' | 'disconnected';

export interface TransportCallback {
  (msg: TransportMessage): void;
}

export interface TransportMessage {
  type: 'registered' | 'ws_message';
  payload?: unknown;
  reconnected?: boolean;
}

// ── Connection Types ─────────────────────────────────────

export interface ConnectionAPI {
  /** Invoke a backend command (request/response with timeout). */
  invoke<T = unknown>(command: string, params?: Record<string, unknown>, options?: { timeout?: number }): Promise<T>;

  /** Listen for backend push events. */
  on(event: string, handler: (payload: unknown) => void): void;

  /** Remove an event listener. */
  off(event: string, handler: (payload: unknown) => void): void;

  /** Send a fire-and-forget event to the backend. */
  emit(event: string, data?: unknown): void;

  /** Close the connection. */
  close(): void;

  /** Current instance ID. */
  readonly instanceId: string;

  /** Current connection state. */
  readonly connectionState: TransportState;
}

// ── State Types ──────────────────────────────────────────

export interface StateAPI {
  /** Save a value (debounced). */
  save(key: string, value: unknown): Promise<void>;

  /** Restore a value. */
  restore<T = unknown>(key: string): Promise<T | null>;

  /** Delete a value. */
  delete(key: string): Promise<void>;

  /** List all keys. */
  keys(): Promise<string[]>;

  /** Auto-save with debounce: calls getter periodically and saves if changed. */
  autoSave(key: string, getter: () => unknown, debounceMs?: number): () => void;
}

// ── Shell Types ──────────────────────────────────────────

export interface ShellAPI {
  /** Whether the app is running inside a shell iframe. */
  readonly isInShell: boolean;

  /** Set the window title. */
  setTitle(title: string): Promise<void>;

  /** Show a notification. */
  notify(opts: { title: string; body?: string; timeout?: number }): Promise<void>;

  /** Set badge count on taskbar. */
  setBadgeCount(count: number): Promise<void>;

  /** Request focus. */
  requestFocus(): Promise<void>;

  /** Minimize window. */
  minimize(): Promise<void>;

  /** Maximize window. */
  maximize(): Promise<void>;

  /** Restore window. */
  restore(): Promise<void>;

  /** Close window. */
  close(): Promise<void>;

  /** Get window info. */
  getWindowInfo(): Promise<unknown>;

  /** Listen for shell events. */
  on(event: string, handler: (payload: unknown) => void): void;

  /** Remove shell event listener. */
  off(event: string, handler: (payload: unknown) => void): void;
}

// ── HTTP Types ───────────────────────────────────────────

export interface HttpAPI {
  get<T = unknown>(path: string, query?: Record<string, string>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
}

// ── Lifecycle Types ──────────────────────────────────────

export interface LifecycleAPI {
  /** Register a handler for before-unload (save before close). */
  onBeforeUnload(handler: () => void | Promise<void>): () => void;

  /** Register a handler for visibility change. */
  onVisibilityChange(handler: (visible: boolean) => void): () => void;

  /** Register a handler for idle detection. */
  onIdle(handler: () => void, timeoutMs?: number): () => void;
}

// ── Replay Buffer Types ──────────────────────────────────

export interface ReplayBufferAPI {
  push(event: string, payload: unknown): void;
  replay(handler: (event: string, payload: unknown) => void): void;
  replayEvent(event: string, handler: (payload: unknown) => void): void;
  clear(): void;
  clearEvent(event: string): void;
  stats(): { totalEvents: number; totalBytes: number; events: Record<string, number> };
  setMaxBytes(bytes: number): void;
}

// ── Theme Types ──────────────────────────────────────────

export interface ThemeAPI {
  getVariables(): Record<string, string>;
  getVariable(name: string): string | undefined;
  setVariables(vars: Record<string, string>): void;
  onChange(handler: (variables: Record<string, string>) => void): () => void;
  readonly isShellManaged: boolean;
}

// ── Clipboard Types ──────────────────────────────────────

export interface ClipboardAPI {
  copy(data: string, mimeType?: string): void;
  paste(): Promise<string>;
  onChange(handler: (data: string, mimeType: string) => void): () => void;
}

// ── DnD Types ────────────────────────────────────────────

export interface DndAPI {
  startDrag(element: HTMLElement, data: { type: string; data: unknown; label?: string }): void;
  registerDropZone(zone: {
    element: HTMLElement;
    acceptTypes?: string[];
    onDrop: (data: { type: string; data: unknown; label?: string }) => void;
    onDragEnter?: () => void;
    onDragLeave?: () => void;
  }): () => void;
  cancelDrag(): void;
  readonly isDragging: boolean;
}

// ── Keybindings Types ────────────────────────────────────

export interface KeybindingsAPI {
  register(keys: string, handler: (e: KeyboardEvent) => void, label?: string): () => void;
  registerGlobal(keys: string, callback: () => void, label?: string): () => void;
  list(): Array<{ keys: string; label?: string; scope: 'local' | 'global' }>;
  clear(): void;
  disable(): void;
  enable(): void;
}

// ── Notifications Types ──────────────────────────────────

export interface NotificationsAPI {
  show(opts: { title: string; body?: string; timeout?: number; type?: string; icon?: string }): string;
  dismiss(id: string): void;
  history(): Array<{ id: string; title: string; body?: string; type: string; timestamp: number; read: boolean }>;
  clearHistory(): void;
  markRead(id: string): void;
  unreadCount(): number;
  requestPermission(): Promise<NotificationPermission>;
  onNotification(handler: (entry: { id: string; title: string; body?: string; type: string; timestamp: number; read: boolean }) => void): () => void;
}

// ── IPC Types ────────────────────────────────────────────

export interface IpcAPI {
  send(targetSlug: string, channel: string, data: unknown): void;
  sendViaBackend(targetSlug: string, channel: string, data: unknown): Promise<unknown>;
  on(channel: string, handler: (message: { from: string; channel: string; data: unknown }) => void): () => void;
  off(channel: string): void;
  channels(): string[];
}

// ── Storage Types ────────────────────────────────────────

export interface StorageAPI {
  get<T = string>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  clear(): void;
  instance(instanceId: string): {
    get<T = string>(key: string): T | null;
    set(key: string, value: unknown): void;
    remove(key: string): void;
    has(key: string): boolean;
    keys(): string[];
    clear(): void;
  };
}

// ── Router Types ─────────────────────────────────────────

export interface RouterAPI {
  route(pattern: string, handler: (match: { pattern: string; params: Record<string, string>; path: string }) => void): () => void;
  navigate(path: string): void;
  current(): string;
  guard(fn: (to: string, from: string) => boolean | Promise<boolean>): () => void;
  onChange(handler: (match: { pattern: string; params: Record<string, string>; path: string } | null) => void): () => void;
  back(): void;
}

// ── Form Types ───────────────────────────────────────────

export interface FormAPI {
  bind(selector: string | HTMLFormElement, schema: {
    fields: Record<string, {
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
      validate?: (value: string) => string | null;
    }>;
    submit?: string;
    onSubmit?: (data: Record<string, string>) => void | Promise<void>;
    errorClass?: string;
    errorMsgClass?: string;
  }): {
    validate(): Record<string, string>;
    getData(): Record<string, string>;
    setData(data: Record<string, string>): void;
    reset(): void;
    setFieldError(field: string, message: string): void;
    destroy(): void;
  };
}

// ── Window Mode Types ────────────────────────────────────

export interface WindowModeAPI {
  moveTo(x: number, y: number): void;
  resizeTo(width: number, height: number): void;
  minimize(): void;
  maximize(): void;
  restore(): void;
  close(): void;
  focus(): void;
  popOut(): void;
  toggleMaximize(): void;
  getInfo(): Promise<{ x: number; y: number; width: number; height: number; maximized: boolean; minimized: boolean; focused: boolean; zIndex: number }>;
  onStateChange(handler: (info: { x: number; y: number; width: number; height: number; maximized: boolean; minimized: boolean; focused: boolean; zIndex: number }) => void): () => void;
  onFocus(handler: (focused: boolean) => void): () => void;
  readonly isManaged: boolean;
}

// ── Taskbar Types ────────────────────────────────────────

export interface TaskbarAPI {
  setBadge(count: number): void;
  setBadgeText(text: string): void;
  clearBadge(): void;
  setTooltip(text: string): void;
  addAction(action: { id: string; label: string; icon?: string; handler: () => void }): () => void;
  clearActions(): void;
  setProgress(percent: number): void;
  flash(): void;
  readonly hasTaskbar: boolean;
}

// ── Launcher Types ───────────────────────────────────────

export interface LauncherAPI {
  getApps(): Promise<Array<{ slug: string; name: string; description?: string; icon?: string; category?: string; running?: boolean }>>;
  launch(slug: string): void;
  getRecent(): string[];
  addFavorite(slug: string): void;
  removeFavorite(slug: string): void;
  getFavorites(): string[];
  readonly isShellManaged: boolean;
}

// ── Dev Types ────────────────────────────────────────────

export interface DevAPI {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void;
  trace(): () => void;
  inspect(): void;
  readonly isDevMode: boolean;
}

// ── Module Factory Type ──────────────────────────────────

/**
 * A module factory is a function that creates a ZroModule.
 * This is what module authors export from their module file.
 */
export type ZroModuleFactory = () => ZroModule;
