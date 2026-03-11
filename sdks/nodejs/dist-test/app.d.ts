import type { CommandHandler, LifecycleHandler, WsEventHandler, EventTarget } from './types';
/**
 * ZRO Application builder and runner (Node.js).
 *
 * Supports three communication channels:
 * - **WS invoke** (req/resp): registered via `.command(name, handler)`
 * - **WS event** (fire-and-forget): registered via `.onWsEvent(name, handler)`
 * - **HTTP API** (req/resp): auto-routed to `.command()` handlers
 *
 * @example
 * ```ts
 * const app = new ZroApp();
 * app.command('greet', async (ctx, params) => {
 *     return `Hello, ${params.name}!`;
 * });
 * app.onWsEvent('term:input', async (ctx, data) => {
 *     // fire-and-forget handling
 * });
 * app.run();
 * ```
 */
export declare class ZroApp {
    private _commands;
    private _wsEventHandlers;
    private _lifecycleHandlers;
    private _states;
    private _ipc;
    private _slug;
    private _dataDir;
    /** Register a command handler (for WS invoke and HTTP API). */
    command(name: string, handler: CommandHandler): this;
    /** Register a WS event handler (fire-and-forget, from client conn.emit()). */
    onWsEvent(event: string, handler: WsEventHandler): this;
    /** Register a lifecycle event handler. */
    on(event: string, handler: LifecycleHandler): this;
    /** Register a shared state value. */
    registerState(key: string, initial: any): this;
    /** Start the application (blocking). */
    run(): void;
    /** @internal — emit an event via IPC. */
    _emit(target: EventTarget, event: string, data: any): void;
    /** @internal — get registered state. */
    _getState(key: string): any;
    private _main;
    private _shutdown;
    private _handleMessage;
    private _handleCommand;
    private _dispatchLifecycle;
    private _handleWsMessage;
    private _handleHttpRequest;
}
//# sourceMappingURL=app.d.ts.map