import type { SessionInfo, UserProfile } from './types';
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

    /** Broadcast an event to all instances of this app. */
    emit(event: string, data: any): void {
        this._app._emit({ type: 'broadcast' }, event, data);
    }

    /** Emit an event to all apps within the current user session. */
    emitToSession(event: string, data: any): void {
        this._app._emit({ type: 'session', session_id: this.session.session_id }, event, data);
    }

    /** Emit a system-wide event to every connected client. */
    emitSystem(event: string, data: any): void {
        this._app._emit({ type: 'system' }, event, data);
    }

    /** Get the user profile (if available). */
    get profile(): UserProfile | undefined {
        return this.session.profile;
    }

    /** Get the current username. */
    get username(): string {
        return this.session.username;
    }

    /** Get the current user's role. */
    get role(): string {
        return this.session.role;
    }

    /** Get the current user's groups. */
    get groups(): string[] {
        return this.session.groups;
    }

    /** Access registered state by key. */
    state(key: string): any {
        return this._app._getState(key);
    }
}
