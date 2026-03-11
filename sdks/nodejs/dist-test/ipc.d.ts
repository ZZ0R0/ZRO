import { IpcMessage } from './protocol';
/**
 * IPC client using Unix domain sockets with 4-byte big-endian
 * length-prefixed JSON framing.
 */
export declare class IpcClient {
    private socket;
    private buffer;
    private pending;
    private closed;
    /** Connect to the runtime IPC socket. */
    connect(socketPath: string): Promise<void>;
    /** Send an IpcMessage over the socket. */
    send(msg: IpcMessage): void;
    /** Receive the next IpcMessage. Blocks until one arrives. */
    recv(): Promise<IpcMessage>;
    /** Close the connection. */
    close(): void;
    private onData;
    private tryExtract;
}
//# sourceMappingURL=ipc.d.ts.map