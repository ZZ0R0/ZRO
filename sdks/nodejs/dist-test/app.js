"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZroApp = void 0;
const ipc_1 = require("./ipc");
const protocol_1 = require("./protocol");
const context_1 = require("./context");
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
class ZroApp {
    _commands = new Map();
    _wsEventHandlers = new Map();
    _lifecycleHandlers = new Map();
    _states = new Map();
    _ipc = null;
    _slug = '';
    _dataDir = '/tmp';
    /** Register a command handler (for WS invoke and HTTP API). */
    command(name, handler) {
        this._commands.set(name, handler);
        return this;
    }
    /** Register a WS event handler (fire-and-forget, from client conn.emit()). */
    onWsEvent(event, handler) {
        this._wsEventHandlers.set(event, handler);
        return this;
    }
    /** Register a lifecycle event handler. */
    on(event, handler) {
        this._lifecycleHandlers.set(event, handler);
        return this;
    }
    /** Register a shared state value. */
    registerState(key, initial) {
        this._states.set(key, initial);
        return this;
    }
    /** Start the application (blocking). */
    run() {
        this._main().catch((err) => {
            console.error('[ZRO SDK] Fatal error:', err);
            process.exit(1);
        });
    }
    /** @internal — emit an event via IPC. */
    _emit(target, event, data) {
        if (!this._ipc)
            return;
        const msg = protocol_1.IpcMessage.new('EventEmit', {
            event,
            payload: data,
            target,
        });
        this._ipc.send(msg);
    }
    /** @internal — get registered state. */
    _getState(key) {
        return this._states.get(key);
    }
    // ── Main loop ───────────────────────────────────────
    async _main() {
        const socketPath = process.env.ZRO_IPC_SOCKET ?? '';
        this._slug = process.env.ZRO_APP_SLUG ?? '';
        this._dataDir = process.env.ZRO_DATA_DIR ?? `/tmp/zro-${this._slug}`;
        if (!socketPath) {
            console.error('[ZRO SDK] ERROR: ZRO_IPC_SOCKET not set');
            process.exit(1);
        }
        this._ipc = new ipc_1.IpcClient();
        await this._ipc.connect(socketPath);
        // Handshake
        const hello = protocol_1.IpcMessage.new('Hello', {
            slug: this._slug,
            app_version: '0.1.0',
            protocol_version: 1,
        });
        this._ipc.send(hello);
        const ack = await this._ipc.recv();
        if (ack.type !== 'HelloAck') {
            console.error(`[ZRO SDK] Handshake failed: ${ack.type}`);
            process.exit(1);
        }
        console.error(`[ZRO SDK] App ${this._slug} connected`);
        // SIGTERM
        process.on('SIGTERM', () => this._shutdown());
        // Message loop
        try {
            while (true) {
                const msg = await this._ipc.recv();
                this._handleMessage(msg).catch((err) => {
                    console.error(`[ZRO SDK] Error handling ${msg.type}:`, err);
                });
            }
        }
        catch (err) {
            if (err?.message === 'Connection closed') {
                console.error('[ZRO SDK] IPC connection closed');
            }
            else {
                console.error('[ZRO SDK] IPC error:', err);
            }
        }
    }
    _shutdown() {
        if (this._ipc) {
            const ack = protocol_1.IpcMessage.new('ShutdownAck', { status: 'ok' });
            try {
                this._ipc.send(ack);
                this._ipc.close();
            }
            catch { /* ignore */ }
        }
        process.exit(0);
    }
    // ── Message dispatch ────────────────────────────────
    async _handleMessage(msg) {
        switch (msg.type) {
            case 'CommandRequest':
                await this._handleCommand(msg);
                break;
            case 'WsMessage':
                await this._handleWsMessage(msg);
                break;
            case 'HttpRequest':
                await this._handleHttpRequest(msg);
                break;
            case 'ClientConnected':
                await this._dispatchLifecycle('client:connected', msg);
                break;
            case 'ClientDisconnected':
                await this._dispatchLifecycle('client:disconnected', msg);
                break;
            case 'ClientReconnected':
                await this._dispatchLifecycle('client:reconnected', msg);
                break;
            case 'Shutdown':
                this._shutdown();
                break;
            default:
                console.error(`[ZRO SDK] Unknown message type: ${msg.type}`);
        }
    }
    async _handleCommand(msg) {
        const { command: cmdName, params = {}, session, instance_id } = msg.payload;
        const handler = this._commands.get(cmdName);
        if (!handler) {
            const response = protocol_1.IpcMessage.reply(msg.id, 'CommandResponse', {
                error: `Unknown command: ${cmdName}`,
            });
            this._ipc.send(response);
            return;
        }
        const ctx = new context_1.AppContext(session, instance_id, this._slug, this._dataDir, this);
        try {
            const result = await handler(ctx, params);
            const response = protocol_1.IpcMessage.reply(msg.id, 'CommandResponse', { result });
            this._ipc.send(response);
        }
        catch (err) {
            const response = protocol_1.IpcMessage.reply(msg.id, 'CommandResponse', {
                error: err?.message ?? String(err),
            });
            this._ipc.send(response);
        }
    }
    async _dispatchLifecycle(event, msg) {
        const handler = this._lifecycleHandlers.get(event);
        if (!handler)
            return;
        const { session, instance_id } = msg.payload;
        const ctx = new context_1.AppContext(session, instance_id, this._slug, this._dataDir, this);
        await handler(ctx);
    }
    async _handleWsMessage(msg) {
        const { event, data, session, instance_id } = msg.payload;
        const ctx = new context_1.AppContext(session, instance_id, this._slug, this._dataDir, this);
        // 1. Try dedicated WS event handlers first
        let handler = this._wsEventHandlers.get(event);
        if (!handler) {
            const alt = event.replace(/:/g, '_');
            handler = this._wsEventHandlers.get(alt);
        }
        if (handler) {
            try {
                await handler(ctx, data);
            }
            catch (err) {
                console.error(`[ZRO SDK] WS event handler error (${event}):`, err);
            }
            return;
        }
        // 2. Fall back to command handlers (backward compat)
        let cmdHandler = this._commands.get(event);
        if (!cmdHandler) {
            const alt = event.replace(/:/g, '_');
            cmdHandler = this._commands.get(alt);
        }
        if (cmdHandler) {
            try {
                await cmdHandler(ctx, data);
            }
            catch (err) {
                console.error(`[ZRO SDK] WS→command fallback error (${event}):`, err);
            }
        }
        else {
            console.error(`[ZRO SDK] No handler for WS event: ${event}`);
        }
    }
    async _handleHttpRequest(msg) {
        const { method = 'GET', path = '', body: bodyB64, query = {}, session } = msg.payload;
        const ctx = new context_1.AppContext(session, null, this._slug, this._dataDir, this);
        // Strip /api/ prefix
        let cleanPath = path.replace(/^\/?(api\/)?/, '').replace(/^\/|\/$/g, '');
        const segments = cleanPath.split('/').filter(Boolean);
        const base = segments[0] || '';
        const methodLower = method.toLowerCase();
        // Build candidate command names
        const candidates = [base, `${methodLower}_${base}`];
        const crudMap = {
            get: ['list', 'get'],
            post: ['create'],
            put: ['update', 'set'],
            delete: ['delete'],
            patch: ['update'],
        };
        for (const action of crudMap[methodLower] || []) {
            candidates.push(`${base}_${action}`, `${action}_${base}`);
        }
        if (segments.length > 1) {
            candidates.push(`${base}_${segments[1]}`, `${segments[1]}_${base}`);
        }
        const commandName = candidates.find((c) => this._commands.has(c));
        if (!commandName) {
            const bodyJson = JSON.stringify({ error: `No handler for ${method} ${path}` });
            const response = protocol_1.IpcMessage.reply(msg.id, 'HttpResponse', {
                status: 404,
                headers: { 'content-type': 'application/json' },
                body: Buffer.from(bodyJson).toString('base64'),
            });
            this._ipc.send(response);
            return;
        }
        // Build params from body + query + path id
        let params = {};
        if (bodyB64) {
            try {
                params = JSON.parse(Buffer.from(bodyB64, 'base64').toString());
            }
            catch {
                params = {};
            }
        }
        if (typeof params !== 'object' || params === null)
            params = {};
        Object.assign(params, query);
        if (segments.length > 1 && !params.id) {
            params.id = segments.slice(1).join('/');
        }
        if (!params._method) {
            params._method = method;
        }
        const handler = this._commands.get(commandName);
        try {
            const result = await handler(ctx, params);
            const bodyJson = JSON.stringify(result);
            const response = protocol_1.IpcMessage.reply(msg.id, 'HttpResponse', {
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: Buffer.from(bodyJson).toString('base64'),
            });
            this._ipc.send(response);
        }
        catch (err) {
            const bodyJson = JSON.stringify({ error: err?.message ?? String(err) });
            const response = protocol_1.IpcMessage.reply(msg.id, 'HttpResponse', {
                status: 500,
                headers: { 'content-type': 'application/json' },
                body: Buffer.from(bodyJson).toString('base64'),
            });
            this._ipc.send(response);
        }
    }
}
exports.ZroApp = ZroApp;
//# sourceMappingURL=app.js.map