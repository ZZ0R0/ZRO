/**
 * @zro/taskbar — Taskbar integration module.
 *
 * Provides API for apps to interact with the shell taskbar:
 * set badges, register quick actions, update status indicators.
 * Communicates with the shell via postMessage.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface TaskbarAction {
  /** Unique action ID. */
  id: string;
  /** Display label. */
  label: string;
  /** Optional icon URL or emoji. */
  icon?: string;
  /** Handler when action is clicked. */
  handler: () => void;
}

export interface TaskbarAPI {
  /** Set the badge count (0 to clear). */
  setBadge(count: number): void;

  /** Set a text badge (e.g. "!"). */
  setBadgeText(text: string): void;

  /** Clear the badge. */
  clearBadge(): void;

  /** Set the taskbar tooltip text. */
  setTooltip(text: string): void;

  /** Register a right-click context action. */
  addAction(action: TaskbarAction): () => void;

  /** Remove all context actions. */
  clearActions(): void;

  /** Set progress indicator (0-100, -1 to hide). */
  setProgress(percent: number): void;

  /** Flash the taskbar button to get user attention. */
  flash(): void;

  /** Whether the app has a taskbar entry (in shell mode). */
  readonly hasTaskbar: boolean;
}

// ── Module factory ───────────────────────────────────────

export const taskbarModule: ZroModuleFactory = () => {
  let _actions: Map<string, TaskbarAction> = new Map();
  let _messageHandler: ((e: MessageEvent) => void) | null = null;
  let _hasTaskbar = false;

  const mod: ZroModule = {
    meta: {
      name: 'taskbar',
      version: '0.1.0',
      description: 'Taskbar integration (badges, actions, progress)',
      category: 'shell',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): TaskbarAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      _hasTaskbar = isInShell;

      function _sendToShell(action: string, payload?: Record<string, unknown>): void {
        if (!isInShell) return;
        parent.postMessage({
          type: 'zro:taskbar:' + action,
          payload: payload ?? {},
        }, '*');
      }

      // Listen for taskbar action triggers from shell
      if (isInShell) {
        _messageHandler = (e: MessageEvent) => {
          if (e.data?.type === 'zro:taskbar:actionTrigger') {
            const actionId = e.data.actionId as string;
            const action = _actions.get(actionId);
            if (action) {
              try { action.handler(); } catch (_) { /* noop */ }
            }
          }
        };
        window.addEventListener('message', _messageHandler);
      }

      const api: TaskbarAPI = {
        setBadge(count: number): void {
          _sendToShell('setBadge', { count });
        },

        setBadgeText(text: string): void {
          _sendToShell('setBadgeText', { text });
        },

        clearBadge(): void {
          _sendToShell('clearBadge');
        },

        setTooltip(text: string): void {
          _sendToShell('setTooltip', { text });
        },

        addAction(action: TaskbarAction): () => void {
          _actions.set(action.id, action);
          _sendToShell('addAction', {
            id: action.id,
            label: action.label,
            icon: action.icon,
          });

          return () => {
            _actions.delete(action.id);
            _sendToShell('removeAction', { id: action.id });
          };
        },

        clearActions(): void {
          _actions.clear();
          _sendToShell('clearActions');
        },

        setProgress(percent: number): void {
          _sendToShell('setProgress', { percent });
        },

        flash(): void {
          _sendToShell('flash');
        },

        get hasTaskbar(): boolean {
          return _hasTaskbar;
        },
      };

      return api;
    },

    destroy(): void {
      if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
      }
      _actions.clear();
    },
  };

  return mod;
};
