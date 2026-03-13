/**
 * @zro/state — Persistent state module.
 *
 * Save/restore app state to server-side SQLite via __state:* commands.
 * Adds auto-save with debounce support.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ConnectionAPI,
  StateAPI,
} from '../core/types.js';

export const stateModule: ZroModuleFactory = () => {
  let _conn: ConnectionAPI;
  let _autoSaveCleanups: Array<() => void> = [];

  const mod: ZroModule = {
    meta: {
      name: 'state',
      version: '0.1.0',
      description: 'Persistent state save/restore with auto-save',
      category: 'core',
      dependencies: ['connection'],
    },

    init(ctx: ZroModuleContext): StateAPI {
      _conn = ctx.getModule<ConnectionAPI>('connection');

      const api: StateAPI = {
        async save(key: string, value: unknown): Promise<void> {
          await _conn.invoke('__state:save', {
            key,
            value: JSON.stringify(value),
          });
        },

        async restore<T = unknown>(key: string): Promise<T | null> {
          const raw = await _conn.invoke<string | null>('__state:restore', { key });
          return raw ? JSON.parse(raw) as T : null;
        },

        async delete(key: string): Promise<void> {
          await _conn.invoke('__state:delete', { key });
        },

        async keys(): Promise<string[]> {
          return _conn.invoke<string[]>('__state:keys');
        },

        autoSave(key: string, getter: () => unknown, debounceMs = 500): () => void {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let lastJson = '';
          let stopped = false;

          const check = () => {
            if (stopped) return;
            try {
              const val = getter();
              const json = JSON.stringify(val);
              if (json !== lastJson) {
                lastJson = json;
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                  if (!stopped) {
                    api.save(key, val).catch(() => { /* silent */ });
                  }
                }, debounceMs);
              }
            } catch (_) { /* getter may fail during teardown */ }
          };

          // Use MutationObserver-style polling at a reasonable interval
          const interval = setInterval(check, Math.max(debounceMs, 250));

          const cleanup = () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            clearInterval(interval);
          };

          _autoSaveCleanups.push(cleanup);
          return cleanup;
        },
      };

      return api;
    },

    destroy(): void {
      for (const cleanup of _autoSaveCleanups) {
        cleanup();
      }
      _autoSaveCleanups = [];
    },
  };

  return mod;
};
