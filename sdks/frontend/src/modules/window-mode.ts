/**
 * @zro/window-mode — Window manager module.
 *
 * Provides window management for apps running in the shell.
 * Supports drag, resize, minimize, maximize, pop-out to browser window,
 * and focus management. Communicates with the shell via postMessage.
 *
 * In standalone mode, provides basic window info stubs.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ShellAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface WindowInfo {
  /** Window position x. */
  x: number;
  /** Window position y. */
  y: number;
  /** Window width. */
  width: number;
  /** Window height. */
  height: number;
  /** Whether the window is maximized. */
  maximized: boolean;
  /** Whether the window is minimized. */
  minimized: boolean;
  /** Whether the window is focused. */
  focused: boolean;
  /** Z-index layer. */
  zIndex: number;
}

export interface WindowModeAPI {
  /** Move the window to a position. */
  moveTo(x: number, y: number): void;

  /** Resize the window. */
  resizeTo(width: number, height: number): void;

  /** Minimize the window. */
  minimize(): void;

  /** Maximize the window. */
  maximize(): void;

  /** Restore the window from minimized/maximized state. */
  restore(): void;

  /** Close the window. */
  close(): void;

  /** Bring the window to front. */
  focus(): void;

  /** Pop out the window to a new browser window. */
  popOut(): void;

  /** Toggle maximized state. */
  toggleMaximize(): void;

  /** Get current window info. */
  getInfo(): Promise<WindowInfo>;

  /** Listen for window state changes. */
  onStateChange(handler: (info: WindowInfo) => void): () => void;

  /** Listen for window focus changes. */
  onFocus(handler: (focused: boolean) => void): () => void;

  /** Whether the app is managed by the shell window manager. */
  readonly isManaged: boolean;
}

// ── Module factory ───────────────────────────────────────

export const windowModeModule: ZroModuleFactory = () => {
  let _stateListeners: Array<(info: WindowInfo) => void> = [];
  let _focusListeners: Array<(focused: boolean) => void> = [];
  let _messageHandler: ((e: MessageEvent) => void) | null = null;
  let _isManaged = false;

  const mod: ZroModule = {
    meta: {
      name: 'window-mode',
      version: '0.1.0',
      description: 'Window manager (drag, resize, minimize, maximize, pop-out)',
      category: 'shell',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): WindowModeAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      _isManaged = isInShell;

      function _sendToShell(action: string, payload?: Record<string, unknown>): void {
        if (!isInShell) return;
        parent.postMessage({
          type: 'zro:window:' + action,
          payload: payload ?? {},
        }, '*');
      }

      // Listen for window state updates from shell
      if (isInShell) {
        _messageHandler = (e: MessageEvent) => {
          if (!e.data) return;

          if (e.data.type === 'zro:window:stateChanged') {
            const info = e.data.info as WindowInfo;
            for (const handler of _stateListeners) {
              try { handler(info); } catch (_) { /* noop */ }
            }
          }

          if (e.data.type === 'zro:window:focusChanged') {
            const focused = e.data.focused as boolean;
            for (const handler of _focusListeners) {
              try { handler(focused); } catch (_) { /* noop */ }
            }
          }
        };
        window.addEventListener('message', _messageHandler);
      }

      const api: WindowModeAPI = {
        moveTo(x: number, y: number): void {
          _sendToShell('moveTo', { x, y });
        },

        resizeTo(width: number, height: number): void {
          _sendToShell('resizeTo', { width, height });
        },

        minimize(): void {
          _sendToShell('minimize');
        },

        maximize(): void {
          _sendToShell('maximize');
        },

        restore(): void {
          _sendToShell('restore');
        },

        close(): void {
          _sendToShell('close');
        },

        focus(): void {
          _sendToShell('focus');
        },

        popOut(): void {
          // Open current app in a new browser window
          if (isInShell) {
            _sendToShell('popOut');
          } else {
            // Already standalone — noop
          }
        },

        toggleMaximize(): void {
          _sendToShell('toggleMaximize');
        },

        async getInfo(): Promise<WindowInfo> {
          if (!isInShell) {
            return {
              x: window.screenX,
              y: window.screenY,
              width: window.innerWidth,
              height: window.innerHeight,
              maximized: false,
              minimized: false,
              focused: document.hasFocus(),
              zIndex: 0,
            };
          }

          return new Promise<WindowInfo>((resolve) => {
            const handler = (e: MessageEvent) => {
              if (e.data?.type === 'zro:window:info') {
                window.removeEventListener('message', handler);
                resolve(e.data.info as WindowInfo);
              }
            };
            window.addEventListener('message', handler);
            _sendToShell('getInfo');

            // Timeout fallback
            setTimeout(() => {
              window.removeEventListener('message', handler);
              resolve({
                x: 0, y: 0, width: 800, height: 600,
                maximized: false, minimized: false, focused: true, zIndex: 0,
              });
            }, 2000);
          });
        },

        onStateChange(handler: (info: WindowInfo) => void): () => void {
          _stateListeners.push(handler);
          return () => {
            _stateListeners = _stateListeners.filter(h => h !== handler);
          };
        },

        onFocus(handler: (focused: boolean) => void): () => void {
          _focusListeners.push(handler);
          return () => {
            _focusListeners = _focusListeners.filter(h => h !== handler);
          };
        },

        get isManaged(): boolean {
          return _isManaged;
        },
      };

      return api;
    },

    destroy(): void {
      if (_messageHandler) {
        window.removeEventListener('message', _messageHandler);
        _messageHandler = null;
      }
      _stateListeners = [];
      _focusListeners = [];
    },
  };

  return mod;
};
