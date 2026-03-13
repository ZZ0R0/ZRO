import * as net from 'net';
import { IpcMessage } from './protocol';

/**
 * IPC client using Unix domain sockets with 4-byte big-endian
 * length-prefixed JSON framing.
 */
export class IpcClient {
    private socket: net.Socket | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private pending: Array<(msg: IpcMessage) => void> = [];
    private closed = false;

    private _rejectPending: Array<(reason: Error) => void> = [];

    /** Connect to the runtime IPC socket. */
    connect(socketPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(socketPath, () => resolve());
            this.socket.on('error', reject);
            this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
            this.socket.on('close', () => {
                this.closed = true;
                const err = new Error('Connection closed');
                for (const rej of this._rejectPending) {
                    rej(err);
                }
                this._rejectPending = [];
                this.pending = [];
            });
        });
    }

    /** Send an IpcMessage over the socket. */
    send(msg: IpcMessage): void {
        if (!this.socket || this.closed) throw new Error('Not connected');
        const body = msg.toBuffer();
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length, 0);
        this.socket.write(Buffer.concat([header, body]));
    }

    /** Receive the next IpcMessage. Blocks until one arrives. */
    recv(): Promise<IpcMessage> {
        // Try to extract a message from the existing buffer first
        const extracted = this.tryExtract();
        if (extracted) return Promise.resolve(extracted);

        if (this.closed) return Promise.reject(new Error('Connection closed'));

        return new Promise((resolve, reject) => {
            this.pending.push(resolve);
            this._rejectPending.push(reject);
        });
    }

    /** Close the connection. */
    close(): void {
        this.closed = true;
        this.socket?.destroy();
        this.socket = null;
    }

    private onData(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        // Drain as many complete messages as possible
        while (true) {
            const msg = this.tryExtract();
            if (!msg) break;
            if (this.pending.length > 0) {
                this.pending.shift()!(msg);
                this._rejectPending.shift();
            }
            // If no pending reader, message is dropped (shouldn't happen in normal flow)
        }
    }

    private tryExtract(): IpcMessage | null {
        if (this.buffer.length < 4) return null;
        const len = this.buffer.readUInt32BE(0);
        if (this.buffer.length < 4 + len) return null;
        const body = this.buffer.subarray(4, 4 + len);
        this.buffer = this.buffer.subarray(4 + len);
        return IpcMessage.fromBuffer(body);
    }
}
