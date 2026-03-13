import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ModuleRegistrar, resolveModuleOrder } from '../src/module.js';
import type { ZroModule } from '../src/module.js';
import { ZroApp } from '../src/app.js';

// ── ModuleRegistrar ─────────────────────────────────────────────

describe('ModuleRegistrar', () => {
    it('registers commands', () => {
        const r = new ModuleRegistrar();
        r.command('greet', async () => 'hello');
        assert.ok(r._commands.has('greet'));
    });

    it('registers event handlers', () => {
        const r = new ModuleRegistrar();
        r.onEvent('my:event', async () => {});
        assert.ok(r._eventHandlers.has('my:event'));
    });

    it('registers lifecycle handlers', () => {
        const r = new ModuleRegistrar();
        r.on('client:connected', async () => {});
        assert.ok(r._lifecycleHandlers.has('client:connected'));
    });

    it('registers init hooks', () => {
        const r = new ModuleRegistrar();
        r.onInit(async () => {});
        assert.equal(r._initHooks.length, 1);
    });

    it('registers destroy hooks', () => {
        const r = new ModuleRegistrar();
        r.onDestroy(async () => {});
        assert.equal(r._destroyHooks.length, 1);
    });

    it('chains fluently', () => {
        const r = new ModuleRegistrar();
        const result = r
            .command('a', async () => {})
            .onEvent('b', async () => {})
            .on('client:connected', async () => {})
            .onInit(async () => {})
            .onDestroy(async () => {});
        assert.equal(result, r);
    });
});

// ── ZroModule with ZroApp ───────────────────────────────────────

describe('ZroApp.module()', () => {
    it('registers a module', () => {
        const mod: ZroModule = {
            meta: { name: 'greet', version: '0.1.0' },
            register(r) {
                r.command('greet', async (_ctx, params) => `Hi ${params.name}`);
            },
        };

        const app = new ZroApp();
        const result = app.module(mod);
        assert.equal(result, app);
        // @ts-ignore — accessing private for testing
        assert.equal(app._modules.length, 1);
    });

    it('chains with other methods', () => {
        const mod: ZroModule = {
            meta: { name: 'test', version: '0.1.0' },
            register(r) {
                r.command('test_cmd', async () => 'ok');
            },
        };

        const app = new ZroApp();
        const result = app
            .module(mod)
            .command('extra', async () => 'extra')
            .registerState('x', 0);
        assert.equal(result, app);
    });
});

// ── Dependency Resolution ───────────────────────────────────────

describe('resolveModuleOrder', () => {
    it('resolves modules with no deps', () => {
        const modules: ZroModule[] = [
            { meta: { name: 'a', version: '0.1.0' }, register() {} },
            { meta: { name: 'b', version: '0.1.0' }, register() {} },
        ];
        const order = resolveModuleOrder(modules);
        assert.equal(order.length, 2);
    });

    it('resolves dependency order', () => {
        const modules: ZroModule[] = [
            { meta: { name: 'b', version: '0.1.0', dependencies: ['a'] }, register() {} },
            { meta: { name: 'a', version: '0.1.0' }, register() {} },
        ];
        const order = resolveModuleOrder(modules);
        const aPos = order.indexOf(1); // 'a' is at index 1
        const bPos = order.indexOf(0); // 'b' is at index 0
        assert.ok(aPos < bPos, `a (pos ${aPos}) should come before b (pos ${bPos})`);
    });

    it('resolves chain A → B → C', () => {
        const modules: ZroModule[] = [
            { meta: { name: 'c', version: '0.1.0', dependencies: ['b'] }, register() {} },
            { meta: { name: 'a', version: '0.1.0' }, register() {} },
            { meta: { name: 'b', version: '0.1.0', dependencies: ['a'] }, register() {} },
        ];
        const order = resolveModuleOrder(modules);
        const aPos = order.indexOf(1);
        const bPos = order.indexOf(2);
        const cPos = order.indexOf(0);
        assert.ok(aPos < bPos, 'a before b');
        assert.ok(bPos < cPos, 'b before c');
    });

    it('throws on circular dependency', () => {
        const modules: ZroModule[] = [
            { meta: { name: 'a', version: '0.1.0', dependencies: ['b'] }, register() {} },
            { meta: { name: 'b', version: '0.1.0', dependencies: ['a'] }, register() {} },
        ];
        assert.throws(
            () => resolveModuleOrder(modules),
            /Circular dependency/,
        );
    });

    it('throws on missing dependency', () => {
        const modules: ZroModule[] = [
            { meta: { name: 'a', version: '0.1.0', dependencies: ['nonexistent'] }, register() {} },
        ];
        assert.throws(
            () => resolveModuleOrder(modules),
            /not registered/,
        );
    });
});
