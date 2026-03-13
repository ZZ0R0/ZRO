/**
 * Files module — sandboxed filesystem operations within the app's data directory.
 *
 * @example
 * ```ts
 * import { FilesModule } from '@zro/sdk';
 *
 * app.module(new FilesModule());
 *
 * // From frontend:
 * // conn.invoke('__fs:read', { path: 'notes/hello.md' })
 * // conn.invoke('__fs:write', { path: 'notes/hello.md', content: '# Hello' })
 * // conn.invoke('__fs:list', { path: 'notes' })
 * // conn.invoke('__fs:delete', { path: 'notes/hello.md' })
 * ```
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import type { AppContext } from '../context';
import type { ZroModule, ModuleMeta, ModuleRegistrar, ModuleInitContext } from '../module';

export class FilesModule implements ZroModule {
    private _dataDir = '';

    meta(): ModuleMeta {
        return {
            name: 'files',
            version: '0.1.0',
            description: 'Sandboxed filesystem operations',
            dependencies: [],
        };
    }

    register(reg: ModuleRegistrar): void {
        reg.onInit(async (initCtx: ModuleInitContext) => {
            this._dataDir = initCtx.dataDir;
        });

        reg.command('__fs:read', async (ctx: AppContext, params: any) => {
            const full = this._safePath(params.path);
            const stat = await fsp.stat(full);
            if (!stat.isFile()) throw new Error(`not a file: ${params.path}`);
            const content = await fsp.readFile(full, 'utf-8');
            return { content };
        });

        reg.command('__fs:write', async (ctx: AppContext, params: any) => {
            const full = this._safePath(params.path);
            await fsp.mkdir(path.dirname(full), { recursive: true });
            const content = params.content ?? '';
            await fsp.writeFile(full, content, 'utf-8');
            return { ok: true, bytes: Buffer.byteLength(content) };
        });

        reg.command('__fs:list', async (ctx: AppContext, params: any) => {
            const rel = params.path || '.';
            const full = this._safePath(rel);
            const dirents = await fsp.readdir(full, { withFileTypes: true });
            const entries = await Promise.all(
                dirents.map(async (d) => {
                    const st = await fsp.stat(path.join(full, d.name)).catch(() => null);
                    return {
                        name: d.name,
                        is_dir: d.isDirectory(),
                        is_file: d.isFile(),
                        size: st?.size ?? 0,
                    };
                }),
            );
            return { entries };
        });

        reg.command('__fs:delete', async (ctx: AppContext, params: any) => {
            const full = this._safePath(params.path);
            const stat = await fsp.stat(full);
            if (stat.isDirectory()) {
                await fsp.rm(full, { recursive: true });
            } else {
                await fsp.unlink(full);
            }
            return { ok: true };
        });

        reg.command('__fs:mkdir', async (ctx: AppContext, params: any) => {
            const full = this._safePath(params.path);
            await fsp.mkdir(full, { recursive: true });
            return { ok: true };
        });

        reg.command('__fs:stat', async (ctx: AppContext, params: any) => {
            const full = this._safePath(params.path);
            const stat = await fsp.stat(full);
            return {
                path: params.path,
                is_dir: stat.isDirectory(),
                is_file: stat.isFile(),
                size: stat.size,
            };
        });
    }

    private _safePath(relative: string): string {
        if (!relative) throw new Error('path is required');
        const cleaned = relative.replace(/^\/+/, '');
        if (cleaned.includes('..')) throw new Error('path traversal not allowed');
        const full = path.resolve(this._dataDir, cleaned);
        const base = path.resolve(this._dataDir);
        if (!full.startsWith(base + path.sep) && full !== base) {
            throw new Error('path outside data directory');
        }
        return full;
    }
}
