/**
 * zro-shared-worker.js — ZRO SharedWorker v0.1.0
 * Built: 2026-03-13T05:09:16.286Z
 */
"use strict";
(() => {
  // src/worker.ts
  var allPorts = /* @__PURE__ */ new Set();
  function log(...args) {
    const msg = "[ZRO-WORKER] " + args.join(" ");
    console.log(msg);
    for (const port of allPorts) {
      try {
        port.postMessage({ type: "log", msg });
      } catch (_) {
      }
    }
  }
  var ws = null;
  var wsState = "disconnected";
  var instances = /* @__PURE__ */ new Map();
  var eventBuffers = /* @__PURE__ */ new Map();
  var MAX_BUFFER_BYTES = 200 * 1024;
  var reconnectAttempts = 0;
  var RECONNECT_DELAY_BASE = 1e3;
  var RECONNECT_DELAY_MAX = 3e4;
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
    while (buf.totalBytes > MAX_BUFFER_BYTES && buf.entries.length > 1) {
      const removed = buf.entries.shift();
      buf.totalBytes -= removed.bytes;
    }
  }
  function replayBuffer(instanceId, port) {
    const buf = eventBuffers.get(instanceId);
    if (!buf || buf.entries.length === 0) return;
    log("REPLAY", instanceId, "\u2014", buf.entries.length, "events (" + buf.totalBytes, "bytes)");
    for (const entry of buf.entries) {
      try {
        port.postMessage({ type: "message", instanceId, payload: entry.msg });
      } catch (e) {
        log("REPLAY ERROR:", e.message);
        break;
      }
    }
  }
  function getWsUrl() {
    const proto = self.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${self.location.host}/ws`;
  }
  function broadcastState(state) {
    for (const port of allPorts) {
      try {
        port.postMessage({ type: "state", state });
      } catch (_) {
      }
    }
  }
  function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttempts - 1),
      RECONNECT_DELAY_MAX
    );
    setTimeout(connectWs, delay);
  }
  function connectWs() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }
    const url = getWsUrl();
    log("connectWs() \u2192", url);
    wsState = "connecting";
    try {
      ws = new WebSocket(url);
    } catch (e) {
      wsState = "disconnected";
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      wsState = "connected";
      reconnectAttempts = 0;
      log("WS OPEN \u2014 re-registering", instances.size, "instances");
      broadcastState("connected");
      for (const [instanceId, info] of instances) {
        info.registered = false;
        const regMsg = { type: "register", instance: instanceId, app: info.slug };
        ws.send(JSON.stringify(regMsg));
      }
    };
    ws.onclose = (ev) => {
      log("WS CLOSE code=" + ev.code, "reason=" + ev.reason);
      wsState = "disconnected";
      for (const [, info] of instances) {
        info.registered = false;
      }
      broadcastState("disconnected");
      scheduleReconnect();
    };
    ws.onerror = () => {
      log("WS ERROR");
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        routeMessage(msg);
      } catch (_) {
      }
    };
  }
  function routeMessage(msg) {
    if (msg.type === "registered" && msg.instance) {
      const info = instances.get(msg.instance);
      if (info) {
        info.registered = true;
        for (const p of info.ports) {
          try {
            p.postMessage({
              type: "registered",
              instanceId: msg.instance,
              reconnected: !!msg.reconnected
            });
          } catch (_) {
          }
        }
      }
      return;
    }
    if (msg.instance) {
      if (msg.type === "event") {
        bufferEvent(msg.instance, msg);
      }
      const info = instances.get(msg.instance);
      if (info) {
        for (const p of info.ports) {
          try {
            p.postMessage({ type: "message", instanceId: msg.instance, payload: msg });
          } catch (_) {
          }
        }
      }
      return;
    }
    for (const port of allPorts) {
      try {
        port.postMessage({ type: "message", instanceId: null, payload: msg });
      } catch (_) {
      }
    }
  }
  function handlePortMessage(port, data) {
    switch (data.type) {
      case "register": {
        const instanceId = data.instanceId;
        const slug = data.slug;
        if (!instanceId || !slug) return;
        let info = instances.get(instanceId);
        if (info) {
          info.ports.add(port);
        } else {
          info = { ports: /* @__PURE__ */ new Set([port]), slug, registered: false };
          instances.set(instanceId, info);
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
          if (info.registered) {
            try {
              port.postMessage({
                type: "registered",
                instanceId,
                reconnected: true
              });
            } catch (_) {
            }
            replayBuffer(instanceId, port);
          } else {
            ws.send(JSON.stringify({ type: "register", instance: instanceId, app: slug }));
          }
        }
        break;
      }
      case "unregister": {
        const instanceId = data.instanceId;
        if (!instanceId) return;
        const info = instances.get(instanceId);
        if (info) {
          info.ports.delete(port);
          if (info.ports.size === 0) {
            instances.delete(instanceId);
            eventBuffers.delete(instanceId);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "unregister", instance: instanceId }));
            }
          }
        }
        break;
      }
      case "send": {
        if (ws && ws.readyState === WebSocket.OPEN && data.payload) {
          const payloadStr = typeof data.payload === "string" ? data.payload : JSON.stringify(data.payload);
          ws.send(payloadStr);
        }
        break;
      }
    }
  }
  var _self = globalThis;
  _self.onconnect = (e) => {
    const port = e.ports[0];
    allPorts.add(port);
    log("NEW PORT (total:", allPorts.size, ")");
    port.onmessage = (ev) => {
      handlePortMessage(port, ev.data);
    };
    port.postMessage({ type: "state", state: wsState });
    if (wsState === "disconnected") {
      connectWs();
    }
  };
  log("SharedWorker loaded");
  connectWs();
})();
//# sourceMappingURL=zro-shared-worker.js.map
