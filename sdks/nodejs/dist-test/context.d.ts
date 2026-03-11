import type { SessionInfo } from './types';
import type { ZroApp } from './app';
/** Context passed to every command and event handler. */
export declare class AppContext {
    readonly session: SessionInfo;
    readonly instanceId: string | null;
    readonly slug: string;
    readonly dataDir: string;
    private _app;
    constructor(session: SessionInfo, instanceId: string | null, slug: string, dataDir: string, app: ZroApp);
    /** Emit an event to a specific instance. */
    emitTo(instanceId: string, event: string, data: any): void;
    /** Broadcast an event to all instances. */
    emitBroadcast(event: string, data: any): void;
    /** Access registered state by key. */
    state(key: string): any;
}
//# sourceMappingURL=context.d.ts.map