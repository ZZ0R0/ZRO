"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleRegistrar = void 0;
exports.resolveModuleOrder = resolveModuleOrder;
// ── Module Registrar ────────────────────────────────────────────
/**
 * Builder passed to {@link ZroModule.register} for contributing handlers.
 *
 * Mirrors the `ZroApp` API so modules register in the same way
 * as manual inline handlers.
 */
class ModuleRegistrar {
    /** @internal */ _commands = new Map();
    /** @internal */ _eventHandlers = new Map();
    /** @internal */ _lifecycleHandlers = new Map();
    /** @internal */ _initHooks = [];
    /** @internal */ _destroyHooks = [];
    /** Register a command handler (WS invoke + HTTP API). */
    command(name, handler) {
        this._commands.set(name, handler);
        return this;
    }
    /** Register a WS event handler (fire-and-forget). */
    onEvent(event, handler) {
        this._eventHandlers.set(event, handler);
        return this;
    }
    /** Register a lifecycle handler (`client:connected`, etc.). */
    on(event, handler) {
        this._lifecycleHandlers.set(event, handler);
        return this;
    }
    /** Register an init hook, called after IPC handshake before the main loop. */
    onInit(handler) {
        this._initHooks.push(handler);
        return this;
    }
    /** Register a destroy hook, called during shutdown (reverse init order). */
    onDestroy(handler) {
        this._destroyHooks.push(handler);
        return this;
    }
}
exports.ModuleRegistrar = ModuleRegistrar;
// ── Dependency Resolution ───────────────────────────────────────
/**
 * Resolve module initialization order via topological sort.
 * Returns indices into `modules` in the order they should be initialized.
 *
 * @throws Error on missing dependencies or circular references.
 */
function resolveModuleOrder(modules) {
    const nameToIdx = new Map();
    for (let i = 0; i < modules.length; i++) {
        nameToIdx.set(modules[i].meta.name, i);
    }
    const n = modules.length;
    const inDegree = new Array(n).fill(0);
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
        const deps = modules[i].meta.dependencies ?? [];
        for (const dep of deps) {
            const depIdx = nameToIdx.get(dep);
            if (depIdx === undefined) {
                throw new Error(`Module '${modules[i].meta.name}' depends on '${dep}' which is not registered`);
            }
            adj[depIdx].push(i);
            inDegree[i]++;
        }
    }
    // Kahn's algorithm
    const queue = [];
    for (let i = 0; i < n; i++) {
        if (inDegree[i] === 0)
            queue.push(i);
    }
    const order = [];
    while (queue.length > 0) {
        const node = queue.shift();
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
