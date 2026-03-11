import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppContext } from '../src/context.js';
import { ZroApp } from '../src/app.js';
import type { SessionInfo } from '../src/types.js';

function makeSession(): SessionInfo {
    return {
        session_id: 'sess-1',
        user_id: 'u1',
        username: 'alice',
        role: 'admin',
        groups: ['dev'],
    };
}

describe('AppContext', () => {
    it('exposes session info', () => {
        const app = new ZroApp();
        const ctx = new AppContext(makeSession(), 'inst-1', 'echo', '/tmp/echo', app);
        assert.equal(ctx.session.username, 'alice');
        assert.equal(ctx.instanceId, 'inst-1');
        assert.equal(ctx.slug, 'echo');
    });

    it('accesses registered state', () => {
        const app = new ZroApp();
        app.registerState('counter', 42);
        const ctx = new AppContext(makeSession(), 'i1', 's', '/tmp', app);
        assert.equal(ctx.state('counter'), 42);
    });
});

describe('ZroApp', () => {
    it('registers commands', () => {
        const app = new ZroApp();
        app.command('greet', async (ctx, params) => `Hi ${params.name}`);
        // @ts-ignore — accessing private for testing
        assert.ok(app._commands.has('greet'));
    });

    it('registers event handlers', () => {
        const app = new ZroApp();
        app.on('client:connected', async (ctx) => {});
        // @ts-ignore
        assert.ok(app._lifecycleHandlers.has('client:connected'));
    });

    it('registers state', () => {
        const app = new ZroApp();
        app.registerState('items', [1, 2, 3]);
        // @ts-ignore
        assert.deepEqual(app._states.get('items'), [1, 2, 3]);
    });

    it('chains fluently', () => {
        const app = new ZroApp();
        const result = app
            .command('a', async () => {})
            .command('b', async () => {})
            .on('client:connected', async () => {})
            .registerState('x', 0);
        assert.equal(result, app);
    });
});

describe('ZroApp._handleCommand', () => {
    it('calls handler and returns result', async () => {
        const app = new ZroApp();
        app.command('add', async (ctx, params) => params.a + params.b);

        // Capture what gets sent
        let sentMsg: any = null;
        // @ts-ignore
        app._ipc = { send: (msg: any) => { sentMsg = msg; } };
        // @ts-ignore
        app._appId = 'test-app';
        // @ts-ignore
        app._slug = 'test';

        const { IpcMessage } = await import('../src/protocol.js');
        const req = IpcMessage.new('CommandRequest', {
            command: 'add',
            params: { a: 3, b: 4 },
            session: makeSession(),
            instance_id: 'i1',
        });

        // @ts-ignore — calling private method
        await app._handleCommand(req);
        assert.ok(sentMsg);
        assert.equal(sentMsg.type, 'CommandResponse');
        assert.equal(sentMsg.payload.result, 7);
        assert.equal(sentMsg.id, req.id);
    });

    it('returns error for unknown command', async () => {
        const app = new ZroApp();

        let sentMsg: any = null;
        // @ts-ignore
        app._ipc = { send: (msg: any) => { sentMsg = msg; } };

        const { IpcMessage } = await import('../src/protocol.js');
        const req = IpcMessage.new('CommandRequest', {
            command: 'nonexistent',
            params: {},
            session: makeSession(),
            instance_id: 'i1',
        });

        // @ts-ignore
        await app._handleCommand(req);
        assert.ok(sentMsg);
        assert.equal(sentMsg.type, 'CommandResponse');
        assert.ok(sentMsg.payload.error.includes('nonexistent'));
    });

    it('catches handler errors', async () => {
        const app = new ZroApp();
        app.command('fail', async () => { throw new Error('boom'); });

        let sentMsg: any = null;
        // @ts-ignore
        app._ipc = { send: (msg: any) => { sentMsg = msg; } };

        const { IpcMessage } = await import('../src/protocol.js');
        const req = IpcMessage.new('CommandRequest', {
            command: 'fail',
            params: {},
            session: makeSession(),
            instance_id: 'i1',
        });

        // @ts-ignore
        await app._handleCommand(req);
        assert.ok(sentMsg);
        assert.equal(sentMsg.payload.error, 'boom');
    });
});
