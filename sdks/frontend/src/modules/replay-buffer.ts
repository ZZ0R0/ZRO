/**
 * @zro/replay-buffer — Ring buffer for event replay on reconnect.
 *
 * Maintains a size-limited ring buffer of recent events. When a client
 * reconnects after a brief disconnection, buffered events are replayed
 * so the UI can catch up without a full reload.
 *
 * The buffer is per-event-type with a configurable max size (bytes).
 * Oldest entries are evicted when the buffer exceeds its limit.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface ReplayBufferAPI {
  /** Push an event into the replay buffer. */
  push(event: string, payload: unknown): void;

  /** Replay all buffered events by calling the provided handler. */
  replay(handler: (event: string, payload: unknown) => void): void;

  /** Replay only events matching a specific event name. */
  replayEvent(event: string, handler: (payload: unknown) => void): void;

  /** Clear all buffered events. */
  clear(): void;

  /** Clear buffered events for a specific event name. */
  clearEvent(event: string): void;

  /** Get buffer stats. */
  stats(): { totalEvents: number; totalBytes: number; events: Record<string, number> };

  /** Set max buffer size in bytes. */
  setMaxBytes(bytes: number): void;
}

// ── Module factory ───────────────────────────────────────

export const replayBufferModule: ZroModuleFactory = () => {
  interface BufferEntry {
    event: string;
    payload: unknown;
    bytes: number;
    timestamp: number;
  }

  let _entries: BufferEntry[] = [];
  let _totalBytes = 0;
  let _maxBytes = 200 * 1024; // 200KB default

  function _evict(): void {
    while (_totalBytes > _maxBytes && _entries.length > 0) {
      const removed = _entries.shift()!;
      _totalBytes -= removed.bytes;
    }
  }

  const mod: ZroModule = {
    meta: {
      name: 'replay-buffer',
      version: '0.1.0',
      description: 'Ring buffer for event replay on reconnect',
      category: 'core',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): ReplayBufferAPI {
      // If connection module is available, auto-capture events
      if (ctx.hasModule('connection')) {
        ctx.log('ReplayBuffer: auto-capture mode (connection available)');
      }

      const api: ReplayBufferAPI = {
        push(event: string, payload: unknown): void {
          const raw = JSON.stringify(payload);
          const bytes = raw.length * 2; // approximate UTF-16 byte count
          _entries.push({ event, payload, bytes, timestamp: Date.now() });
          _totalBytes += bytes;
          _evict();
        },

        replay(handler: (event: string, payload: unknown) => void): void {
          for (const entry of _entries) {
            try {
              handler(entry.event, entry.payload);
            } catch (_) { /* noop */ }
          }
        },

        replayEvent(event: string, handler: (payload: unknown) => void): void {
          for (const entry of _entries) {
            if (entry.event === event) {
              try {
                handler(entry.payload);
              } catch (_) { /* noop */ }
            }
          }
        },

        clear(): void {
          _entries = [];
          _totalBytes = 0;
        },

        clearEvent(event: string): void {
          const filtered = _entries.filter(e => e.event !== event);
          _totalBytes = filtered.reduce((sum, e) => sum + e.bytes, 0);
          _entries = filtered;
        },

        stats(): { totalEvents: number; totalBytes: number; events: Record<string, number> } {
          const events: Record<string, number> = {};
          for (const e of _entries) {
            events[e.event] = (events[e.event] || 0) + 1;
          }
          return { totalEvents: _entries.length, totalBytes: _totalBytes, events };
        },

        setMaxBytes(bytes: number): void {
          _maxBytes = bytes;
          _evict();
        },
      };

      return api;
    },

    destroy(): void {
      _entries = [];
      _totalBytes = 0;
    },
  };

  return mod;
};
