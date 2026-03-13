/**
 * @zro/clipboard — SharedWorker-based clipboard sharing.
 *
 * Provides a shared clipboard across all ZRO apps and tabs.
 * Uses the SharedWorker as a central clipboard store. Falls back to
 * navigator.clipboard API when available and app has focus.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  TransportAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface ClipboardAPI {
  /** Copy data to the shared clipboard. */
  copy(data: string, mimeType?: string): void;

  /** Read the last copied data from the shared clipboard. */
  paste(): Promise<string>;

  /** Listen for clipboard changes from other apps. */
  onChange(handler: (data: string, mimeType: string) => void): () => void;
}

// ── Module factory ───────────────────────────────────────

export const clipboardModule: ZroModuleFactory = () => {
  let _listeners: Array<(data: string, mimeType: string) => void> = [];
  let _lastData = '';
  let _lastMimeType = 'text/plain';
  let _messageHandler: ((e: MessageEvent) => void) | null = null;

  const mod: ZroModule = {
    meta: {
      name: 'clipboard',
      version: '0.1.0',
      description: 'SharedWorker-based clipboard sharing',
      category: 'ux',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): ClipboardAPI {
      let isInShell: boolean;
      try {
        isInShell = window !== window.parent;
      } catch (_) {
        isInShell = true;
      }

      // If in shell, coordinate clipboard via postMessage to shell
      if (isInShell) {
        _messageHandler = (e: MessageEvent) => {
          if (!e.data || e.data.type !== 'zro:clipboard:changed') return;
          _lastData = e.data.data ?? '';
          _lastMimeType = e.data.mimeType ?? 'text/plain';
          for (const handler of _listeners) {
            try { handler(_lastData, _lastMimeType); } catch (_) { /* noop */ }
          }
        };
        window.addEventListener('message', _messageHandler);
      }

      const api: ClipboardAPI = {
        copy(data: string, mimeType = 'text/plain'): void {
          _lastData = data;
          _lastMimeType = mimeType;

          // Try native clipboard first
          if (document.hasFocus() && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(data).catch(() => { /* silent */ });
          }

          // Broadcast to shell/worker
          if (isInShell) {
            parent.postMessage({
              type: 'zro:clipboard:write',
              data,
              mimeType,
            }, '*');
          }
        },

        async paste(): Promise<string> {
          // Try native clipboard first if focused
          if (document.hasFocus() && navigator.clipboard?.readText) {
            try {
              return await navigator.clipboard.readText();
            } catch (_) {
              // Fall through to shared clipboard
            }
          }

          // Request from shell
          if (isInShell) {
            return new Promise<string>((resolve) => {
              const handler = (e: MessageEvent) => {
                if (e.data?.type === 'zro:clipboard:response') {
                  window.removeEventListener('message', handler);
                  resolve(e.data.data ?? _lastData);
                }
              };
              window.addEventListener('message', handler);
              parent.postMessage({ type: 'zro:clipboard:read' }, '*');

              // Timeout fallback
              setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(_lastData);
              }, 1000);
            });
          }

          return _lastData;
        },

        onChange(handler: (data: string, mimeType: string) => void): () => void {
          _listeners.push(handler);
          return () => {
            _listeners = _listeners.filter(h => h !== handler);
          };
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
    },
  };

  return mod;
};
