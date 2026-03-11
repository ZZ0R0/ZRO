import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We import the compiled JS files — for tests we'll work with the TS sources
// compiled via tsc. For now, test the logic directly by importing source.
// Since we use ts-node or tsx, we can import .ts files.

import { IpcMessage } from '../src/protocol.js';

describe('IpcMessage', () => {
    it('creates message with auto id', () => {
        const msg = IpcMessage.new('Hello', { app_id: 'test' });
        assert.equal(msg.type, 'Hello');
        assert.deepEqual(msg.payload, { app_id: 'test' });
        assert.ok(msg.id.length > 0);
        assert.ok(msg.timestamp.length > 0);
    });

    it('creates reply with same id', () => {
        const original = IpcMessage.new('CommandRequest', {});
        const reply = IpcMessage.reply(original.id, 'CommandResponse', { result: 42 });
        assert.equal(reply.id, original.id);
        assert.equal(reply.type, 'CommandResponse');
        assert.deepEqual(reply.payload, { result: 42 });
    });

    it('serializes to JSON', () => {
        const msg = IpcMessage.new('Hello', { key: 'value' });
        const json = msg.toJSON();
        const parsed = JSON.parse(json);
        assert.equal(parsed.type, 'Hello');
        assert.equal(parsed.payload.key, 'value');
        assert.equal(parsed.id, msg.id);
    });

    it('serializes/deserializes to Buffer', () => {
        const msg = IpcMessage.new('Test', { n: 123 });
        const buf = msg.toBuffer();
        const restored = IpcMessage.fromBuffer(buf);
        assert.equal(restored.type, 'Test');
        assert.equal(restored.payload.n, 123);
        assert.equal(restored.id, msg.id);
    });

    it('fromData reconstructs message', () => {
        const data = {
            type: 'CommandRequest',
            id: 'abc-123',
            timestamp: '2024-01-01T00:00:00Z',
            payload: { command: 'greet' },
        };
        const msg = IpcMessage.fromData(data);
        assert.equal(msg.type, 'CommandRequest');
        assert.equal(msg.id, 'abc-123');
        assert.equal(msg.timestamp, '2024-01-01T00:00:00Z');
        assert.deepEqual(msg.payload, { command: 'greet' });
    });

    it('default payload is empty object', () => {
        const msg = IpcMessage.new('Ping');
        assert.deepEqual(msg.payload, {});
    });
});

describe('IpcMessage framing', () => {
    it('toBuffer produces valid UTF-8 JSON', () => {
        const msg = IpcMessage.new('Hello', { emoji: '🎉' });
        const buf = msg.toBuffer();
        const str = buf.toString('utf-8');
        const parsed = JSON.parse(str);
        assert.equal(parsed.payload.emoji, '🎉');
    });
});
