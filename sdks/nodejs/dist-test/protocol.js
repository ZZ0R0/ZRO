"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcMessage = void 0;
const crypto_1 = require("crypto");
/** IPC message envelope (matches Rust IpcMessage). */
class IpcMessage {
    type;
    id;
    timestamp;
    payload;
    constructor(type, payload = {}, id) {
        this.type = type;
        this.id = id ?? (0, crypto_1.randomUUID)();
        this.timestamp = new Date().toISOString();
        this.payload = payload;
    }
    /** Create a new message with auto-generated id. */
    static new(type, payload = {}) {
        return new IpcMessage(type, payload);
    }
    /** Create a reply sharing the same id as the original. */
    static reply(originalId, type, payload = {}) {
        return new IpcMessage(type, payload, originalId);
    }
    /** Serialize to JSON string. */
    toJSON() {
        return JSON.stringify({
            type: this.type,
            id: this.id,
            timestamp: this.timestamp,
            payload: this.payload,
        });
    }
    /** Serialize to Buffer. */
    toBuffer() {
        return Buffer.from(this.toJSON(), 'utf-8');
    }
    /** Deserialize from a raw object. */
    static fromData(data) {
        const msg = new IpcMessage(data.type, data.payload, data.id);
        msg.timestamp = data.timestamp;
        return msg;
    }
    /** Deserialize from a Buffer. */
    static fromBuffer(buf) {
        const data = JSON.parse(buf.toString('utf-8'));
        return IpcMessage.fromData(data);
    }
}
exports.IpcMessage = IpcMessage;
//# sourceMappingURL=protocol.js.map