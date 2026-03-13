"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const module_js_1 = require("../src/module.js");
const app_js_1 = require("../src/app.js");
// ── ModuleRegistrar ─────────────────────────────────────────────
(0, node_test_1.describe)('ModuleRegistrar', () => {
    (0, node_test_1.it)('registers commands', () => {
        const r = new module_js_1.ModuleRegistrar();
        r.command('greet', async () => 'hello');
        strict_1.default.ok(r._commands.has('greet'));
    });
    (0, node_test_1.it)('registers event handlers', () => {
        const r = new module_js_1.ModuleRegistrar();
        r.onEvent('my:event', async () => { });
        strict_1.default.ok(r._eventHandlers.has('my:event'));
    });
    (0, node_test_1.it)('registers lifecycle handlers', () => {
        const r = new module_js_1.ModuleRegistrar();
        r.on('client:connected', async () => { });
        strict_1.default.ok(r._lifecycleHandlers.has('client:connected'));
    });
    (0, node_test_1.it)('registers init hooks', () => {
        const r = new module_js_1.ModuleRegistrar();
        r.onInit(async () => { });
        strict_1.default.equal(r._initHooks.length, 1);
    });
    (0, node_test_1.it)('registers destroy hooks', () => {
        const r = new module_js_1.ModuleRegistrar();
        r.onDestroy(async () => { });
        strict_1.default.equal(r._destroyHooks.length, 1);
    });
    (0, node_test_1.it)('chains fluently', () => {
        const r = new module_js_1.ModuleRegistrar();
        const result = r
            .command('a', async () => { })
            .onEvent('b', async () => { })
            .on('client:connected', async () => { })
            .onInit(async () => { })
            .onDestroy(async () => { });
        strict_1.default.equal(result, r);
    });
});
// ── ZroModule with ZroApp ───────────────────────────────────────
(0, node_test_1.describe)('ZroApp.module()', () => {
    (0, node_test_1.it)('registers a module', () => {
        const mod = {
            meta: { name: 'greet', version: '0.1.0' },
            register(r) {
                r.command('greet', async (_ctx, params) => `Hi ${params.name}`);
            },
        };
        const app = new app_js_1.ZroApp();
        const result = app.module(mod);
        strict_1.default.equal(result, app);
        // @ts-ignore — accessing private for testing
        strict_1.default.equal(app._modules.length, 1);
    });
    (0, node_test_1.it)('chains with other methods', () => {
        const mod = {
            meta: { name: 'test', version: '0.1.0' },
            register(r) {
                r.command('test_cmd', async () => 'ok');
            },
        };
        const app = new app_js_1.ZroApp();
        const result = app
            .module(mod)
            .command('extra', async () => 'extra')
            .registerState('x', 0);
        strict_1.default.equal(result, app);
    });
});
// ── Dependency Resolution ───────────────────────────────────────
(0, node_test_1.describe)('resolveModuleOrder', () => {
    (0, node_test_1.it)('resolves modules with no deps', () => {
        const modules = [
            { meta: { name: 'a', version: '0.1.0' }, register() { } },
            { meta: { name: 'b', version: '0.1.0' }, register() { } },
        ];
        const order = (0, module_js_1.resolveModuleOrder)(modules);
        strict_1.default.equal(order.length, 2);
    });
    (0, node_test_1.it)('resolves dependency order', () => {
        const modules = [
            { meta: { name: 'b', version: '0.1.0', dependencies: ['a'] }, register() { } },
            { meta: { name: 'a', version: '0.1.0' }, register() { } },
        ];
        const order = (0, module_js_1.resolveModuleOrder)(modules);
        const aPos = order.indexOf(1); // 'a' is at index 1
        const bPos = order.indexOf(0); // 'b' is at index 0
        strict_1.default.ok(aPos < bPos, `a (pos ${aPos}) should come before b (pos ${bPos})`);
    });
    (0, node_test_1.it)('resolves chain A → B → C', () => {
        const modules = [
            { meta: { name: 'c', version: '0.1.0', dependencies: ['b'] }, register() { } },
            { meta: { name: 'a', version: '0.1.0' }, register() { } },
            { meta: { name: 'b', version: '0.1.0', dependencies: ['a'] }, register() { } },
        ];
        const order = (0, module_js_1.resolveModuleOrder)(modules);
        const aPos = order.indexOf(1);
        const bPos = order.indexOf(2);
        const cPos = order.indexOf(0);
        strict_1.default.ok(aPos < bPos, 'a before b');
        strict_1.default.ok(bPos < cPos, 'b before c');
    });
    (0, node_test_1.it)('throws on circular dependency', () => {
        const modules = [
            { meta: { name: 'a', version: '0.1.0', dependencies: ['b'] }, register() { } },
            { meta: { name: 'b', version: '0.1.0', dependencies: ['a'] }, register() { } },
        ];
        strict_1.default.throws(() => (0, module_js_1.resolveModuleOrder)(modules), /Circular dependency/);
    });
    (0, node_test_1.it)('throws on missing dependency', () => {
        const modules = [
            { meta: { name: 'a', version: '0.1.0', dependencies: ['nonexistent'] }, register() { } },
        ];
        strict_1.default.throws(() => (0, module_js_1.resolveModuleOrder)(modules), /not registered/);
    });
});
