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

import * as fs from 'fs';
import * as path from 'path';

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar, ModuleInitContext } from '../module';

class KvStore {
    private _data: Record<string, any> = {};
    private _path: string | null = null;

    init(dataDir: string): void {
        this._path = path.join(dataDir, 'kv.json');
        if (fs.existsSync(this._path)) {
            try {
                const raw = fs.readFileSync(this._path, 'utf-8');
                this._data = JSON.parse(raw);
                console.error(
                    `[state] Loaded KV store from ${this._path} (${Object.keys(this._data).length} entries)`,
                );
            } catch (err) {
                console.error(`[state] Failed to load KV store: ${err}`);
            }
        }
    }

    get(key: string): any {
        return this._data[key] ?? null;
    }

    set(key: string, value: any): void {
        this._data[key] = value;
        this._persist();
    }

    delete(key: string): boolean {
        const existed = key in this._data;
        delete this._data[key];
        if (existed) this._persist();
        return existed;
    }

    listKeys(): string[] {
        return Object.keys(this._data);
    }

    getAll(): Record<string, any> {
        return { ...this._data };
    }

    private _persist(): void {
        if (!this._path) return;
        try {
            const dir = path.dirname(this._path);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf-8');
        } catch (err) {
            console.error(`[state] Failed to persist KV store: ${err}`);
        }
    }
}

export class StateModule implements ZroModule {
    readonly meta: ModuleMeta = {
        name: 'state',
        version: '0.1.0',
        description: 'Server-side key-value state management',
    };

    private _store = new KvStore();

    register(r: ModuleRegistrar): void {
        const store = this._store;

        r.onInit(async (ctx: ModuleInitContext) => {
            store.init(ctx.dataDir);
        });

        r.command('__kv:get', async (_ctx: AppContext, params: any) => {
            const key = params.key;
            if (typeof key !== 'string') throw new Error("Missing 'key' parameter");
            return { key, value: store.get(key) };
        });

        r.command('__kv:set', async (_ctx: AppContext, params: any) => {
            const key = params.key;
            if (typeof key !== 'string') throw new Error("Missing 'key' parameter");
            store.set(key, params.value ?? null);
            return { key, status: 'ok' };
        });

        r.command('__kv:delete', async (_ctx: AppContext, params: any) => {
            const key = params.key;
            if (typeof key !== 'string') throw new Error("Missing 'key' parameter");
            return { key, deleted: store.delete(key) };
        });

        r.command('__kv:list', async (_ctx: AppContext, _params: any) => {
            return { keys: store.listKeys() };
        });

        r.command('__kv:get_all', async (_ctx: AppContext, _params: any) => {
            return { entries: store.getAll() };
        });
    }
}
