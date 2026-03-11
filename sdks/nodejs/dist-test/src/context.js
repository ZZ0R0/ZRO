"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppContext = void 0;
/** Context passed to every command and event handler. */
class AppContext {
    session;
    instanceId;
    slug;
    dataDir;
    _app;
    constructor(session, instanceId, slug, dataDir, app) {
        this.session = session;
        this.instanceId = instanceId;
        this.slug = slug;
        this.dataDir = dataDir;
        this._app = app;
    }
    /** Emit an event to a specific instance. */
    emitTo(instanceId, event, data) {
        this._app._emit({ type: 'instance', instance_id: instanceId }, event, data);
    }
    /** Broadcast an event to all instances. */
    emit(event, data) {
        this._app._emit({ type: 'broadcast' }, event, data);
    }
    /** Access registered state by key. */
    state(key) {
        return this._app._getState(key);
    }
}
exports.AppContext = AppContext;
