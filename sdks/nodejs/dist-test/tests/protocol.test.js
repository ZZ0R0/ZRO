"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
// We import the compiled JS files — for tests we'll work with the TS sources
// compiled via tsc. For now, test the logic directly by importing source.
// Since we use ts-node or tsx, we can import .ts files.
const protocol_js_1 = require("../src/protocol.js");
(0, node_test_1.describe)('IpcMessage', () => {
    (0, node_test_1.it)('creates message with auto id', () => {
        const msg = protocol_js_1.IpcMessage.new('Hello', { app_id: 'test' });
        strict_1.default.equal(msg.type, 'Hello');
        strict_1.default.deepEqual(msg.payload, { app_id: 'test' });
        strict_1.default.ok(msg.id.length > 0);
        strict_1.default.ok(msg.timestamp.length > 0);
    });
    (0, node_test_1.it)('creates reply with same id', () => {
        const original = protocol_js_1.IpcMessage.new('CommandRequest', {});
        const reply = protocol_js_1.IpcMessage.reply(original.id, 'CommandResponse', { result: 42 });
        strict_1.default.equal(reply.id, original.id);
        strict_1.default.equal(reply.type, 'CommandResponse');
        strict_1.default.deepEqual(reply.payload, { result: 42 });
    });
    (0, node_test_1.it)('serializes to JSON', () => {
        const msg = protocol_js_1.IpcMessage.new('Hello', { key: 'value' });
        const json = msg.toJSON();
        const parsed = JSON.parse(json);
        strict_1.default.equal(parsed.type, 'Hello');
        strict_1.default.equal(parsed.payload.key, 'value');
        strict_1.default.equal(parsed.id, msg.id);
    });
    (0, node_test_1.it)('serializes/deserializes to Buffer', () => {
        const msg = protocol_js_1.IpcMessage.new('Test', { n: 123 });
        const buf = msg.toBuffer();
        const restored = protocol_js_1.IpcMessage.fromBuffer(buf);
        strict_1.default.equal(restored.type, 'Test');
        strict_1.default.equal(restored.payload.n, 123);
        strict_1.default.equal(restored.id, msg.id);
    });
    (0, node_test_1.it)('fromData reconstructs message', () => {
        const data = {
            type: 'CommandRequest',
            id: 'abc-123',
            timestamp: '2024-01-01T00:00:00Z',
            payload: { command: 'greet' },
        };
        const msg = protocol_js_1.IpcMessage.fromData(data);
        strict_1.default.equal(msg.type, 'CommandRequest');
        strict_1.default.equal(msg.id, 'abc-123');
        strict_1.default.equal(msg.timestamp, '2024-01-01T00:00:00Z');
        strict_1.default.deepEqual(msg.payload, { command: 'greet' });
    });
    (0, node_test_1.it)('default payload is empty object', () => {
        const msg = protocol_js_1.IpcMessage.new('Ping');
        strict_1.default.deepEqual(msg.payload, {});
    });
});
(0, node_test_1.describe)('IpcMessage framing', () => {
    (0, node_test_1.it)('toBuffer produces valid UTF-8 JSON', () => {
        const msg = protocol_js_1.IpcMessage.new('Hello', { emoji: '🎉' });
        const buf = msg.toBuffer();
        const str = buf.toString('utf-8');
        const parsed = JSON.parse(str);
        strict_1.default.equal(parsed.payload.emoji, '🎉');
    });
});
