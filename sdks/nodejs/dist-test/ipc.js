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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcClient = void 0;
const net = __importStar(require("net"));
const protocol_1 = require("./protocol");
/**
 * IPC client using Unix domain sockets with 4-byte big-endian
 * length-prefixed JSON framing.
 */
class IpcClient {
    socket = null;
    buffer = Buffer.alloc(0);
    pending = [];
    closed = false;
    /** Connect to the runtime IPC socket. */
    connect(socketPath) {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(socketPath, () => resolve());
            this.socket.on('error', reject);
            this.socket.on('data', (chunk) => this.onData(chunk));
            this.socket.on('close', () => {
                this.closed = true;
                // Reject any pending reads
                for (const cb of this.pending) {
                    // will never resolve — caller should handle close
                }
                this.pending = [];
            });
        });
    }
    /** Send an IpcMessage over the socket. */
    send(msg) {
        if (!this.socket || this.closed)
            throw new Error('Not connected');
        const body = msg.toBuffer();
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length, 0);
        this.socket.write(Buffer.concat([header, body]));
    }
    /** Receive the next IpcMessage. Blocks until one arrives. */
    recv() {
        // Try to extract a message from the existing buffer first
        const extracted = this.tryExtract();
        if (extracted)
            return Promise.resolve(extracted);
        if (this.closed)
            return Promise.reject(new Error('Connection closed'));
        return new Promise((resolve) => {
            this.pending.push(resolve);
        });
    }
    /** Close the connection. */
    close() {
        this.closed = true;
        this.socket?.destroy();
        this.socket = null;
    }
    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        // Drain as many complete messages as possible
        while (true) {
            const msg = this.tryExtract();
            if (!msg)
                break;
            if (this.pending.length > 0) {
                const resolve = this.pending.shift();
                resolve(msg);
            }
            // If no pending reader, message is dropped (shouldn't happen in normal flow)
        }
    }
    tryExtract() {
        if (this.buffer.length < 4)
            return null;
        const len = this.buffer.readUInt32BE(0);
        if (this.buffer.length < 4 + len)
            return null;
        const body = this.buffer.subarray(4, 4 + len);
        this.buffer = this.buffer.subarray(4 + len);
        return protocol_1.IpcMessage.fromBuffer(body);
    }
}
exports.IpcClient = IpcClient;
//# sourceMappingURL=ipc.js.map