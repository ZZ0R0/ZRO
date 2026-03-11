import type { SessionInfo } from './types';
import type { ZroApp } from './app';

/** Context passed to every command and event handler. */
export class AppContext {
    readonly session: SessionInfo;
    readonly instanceId: string | null;
    readonly slug: string;
    readonly dataDir: string;
    private _app: ZroApp;

    constructor(
        session: SessionInfo,
        instanceId: string | null,
        slug: string,
        dataDir: string,
        app: ZroApp,
    ) {
        this.session = session;
        this.instanceId = instanceId;
        this.slug = slug;
        this.dataDir = dataDir;
        this._app = app;
    }

    /** Emit an event to a specific instance. */
    emitTo(instanceId: string, event: string, data: any): void {
        this._app._emit({ type: 'instance', instance_id: instanceId }, event, data);
    }

    /** Broadcast an event to all instances. */
    emit(event: string, data: any): void {
        this._app._emit({ type: 'broadcast' }, event, data);
    }

    /** Access registered state by key. */
    state(key: string): any {
        return this._app._getState(key);
    }
}
