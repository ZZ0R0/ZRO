/**
 * Module system for ZRO backend applications (Node.js).
 *
 * Modules are self-contained units that contribute commands, event handlers,
 * and lifecycle hooks to a ZRO app. They declare dependencies, are resolved
 * in topological order, and have optional init/destroy lifecycle hooks.
 *
 * @example
 * ```ts
 * import { ZroModule, ModuleMeta, ModuleRegistrar } from '@zro/sdk';
 *
 * const greetModule: ZroModule = {
 *     meta: { name: 'greet', version: '0.1.0' },
 *     register(r: ModuleRegistrar) {
 *         r.command('greet', async (ctx, params) => {
 *             return `Hello, ${params.name ?? 'world'}!`;
 *         });
 *     },
 * };
 *
 * const app = new ZroApp();
 * app.module(greetModule);
 * app.run();
 * ```
 */

import type { AppContext } from './context';
import type { CommandHandler, LifecycleHandler, EventHandler } from './types';

// ── Module Metadata ─────────────────────────────────────────────

/** Metadata describing a module: identity, version, and dependencies. */
export interface ModuleMeta {
    /** Unique module name (e.g. 'kv', 'auth', 'files'). */
    readonly name: string;
    /** Semver version string (e.g. '0.1.0'). */
    readonly version: string;
    /** Human-readable description. */
    readonly description?: string;
    /** Names of modules this module depends on (initialized first). */
    readonly dependencies?: string[];
}

// ── Module Init Context ─────────────────────────────────────────

/** Context available during module initialization (after IPC handshake). */
export interface ModuleInitContext {
    /** The app slug. */
    readonly slug: string;
    /** Path to the app's persistent data directory. */
    readonly dataDir: string;
}

// ── Hook types ──────────────────────────────────────────────────

export type InitHook = (ctx: ModuleInitContext) => Promise<void>;
export type DestroyHook = () => Promise<void>;

// ── Module Registrar ────────────────────────────────────────────

/**
 * Builder passed to {@link ZroModule.register} for contributing handlers.
 *
 * Mirrors the `ZroApp` API so modules register in the same way
 * as manual inline handlers.
 */
export class ModuleRegistrar {
    /** @internal */ readonly _commands = new Map<string, CommandHandler>();
    /** @internal */ readonly _eventHandlers = new Map<string, EventHandler>();
    /** @internal */ readonly _lifecycleHandlers = new Map<string, LifecycleHandler>();
    /** @internal */ readonly _initHooks: InitHook[] = [];
    /** @internal */ readonly _destroyHooks: DestroyHook[] = [];

    /** Register a command handler (WS invoke + HTTP API). */
    command(name: string, handler: CommandHandler): this {
        this._commands.set(name, handler);
        return this;
    }

    /** Register a WS event handler (fire-and-forget). */
    onEvent(event: string, handler: EventHandler): this {
        this._eventHandlers.set(event, handler);
        return this;
    }

    /** Register a lifecycle handler (`client:connected`, etc.). */
    on(event: string, handler: LifecycleHandler): this {
        this._lifecycleHandlers.set(event, handler);
        return this;
    }

    /** Register an init hook, called after IPC handshake before the main loop. */
    onInit(handler: InitHook): this {
        this._initHooks.push(handler);
        return this;
    }

    /** Register a destroy hook, called during shutdown (reverse init order). */
    onDestroy(handler: DestroyHook): this {
        this._destroyHooks.push(handler);
        return this;
    }
}

// ── Module Interface ────────────────────────────────────────────

/**
 * A ZRO backend module. Implement this interface to package reusable
 * commands, event handlers, and lifecycle hooks.
 */
export interface ZroModule {
    /** Module metadata (name, version, dependencies). */
    readonly meta: ModuleMeta;

    /**
     * Register handlers on the provided registrar.
     * Called once during app setup, in dependency order.
     */
    register(registrar: ModuleRegistrar): void;
}

// ── Dependency Resolution ───────────────────────────────────────

/**
 * Resolve module initialization order via topological sort.
 * Returns indices into `modules` in the order they should be initialized.
 *
 * @throws Error on missing dependencies or circular references.
 */
export function resolveModuleOrder(modules: ZroModule[]): number[] {
    const nameToIdx = new Map<string, number>();
    for (let i = 0; i < modules.length; i++) {
        nameToIdx.set(modules[i].meta.name, i);
    }

    const n = modules.length;
    const inDegree = new Array<number>(n).fill(0);
    const adj: number[][] = Array.from({ length: n }, () => []);

    for (let i = 0; i < n; i++) {
        const deps = modules[i].meta.dependencies ?? [];
        for (const dep of deps) {
            const depIdx = nameToIdx.get(dep);
            if (depIdx === undefined) {
                throw new Error(
                    `Module '${modules[i].meta.name}' depends on '${dep}' which is not registered`,
                );
            }
            adj[depIdx].push(i);
            inDegree[i]++;
        }
    }

    // Kahn's algorithm
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
        if (inDegree[i] === 0) queue.push(i);
    }

    const order: number[] = [];
    while (queue.length > 0) {
        const node = queue.shift()!;
        order.push(node);
        for (const next of adj[node]) {
            inDegree[next]--;
            if (inDegree[next] === 0) {
                queue.push(next);
            }
        }
    }

    if (order.length !== n) {
        throw new Error('Circular dependency detected among modules');
    }

    return order;
}
