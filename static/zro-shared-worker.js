/**
 * zro-shared-worker.js — SharedWorker that owns the multiplexed WebSocket.
 *
 * Architecture:
 *   One WebSocket connection to /ws, shared across ALL tabs/iframes.
 *   Multiple ports can subscribe to the same instanceId (e.g. shell iframe
 *   AND a popped-out browser tab both showing terminal-1).
 *   Messages are routed by instanceId to ALL subscribed ports.
 *
 * Port ↔ Worker protocol:
 *   Port → Worker:
 *     { type: 'register',   instanceId, slug }
 *     { type: 'unregister', instanceId }
 *     { type: 'send',       instanceId, payload }   // payload = raw WS JSON msg
 *
 *   Worker → Port:
 *     { type: 'registered', instanceId, reconnected }
 *     { type: 'message',    instanceId, payload }    // payload = parsed WS JSON msg
 *     { type: 'state',      state }                  // 'connected' | 'disconnected'
 */
'use strict';

// ── Logging ─────────────────────────────────────────────

function log(...args) {
    const msg = '[ZRO-WORKER] ' + args.join(' ');
    console.log(msg);
    for (const port of allPorts) {
        try { port.postMessage({ type: 'log', msg }); } catch (_) {}
    }
}

// ── State ──────────────────────────────────────────────

/** @type {WebSocket|null} */
let ws = null;

/** Connection state: 'connecting' | 'connected' | 'disconnected' */
let wsState = 'disconnected';

/** All connected ports.  @type {Set<MessagePort>} */
const allPorts = new Set();

/**
 * Map of instanceId → { ports, slug, registered }.
 * Multiple ports can subscribe to the same instanceId simultaneously.
 * @type {Map<string, { ports: Set<MessagePort>, slug: string, registered: boolean }>}
 */
const instances = new Map();

/**
 * Replay buffer per instanceId.
 * Captures event messages so they can be replayed when a new port takes over
 * (e.g. pop-out from iframe to browser tab).
 * @type {Map<string, { entries: Array<{msg: object, bytes: number}>, totalBytes: number }>}
 */
const eventBuffers = new Map();
const MAX_BUFFER_BYTES = 200 * 1024; // 200KB per instance

function bufferEvent(instanceId, msg) {
    let buf = eventBuffers.get(instanceId);
    if (!buf) {
        buf = { entries: [], totalBytes: 0 };
        eventBuffers.set(instanceId, buf);
    }

    const raw = JSON.stringify(msg);
    const bytes = raw.length;

    buf.entries.push({ msg, bytes });
    buf.totalBytes += bytes;

    // Trim oldest entries if over limit
    while (buf.totalBytes > MAX_BUFFER_BYTES && buf.entries.length > 1) {
        const removed = buf.entries.shift();
        buf.totalBytes -= removed.bytes;
    }
}

function replayBuffer(instanceId, port) {
    const buf = eventBuffers.get(instanceId);
    if (!buf || buf.entries.length === 0) {
        log('REPLAY', instanceId, '— no buffered events');
        return;
    }

    log('REPLAY', instanceId, '—', buf.entries.length, 'events (' + buf.totalBytes, 'bytes)');
    for (const entry of buf.entries) {
        try {
            port.postMessage({
                type: 'message',
                instanceId,
                payload: entry.msg,
            });
        } catch (e) {
            log('REPLAY POST ERROR:', e.message);
            break;
        }
    }
}

/** Reconnect state */
let reconnectAttempts = 0;
const RECONNECT_DELAY_BASE = 1000;
const RECONNECT_DELAY_MAX = 30000;

// ── WebSocket management ───────────────────────────────

