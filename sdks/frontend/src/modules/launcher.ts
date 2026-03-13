/**
 * @zro/launcher — App launcher module.
 *
 * Provides APIs for the app launcher grid in the shell.
 * Fetches available apps from the server, handles app launching,
 * and manages launch history/favorites.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  HttpAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface AppInfo {
  /** App slug. */
  slug: string;
  /** Display name. */
  name: string;
  /** Description. */
  description?: string;
  /** Icon URL or emoji. */
  icon?: string;
  /** Category for grouping. */
  category?: string;
  /** Whether the app is currently running. */
  running?: boolean;
}

export interface LauncherAPI {
  /** Get list of available apps from the server. */
  getApps(): Promise<AppInfo[]>;

  /** Launch an app (open in shell or navigate). */
  launch(slug: string): void;

  /** Get recent launched apps. */
  getRecent(): string[];

  /** Add an app to favorites. */
  addFavorite(slug: string): void;

  /** Remove an app from favorites. */
  removeFavorite(slug: string): void;

  /** Get favorite apps. */
  getFavorites(): string[];

  /** Whether the launcher is managed by shell. */
  readonly isShellManaged: boolean;
}

// ── Module factory ───────────────────────────────────────

const STORAGE_KEY_RECENT = 'zro:launcher:recent';
const STORAGE_KEY_FAVORITES = 'zro:launcher:favorites';
const MAX_RECENT = 10;

export const launcherModule: ZroModuleFactory = () => {
  let _isShellManaged = false;

  const mod: ZroModule = {
    meta: {
      name: 'launcher',
      version: '0.1.0',
      description: 'App launcher (grid, recent, favorites)',
      category: 'shell',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): LauncherAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }
      _isShellManaged = isInShell;

      function _getStoredList(key: string): string[] {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) as string[] : [];
        } catch {
          return [];
        }
      }

      function _setStoredList(key: string, list: string[]): void {
        localStorage.setItem(key, JSON.stringify(list));
      }

      function _addRecent(slug: string): void {
        const recent = _getStoredList(STORAGE_KEY_RECENT).filter(s => s !== slug);
        recent.unshift(slug);
        _setStoredList(STORAGE_KEY_RECENT, recent.slice(0, MAX_RECENT));
      }

      const api: LauncherAPI = {
        async getApps(): Promise<AppInfo[]> {
          // Try fetching from the API
          try {
            const resp = await fetch('/api/apps', { credentials: 'same-origin' });
            if (resp.ok) {
              return await resp.json() as AppInfo[];
            }
          } catch (_) {
            // Fall through
          }
          return [];
        },

        launch(slug: string): void {
          _addRecent(slug);

          if (isInShell) {
            parent.postMessage({
              type: 'zro:launcher:launch',
              slug,
            }, '*');
          } else {
            // Standalone: navigate directly
            window.location.href = `/${slug}/`;
          }
        },

        getRecent(): string[] {
          return _getStoredList(STORAGE_KEY_RECENT);
        },

        addFavorite(slug: string): void {
          const favs = _getStoredList(STORAGE_KEY_FAVORITES);
          if (!favs.includes(slug)) {
            favs.push(slug);
            _setStoredList(STORAGE_KEY_FAVORITES, favs);
          }
        },

        removeFavorite(slug: string): void {
          const favs = _getStoredList(STORAGE_KEY_FAVORITES).filter(s => s !== slug);
          _setStoredList(STORAGE_KEY_FAVORITES, favs);
        },

        getFavorites(): string[] {
          return _getStoredList(STORAGE_KEY_FAVORITES);
        },

        get isShellManaged(): boolean {
          return _isShellManaged;
        },
      };

      return api;
    },
  };

  return mod;
};
