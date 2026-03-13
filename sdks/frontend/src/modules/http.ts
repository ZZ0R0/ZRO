/**
 * @zro/http — HTTP client module.
 *
 * Pre-configured HTTP client for REST API calls to app backends.
 * Handles URL construction, JSON parsing, and error formatting.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
  HttpAPI,
} from '../core/types.js';

function _parseUrlPath(): { slug: string | null; instanceId: string | null } {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const slug = parts[0] || null;
  const second = parts[1] || null;
  const instanceId = (second && second !== 'static' && second !== 'api') ? second : null;
  return { slug, instanceId };
}

async function _fetchJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body && method.toUpperCase() !== 'GET') {
    opts.body = JSON.stringify(body);
  }

  const resp = await fetch(url, opts);

  if (!resp.ok) {
    const text = await resp.text();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { parsed = { error: text }; }
    const err = new Error((parsed.error as string) || `HTTP ${resp.status}`) as Error & { status: number; data: unknown };
    err.status = resp.status;
    err.data = parsed;
    throw err;
  }

  const text = await resp.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export const httpModule: ZroModuleFactory = () => {
  let _slug: string;

  const mod: ZroModule = {
    meta: {
      name: 'http',
      version: '0.1.0',
      description: 'HTTP client for REST API calls',
      category: 'data',
      dependencies: [],
    },

    init(ctx: ZroModuleContext): HttpAPI {
      _slug = ctx.config.slug;

      function _buildUrl(path: string, query?: Record<string, string>): string {
        const urlInfo = _parseUrlPath();
        const prefix = (urlInfo.slug === _slug && urlInfo.instanceId)
          ? `/${_slug}/${urlInfo.instanceId}`
          : `/${_slug}`;
        let url = `${prefix}/api${path}`;
        if (query) {
          const params = new URLSearchParams(query);
          url += `?${params.toString()}`;
        }
        return url;
      }

      return {
        get: <T = unknown>(path: string, query?: Record<string, string>) =>
          _fetchJson<T>(_buildUrl(path, query), 'GET'),
        post: <T = unknown>(path: string, body?: unknown) =>
          _fetchJson<T>(_buildUrl(path), 'POST', body),
        put: <T = unknown>(path: string, body?: unknown) =>
          _fetchJson<T>(_buildUrl(path), 'PUT', body),
        delete: <T = unknown>(path: string) =>
          _fetchJson<T>(_buildUrl(path), 'DELETE'),
      };
    },
  };

  return mod;
};
