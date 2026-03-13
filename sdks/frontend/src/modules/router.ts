/**
 * @zro/router — Hash-based mini router.
 *
 * Minimal client-side router for apps with multiple views.
 * Uses hash fragments (#/path) to avoid page reloads within iframes.
 * Supports dynamic parameters, programmatic navigation, and guards.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface RouteMatch {
  /** The matched route pattern. */
  pattern: string;
  /** Extracted parameters. */
  params: Record<string, string>;
  /** Full hash path. */
  path: string;
}

export interface RouteGuard {
  /** Return false to prevent navigation. */
  (to: string, from: string): boolean | Promise<boolean>;
}

export interface RouterAPI {
  /** Register a route handler. Pattern supports :param and *wildcard. */
  route(pattern: string, handler: (match: RouteMatch) => void): () => void;

  /** Navigate to a hash path. */
  navigate(path: string): void;

  /** Get the current hash path. */
  current(): string;

  /** Register a navigation guard (called before every navigation). */
  guard(fn: RouteGuard): () => void;

  /** Listen for any route change. */
  onChange(handler: (match: RouteMatch | null) => void): () => void;

  /** Go back in hash history. */
  back(): void;
}

// ── Helpers ──────────────────────────────────────────────

interface RouteEntry {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handler: (match: RouteMatch) => void;
}

function _compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const parts = pattern.split('/').filter(Boolean);

  const regexParts = parts.map(part => {
    if (part.startsWith(':')) {
      paramNames.push(part.slice(1));
      return '([^/]+)';
    }
    if (part === '*') {
      paramNames.push('_wildcard');
      return '(.*)';
    }
    if (part.endsWith('*')) {
      paramNames.push(part.slice(0, -1) || '_rest');
      return '(.*)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });

  const regex = new RegExp('^/?' + regexParts.join('/') + '/?$');
  return { regex, paramNames };
}

// ── Module factory ───────────────────────────────────────

export const routerModule: ZroModuleFactory = () => {
  let _routes: RouteEntry[] = [];
  let _guards: RouteGuard[] = [];
  let _changeListeners: Array<(match: RouteMatch | null) => void> = [];
  let _hashHandler: (() => void) | null = null;
  let _currentPath = '';

  async function _dispatch(): Promise<void> {
    const hash = window.location.hash || '#/';
    const path = hash.startsWith('#') ? hash.slice(1) : hash;
    const prevPath = _currentPath;

    // Run guards
    for (const guard of _guards) {
      const allowed = await guard(path, prevPath);
      if (!allowed) return;
    }

    _currentPath = path;

    let matched = false;
    for (const route of _routes) {
      const m = path.match(route.regex);
      if (m) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1] || '');
        });

        const match: RouteMatch = {
          pattern: route.pattern,
          params,
          path,
        };

        try { route.handler(match); } catch (_) { /* noop */ }

        for (const listener of _changeListeners) {
          try { listener(match); } catch (_) { /* noop */ }
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      for (const listener of _changeListeners) {
        try { listener(null); } catch (_) { /* noop */ }
      }
    }
  }

  const mod: ZroModule = {
    meta: {
      name: 'router',
      version: '0.1.0',
      description: 'Hash-based mini router for multi-view apps',
      category: 'util',
      dependencies: [],
    },

    init(_ctx: ZroModuleContext): RouterAPI {
      _currentPath = (window.location.hash || '#/').slice(1);

      _hashHandler = () => { _dispatch(); };
      window.addEventListener('hashchange', _hashHandler);

      const api: RouterAPI = {
        route(pattern: string, handler: (match: RouteMatch) => void): () => void {
          const { regex, paramNames } = _compilePattern(pattern);
          const entry: RouteEntry = { pattern, regex, paramNames, handler };
          _routes.push(entry);

          // Immediately check if current hash matches the new route
          _dispatch();

          return () => {
            _routes = _routes.filter(r => r !== entry);
          };
        },

        navigate(path: string): void {
          if (!path.startsWith('#')) path = '#' + path;
          window.location.hash = path;
        },

        current(): string {
          return _currentPath;
        },

        guard(fn: RouteGuard): () => void {
          _guards.push(fn);
          return () => {
            _guards = _guards.filter(g => g !== fn);
          };
        },

        onChange(handler: (match: RouteMatch | null) => void): () => void {
          _changeListeners.push(handler);
          return () => {
            _changeListeners = _changeListeners.filter(h => h !== handler);
          };
        },

        back(): void {
          history.back();
        },
      };

      return api;
    },

    destroy(): void {
      if (_hashHandler) {
        window.removeEventListener('hashchange', _hashHandler);
        _hashHandler = null;
      }
      _routes = [];
      _guards = [];
      _changeListeners = [];
    },
  };

  return mod;
};
