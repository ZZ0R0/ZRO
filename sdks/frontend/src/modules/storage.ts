/**
 * @zro/storage — Scoped localStorage module.
 *
 * Provides a localStorage wrapper that automatically prefixes keys
 * with the app slug to prevent collisions between apps sharing the
 * same origin. Per-instance storage is also supported.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Types ────────────────────────────────────────────────

export interface StorageAPI {
  /** Get a value from scoped storage. */
  get<T = string>(key: string): T | null;

  /** Set a value in scoped storage. */
  set(key: string, value: unknown): void;

  /** Remove a key from scoped storage. */
  remove(key: string): void;

  /** Check if a key exists. */
  has(key: string): boolean;

  /** List all keys in this app's scope (without prefix). */
  keys(): string[];

  /** Clear all keys in this app's scope. */
  clear(): void;

  /** Get a per-instance storage accessor. */
  instance(instanceId: string): InstanceStorage;
}

export interface InstanceStorage {
  get<T = string>(key: string): T | null;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  clear(): void;
}

// ── Module factory ───────────────────────────────────────

export const storageModule: ZroModuleFactory = () => {
  let _prefix = '';

  function _scopedGet<T>(prefix: string, key: string): T | null {
    const raw = localStorage.getItem(`${prefix}${key}`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  function _scopedSet(prefix: string, key: string, value: unknown): void {
    localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
  }

  function _scopedRemove(prefix: string, key: string): void {
    localStorage.removeItem(`${prefix}${key}`);
  }

  function _scopedHas(prefix: string, key: string): boolean {
    return localStorage.getItem(`${prefix}${key}`) !== null;
  }

  function _scopedKeys(prefix: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        result.push(key.slice(prefix.length));
      }
    }
    return result;
  }

  function _scopedClear(prefix: string): void {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
    }
  }

  function _createInstanceStorage(instanceId: string): InstanceStorage {
    const iPrefix = `${_prefix}${instanceId}:`;
    return {
      get: <T = string>(key: string) => _scopedGet<T>(iPrefix, key),
      set: (key: string, value: unknown) => _scopedSet(iPrefix, key, value),
      remove: (key: string) => _scopedRemove(iPrefix, key),
      has: (key: string) => _scopedHas(iPrefix, key),
      keys: () => _scopedKeys(iPrefix),
      clear: () => _scopedClear(iPrefix),
    };
  }

  const mod: ZroModule = {
    meta: {
      name: 'storage',
      version: '0.1.0',
      description: 'Scoped localStorage (per-app, per-instance)',
      category: 'data',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): StorageAPI {
      _prefix = `zro:${ctx.config.slug}:`;

      const api: StorageAPI = {
        get: <T = string>(key: string) => _scopedGet<T>(_prefix, key),
        set: (key: string, value: unknown) => _scopedSet(_prefix, key, value),
        remove: (key: string) => _scopedRemove(_prefix, key),
        has: (key: string) => _scopedHas(_prefix, key),
        keys: () => _scopedKeys(_prefix),
        clear: () => _scopedClear(_prefix),
        instance: (instanceId: string) => _createInstanceStorage(instanceId),
      };

      return api;
    },
  };

  return mod;
};
