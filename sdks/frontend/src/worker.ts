/**
 * zro-shared-worker.ts — SharedWorker source that owns the multiplexed WebSocket.
 *
 * This is compiled separately from the main client bundle.
 * It manages:
 *   - Single WebSocket to /ws
 *   - Port registration/routing by instanceId
 *   - Multi-port support (same instanceId on multiple tabs)
 *   - Event replay buffer (200KB per instance)
 *   - Reconnection with exponential backoff
 */

// ── Logging ─────────────────────────────────────────────

const allPorts = new Set<MessagePort>();

function log(...args: unknown[]): void {
  const msg = '[ZRO-WORKER] ' + args.join(' ');
  console.log(msg);
  for (const port of allPorts) {
    try { port.postMessage({ type: 'log', msg }); } catch (_) { /* noop */ }
  }
}

// ── State ──────────────────────────────────────────────

let ws: WebSocket | null = null;
let wsState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

interface InstanceInfo {
  ports: Set<MessagePort>;
  slug: string;
  registered: boolean;
}

const instances = new Map<string, InstanceInfo>();

interface BufferEntry {
  msg: Record<string, unknown>;
  bytes: number;
}

interface EventBuffer {
  entries: BufferEntry[];
  totalBytes: number;
}

const eventBuffers = new Map<string, EventBuffer>();
const MAX_BUFFER_BYTES = 200 * 1024;

let reconnectAttempts = 0;
const RECONNECT_DELAY_BASE = 1000;
const RECONNECT_DELAY_MAX = 30000;

// ── Buffer management ──────────────────────────────────

function bufferEvent(instanceId: string, msg: Record<string, unknown>): void {
  let buf = eventBuffers.get(instanceId);
  if (!buf) {
    buf = { entries: [], totalBytes: 0 };
    eventBuffers.set(instanceId, buf);
  }

  const raw = JSON.stringify(msg);
  const bytes = raw.length;
  buf.entries.push({ msg, bytes });
  buf.totalBytes += bytes;

  while (buf.totalBytes > MAX_BUFFER_BYTES && buf.entries.length > 1) {
    const removed = buf.entries.shift()!;
    buf.totalBytes -= removed.bytes;
  }
}

function replayBuffer(instanceId: string, port: MessagePort): void {
  const buf = eventBuffers.get(instanceId);
  if (!buf || buf.entries.length === 0) return;

  log('REPLAY', instanceId, '—', buf.entries.length, 'events (' + buf.totalBytes, 'bytes)');
  for (const entry of buf.entries) {
    try {
      port.postMessage({ type: 'message', instanceId, payload: entry.msg });
    } catch (e) {
      log('REPLAY ERROR:', (e as Error).message);
      break;
    }
  }
}

// ── WebSocket management ───────────────────────────────

function getWsUrl(): string {
  const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${self.location.host}/ws`;
}

function broadcastState(state: string): void {
  for (const port of allPorts) {
    try { port.postMessage({ type: 'state', state }); } catch (_) { /* noop */ }
  }
}

function scheduleReconnect(): void {
  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1),
    RECONNECT_DELAY_MAX
  );
  setTimeout(connectWs, delay);
}

function connectWs(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const url = getWsUrl();
  log('connectWs() →', url);
  wsState = 'connecting';

  try {
    ws = new WebSocket(url);
  } catch (e) {
    wsState = 'disconnected';
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    wsState = 'connected';
    reconnectAttempts = 0;
    log('WS OPEN — re-registering', instances.size, 'instances');
    broadcastState('connected');

    for (const [instanceId, info] of instances) {
      info.registered = false;
      const regMsg = { type: 'register', instance: instanceId, app: info.slug };
      ws!.send(JSON.stringify(regMsg));
    }
  };

  ws.onclose = (ev: CloseEvent) => {
    log('WS CLOSE code=' + ev.code, 'reason=' + ev.reason);
    wsState = 'disconnected';
    for (const [, info] of instances) {
      info.registered = false;
    }
    broadcastState('disconnected');
    scheduleReconnect();
  };

  ws.onerror = () => {
    log('WS ERROR');
  };

  ws.onmessage = (e: MessageEvent) => {
    try {
      const msg = JSON.parse(e.data);
      routeMessage(msg);
    } catch (_) { /* malformed */ }
  };
}

// ── Message routing ────────────────────────────────────

function routeMessage(msg: Record<string, unknown>): void {
  // Registration confirmation
  if (msg.type === 'registered' && msg.instance) {
    const info = instances.get(msg.instance as string);
    if (info) {
      info.registered = true;
      for (const p of info.ports) {
        try {
          p.postMessage({
            type: 'registered',
            instanceId: msg.instance,
            reconnected: !!msg.reconnected,
          });
        } catch (_) { /* noop */ }
      }
    }
    return;
  }

  // Messages with instance — route to subscribed ports
  if (msg.instance) {
    if (msg.type === 'event') {
      bufferEvent(msg.instance as string, msg);
    }

    const info = instances.get(msg.instance as string);
    if (info) {
      for (const p of info.ports) {
        try {
          p.postMessage({ type: 'message', instanceId: msg.instance, payload: msg });
        } catch (_) { /* noop */ }
      }
    }
    return;
  }

  // Messages without instance — broadcast
  for (const port of allPorts) {
    try {
      port.postMessage({ type: 'message', instanceId: null, payload: msg });
    } catch (_) { /* noop */ }
  }
}

// ── Port management ────────────────────────────────────

function handlePortMessage(port: MessagePort, data: Record<string, unknown>): void {
  switch (data.type) {
    case 'register': {
      const instanceId = data.instanceId as string;
      const slug = data.slug as string;
      if (!instanceId || !slug) return;

      let info = instances.get(instanceId);
      if (info) {
        info.ports.add(port);
      } else {
        info = { ports: new Set([port]), slug, registered: false };
        instances.set(instanceId, info);
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        if (info.registered) {
          try {
            port.postMessage({
              type: 'registered',
              instanceId,
              reconnected: true,
            });
          } catch (_) { /* noop */ }
          replayBuffer(instanceId, port);
        } else {
          ws.send(JSON.stringify({ type: 'register', instance: instanceId, app: slug }));
        }
      }
      break;
    }

    case 'unregister': {
      const instanceId = data.instanceId as string;
      if (!instanceId) return;

      const info = instances.get(instanceId);
      if (info) {
        info.ports.delete(port);
        if (info.ports.size === 0) {
          instances.delete(instanceId);
          eventBuffers.delete(instanceId);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'unregister', instance: instanceId }));
          }
        }
      }
      break;
    }

    case 'send': {
      if (ws && ws.readyState === WebSocket.OPEN && data.payload) {
        const payloadStr = typeof data.payload === 'string'
          ? data.payload
          : JSON.stringify(data.payload);
        ws.send(payloadStr);
      }
      break;
    }
  }
}

// ── SharedWorker entry point ───────────────────────────

// TypeScript: SharedWorkerGlobalScope
const _self = globalThis as unknown as SharedWorkerGlobalScope;

_self.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  allPorts.add(port);
  log('NEW PORT (total:', allPorts.size, ')');

  port.onmessage = (ev: MessageEvent) => {
    handlePortMessage(port, ev.data);
  };

  port.postMessage({ type: 'state', state: wsState });

  if (wsState === 'disconnected') {
    connectWs();
  }
};

log('SharedWorker loaded');
connectWs();
