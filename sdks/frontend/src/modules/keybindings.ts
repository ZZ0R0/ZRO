/**
 * @zro/keybindings — Unified keyboard shortcuts module.
 *
 * Manages both local (in-iframe) and global (cross-iframe via shell)
 * keyboard shortcuts. Local shortcuts are captured and handled within
 * the iframe. Global shortcuts are forwarded to the shell for routing.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface KeyBinding {
  /** Key combo string, e.g. 'Ctrl+S', 'Ctrl+Shift+T', 'Alt+1'. */
  keys: string;
  /** Handler to execute. */
  handler: (e: KeyboardEvent) => void;
  /** Optional label for help display. */
  label?: string;
}

export interface KeybindingsAPI {
  /** Register a local shortcut (handled within this app). */
  register(keys: string, handler: (e: KeyboardEvent) => void, label?: string): () => void;

  /** Register a global shortcut (forwarded to shell). */
  registerGlobal(keys: string, callback: () => void, label?: string): () => void;

  /** List all registered keybindings. */
  list(): Array<{ keys: string; label?: string; scope: 'local' | 'global' }>;

  /** Remove all keybindings. */
  clear(): void;

  /** Temporarily disable all keybindings (e.g. when a text input has focus). */
  disable(): void;

  /** Re-enable keybindings. */
  enable(): void;
}

// ── Helpers ──────────────────────────────────────────────

function _normalizeKey(combo: string): string {
  return combo
    .split('+')
    .map(k => k.trim().toLowerCase())
    .sort()
    .join('+');
}

function _eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');

  const key = e.key.toLowerCase();
  // Avoid adding modifier keys themselves
  if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
    parts.push(key);
  }

  return parts.sort().join('+');
}

// ── Module factory ───────────────────────────────────────

export const keybindingsModule: ZroModuleFactory = () => {
  interface LocalBinding {
    normalized: string;
    handler: (e: KeyboardEvent) => void;
    label?: string;
  }

  interface GlobalBinding {
    normalized: string;
    callback: () => void;
    label?: string;
  }

  let _localBindings: LocalBinding[] = [];
  let _globalBindings: GlobalBinding[] = [];
  let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  let _messageHandler: ((e: MessageEvent) => void) | null = null;
  let _disabled = false;

  const mod: ZroModule = {
    meta: {
      name: 'keybindings',
      version: '0.1.0',
      description: 'Unified keyboard shortcuts (local + global)',
      category: 'ux',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): KeybindingsAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      // Main keydown listener
      _keydownHandler = (e: KeyboardEvent) => {
        if (_disabled) return;

        // Ignore keys when typing in inputs/textareas (unless Escape)
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (isInput && e.key !== 'Escape') return;

        const combo = _eventToCombo(e);

        // Check local bindings first
        for (const binding of _localBindings) {
          if (binding.normalized === combo) {
            e.preventDefault();
            e.stopPropagation();
            try { binding.handler(e); } catch (_) { /* noop */ }
            return;
          }
        }

        // Check global bindings — forward to shell
        for (const binding of _globalBindings) {
          if (binding.normalized === combo) {
            e.preventDefault();
            e.stopPropagation();

            if (isInShell) {
              parent.postMessage({
                type: 'zro:keybinding:global',
                keys: combo,
              }, '*');
            }

            // Also call local callback
            try { binding.callback(); } catch (_) { /* noop */ }
            return;
          }
        }
      };

      document.addEventListener('keydown', _keydownHandler, true);

      // Listen for global keybinding responses from shell
      if (isInShell) {
        _messageHandler = (e: MessageEvent) => {
          if (e.data?.type === 'zro:keybinding:execute') {
            const combo = _normalizeKey(e.data.keys);
            for (const binding of _globalBindings) {
              if (binding.normalized === combo) {
                try { binding.callback(); } catch (_) { /* noop */ }
              }
            }
          }
        };
        window.addEventListener('message', _messageHandler);
      }

      const api: KeybindingsAPI = {
        register(keys: string, handler: (e: KeyboardEvent) => void, label?: string): () => void {
          const normalized = _normalizeKey(keys);
          const binding: LocalBinding = { normalized, handler, label };
          _localBindings.push(binding);
          return () => {
            _localBindings = _localBindings.filter(b => b !== binding);
          };
        },

        registerGlobal(keys: string, callback: () => void, label?: string): () => void {
          const normalized = _normalizeKey(keys);
          const binding: GlobalBinding = { normalized, callback, label };
          _globalBindings.push(binding);

          // Notify shell of registration
          if (isInShell) {
            parent.postMessage({
              type: 'zro:keybinding:register',
              keys: normalized,
              label,
            }, '*');
          }

          return () => {
            _globalBindings = _globalBindings.filter(b => b !== binding);
            if (isInShell) {
              parent.postMessage({
                type: 'zro:keybinding:unregister',
                keys: normalized,
              }, '*');
            }
          };
        },

        list(): Array<{ keys: string; label?: string; scope: 'local' | 'global' }> {
          return [
            ..._localBindings.map(b => ({ keys: b.normalized, label: b.label, scope: 'local' as const })),
            ..._globalBindings.map(b => ({ keys: b.normalized, label: b.label, scope: 'global' as const })),
          ];
        },

        clear(): void {
          _localBindings = [];
          _globalBindings = [];
        },

        disable(): void {
          _disabled = true;
        },

        enable(): void {
          _disabled = false;
        },
      };

      return api;
    },

    destroy(): void {
      if (_keydownHandler) {
        document.removeEventListener('keydown', _keydownHandler, true);
        _keydownHandler = null;
      }
      if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
      }
      _localBindings = [];
      _globalBindings = [];
    },
  };

  return mod;
};
