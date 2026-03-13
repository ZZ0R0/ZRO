/**
 * @zro/core/registry — Module registry with dependency resolution.
 *
 * The registry:
 *   1. Collects module factories
 *   2. Resolves dependency order (topological sort)
 *   3. Initializes modules in order
 *   4. Provides access to initialized module APIs
 *   5. Handles teardown in reverse order
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  ZroConfig,
} from './types.js';

interface InitializedModule {
  module: ZroModule;
  api: unknown;
}

export class ModuleRegistry {
  private _factories: Map<string, ZroModuleFactory> = new Map();
  private _modules: Map<string, InitializedModule> = new Map();
  private _initOrder: string[] = [];
  private _config: ZroConfig | null = null;
  private _debug = false;

  /**
   * Register a module factory. Call this before init().
   * Can be called multiple times to add modules.
   */
  register(factory: ZroModuleFactory): this {
    const mod = factory();
    const name = mod.meta.name;

    if (this._modules.has(name)) {
      throw new Error(`[ZRO] Module '${name}' is already initialized. Cannot re-register.`);
    }

    this._factories.set(name, factory);
    return this;
  }

  /**
   * Register multiple module factories at once.
   */
  registerAll(factories: ZroModuleFactory[]): this {
    for (const f of factories) {
      this.register(f);
    }
    return this;
  }

  /**
   * Initialize all registered modules in dependency order.
   * Must be called once with the app config.
   */
  async init(config: ZroConfig): Promise<void> {
    this._config = config;
    this._debug = config.debug ?? false;

    // Build module instances from factories
    const pending = new Map<string, ZroModule>();
    for (const [name, factory] of this._factories) {
      if (!this._modules.has(name)) {
        pending.set(name, factory());
      }
    }

    // Topological sort for dependency order
    const order = this._resolveDependencies(pending);

    // Initialize in order
    for (const name of order) {
      const mod = pending.get(name);
      if (!mod) continue;

      const ctx = this._createContext(name);
      this._log(`Initializing module: ${name} v${mod.meta.version}`);

      try {
        const api = await mod.init(ctx);
        this._modules.set(name, { module: mod, api });
        this._initOrder.push(name);
      } catch (err) {
        throw new Error(
          `[ZRO] Module '${name}' failed to initialize: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this._log(`All modules initialized: [${this._initOrder.join(', ')}]`);
  }

  /**
   * Get a module's public API by name.
   * @throws if module is not initialized.
   */
  get<T = unknown>(name: string): T {
    const entry = this._modules.get(name);
    if (!entry) {
      throw new Error(`[ZRO] Module '${name}' is not available. Did you register it?`);
    }
    return entry.api as T;
  }

  /**
   * Check if a module is available (registered and initialized).
   */
  has(name: string): boolean {
    return this._modules.has(name);
  }

  /**
   * Tear down all modules in reverse initialization order.
   */
  async destroy(): Promise<void> {
    const reversed = [...this._initOrder].reverse();
    for (const name of reversed) {
      const entry = this._modules.get(name);
      if (entry?.module.destroy) {
        this._log(`Destroying module: ${name}`);
        try {
          await entry.module.destroy();
        } catch (err) {
          console.error(`[ZRO] Module '${name}' destroy error:`, err);
        }
      }
    }
    this._modules.clear();
    this._initOrder = [];
  }

  /**
   * List all initialized module names (in init order).
   */
  list(): string[] {
    return [...this._initOrder];
  }

  /**
   * Get metadata for all registered modules.
   */
  info(): Array<{ name: string; version: string; category: string; initialized: boolean }> {
    const result: Array<{ name: string; version: string; category: string; initialized: boolean }> = [];

    for (const [name, factory] of this._factories) {
      const mod = factory();
      result.push({
        name,
        version: mod.meta.version,
        category: mod.meta.category,
        initialized: this._modules.has(name),
      });
    }

    return result;
  }

  // ── Private ──────────────────────────────────────────

  private _resolveDependencies(modules: Map<string, ZroModule>): string[] {
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;

      if (visiting.has(name)) {
        throw new Error(`[ZRO] Circular dependency detected involving module '${name}'`);
      }

      const mod = modules.get(name);
      if (!mod) {
        // Check if already initialized (from a previous init call)
        if (this._modules.has(name)) {
          visited.add(name);
          return;
        }
        throw new Error(
          `[ZRO] Module '${name}' is required as a dependency but not registered.`
        );
      }

      visiting.add(name);

      for (const dep of mod.meta.dependencies ?? []) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of modules.keys()) {
      visit(name);
    }

    return order;
  }

  private _createContext(moduleName: string): ZroModuleContext {
    return {
      getModule: <T = unknown>(name: string): T => this.get<T>(name),
      hasModule: (name: string): boolean => this.has(name),
      config: this._config!,
      log: (...args: unknown[]) => {
        if (this._debug) {
          console.log(`[ZRO:${moduleName}]`, ...args);
        }
      },
    };
  }

  private _log(...args: unknown[]) {
    if (this._debug) {
      console.log('[ZRO:registry]', ...args);
    }
  }
}
