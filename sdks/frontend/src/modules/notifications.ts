/**
 * @zro/notifications — Unified notification system.
 *
 * Provides toast notifications (when in shell) and native browser
 * notifications (when in background or standalone). Supports action
 * buttons, auto-dismiss, and notification history.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ShellAPI,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface NotificationOptions {
  /** Notification title. */
  title: string;
  /** Notification body text. */
  body?: string;
  /** Auto-dismiss timeout in ms (0 = manual dismiss). Default: 5000. */
  timeout?: number;
  /** Notification type for styling. */
  type?: 'info' | 'success' | 'warning' | 'error';
  /** Action buttons. */
  actions?: Array<{ label: string; callback: () => void }>;
  /** Optional icon URL. */
  icon?: string;
}

export interface NotificationEntry {
  id: string;
  title: string;
  body?: string;
  type: string;
  timestamp: number;
  read: boolean;
}

export interface NotificationsAPI {
  /** Show a notification. */
  show(opts: NotificationOptions): string;

  /** Dismiss a notification by ID. */
  dismiss(id: string): void;

  /** Get notification history. */
  history(): NotificationEntry[];

  /** Clear notification history. */
  clearHistory(): void;

  /** Mark a notification as read. */
  markRead(id: string): void;

  /** Get count of unread notifications. */
  unreadCount(): number;

  /** Request browser notification permission. */
  requestPermission(): Promise<NotificationPermission>;

  /** Listen for new notifications. */
  onNotification(handler: (entry: NotificationEntry) => void): () => void;
}

// ── Module factory ───────────────────────────────────────

export const notificationsModule: ZroModuleFactory = () => {
  let _history: NotificationEntry[] = [];
  let _listeners: Array<(entry: NotificationEntry) => void> = [];
  let _maxHistory = 100;
  let _idCounter = 0;

  const mod: ZroModule = {
    meta: {
      name: 'notifications',
      version: '0.1.0',
      description: 'Unified notification system (toast + native)',
      category: 'ux',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): NotificationsAPI {
      const shell = ctx.hasModule('shell') ? ctx.getModule<ShellAPI>('shell') : null;
      const isInShell = shell?.isInShell ?? false;

      function _addToHistory(title: string, body: string | undefined, type: string): NotificationEntry {
        const entry: NotificationEntry = {
          id: `notif-${++_idCounter}`,
          title,
          body,
          type,
          timestamp: Date.now(),
          read: false,
        };
        _history.push(entry);
        if (_history.length > _maxHistory) {
          _history = _history.slice(-_maxHistory);
        }
        for (const handler of _listeners) {
          try { handler(entry); } catch (_) { /* noop */ }
        }
        return entry;
      }

      function _showNative(opts: NotificationOptions): void {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

        try {
          const n = new Notification(opts.title, {
            body: opts.body,
            icon: opts.icon,
          });

          if (opts.timeout !== 0) {
            setTimeout(() => n.close(), opts.timeout ?? 5000);
          }
        } catch (_) {
          // Notifications not supported
        }
      }

      const api: NotificationsAPI = {
        show(opts: NotificationOptions): string {
          const entry = _addToHistory(opts.title, opts.body, opts.type ?? 'info');

          if (isInShell && document.visibilityState === 'visible') {
            // Use shell toast notification
            shell!.notify({
              title: opts.title,
              body: opts.body,
              timeout: opts.timeout ?? 5000,
            }).catch(() => { /* silent */ });
          } else if (isInShell && document.visibilityState === 'hidden') {
            // Shell in background: use native notification
            _showNative(opts);
          } else {
            // Standalone: use native notification
            _showNative(opts);
          }

          return entry.id;
        },

        dismiss(id: string): void {
          // Notifications auto-dismiss via timeout; this marks as read
          const entry = _history.find(n => n.id === id);
          if (entry) entry.read = true;
        },

        history(): NotificationEntry[] {
          return [..._history];
        },

        clearHistory(): void {
          _history = [];
        },

        markRead(id: string): void {
          const entry = _history.find(n => n.id === id);
          if (entry) entry.read = true;
        },

        unreadCount(): number {
          return _history.filter(n => !n.read).length;
        },

        async requestPermission(): Promise<NotificationPermission> {
          if (typeof Notification === 'undefined') return 'denied';
          if (Notification.permission === 'granted') return 'granted';
          return Notification.requestPermission();
        },

        onNotification(handler: (entry: NotificationEntry) => void): () => void {
          _listeners.push(handler);
          return () => {
            _listeners = _listeners.filter(h => h !== handler);
          };
        },
      };

      return api;
    },

    destroy(): void {
      _listeners = [];
    },
  };

  return mod;
};
