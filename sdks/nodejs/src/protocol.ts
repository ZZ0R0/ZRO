import { randomUUID } from 'crypto';
import type { IpcMessageData } from './types';

/** IPC message envelope (matches Rust IpcMessage). */
export class IpcMessage {
    type: string;
    id: string;
    timestamp: string;
    payload: any;

    constructor(type: string, payload: any = {}, id?: string) {
        this.type = type;
        this.id = id ?? randomUUID();
        this.timestamp = new Date().toISOString();
        this.payload = payload;
    }

    /** Create a new message with auto-generated id. */
    static new(type: string, payload: any = {}): IpcMessage {
        return new IpcMessage(type, payload);
    }

    /** Create a reply sharing the same id as the original. */
    static reply(originalId: string, type: string, payload: any = {}): IpcMessage {
        return new IpcMessage(type, payload, originalId);
    }

    /** Serialize to JSON string. */
    toJSON(): string {
        return JSON.stringify({
            type: this.type,
            id: this.id,
            timestamp: this.timestamp,
            payload: this.payload,
        });
    }

    /** Serialize to Buffer. */
    toBuffer(): Buffer {
        return Buffer.from(this.toJSON(), 'utf-8');
    }

    /** Deserialize from a raw object. */
    static fromData(data: IpcMessageData): IpcMessage {
        const msg = new IpcMessage(data.type, data.payload, data.id);
        msg.timestamp = data.timestamp;
        return msg;
    }

    /** Deserialize from a Buffer. */
    static fromBuffer(buf: Buffer): IpcMessage {
        const data = JSON.parse(buf.toString('utf-8')) as IpcMessageData;
        return IpcMessage.fromData(data);
    }
}
