/**
 * @zro/lifecycle — Frontend lifecycle management module.
 *
 * Handles beforeunload, visibility changes, and idle detection.
 * Integrates with state module for auto-save on close.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  LifecycleAPI,
} from '../core/types.js';

export const lifecycleModule: ZroModuleFactory = () => {
  let _cleanups: Array<() => void> = [];

  const mod: ZroModule = {
    meta: {
      name: 'lifecycle',
      version: '0.1.0',
      description: 'Frontend lifecycle (unload, visibility, idle)',
      category: 'core',
      dependencies: [],
    },

    init(_ctx: ZroModuleContext): LifecycleAPI {
      return {
        onBeforeUnload(handler: () => void | Promise<void>): () => void {
          const listener = (e: BeforeUnloadEvent) => {
            handler();
            // Setting returnValue for browsers that require it
            e.returnValue = '';
          };
          window.addEventListener('beforeunload', listener);
          const cleanup = () => window.removeEventListener('beforeunload', listener);
          _cleanups.push(cleanup);
          return cleanup;
        },

        onVisibilityChange(handler: (visible: boolean) => void): () => void {
          const listener = () => handler(document.visibilityState === 'visible');
          document.addEventListener('visibilitychange', listener);
          const cleanup = () => document.removeEventListener('visibilitychange', listener);
          _cleanups.push(cleanup);
          return cleanup;
        },

        onIdle(handler: () => void, timeoutMs = 60000): () => void {
          let timer = setTimeout(handler, timeoutMs);
          const events = ['mousemove', 'keydown', 'scroll', 'touchstart'];

          const reset = () => {
            clearTimeout(timer);
            timer = setTimeout(handler, timeoutMs);
          };

          for (const ev of events) {
            document.addEventListener(ev, reset, { passive: true });
          }

          const cleanup = () => {
            clearTimeout(timer);
            for (const ev of events) {
              document.removeEventListener(ev, reset);
            }
          };

          _cleanups.push(cleanup);
          return cleanup;
        },
      };
    },

    destroy(): void {
      for (const fn of _cleanups) fn();
      _cleanups = [];
    },
  };

  return mod;
};