function getWsUrl() {
    // SharedWorker doesn't have location.protocol, derive from self.location
    const proto = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${self.location.host}/ws`;
}

function connectWs() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        log('connectWs() skipped — already', ws.readyState === WebSocket.CONNECTING ? 'CONNECTING' : 'OPEN');
        return;
    }

    const url = getWsUrl();
    log('connectWs() → connecting to', url);
    wsState = 'connecting';

    try {
        ws = new WebSocket(url);
    } catch (e) {
        log('connectWs() ERROR:', e.message);
        wsState = 'disconnected';
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        wsState = 'connected';
        reconnectAttempts = 0;
        log('WS OPEN — re-registering', instances.size, 'instances:', [...instances.keys()].join(', '));
        broadcastState('connected');

        // Re-register all known instances
        for (const [instanceId, info] of instances) {
            info.registered = false;
            const regMsg = { type: 'register', instance: instanceId, app: info.slug };
            log('WS SEND register:', JSON.stringify(regMsg));
            ws.send(JSON.stringify(regMsg));
        }
    };

    ws.onclose = (ev) => {
        log('WS CLOSE code=' + ev.code, 'reason=' + ev.reason);
        wsState = 'disconnected';
        for (const [, info] of instances) {
            info.registered = false;
        }
        broadcastState('disconnected');
        scheduleReconnect();
    };

    ws.onerror = (ev) => {
        log('WS ERROR:', ev.type);
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            log('WS RECV type=' + msg.type, 'instance=' + (msg.instance || 'none'), msg.event ? 'event=' + msg.event : '');
            routeMessage(msg);
        } catch (err) {
            log('WS RECV malformed:', e.data.substring(0, 100));
        }
    };
}

function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(
        RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1),
        RECONNECT_DELAY_MAX
    );
    setTimeout(connectWs, delay);
}

function broadcastState(state) {
    for (const port of allPorts) {
        try { port.postMessage({ type: 'state', state }); } catch (_) {}
    }
}

// ── Message routing ────────────────────────────────────

function routeMessage(msg) {
    // Registration confirmation — route to all ports for this instance
    if (msg.type === 'registered' && msg.instance) {
        const info = instances.get(msg.instance);
        if (info) {
            info.registered = true;
            for (const p of info.ports) {
                try {
                    p.postMessage({
                        type: 'registered',
                        instanceId: msg.instance,
                        reconnected: !!msg.reconnected,
                    });
                } catch (_) {}
            }
        }
        return;
    }

    // Messages with an instance field — route to all ports for that instance
    if (msg.instance) {
        if (msg.type === 'event') {
            bufferEvent(msg.instance, msg);
        }

        const info = instances.get(msg.instance);
        if (info) {
            for (const p of info.ports) {
                try {
                    p.postMessage({
                        type: 'message',
                        instanceId: msg.instance,
                        payload: msg,
                    });
                } catch (_) {}
            }
        }
        return;
    }

    // Messages without instance — broadcast to all ports
    for (const port of allPorts) {
        try {
            port.postMessage({ type: 'message', instanceId: null, payload: msg });
        } catch (_) {}
    }
}

// ── Port management ────────────────────────────────────

function handlePortMessage(port, data) {
    switch (data.type) {
        case 'register': {
            const { instanceId, slug } = data;
            if (!instanceId || !slug) return;

            let info = instances.get(instanceId);
            if (info) {
                // Add this port to the set (may already be there — idempotent)
                info.ports.add(port);
            } else {
                info = { ports: new Set([port]), slug, registered: false };
                instances.set(instanceId, info);
            }

            // If WS is connected, register on server or send local confirmation
            if (ws && ws.readyState === WebSocket.OPEN) {
                if (info.registered) {
                    // Already registered on server — confirm locally + replay buffer
                    try {
                        port.postMessage({
                            type: 'registered',
                            instanceId,
                            reconnected: true,
                        });
                    } catch (_) {}
                    replayBuffer(instanceId, port);
                } else {
                    const regMsg = { type: 'register', instance: instanceId, app: slug };
                    ws.send(JSON.stringify(regMsg));
                }
            }
            break;
        }

        case 'unregister': {
            const { instanceId } = data;
            if (!instanceId) return;

            const info = instances.get(instanceId);
            if (info) {
                info.ports.delete(port);
                // Only unregister from server if no ports remain
                if (info.ports.size === 0) {
                    instances.delete(instanceId);
                    eventBuffers.delete(instanceId);
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'unregister',
                            instance: instanceId,
                        }));
                    }
                }
            }
            break;
        }

        case 'send': {
            if (ws && ws.readyState === WebSocket.OPEN && data.payload) {
                const payloadStr = typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload);
                ws.send(payloadStr);
            }
            break;
        }
    }
}

// ── SharedWorker entry point ───────────────────────────

self.onconnect = (e) => {
    const port = e.ports[0];
    allPorts.add(port);
    log('NEW PORT connected (total ports:', allPorts.size, ')');

    port.onmessage = (ev) => {
        handlePortMessage(port, ev.data);
    };

    // Notify the new port of the current WS state
    port.postMessage({ type: 'state', state: wsState });

    // Ensure WS is connected
    if (wsState === 'disconnected') {
        connectWs();
    }
};

log('SharedWorker loaded, starting initial WS connection');
connectWs();
