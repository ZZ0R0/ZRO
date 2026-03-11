"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const context_js_1 = require("../src/context.js");
const app_js_1 = require("../src/app.js");
function makeSession() {
    return {
        session_id: 'sess-1',
        user_id: 'u1',
        username: 'alice',
        role: 'admin',
        groups: ['dev'],
    };
}
(0, node_test_1.describe)('AppContext', () => {
    (0, node_test_1.it)('exposes session info', () => {
        const app = new app_js_1.ZroApp();
        const ctx = new context_js_1.AppContext(makeSession(), 'inst-1', 'echo', '/tmp/echo', app);
        strict_1.default.equal(ctx.session.username, 'alice');
        strict_1.default.equal(ctx.instanceId, 'inst-1');
        strict_1.default.equal(ctx.slug, 'echo');
    });
    (0, node_test_1.it)('accesses registered state', () => {
        const app = new app_js_1.ZroApp();
        app.registerState('counter', 42);
        const ctx = new context_js_1.AppContext(makeSession(), 'i1', 's', '/tmp', app);
        strict_1.default.equal(ctx.state('counter'), 42);
    });
});
(0, node_test_1.describe)('ZroApp', () => {
    (0, node_test_1.it)('registers commands', () => {
        const app = new app_js_1.ZroApp();
        app.command('greet', async (ctx, params) => `Hi ${params.name}`);
        // @ts-ignore — accessing private for testing
        strict_1.default.ok(app._commands.has('greet'));
    });
    (0, node_test_1.it)('registers event handlers', () => {
        const app = new app_js_1.ZroApp();
        app.on('client:connected', async (ctx) => { });
        // @ts-ignore
        strict_1.default.ok(app._lifecycleHandlers.has('client:connected'));
    });
    (0, node_test_1.it)('registers state', () => {
        const app = new app_js_1.ZroApp();
        app.registerState('items', [1, 2, 3]);
        // @ts-ignore
        strict_1.default.deepEqual(app._states.get('items'), [1, 2, 3]);
    });
    (0, node_test_1.it)('chains fluently', () => {
        const app = new app_js_1.ZroApp();
        const result = app
            .command('a', async () => { })
            .command('b', async () => { })
            .on('client:connected', async () => { })
            .registerState('x', 0);
        strict_1.default.equal(result, app);
    });
});
(0, node_test_1.describe)('ZroApp._handleCommand', () => {
    (0, node_test_1.it)('calls handler and returns result', async () => {
        const app = new app_js_1.ZroApp();
        app.command('add', async (ctx, params) => params.a + params.b);
        // Capture what gets sent
        let sentMsg = null;
        // @ts-ignore
        app._ipc = { send: (msg) => { sentMsg = msg; } };
        // @ts-ignore
        app._appId = 'test-app';
        // @ts-ignore
        app._slug = 'test';
        const { IpcMessage } = await Promise.resolve().then(() => __importStar(require('../src/protocol.js')));
        const req = IpcMessage.new('CommandRequest', {
            command: 'add',
            params: { a: 3, b: 4 },
            session: makeSession(),
            instance_id: 'i1',
        });
        // @ts-ignore — calling private method
        await app._handleCommand(req);
        strict_1.default.ok(sentMsg);
        strict_1.default.equal(sentMsg.type, 'CommandResponse');
        strict_1.default.equal(sentMsg.payload.result, 7);
        strict_1.default.equal(sentMsg.id, req.id);
    });
    (0, node_test_1.it)('returns error for unknown command', async () => {
        const app = new app_js_1.ZroApp();
        let sentMsg = null;
        // @ts-ignore
        app._ipc = { send: (msg) => { sentMsg = msg; } };
        const { IpcMessage } = await Promise.resolve().then(() => __importStar(require('../src/protocol.js')));
        const req = IpcMessage.new('CommandRequest', {
            command: 'nonexistent',
            params: {},
            session: makeSession(),
            instance_id: 'i1',
        });
        // @ts-ignore
        await app._handleCommand(req);
        strict_1.default.ok(sentMsg);
        strict_1.default.equal(sentMsg.type, 'CommandResponse');
        strict_1.default.ok(sentMsg.payload.error.includes('nonexistent'));
    });
    (0, node_test_1.it)('catches handler errors', async () => {
        const app = new app_js_1.ZroApp();
        app.command('fail', async () => { throw new Error('boom'); });
        let sentMsg = null;
        // @ts-ignore
        app._ipc = { send: (msg) => { sentMsg = msg; } };
        const { IpcMessage } = await Promise.resolve().then(() => __importStar(require('../src/protocol.js')));
        const req = IpcMessage.new('CommandRequest', {
            command: 'fail',
            params: {},
            session: makeSession(),
            instance_id: 'i1',
        });
        // @ts-ignore
        await app._handleCommand(req);
        strict_1.default.ok(sentMsg);
        strict_1.default.equal(sentMsg.payload.error, 'boom');
    });
});
