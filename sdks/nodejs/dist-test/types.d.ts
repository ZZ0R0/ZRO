/** Session information attached to IPC commands. */
export interface SessionInfo {
    session_id: string;
    user_id: string;
    username: string;
    role: string;
    groups: string[];
}
/** IPC message envelope. */
export interface IpcMessageData {
    type: string;
    id: string;
    timestamp: string;
    payload: any;
}
/** Event target types. */
export type EventTarget = {
    type: 'instance';
    instance_id: string;
} | {
    type: 'broadcast';
};
/** Command handler function type. */
export type CommandHandler<T = any> = (ctx: AppContext, params: T) => Promise<any>;
/** Lifecycle event handler. */
export type LifecycleHandler = (ctx: AppContext, data?: any) => Promise<void>;
/** WS event handler (fire-and-forget, from client conn.emit()). */
export type WsEventHandler = (ctx: AppContext, data: any) => Promise<void>;
import { AppContext } from './context';
export { AppContext };
//# sourceMappingURL=types.d.ts.map