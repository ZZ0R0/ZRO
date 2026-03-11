import type { IpcMessageData } from './types';
/** IPC message envelope (matches Rust IpcMessage). */
export declare class IpcMessage {
    type: string;
    id: string;
    timestamp: string;
    payload: any;
    constructor(type: string, payload?: any, id?: string);
    /** Create a new message with auto-generated id. */
    static new(type: string, payload?: any): IpcMessage;
    /** Create a reply sharing the same id as the original. */
    static reply(originalId: string, type: string, payload?: any): IpcMessage;
    /** Serialize to JSON string. */
    toJSON(): string;
    /** Serialize to Buffer. */
    toBuffer(): Buffer;
    /** Deserialize from a raw object. */
    static fromData(data: IpcMessageData): IpcMessage;
    /** Deserialize from a Buffer. */
    static fromBuffer(buf: Buffer): IpcMessage;
}
//# sourceMappingURL=protocol.d.ts.map