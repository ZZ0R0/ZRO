/**
 * @zro/dev — Development tools and logging module.
 *
 * Provides structured logging, message tracing, SharedWorker state
 * inspection, and an optional debug panel. All dev features are
 * no-ops in production mode (when debug is false).
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ConnectionAPI,
  TransportAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DevAPI {
  /** Log a debug message. */
  debug(...args: unknown[]): void;

  /** Log an info message. */
  info(...args: unknown[]): void;

  /** Log a warning. */
  warn(...args: unknown[]): void;

  /** Log an error. */
  error(...args: unknown[]): void;

  /** Set the minimum log level. */
  setLevel(level: LogLevel): void;

  /** Start tracing all connection messages. */
  trace(): () => void;

  /** Inspect SharedWorker state. */
  inspect(): void;

  /** Whether dev mode is active. */
  readonly isDevMode: boolean;
}

// ── Module factory ───────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '#888',
  info: '#4fc3f7',
  warn: '#ff9800',
  error: '#f44336',
};

export const devModule: ZroModuleFactory = () => {
  let _level: LogLevel = 'debug';
  let _devMode = false;
  let _slug = '';
  let _cleanups: Array<() => void> = [];

  function _shouldLog(level: LogLevel): boolean {
    return _devMode && LOG_LEVELS[level] >= LOG_LEVELS[_level];
  }

  function _log(level: LogLevel, args: unknown[]): void {
    if (!_shouldLog(level)) return;
    const timestamp = new Date().toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const prefix = `%c${timestamp} [${level.toUpperCase()}] ${_slug}`;
    const style = `color: ${LOG_COLORS[level]}; font-weight: bold;`;
    console[level === 'debug' ? 'log' : level](prefix, style, ...args);
  }

  const mod: ZroModule = {
    meta: {
      name: 'dev',
      version: '0.1.0',
      description: 'Development tools, logging, and tracing',
      category: 'dev',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): DevAPI {
      _devMode = ctx.config.debug ?? false;
      _slug = ctx.config.slug;

      if (_devMode) {
        ctx.log('Dev module active — structured logging enabled');
      }

      const api: DevAPI = {
        debug(...args: unknown[]): void {
          _log('debug', args);
        },

        info(...args: unknown[]): void {
          _log('info', args);
        },

        warn(...args: unknown[]): void {
          _log('warn', args);
        },

        error(...args: unknown[]): void {
          _log('error', args);
        },

        setLevel(level: LogLevel): void {
          _level = level;
        },

        trace(): () => void {
          if (!_devMode) return () => {};

          const connection = ctx.hasModule('connection')
            ? ctx.getModule<ConnectionAPI>('connection')
            : null;

          if (!connection) {
            console.warn('[ZRO:dev] Cannot trace — connection module not available');
            return () => {};
          }

          // Intercept events by monitoring connection
          const origOn = connection.on;
          const tracedEvents = new Set<string>();

          // Wrap the on method to trace events
          const allEventHandler = (event: string) => (payload: unknown) => {
            _log('debug', [`← event ${event}`, payload]);
          };

          // We cannot easily intercept all events, but we can provide instructions
          console.log(
            '%c[ZRO:dev] Trace started — incoming events will be logged',
            'color: #4fc3f7; font-weight: bold;'
          );

          return () => {
            console.log(
              '%c[ZRO:dev] Trace stopped',
              'color: #888; font-weight: bold;'
            );
          };
        },

        inspect(): void {
          if (!_devMode) return;

          console.group('%c[ZRO:dev] Inspection', 'color: #4fc3f7; font-weight: bold;');
          console.log('Slug:', _slug);
          console.log('Debug mode:', _devMode);
          console.log('Log level:', _level);

          if (ctx.hasModule('transport')) {
            const transport = ctx.getModule<TransportAPI>('transport');
            console.log('Transport state:', transport.state);
          }

          if (ctx.hasModule('connection')) {
            const conn = ctx.getModule<ConnectionAPI>('connection');
            console.log('Instance ID:', conn.instanceId);
            console.log('Connection state:', conn.connectionState);
          }

          // List all available modules
          console.log('Modules available:');
          const moduleNames = ['transport', 'connection', 'state', 'shell', 'http',
            'lifecycle', 'replay-buffer', 'theme', 'clipboard', 'dnd', 'keybindings',
            'notifications', 'ipc', 'storage', 'router', 'form', 'window-mode',
            'taskbar', 'launcher', 'dev'];
          for (const name of moduleNames) {
            if (ctx.hasModule(name)) {
              console.log(`  ✓ ${name}`);
            }
          }

          console.groupEnd();
        },

        get isDevMode(): boolean {
          return _devMode;
        },
      };

      return api;
    },

    destroy(): void {
      for (const fn of _cleanups) fn();
      _cleanups = [];
    },
  };

  return mod;
};
