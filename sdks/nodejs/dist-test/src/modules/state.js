"use strict";
/**
 * State module — server-side key-value state management.
 *
 * Provides commands for managing per-app persistent state via a
 * JSON-backed KV store on disk.
 *
 * @example
 * ```ts
 * import { StateModule } from '@zro/sdk';
 *
 * app.module(new StateModule());
 *
 * // From frontend:
 * // conn.invoke('__kv:get', { key: 'theme' })
 * // conn.invoke('__kv:set', { key: 'theme', value: 'dark' })
 * ```
 */
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
exports.StateModule = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class KvStore {
    _data = {};
    _path = null;
    init(dataDir) {
        this._path = path.join(dataDir, 'kv.json');
        if (fs.existsSync(this._path)) {
            try {
                const raw = fs.readFileSync(this._path, 'utf-8');
                this._data = JSON.parse(raw);
                console.error(`[state] Loaded KV store from ${this._path} (${Object.keys(this._data).length} entries)`);
            }
            catch (err) {
                console.error(`[state] Failed to load KV store: ${err}`);
            }
        }
    }
    get(key) {
        return this._data[key] ?? null;
    }
    set(key, value) {
        this._data[key] = value;
        this._persist();
    }
    delete(key) {
        const existed = key in this._data;
        delete this._data[key];
        if (existed)
            this._persist();
        return existed;
    }
    listKeys() {
        return Object.keys(this._data);
    }
    getAll() {
        return { ...this._data };
    }
    _persist() {
        if (!this._path)
            return;
        try {
            const dir = path.dirname(this._path);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
        }
        catch (err) {
            console.error(`[state] Failed to persist KV store: ${err}`);
        }
    }
}
class StateModule {
    meta = {
        name: 'state',
        version: '0.1.0',
        description: 'Server-side key-value state management',
    };
    _store = new KvStore();
    register(r) {
        const store = this._store;
        r.onInit(async (ctx) => {
            store.init(ctx.dataDir);
        });
        r.command('__kv:get', async (_ctx, params) => {
            const key = params.key;
            if (typeof key !== 'string')
                throw new Error("Missing 'key' parameter");
            return { key, value: store.get(key) };
        });
        r.command('__kv:set', async (_ctx, params) => {
            const key = params.key;
            if (typeof key !== 'string')
                throw new Error("Missing 'key' parameter");
            store.set(key, params.value ?? null);
            return { key, status: 'ok' };
        });
        r.command('__kv:delete', async (_ctx, params) => {
            const key = params.key;
            if (typeof key !== 'string')
                throw new Error("Missing 'key' parameter");
            return { key, deleted: store.delete(key) };
        });
        r.command('__kv:list', async (_ctx, _params) => {
            return { keys: store.listKeys() };
        });
        r.command('__kv:get_all', async (_ctx, _params) => {
            return { entries: store.getAll() };
        });
    }
}
exports.StateModule = StateModule;
