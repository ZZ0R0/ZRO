/**
 * @zro/theme — Theme synchronization module.
 *
 * Synchronizes CSS variables between the shell and apps running in iframes.
 * When the shell changes theme, all apps update their CSS variables in real-time.
 * In standalone mode, uses a default theme or one stored in localStorage.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface ThemeAPI {
  /** Get all current theme variables. */
  getVariables(): Record<string, string>;

  /** Get a single CSS variable value. */
  getVariable(name: string): string | undefined;

  /** Set theme variables (standalone mode only). */
  setVariables(vars: Record<string, string>): void;

  /** Listen for theme changes. */
  onChange(handler: (variables: Record<string, string>) => void): () => void;

  /** Whether theme is managed by shell or standalone. */
  readonly isShellManaged: boolean;
}

// ── Module factory ───────────────────────────────────────

export const themeModule: ZroModuleFactory = () => {
  let _variables: Record<string, string> = {};
  let _listeners: Array<(variables: Record<string, string>) => void> = [];
  let _messageHandler: ((e: MessageEvent) => void) | null = null;
  let _isShellManaged = false;

  function _applyVariables(vars: Record<string, string>): void {
    _variables = { ..._variables, ...vars };
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    for (const handler of _listeners) {
      try { handler({ ..._variables }); } catch (_) { /* noop */ }
    }
  }

  const mod: ZroModule = {
    meta: {
      name: 'theme',
      version: '0.1.0',
      description: 'Theme synchronization (shell ↔ app)',
      category: 'ux',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): ThemeAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      if (isInShell) {
        _isShellManaged = true;

        // Listen for theme updates from shell
        _messageHandler = (e: MessageEvent) => {
          if (!e.data || e.data.type !== 'zro:theme:update') return;
          const vars = e.data.variables as Record<string, string>;
          if (vars && typeof vars === 'object') {
            ctx.log('Theme: received update from shell');
            _applyVariables(vars);
          }
        };
        window.addEventListener('message', _messageHandler);

        // Request initial theme from shell
        parent.postMessage({ type: 'zro:theme:request' }, '*');
      } else {
        // Standalone: load from localStorage or use defaults
        const stored = localStorage.getItem('zro:theme');
        if (stored) {
          try {
            const vars = JSON.parse(stored) as Record<string, string>;
            _applyVariables(vars);
          } catch (_) { /* invalid stored theme */ }
        }
      }

      const api: ThemeAPI = {
        getVariables(): Record<string, string> {
          return { ..._variables };
        },

        getVariable(name: string): string | undefined {
          return _variables[name];
        },

        setVariables(vars: Record<string, string>): void {
          _applyVariables(vars);
          if (!_isShellManaged) {
            localStorage.setItem('zro:theme', JSON.stringify(_variables));
          }
        },

        onChange(handler: (variables: Record<string, string>) => void): () => void {
          _listeners.push(handler);
          return () => {
            _listeners = _listeners.filter(h => h !== handler);
          };
        },

        get isShellManaged(): boolean {
          return _isShellManaged;
        },
      };

      return api;
    },

    destroy(): void {
      if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
      }
      _listeners = [];
      _variables = {};
    },
  };

  return mod;
};
