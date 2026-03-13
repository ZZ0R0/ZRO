/**
 * zro-client.js — ZRO Frontend SDK v0.1.0
 * Built: 2026-03-13T05:09:16.286Z
 * Modules: clipboard, connection, dev, dnd, form, http, ipc, keybindings, launcher, lifecycle, notifications, replay-buffer, router, shell, state, storage, taskbar, theme, transport, window-mode
 */
"use strict";
var _ZroSDK = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser.ts
  var browser_exports = {};
  __export(browser_exports, {
    ZroClient: () => BrowserZroClient
  });

  // src/core/registry.ts
  var ModuleRegistry = class {
    constructor() {
      this._factories = /* @__PURE__ */ new Map();
      this._modules = /* @__PURE__ */ new Map();
      this._initOrder = [];
      this._config = null;
      this._debug = false;
    }
    /**
     * Register a module factory. Call this before init().
     * Can be called multiple times to add modules.
     */
    register(factory) {
      const mod = factory();
      const name = mod.meta.name;
      if (this._modules.has(name)) {
        throw new Error(`[ZRO] Module '${name}' is already initialized. Cannot re-register.`);
      }
      this._factories.set(name, factory);
      return this;
    }
    /**
     * Register multiple module factories at once.
     */
    registerAll(factories) {
      for (const f of factories) {
        this.register(f);
      }
      return this;
    }
    /**
     * Initialize all registered modules in dependency order.
     * Must be called once with the app config.
     */
    async init(config) {
      this._config = config;
      this._debug = config.debug ?? false;
      const pending = /* @__PURE__ */ new Map();
      for (const [name, factory] of this._factories) {
        if (!this._modules.has(name)) {
          pending.set(name, factory());
        }
      }
      const order = this._resolveDependencies(pending);
      for (const name of order) {
        const mod = pending.get(name);
        if (!mod) continue;
        const ctx = this._createContext(name);
        this._log(`Initializing module: ${name} v${mod.meta.version}`);
        try {
          const api = await mod.init(ctx);
          this._modules.set(name, { module: mod, api });
          this._initOrder.push(name);
        } catch (err) {
          throw new Error(
            `[ZRO] Module '${name}' failed to initialize: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      this._log(`All modules initialized: [${this._initOrder.join(", ")}]`);
    }
    /**
     * Get a module's public API by name.
     * @throws if module is not initialized.
     */
    get(name) {
      const entry = this._modules.get(name);
      if (!entry) {
        throw new Error(`[ZRO] Module '${name}' is not available. Did you register it?`);
      }
      return entry.api;
    }
    /**
     * Check if a module is available (registered and initialized).
     */
    has(name) {
      return this._modules.has(name);
    }
    /**
     * Tear down all modules in reverse initialization order.
     */
    async destroy() {
      const reversed = [...this._initOrder].reverse();
      for (const name of reversed) {
        const entry = this._modules.get(name);
        if (entry?.module.destroy) {
          this._log(`Destroying module: ${name}`);
          try {
            await entry.module.destroy();
          } catch (err) {
            console.error(`[ZRO] Module '${name}' destroy error:`, err);
          }
        }
      }
      this._modules.clear();
      this._initOrder = [];
    }
    /**
     * List all initialized module names (in init order).
     */
    list() {
      return [...this._initOrder];
    }
    /**
     * Get metadata for all registered modules.
     */
    info() {
      const result = [];
      for (const [name, factory] of this._factories) {
        const mod = factory();
        result.push({
          name,
          version: mod.meta.version,
          category: mod.meta.category,
          initialized: this._modules.has(name)
        });
      }
      return result;
    }
    // ── Private ──────────────────────────────────────────
    _resolveDependencies(modules) {
      const order = [];
      const visited = /* @__PURE__ */ new Set();
      const visiting = /* @__PURE__ */ new Set();
      const visit = (name) => {
        if (visited.has(name)) return;
        if (visiting.has(name)) {
          throw new Error(`[ZRO] Circular dependency detected involving module '${name}'`);
        }
        const mod = modules.get(name);
        if (!mod) {
          if (this._modules.has(name)) {
            visited.add(name);
            return;
          }
          throw new Error(
            `[ZRO] Module '${name}' is required as a dependency but not registered.`
          );
        }
        visiting.add(name);
        for (const dep of mod.meta.dependencies ?? []) {
          visit(dep);
        }
        visiting.delete(name);
        visited.add(name);
        order.push(name);
      };
      for (const name of modules.keys()) {
        visit(name);
      }
      return order;
    }
    _createContext(moduleName) {
      return {
        getModule: (name) => this.get(name),
        hasModule: (name) => this.has(name),
        config: this._config,
        log: (...args) => {
          if (this._debug) {
            console.log(`[ZRO:${moduleName}]`, ...args);
          }
        }
      };
    }
    _log(...args) {
      if (this._debug) {
        console.log("[ZRO:registry]", ...args);
      }
    }
  };

  // src/modules/transport.ts
  var _worker = null;
  var _workerPort = null;
  var _workerSupported = typeof SharedWorker !== "undefined";
  var _portCallbacks = /* @__PURE__ */ new Map();
  var _stateListeners = /* @__PURE__ */ new Set();
  function _getWorkerPort(debug) {
    if (_workerPort) return _workerPort;
    if (!_workerSupported) return null;
    try {
      _worker = new SharedWorker("/static/zro-shared-worker.js", { name: "zro" });
      _workerPort = _worker.port;
      _workerPort.onmessage = (e) => {
        const data = e.data;
        if (data.type === "log") {
          if (debug) console.log(data.msg);
          return;
        }
        if (data.type === "state") {
          for (const cb of _stateListeners) {
            try {
              cb(data.state);
            } catch (_) {
            }
          }
          return;
        }
        if (data.type === "registered" && data.instanceId) {
          const cb = _portCallbacks.get(data.instanceId);
          if (cb) {
            cb({ type: "registered", reconnected: data.reconnected });
          }
          return;
        }
        if (data.type === "message" && data.instanceId) {
          const cb = _portCallbacks.get(data.instanceId);
          if (cb) {
            cb({ type: "ws_message", payload: data.payload });
          }
          return;
        }
      };
      _workerPort.start();
      return _workerPort;
    } catch (_) {
      _workerSupported = false;
      return null;
    }
  }
  function _connectDirect(ds, debug) {
    if (ds.closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws`;
    try {
      ds.ws = new WebSocket(url);
    } catch (_) {
      _scheduleDirectReconnect(ds, debug);
      return;
    }
    ds.ws.onopen = () => {
      ds.reconnectAttempts = 0;
      for (const cb of _stateListeners) {
        try {
          cb("connected");
        } catch (_) {
        }
      }
      ds.ws.send(JSON.stringify({
        type: "register",
        instance: ds.instanceId,
        app: ds.slug
      }));
    };
    ds.ws.onclose = () => {
      for (const cb of _stateListeners) {
        try {
          cb("disconnected");
        } catch (_) {
        }
      }
      _scheduleDirectReconnect(ds, debug);
    };
    ds.ws.onerror = () => {
    };
    ds.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "registered" && msg.instance === ds.instanceId) {
          ds.callback?.({ type: "registered", reconnected: !!msg.reconnected });
          return;
        }
        if (msg.instance && msg.instance !== ds.instanceId) return;
        ds.callback?.({ type: "ws_message", payload: msg });
      } catch (_) {
      }
    };
  }
  function _scheduleDirectReconnect(ds, debug) {
    if (ds.closed) return;
    ds.reconnectAttempts++;
    const delay = Math.min(1e3 * Math.pow(2, ds.reconnectAttempts - 1), 3e4);
    setTimeout(() => _connectDirect(ds, debug), delay);
  }
  var transportModule = () => {
    let _mode = "worker";
    let _directState = null;
    let _currentState = "disconnected";
    let _debug = false;
    const mod = {
      meta: {
        name: "transport",
        version: "0.1.0",
        description: "SharedWorker + WebSocket transport layer",
        category: "core",
        dependencies: []
      },
      init(ctx) {
        _debug = ctx.config.debug ?? false;
        const port = _getWorkerPort(_debug);
        if (port) {
          _mode = "worker";
          ctx.log("Transport: SharedWorker mode");
        } else {
          _mode = "direct";
          ctx.log("Transport: Direct WebSocket fallback");
        }
        _stateListeners.add((state) => {
          _currentState = state;
        });
        const api = {
          send(instanceId, payload) {
            if (_mode === "worker") {
              const p = _getWorkerPort(_debug);
              if (p) {
                p.postMessage({ type: "send", instanceId, payload });
              }
            } else if (_directState?.ws?.readyState === WebSocket.OPEN) {
              _directState.ws.send(JSON.stringify(payload));
            }
          },
          subscribe(instanceId, callback) {
            if (_mode === "worker") {
              _portCallbacks.set(instanceId, callback);
              const p = _getWorkerPort(_debug);
              if (p) {
                p.postMessage({
                  type: "register",
                  instanceId,
                  slug: ctx.config.slug
                });
              }
            } else {
              _directState = {
                ws: null,
                instanceId,
                slug: ctx.config.slug,
                callback,
                reconnectAttempts: 0,
                closed: false
              };
              _connectDirect(_directState, _debug);
            }
          },
          unsubscribe(instanceId) {
            if (_mode === "worker") {
              _portCallbacks.delete(instanceId);
              const p = _getWorkerPort(_debug);
              if (p) {
                p.postMessage({ type: "unregister", instanceId });
              }
            } else if (_directState) {
              _directState.closed = true;
              if (_directState.ws?.readyState === WebSocket.OPEN) {
                try {
                  _directState.ws.send(JSON.stringify({
                    type: "unregister",
                    instance: instanceId
                  }));
                } catch (_) {
                }
                _directState.ws.close();
              }
              _directState = null;
            }
          },
          onState(callback) {
            _stateListeners.add(callback);
            return () => _stateListeners.delete(callback);
          },
          get state() {
            return _currentState;
          }
        };
        return api;
      },
      destroy() {
        for (const id of _portCallbacks.keys()) {
          const p = _getWorkerPort(_debug);
          if (p) {
            p.postMessage({ type: "unregister", instanceId: id });
          }
        }
        _portCallbacks.clear();
        _stateListeners.clear();
        if (_directState) {
          _directState.closed = true;
          _directState.ws?.close();
          _directState = null;
        }
      }
    };
    return mod;
  };

  // src/modules/connection.ts
  var connectionModule = () => {
    let _transport;
    let _instanceId;
    let _listeners = {};
    let _pendingInvokes = {};
    let _connectionState = "connecting";
    let _onConnect = () => {
    };
    let _onDisconnect = () => {
    };
    let _closed = false;
    let _instanceCounter = 0;
    function _parseUrlPath4() {
      const parts = window.location.pathname.split("/").filter(Boolean);
      const slug = parts[0] || null;
      const second = parts[1] || null;
      const instanceId = second && second !== "static" && second !== "api" ? second : null;
      return { slug, instanceId };
    }
    function _handleWsMessage(msg) {
      if (_closed) return;
      if (msg.type === "response" && msg.id) {
        const pending = _pendingInvokes[msg.id];
        if (pending) {
          clearTimeout(pending.timer);
          delete _pendingInvokes[msg.id];
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }
      if (msg.type === "event" && msg.event) {
        const handlers = _listeners[msg.event];
        if (handlers) {
          for (const fn of handlers) {
            try {
              fn(msg.payload);
            } catch (err) {
              console.error("Listener error:", err);
            }
          }
        }
        return;
      }
    }
    const mod = {
      meta: {
        name: "connection",
        version: "0.1.0",
        description: "Application-level invoke/on/emit connection",
        category: "core",
        dependencies: ["transport"]
      },
      init(ctx) {
        _transport = ctx.getModule("transport");
        _onConnect = ctx.config.onConnect || (() => {
        });
        _onDisconnect = ctx.config.onDisconnect || (() => {
        });
        const urlInfo = _parseUrlPath4();
        _instanceId = ctx.config.instanceId || (urlInfo.slug === ctx.config.slug ? urlInfo.instanceId : null) || `${ctx.config.slug}-${++_instanceCounter}`;
        ctx.log(`Connection: slug=${ctx.config.slug} instanceId=${_instanceId}`);
        _transport.onState((state) => {
          _connectionState = state;
          if (state === "disconnected") {
            _onDisconnect();
          }
        });
        _transport.subscribe(_instanceId, (msg) => {
          if (_closed) return;
          if (msg.type === "registered") {
            _connectionState = "connected";
            _onConnect({ reconnected: !!msg.reconnected });
            return;
          }
          if (msg.type === "ws_message" && msg.payload) {
            _handleWsMessage(msg.payload);
          }
        });
        const api = {
          invoke(command, params, options) {
            const timeout = options?.timeout ?? 3e4;
            const id = crypto.randomUUID();
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                delete _pendingInvokes[id];
                reject(new Error(`invoke('${command}') timed out`));
              }, timeout);
              _pendingInvokes[id] = {
                resolve,
                reject,
                timer
              };
              _transport.send(_instanceId, {
                type: "invoke",
                id,
                instance: _instanceId,
                command,
                params: params || {}
              });
            });
          },
          on(event, handler) {
            if (!_listeners[event]) _listeners[event] = [];
            _listeners[event].push(handler);
          },
          off(event, handler) {
            if (!_listeners[event]) return;
            _listeners[event] = _listeners[event].filter((fn) => fn !== handler);
          },
          emit(event, data) {
            _transport.send(_instanceId, {
              type: "emit",
              instance: _instanceId,
              event,
              data: data ?? null
            });
          },
          close() {
            _closed = true;
            _transport.unsubscribe(_instanceId);
            for (const [id, pending] of Object.entries(_pendingInvokes)) {
              clearTimeout(pending.timer);
              pending.reject(new Error("Connection closed"));
              delete _pendingInvokes[id];
            }
          },
          get instanceId() {
            return _instanceId;
          },
          get connectionState() {
            return _connectionState;
          }
        };
        return api;
      },
      destroy() {
        _closed = true;
        _listeners = {};
        for (const [id, pending] of Object.entries(_pendingInvokes)) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Connection destroyed"));
          delete _pendingInvokes[id];
        }
      }
    };
    return mod;
  };

  // src/modules/state.ts
  var stateModule = () => {
    let _conn;
    let _autoSaveCleanups = [];
    const mod = {
      meta: {
        name: "state",
        version: "0.1.0",
        description: "Persistent state save/restore with auto-save",
        category: "core",
        dependencies: ["connection"]
      },
      init(ctx) {
        _conn = ctx.getModule("connection");
        const api = {
          async save(key, value) {
            await _conn.invoke("__state:save", {
              key,
              value: JSON.stringify(value)
            });
          },
          async restore(key) {
            const raw = await _conn.invoke("__state:restore", { key });
            return raw ? JSON.parse(raw) : null;
          },
          async delete(key) {
            await _conn.invoke("__state:delete", { key });
          },
          async keys() {
            return _conn.invoke("__state:keys");
          },
          autoSave(key, getter, debounceMs = 500) {
            let timer = null;
            let lastJson = "";
            let stopped = false;
            const check = () => {
              if (stopped) return;
              try {
                const val = getter();
                const json = JSON.stringify(val);
                if (json !== lastJson) {
                  lastJson = json;
                  if (timer) clearTimeout(timer);
                  timer = setTimeout(() => {
                    if (!stopped) {
                      api.save(key, val).catch(() => {
                      });
                    }
                  }, debounceMs);
                }
              } catch (_) {
              }
            };
            const interval = setInterval(check, Math.max(debounceMs, 250));
            const cleanup = () => {
              stopped = true;
              if (timer) clearTimeout(timer);
              clearInterval(interval);
            };
            _autoSaveCleanups.push(cleanup);
            return cleanup;
          }
        };
        return api;
      },
      destroy() {
        for (const cleanup of _autoSaveCleanups) {
          cleanup();
        }
        _autoSaveCleanups = [];
      }
    };
    return mod;
  };

  // src/modules/lifecycle.ts
  var lifecycleModule = () => {
    let _cleanups = [];
    const mod = {
      meta: {
        name: "lifecycle",
        version: "0.1.0",
        description: "Frontend lifecycle (unload, visibility, idle)",
        category: "core",
        dependencies: []
      },
      init(_ctx) {
        return {
          onBeforeUnload(handler) {
            const listener = (e) => {
              handler();
              e.returnValue = "";
            };
            window.addEventListener("beforeunload", listener);
            const cleanup = () => window.removeEventListener("beforeunload", listener);
            _cleanups.push(cleanup);
            return cleanup;
          },
          onVisibilityChange(handler) {
            const listener = () => handler(document.visibilityState === "visible");
            document.addEventListener("visibilitychange", listener);
            const cleanup = () => document.removeEventListener("visibilitychange", listener);
            _cleanups.push(cleanup);
            return cleanup;
          },
          onIdle(handler, timeoutMs = 6e4) {
            let timer = setTimeout(handler, timeoutMs);
            const events = ["mousemove", "keydown", "scroll", "touchstart"];
            const reset = () => {
              clearTimeout(timer);
              timer = setTimeout(handler, timeoutMs);
            };
            for (const ev of events) {
              document.addEventListener(ev, reset, { passive: true });
            }
            const cleanup = () => {
              clearTimeout(timer);
              for (const ev of events) {
                document.removeEventListener(ev, reset);
              }
            };
            _cleanups.push(cleanup);
            return cleanup;
          }
        };
      },
      destroy() {
        for (const fn of _cleanups) fn();
        _cleanups = [];
      }
    };
    return mod;
  };

  // src/modules/replay-buffer.ts
  var replayBufferModule = () => {
    let _entries = [];
    let _totalBytes = 0;
    let _maxBytes = 200 * 1024;
    function _evict() {
      while (_totalBytes > _maxBytes && _entries.length > 0) {
        const removed = _entries.shift();
        _totalBytes -= removed.bytes;
      }
    }
    const mod = {
      meta: {
        name: "replay-buffer",
        version: "0.1.0",
        description: "Ring buffer for event replay on reconnect",
        category: "core",
        dependencies: []
      },
      init(ctx) {
        if (ctx.hasModule("connection")) {
          ctx.log("ReplayBuffer: auto-capture mode (connection available)");
        }
        const api = {
          push(event, payload) {
            const raw = JSON.stringify(payload);
            const bytes = raw.length * 2;
            _entries.push({ event, payload, bytes, timestamp: Date.now() });
            _totalBytes += bytes;
            _evict();
          },
          replay(handler) {
            for (const entry of _entries) {
              try {
                handler(entry.event, entry.payload);
              } catch (_) {
              }
            }
          },
          replayEvent(event, handler) {
            for (const entry of _entries) {
              if (entry.event === event) {
                try {
                  handler(entry.payload);
                } catch (_) {
                }
              }
            }
          },
          clear() {
            _entries = [];
            _totalBytes = 0;
          },
          clearEvent(event) {
            const filtered = _entries.filter((e) => e.event !== event);
            _totalBytes = filtered.reduce((sum, e) => sum + e.bytes, 0);
            _entries = filtered;
          },
          stats() {
            const events = {};
            for (const e of _entries) {
              events[e.event] = (events[e.event] || 0) + 1;
            }
            return { totalEvents: _entries.length, totalBytes: _totalBytes, events };
          },
          setMaxBytes(bytes) {
            _maxBytes = bytes;
            _evict();
          }
        };
        return api;
      },
      destroy() {
        _entries = [];
        _totalBytes = 0;
      }
    };
    return mod;
  };

  // src/modules/shell.ts
  var shellModule = () => {
    const mod = {
      meta: {
        name: "shell",
        version: "0.1.0",
        description: "Shell integration (postMessage protocol)",
        category: "shell",
        dependencies: []
      },
      init(_ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        if (!isInShell) {
          return {
            isInShell: false,
            setTitle: () => Promise.resolve(),
            notify: () => Promise.resolve(),
            setBadgeCount: () => Promise.resolve(),
            requestFocus: () => Promise.resolve(),
            minimize: () => Promise.resolve(),
            maximize: () => Promise.resolve(),
            restore: () => Promise.resolve(),
            close: () => Promise.resolve(),
            getWindowInfo: () => Promise.resolve(null),
            on: () => {
            },
            off: () => {
            }
          };
        }
        const _pending = /* @__PURE__ */ new Map();
        const _listeners = /* @__PURE__ */ new Map();
        let _reqId = 0;
        const _messageHandler = (e) => {
          if (!e.data || typeof e.data.type !== "string") return;
          if (e.data.type === "zro:shell:response" && e.data.requestId) {
            const resolver = _pending.get(e.data.requestId);
            if (resolver) {
              _pending.delete(e.data.requestId);
              if (e.data.success === false) {
                resolver.reject(new Error(e.data.payload?.error || "Shell API error"));
              } else {
                resolver.resolve(e.data.payload);
              }
            }
          }
          if (e.data.type === "zro:shell:event" && e.data.event) {
            const handlers = _listeners.get(e.data.event) || [];
            for (const h of handlers) {
              try {
                h(e.data.payload);
              } catch (_) {
              }
            }
          }
        };
        window.addEventListener("message", _messageHandler);
        function _send(method, payload) {
          return new Promise((resolve, reject) => {
            const requestId = `req_${++_reqId}`;
            _pending.set(requestId, { resolve, reject });
            parent.postMessage({
              type: `zro:shell:${method}`,
              requestId,
              payload: payload || {}
            }, "*");
            setTimeout(() => {
              if (_pending.has(requestId)) {
                _pending.delete(requestId);
                reject(new Error(`Shell API timeout: ${method}`));
              }
            }, 5e3);
          });
        }
        const api = {
          isInShell: true,
          setTitle: (title) => _send("setTitle", { title }),
          notify: (opts) => _send("notify", opts),
          setBadgeCount: (count) => _send("setBadgeCount", { count }),
          requestFocus: () => _send("requestFocus"),
          minimize: () => _send("minimize"),
          maximize: () => _send("maximize"),
          restore: () => _send("restore"),
          close: () => _send("close"),
          getWindowInfo: () => _send("getWindowInfo"),
          on(event, handler) {
            if (!_listeners.has(event)) _listeners.set(event, []);
            _listeners.get(event).push(handler);
          },
          off(event, handler) {
            const arr = _listeners.get(event);
            if (arr) _listeners.set(event, arr.filter((h) => h !== handler));
          }
        };
        return api;
      }
    };
    return mod;
  };

  // src/modules/window-mode.ts
  var windowModeModule = () => {
    let _stateListeners2 = [];
    let _focusListeners = [];
    let _messageHandler = null;
    let _isManaged = false;
    const mod = {
      meta: {
        name: "window-mode",
        version: "0.1.0",
        description: "Window manager (drag, resize, minimize, maximize, pop-out)",
        category: "shell",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        _isManaged = isInShell;
        function _sendToShell(action, payload) {
          if (!isInShell) return;
          parent.postMessage({
            type: "zro:window:" + action,
            payload: payload ?? {}
          }, "*");
        }
        if (isInShell) {
          _messageHandler = (e) => {
            if (!e.data) return;
            if (e.data.type === "zro:window:stateChanged") {
              const info = e.data.info;
              for (const handler of _stateListeners2) {
                try {
                  handler(info);
                } catch (_) {
                }
              }
            }
            if (e.data.type === "zro:window:focusChanged") {
              const focused = e.data.focused;
              for (const handler of _focusListeners) {
                try {
                  handler(focused);
                } catch (_) {
                }
              }
            }
          };
          window.addEventListener("message", _messageHandler);
        }
        const api = {
          moveTo(x, y) {
            _sendToShell("moveTo", { x, y });
          },
          resizeTo(width, height) {
            _sendToShell("resizeTo", { width, height });
          },
          minimize() {
            _sendToShell("minimize");
          },
          maximize() {
            _sendToShell("maximize");
          },
          restore() {
            _sendToShell("restore");
          },
          close() {
            _sendToShell("close");
          },
          focus() {
            _sendToShell("focus");
          },
          popOut() {
            if (isInShell) {
              _sendToShell("popOut");
            } else {
            }
          },
          toggleMaximize() {
            _sendToShell("toggleMaximize");
          },
          async getInfo() {
            if (!isInShell) {
              return {
                x: window.screenX,
                y: window.screenY,
                width: window.innerWidth,
                height: window.innerHeight,
                maximized: false,
                minimized: false,
                focused: document.hasFocus(),
                zIndex: 0
              };
            }
            return new Promise((resolve) => {
              const handler = (e) => {
                if (e.data?.type === "zro:window:info") {
                  window.removeEventListener("message", handler);
                  resolve(e.data.info);
                }
              };
              window.addEventListener("message", handler);
              _sendToShell("getInfo");
              setTimeout(() => {
                window.removeEventListener("message", handler);
                resolve({
                  x: 0,
                  y: 0,
                  width: 800,
                  height: 600,
                  maximized: false,
                  minimized: false,
                  focused: true,
                  zIndex: 0
                });
              }, 2e3);
            });
          },
          onStateChange(handler) {
            _stateListeners2.push(handler);
            return () => {
              _stateListeners2 = _stateListeners2.filter((h) => h !== handler);
            };
          },
          onFocus(handler) {
            _focusListeners.push(handler);
            return () => {
              _focusListeners = _focusListeners.filter((h) => h !== handler);
            };
          },
          get isManaged() {
            return _isManaged;
          }
        };
        return api;
      },
      destroy() {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _stateListeners2 = [];
        _focusListeners = [];
      }
    };
    return mod;
  };

  // src/modules/taskbar.ts
  var taskbarModule = () => {
    let _actions = /* @__PURE__ */ new Map();
    let _messageHandler = null;
    let _hasTaskbar = false;
    const mod = {
      meta: {
        name: "taskbar",
        version: "0.1.0",
        description: "Taskbar integration (badges, actions, progress)",
        category: "shell",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        _hasTaskbar = isInShell;
        function _sendToShell(action, payload) {
          if (!isInShell) return;
          parent.postMessage({
            type: "zro:taskbar:" + action,
            payload: payload ?? {}
          }, "*");
        }
        if (isInShell) {
          _messageHandler = (e) => {
            if (e.data?.type === "zro:taskbar:actionTrigger") {
              const actionId = e.data.actionId;
              const action = _actions.get(actionId);
              if (action) {
                try {
                  action.handler();
                } catch (_) {
                }
              }
            }
          };
          window.addEventListener("message", _messageHandler);
        }
        const api = {
          setBadge(count) {
            _sendToShell("setBadge", { count });
          },
          setBadgeText(text) {
            _sendToShell("setBadgeText", { text });
          },
          clearBadge() {
            _sendToShell("clearBadge");
          },
          setTooltip(text) {
            _sendToShell("setTooltip", { text });
          },
          addAction(action) {
            _actions.set(action.id, action);
            _sendToShell("addAction", {
              id: action.id,
              label: action.label,
              icon: action.icon
            });
            return () => {
              _actions.delete(action.id);
              _sendToShell("removeAction", { id: action.id });
            };
          },
          clearActions() {
            _actions.clear();
            _sendToShell("clearActions");
          },
          setProgress(percent) {
            _sendToShell("setProgress", { percent });
          },
          flash() {
            _sendToShell("flash");
          },
          get hasTaskbar() {
            return _hasTaskbar;
          }
        };
        return api;
      },
      destroy() {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _actions.clear();
      }
    };
    return mod;
  };

  // src/modules/launcher.ts
  var STORAGE_KEY_RECENT = "zro:launcher:recent";
  var STORAGE_KEY_FAVORITES = "zro:launcher:favorites";
  var MAX_RECENT = 10;
  var launcherModule = () => {
    let _isShellManaged = false;
    const mod = {
      meta: {
        name: "launcher",
        version: "0.1.0",
        description: "App launcher (grid, recent, favorites)",
        category: "shell",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        _isShellManaged = isInShell;
        function _getStoredList(key) {
          try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : [];
          } catch {
            return [];
          }
        }
        function _setStoredList(key, list) {
          localStorage.setItem(key, JSON.stringify(list));
        }
        function _addRecent(slug) {
          const recent = _getStoredList(STORAGE_KEY_RECENT).filter((s) => s !== slug);
          recent.unshift(slug);
          _setStoredList(STORAGE_KEY_RECENT, recent.slice(0, MAX_RECENT));
        }
        const api = {
          async getApps() {
            try {
              const resp = await fetch("/api/apps", { credentials: "same-origin" });
              if (resp.ok) {
                return await resp.json();
              }
            } catch (_) {
            }
            return [];
          },
          launch(slug) {
            _addRecent(slug);
            if (isInShell) {
              parent.postMessage({
                type: "zro:launcher:launch",
                slug
              }, "*");
            } else {
              window.location.href = `/${slug}/`;
            }
          },
          getRecent() {
            return _getStoredList(STORAGE_KEY_RECENT);
          },
          addFavorite(slug) {
            const favs = _getStoredList(STORAGE_KEY_FAVORITES);
            if (!favs.includes(slug)) {
              favs.push(slug);
              _setStoredList(STORAGE_KEY_FAVORITES, favs);
            }
          },
          removeFavorite(slug) {
            const favs = _getStoredList(STORAGE_KEY_FAVORITES).filter((s) => s !== slug);
            _setStoredList(STORAGE_KEY_FAVORITES, favs);
          },
          getFavorites() {
            return _getStoredList(STORAGE_KEY_FAVORITES);
          },
          get isShellManaged() {
            return _isShellManaged;
          }
        };
        return api;
      }
    };
    return mod;
  };

  // src/modules/http.ts
  function _parseUrlPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const slug = parts[0] || null;
    const second = parts[1] || null;
    const instanceId = second && second !== "static" && second !== "api" ? second : null;
    return { slug, instanceId };
  }
  async function _fetchJson(url, method, body) {
    const opts = {
      method: method.toUpperCase(),
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin"
    };
    if (body && method.toUpperCase() !== "GET") {
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text2 = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text2);
      } catch {
        parsed = { error: text2 };
      }
      const err = new Error(parsed.error || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = parsed;
      throw err;
    }
    const text = await resp.text();
    if (!text) return {};
    return JSON.parse(text);
  }
  var httpModule = () => {
    let _slug;
    const mod = {
      meta: {
        name: "http",
        version: "0.1.0",
        description: "HTTP client for REST API calls",
        category: "data",
        dependencies: []
      },
      init(ctx) {
        _slug = ctx.config.slug;
        function _buildUrl(path, query) {
          const urlInfo = _parseUrlPath();
          const prefix = urlInfo.slug === _slug && urlInfo.instanceId ? `/${_slug}/${urlInfo.instanceId}` : `/${_slug}`;
          let url = `${prefix}/api${path}`;
          if (query) {
            const params = new URLSearchParams(query);
            url += `?${params.toString()}`;
          }
          return url;
        }
        return {
          get: (path, query) => _fetchJson(_buildUrl(path, query), "GET"),
          post: (path, body) => _fetchJson(_buildUrl(path), "POST", body),
          put: (path, body) => _fetchJson(_buildUrl(path), "PUT", body),
          delete: (path) => _fetchJson(_buildUrl(path), "DELETE")
        };
      }
    };
    return mod;
  };

  // src/modules/storage.ts
  var storageModule = () => {
    let _prefix = "";
    function _scopedGet(prefix, key) {
      const raw = localStorage.getItem(`${prefix}${key}`);
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    function _scopedSet(prefix, key, value) {
      localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
    }
    function _scopedRemove(prefix, key) {
      localStorage.removeItem(`${prefix}${key}`);
    }
    function _scopedHas(prefix, key) {
      return localStorage.getItem(`${prefix}${key}`) !== null;
    }
    function _scopedKeys(prefix) {
      const result = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          result.push(key.slice(prefix.length));
        }
      }
      return result;
    }
    function _scopedClear(prefix) {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          toRemove.push(key);
        }
      }
      for (const key of toRemove) {
        localStorage.removeItem(key);
      }
    }
    function _createInstanceStorage(instanceId) {
      const iPrefix = `${_prefix}${instanceId}:`;
      return {
        get: (key) => _scopedGet(iPrefix, key),
        set: (key, value) => _scopedSet(iPrefix, key, value),
        remove: (key) => _scopedRemove(iPrefix, key),
        has: (key) => _scopedHas(iPrefix, key),
        keys: () => _scopedKeys(iPrefix),
        clear: () => _scopedClear(iPrefix)
      };
    }
    const mod = {
      meta: {
        name: "storage",
        version: "0.1.0",
        description: "Scoped localStorage (per-app, per-instance)",
        category: "data",
        dependencies: []
      },
      init(ctx) {
        _prefix = `zro:${ctx.config.slug}:`;
        const api = {
          get: (key) => _scopedGet(_prefix, key),
          set: (key, value) => _scopedSet(_prefix, key, value),
          remove: (key) => _scopedRemove(_prefix, key),
          has: (key) => _scopedHas(_prefix, key),
          keys: () => _scopedKeys(_prefix),
          clear: () => _scopedClear(_prefix),
          instance: (instanceId) => _createInstanceStorage(instanceId)
        };
        return api;
      }
    };
    return mod;
  };

  // src/modules/ipc.ts
  var ipcModule = () => {
    let _handlers = /* @__PURE__ */ new Map();
    let _messageHandler = null;
    let _slug = "";
    const mod = {
      meta: {
        name: "ipc",
        version: "0.1.0",
        description: "Inter-app communication (frontend + backend)",
        category: "data",
        dependencies: []
      },
      init(ctx) {
        _slug = ctx.config.slug;
        const connection = ctx.hasModule("connection") ? ctx.getModule("connection") : null;
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        _messageHandler = (e) => {
          if (!e.data || e.data.type !== "zro:ipc:message") return;
          const msg = {
            from: e.data.from ?? "unknown",
            channel: e.data.channel ?? "",
            data: e.data.data
          };
          const handlers = _handlers.get(msg.channel);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(msg);
              } catch (_) {
              }
            }
          }
        };
        window.addEventListener("message", _messageHandler);
        if (connection) {
          connection.on("__ipc:receive", (payload) => {
            const p = payload;
            const msg = {
              from: p.from ?? "unknown",
              channel: p.channel ?? "",
              data: p.data
            };
            const handlers = _handlers.get(msg.channel);
            if (handlers) {
              for (const handler of handlers) {
                try {
                  handler(msg);
                } catch (_) {
                }
              }
            }
          });
        }
        const api = {
          send(targetSlug, channel, data) {
            if (isInShell) {
              parent.postMessage({
                type: "zro:ipc:send",
                from: _slug,
                target: targetSlug,
                channel,
                data
              }, "*");
            }
          },
          async sendViaBackend(targetSlug, channel, data) {
            if (!connection) {
              throw new Error("IPC.sendViaBackend requires the connection module");
            }
            return connection.invoke("__ipc:send", {
              target: targetSlug,
              channel,
              data
            });
          },
          on(channel, handler) {
            if (!_handlers.has(channel)) {
              _handlers.set(channel, []);
            }
            _handlers.get(channel).push(handler);
            return () => {
              const arr = _handlers.get(channel);
              if (arr) {
                _handlers.set(channel, arr.filter((h) => h !== handler));
              }
            };
          },
          off(channel) {
            _handlers.delete(channel);
          },
          channels() {
            return [..._handlers.keys()];
          }
        };
        return api;
      },
      destroy() {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _handlers.clear();
      }
    };
    return mod;
  };

  // src/modules/theme.ts
  var themeModule = () => {
    let _variables = {};
    let _listeners = [];
    let _messageHandler = null;
    let _isShellManaged = false;
    function _applyVariables(vars) {
      _variables = { ..._variables, ...vars };
      const root = document.documentElement;
      for (const [key, value] of Object.entries(vars)) {
        root.style.setProperty(key, value);
      }
      for (const handler of _listeners) {
        try {
          handler({ ..._variables });
        } catch (_) {
        }
      }
    }
    const mod = {
      meta: {
        name: "theme",
        version: "0.1.0",
        description: "Theme synchronization (shell \u2194 app)",
        category: "ux",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        if (isInShell) {
          _isShellManaged = true;
          _messageHandler = (e) => {
            if (!e.data || e.data.type !== "zro:theme:update") return;
            const vars = e.data.variables;
            if (vars && typeof vars === "object") {
              ctx.log("Theme: received update from shell");
              _applyVariables(vars);
            }
          };
          window.addEventListener("message", _messageHandler);
          parent.postMessage({ type: "zro:theme:request" }, "*");
        } else {
          const stored = localStorage.getItem("zro:theme");
          if (stored) {
            try {
              const vars = JSON.parse(stored);
              _applyVariables(vars);
            } catch (_) {
            }
          }
        }
        const api = {
          getVariables() {
            return { ..._variables };
          },
          getVariable(name) {
            return _variables[name];
          },
          setVariables(vars) {
            _applyVariables(vars);
            if (!_isShellManaged) {
              localStorage.setItem("zro:theme", JSON.stringify(_variables));
            }
          },
          onChange(handler) {
            _listeners.push(handler);
            return () => {
              _listeners = _listeners.filter((h) => h !== handler);
            };
          },
          get isShellManaged() {
            return _isShellManaged;
          }
        };
        return api;
      },
      destroy() {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _listeners = [];
        _variables = {};
      }
    };
    return mod;
  };

  // src/modules/clipboard.ts
  var clipboardModule = () => {
    let _listeners = [];
    let _lastData = "";
    let _lastMimeType = "text/plain";
    let _messageHandler = null;
    const mod = {
      meta: {
        name: "clipboard",
        version: "0.1.0",
        description: "SharedWorker-based clipboard sharing",
        category: "ux",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        if (isInShell) {
          _messageHandler = (e) => {
            if (!e.data || e.data.type !== "zro:clipboard:changed") return;
            _lastData = e.data.data ?? "";
            _lastMimeType = e.data.mimeType ?? "text/plain";
            for (const handler of _listeners) {
              try {
                handler(_lastData, _lastMimeType);
              } catch (_) {
              }
            }
          };
          window.addEventListener("message", _messageHandler);
        }
        const api = {
          copy(data, mimeType = "text/plain") {
            _lastData = data;
            _lastMimeType = mimeType;
            if (document.hasFocus() && navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(data).catch(() => {
              });
            }
            if (isInShell) {
              parent.postMessage({
                type: "zro:clipboard:write",
                data,
                mimeType
              }, "*");
            }
          },
          async paste() {
            if (document.hasFocus() && navigator.clipboard?.readText) {
              try {
                return await navigator.clipboard.readText();
              } catch (_) {
              }
            }
            if (isInShell) {
              return new Promise((resolve) => {
                const handler = (e) => {
                  if (e.data?.type === "zro:clipboard:response") {
                    window.removeEventListener("message", handler);
                    resolve(e.data.data ?? _lastData);
                  }
                };
                window.addEventListener("message", handler);
                parent.postMessage({ type: "zro:clipboard:read" }, "*");
                setTimeout(() => {
                  window.removeEventListener("message", handler);
                  resolve(_lastData);
                }, 1e3);
              });
            }
            return _lastData;
          },
          onChange(handler) {
            _listeners.push(handler);
            return () => {
              _listeners = _listeners.filter((h) => h !== handler);
            };
          }
        };
        return api;
      },
      destroy() {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _listeners = [];
      }
    };
    return mod;
  };

  // src/modules/dnd.ts
  var dndModule = () => {
    let _isDragging = false;
    let _currentDragData = null;
    let _dropZones = /* @__PURE__ */ new Set();
    let _messageHandler = null;
    let _mousedownHandler = null;
    const mod = {
      meta: {
        name: "dnd",
        version: "0.1.0",
        description: "Drag and drop across iframes",
        category: "ux",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        _messageHandler = (e) => {
          if (!e.data) return;
          switch (e.data.type) {
            case "zro:dnd:dragover": {
              const dragData = e.data.dragData;
              for (const zone of _dropZones) {
                if (!zone.acceptTypes?.length || zone.acceptTypes.includes(dragData.type)) {
                  zone.onDragEnter?.();
                }
              }
              break;
            }
            case "zro:dnd:dragleave": {
              for (const zone of _dropZones) {
                zone.onDragLeave?.();
              }
              break;
            }
            case "zro:dnd:drop": {
              const dropData = e.data.dragData;
              for (const zone of _dropZones) {
                if (!zone.acceptTypes?.length || zone.acceptTypes.includes(dropData.type)) {
                  try {
                    zone.onDrop(dropData);
                  } catch (_) {
                  }
                }
              }
              _isDragging = false;
              _currentDragData = null;
              break;
            }
            case "zro:dnd:cancel": {
              _isDragging = false;
              _currentDragData = null;
              for (const zone of _dropZones) {
                zone.onDragLeave?.();
              }
              break;
            }
          }
        };
        window.addEventListener("message", _messageHandler);
        const api = {
          startDrag(element, data) {
            _isDragging = true;
            _currentDragData = data;
            if (isInShell) {
              const rect = element.getBoundingClientRect();
              parent.postMessage({
                type: "zro:dnd:start",
                dragData: data,
                origin: {
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height
                }
              }, "*");
            } else {
              element.draggable = true;
              const dragstartHandler = (e) => {
                e.dataTransfer?.setData("application/json", JSON.stringify(data));
              };
              element.addEventListener("dragstart", dragstartHandler, { once: true });
            }
          },
          registerDropZone(zone) {
            _dropZones.add(zone);
            const el = zone.element;
            const dragoverHandler = (e) => {
              e.preventDefault();
              zone.onDragEnter?.();
            };
            const dragleaveHandler = () => zone.onDragLeave?.();
            const dropHandler = (e) => {
              e.preventDefault();
              zone.onDragLeave?.();
              const raw = e.dataTransfer?.getData("application/json");
              if (raw) {
                try {
                  const data = JSON.parse(raw);
                  zone.onDrop(data);
                } catch (_) {
                }
              }
            };
            el.addEventListener("dragover", dragoverHandler);
            el.addEventListener("dragleave", dragleaveHandler);
            el.addEventListener("drop", dropHandler);
            return () => {
              _dropZones.delete(zone);
              el.removeEventListener("dragover", dragoverHandler);
              el.removeEventListener("dragleave", dragleaveHandler);
              el.removeEventListener("drop", dropHandler);
            };
          },
          cancelDrag() {
            if (_isDragging) {
              _isDragging = false;
              _currentDragData = null;
              if (isInShell) {
                parent.postMessage({ type: "zro:dnd:cancel" }, "*");
              }
            }
          },
          get isDragging() {
            return _isDragging;
          }
        };
        return api;
      },
      destroy() {
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _dropZones.clear();
        _isDragging = false;
        _currentDragData = null;
      }
    };
    return mod;
  };

  // src/modules/keybindings.ts
  function _normalizeKey(combo) {
    return combo.split("+").map((k) => k.trim().toLowerCase()).sort().join("+");
  }
  function _eventToCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    const key = e.key.toLowerCase();
    if (!["control", "alt", "shift", "meta"].includes(key)) {
      parts.push(key);
    }
    return parts.sort().join("+");
  }
  var keybindingsModule = () => {
    let _localBindings = [];
    let _globalBindings = [];
    let _keydownHandler = null;
    let _messageHandler = null;
    let _disabled = false;
    const mod = {
      meta: {
        name: "keybindings",
        version: "0.1.0",
        description: "Unified keyboard shortcuts (local + global)",
        category: "ux",
        dependencies: []
      },
      init(ctx) {
        let isInShell;
        try {
          isInShell = window !== window.parent;
        } catch (_) {
          isInShell = true;
        }
        _keydownHandler = (e) => {
          if (_disabled) return;
          const target = e.target;
          const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
          if (isInput && e.key !== "Escape") return;
          const combo = _eventToCombo(e);
          for (const binding of _localBindings) {
            if (binding.normalized === combo) {
              e.preventDefault();
              e.stopPropagation();
              try {
                binding.handler(e);
              } catch (_) {
              }
              return;
            }
          }
          for (const binding of _globalBindings) {
            if (binding.normalized === combo) {
              e.preventDefault();
              e.stopPropagation();
              if (isInShell) {
                parent.postMessage({
                  type: "zro:keybinding:global",
                  keys: combo
                }, "*");
              }
              try {
                binding.callback();
              } catch (_) {
              }
              return;
            }
          }
        };
        document.addEventListener("keydown", _keydownHandler, true);
        if (isInShell) {
          _messageHandler = (e) => {
            if (e.data?.type === "zro:keybinding:execute") {
              const combo = _normalizeKey(e.data.keys);
              for (const binding of _globalBindings) {
                if (binding.normalized === combo) {
                  try {
                    binding.callback();
                  } catch (_) {
                  }
                }
              }
            }
          };
          window.addEventListener("message", _messageHandler);
        }
        const api = {
          register(keys, handler, label) {
            const normalized = _normalizeKey(keys);
            const binding = { normalized, handler, label };
            _localBindings.push(binding);
            return () => {
              _localBindings = _localBindings.filter((b) => b !== binding);
            };
          },
          registerGlobal(keys, callback, label) {
            const normalized = _normalizeKey(keys);
            const binding = { normalized, callback, label };
            _globalBindings.push(binding);
            if (isInShell) {
              parent.postMessage({
                type: "zro:keybinding:register",
                keys: normalized,
                label
              }, "*");
            }
            return () => {
              _globalBindings = _globalBindings.filter((b) => b !== binding);
              if (isInShell) {
                parent.postMessage({
                  type: "zro:keybinding:unregister",
                  keys: normalized
                }, "*");
              }
            };
          },
          list() {
            return [
              ..._localBindings.map((b) => ({ keys: b.normalized, label: b.label, scope: "local" })),
              ..._globalBindings.map((b) => ({ keys: b.normalized, label: b.label, scope: "global" }))
            ];
          },
          clear() {
            _localBindings = [];
            _globalBindings = [];
          },
          disable() {
            _disabled = true;
          },
          enable() {
            _disabled = false;
          }
        };
        return api;
      },
      destroy() {
        if (_keydownHandler) {
          document.removeEventListener("keydown", _keydownHandler, true);
          _keydownHandler = null;
        }
        if (_messageHandler) {
          window.removeEventListener("message", _messageHandler);
          _messageHandler = null;
        }
        _localBindings = [];
        _globalBindings = [];
      }
    };
    return mod;
  };

  // src/modules/notifications.ts
  var notificationsModule = () => {
    let _history = [];
    let _listeners = [];
    let _maxHistory = 100;
    let _idCounter = 0;
    const mod = {
      meta: {
        name: "notifications",
        version: "0.1.0",
        description: "Unified notification system (toast + native)",
        category: "ux",
        dependencies: []
      },
      init(ctx) {
        const shell = ctx.hasModule("shell") ? ctx.getModule("shell") : null;
        const isInShell = shell?.isInShell ?? false;
        function _addToHistory(title, body, type) {
          const entry = {
            id: `notif-${++_idCounter}`,
            title,
            body,
            type,
            timestamp: Date.now(),
            read: false
          };
          _history.push(entry);
          if (_history.length > _maxHistory) {
            _history = _history.slice(-_maxHistory);
          }
          for (const handler of _listeners) {
            try {
              handler(entry);
            } catch (_) {
            }
          }
          return entry;
        }
        function _showNative(opts) {
          if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
          try {
            const n = new Notification(opts.title, {
              body: opts.body,
              icon: opts.icon
            });
            if (opts.timeout !== 0) {
              setTimeout(() => n.close(), opts.timeout ?? 5e3);
            }
          } catch (_) {
          }
        }
        const api = {
          show(opts) {
            const entry = _addToHistory(opts.title, opts.body, opts.type ?? "info");
            if (isInShell && document.visibilityState === "visible") {
              shell.notify({
                title: opts.title,
                body: opts.body,
                timeout: opts.timeout ?? 5e3
              }).catch(() => {
              });
            } else if (isInShell && document.visibilityState === "hidden") {
              _showNative(opts);
            } else {
              _showNative(opts);
            }
            return entry.id;
          },
          dismiss(id) {
            const entry = _history.find((n) => n.id === id);
            if (entry) entry.read = true;
          },
          history() {
            return [..._history];
          },
          clearHistory() {
            _history = [];
          },
          markRead(id) {
            const entry = _history.find((n) => n.id === id);
            if (entry) entry.read = true;
          },
          unreadCount() {
            return _history.filter((n) => !n.read).length;
          },
          async requestPermission() {
            if (typeof Notification === "undefined") return "denied";
            if (Notification.permission === "granted") return "granted";
            return Notification.requestPermission();
          },
          onNotification(handler) {
            _listeners.push(handler);
            return () => {
              _listeners = _listeners.filter((h) => h !== handler);
            };
          }
        };
        return api;
      },
      destroy() {
        _listeners = [];
      }
    };
    return mod;
  };

  // src/modules/router.ts
  function _compilePattern(pattern) {
    const paramNames = [];
    const parts = pattern.split("/").filter(Boolean);
    const regexParts = parts.map((part) => {
      if (part.startsWith(":")) {
        paramNames.push(part.slice(1));
        return "([^/]+)";
      }
      if (part === "*") {
        paramNames.push("_wildcard");
        return "(.*)";
      }
      if (part.endsWith("*")) {
        paramNames.push(part.slice(0, -1) || "_rest");
        return "(.*)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    const regex = new RegExp("^/?" + regexParts.join("/") + "/?$");
    return { regex, paramNames };
  }
  var routerModule = () => {
    let _routes = [];
    let _guards = [];
    let _changeListeners = [];
    let _hashHandler = null;
    let _currentPath = "";
    async function _dispatch() {
      const hash = window.location.hash || "#/";
      const path = hash.startsWith("#") ? hash.slice(1) : hash;
      const prevPath = _currentPath;
      for (const guard of _guards) {
        const allowed = await guard(path, prevPath);
        if (!allowed) return;
      }
      _currentPath = path;
      let matched = false;
      for (const route of _routes) {
        const m = path.match(route.regex);
        if (m) {
          const params = {};
          route.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(m[i + 1] || "");
          });
          const match = {
            pattern: route.pattern,
            params,
            path
          };
          try {
            route.handler(match);
          } catch (_) {
          }
          for (const listener of _changeListeners) {
            try {
              listener(match);
            } catch (_) {
            }
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        for (const listener of _changeListeners) {
          try {
            listener(null);
          } catch (_) {
          }
        }
      }
    }
    const mod = {
      meta: {
        name: "router",
        version: "0.1.0",
        description: "Hash-based mini router for multi-view apps",
        category: "util",
        dependencies: []
      },
      init(_ctx) {
        _currentPath = (window.location.hash || "#/").slice(1);
        _hashHandler = () => {
          _dispatch();
        };
        window.addEventListener("hashchange", _hashHandler);
        const api = {
          route(pattern, handler) {
            const { regex, paramNames } = _compilePattern(pattern);
            const entry = { pattern, regex, paramNames, handler };
            _routes.push(entry);
            _dispatch();
            return () => {
              _routes = _routes.filter((r) => r !== entry);
            };
          },
          navigate(path) {
            if (!path.startsWith("#")) path = "#" + path;
            window.location.hash = path;
          },
          current() {
            return _currentPath;
          },
          guard(fn) {
            _guards.push(fn);
            return () => {
              _guards = _guards.filter((g) => g !== fn);
            };
          },
          onChange(handler) {
            _changeListeners.push(handler);
            return () => {
              _changeListeners = _changeListeners.filter((h) => h !== handler);
            };
          },
          back() {
            history.back();
          }
        };
        return api;
      },
      destroy() {
        if (_hashHandler) {
          window.removeEventListener("hashchange", _hashHandler);
          _hashHandler = null;
        }
        _routes = [];
        _guards = [];
        _changeListeners = [];
      }
    };
    return mod;
  };

  // src/modules/form.ts
  var formModule = () => {
    let _bindings = [];
    const mod = {
      meta: {
        name: "form",
        version: "0.1.0",
        description: "Form binding and validation",
        category: "util",
        dependencies: []
      },
      init(ctx) {
        const connection = ctx.hasModule("connection") ? ctx.getModule("connection") : null;
        function _validateField(value, rule) {
          if (rule.required && !value.trim()) {
            return rule.messages?.required ?? "This field is required";
          }
          if (rule.minLength && value.length < rule.minLength) {
            return rule.messages?.minLength ?? `Minimum ${rule.minLength} characters`;
          }
          if (rule.maxLength && value.length > rule.maxLength) {
            return rule.messages?.maxLength ?? `Maximum ${rule.maxLength} characters`;
          }
          if (rule.pattern && !rule.pattern.test(value)) {
            return rule.messages?.pattern ?? "Invalid format";
          }
          if (rule.validate) {
            return rule.validate(value);
          }
          return null;
        }
        function _showError(input, msg, errorClass, errorMsgClass) {
          input.classList.add(errorClass);
          const existing = input.parentElement?.querySelector(`.${errorMsgClass}`);
          if (existing) existing.remove();
          const errEl = document.createElement("span");
          errEl.className = errorMsgClass;
          errEl.textContent = msg;
          input.parentElement?.appendChild(errEl);
        }
        function _clearError(input, errorClass, errorMsgClass) {
          input.classList.remove(errorClass);
          const existing = input.parentElement?.querySelector(`.${errorMsgClass}`);
          if (existing) existing.remove();
        }
        const api = {
          bind(selector, schema) {
            const form = typeof selector === "string" ? document.querySelector(selector) : selector;
            if (!form) {
              throw new Error(`[ZRO:form] Form not found: ${selector}`);
            }
            const errorClass = schema.errorClass ?? "zro-field-error";
            const errorMsgClass = schema.errorMsgClass ?? "zro-error-msg";
            const cleanups = [];
            for (const [fieldName, rule] of Object.entries(schema.fields)) {
              const input = form.elements.namedItem(fieldName);
              if (!input) continue;
              const handler = () => {
                const value = input.value;
                const error = _validateField(value, rule);
                if (error) {
                  _showError(input, error, errorClass, errorMsgClass);
                } else {
                  _clearError(input, errorClass, errorMsgClass);
                }
              };
              input.addEventListener("input", handler);
              cleanups.push(() => input.removeEventListener("input", handler));
            }
            const submitHandler = async (e) => {
              e.preventDefault();
              const errors = binding.validate();
              if (Object.keys(errors).length > 0) return;
              const data = binding.getData();
              if (schema.onSubmit) {
                await schema.onSubmit(data);
              } else if (schema.submit && connection) {
                try {
                  await connection.invoke(schema.submit, data);
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  const errEl = form.querySelector(`.${errorMsgClass}[data-server-error]`) || document.createElement("span");
                  errEl.className = errorMsgClass;
                  errEl.setAttribute("data-server-error", "true");
                  errEl.textContent = message;
                  if (!errEl.parentElement) form.appendChild(errEl);
                }
              }
            };
            form.addEventListener("submit", submitHandler);
            cleanups.push(() => form.removeEventListener("submit", submitHandler));
            const binding = {
              validate() {
                const errors = {};
                for (const [fieldName, rule] of Object.entries(schema.fields)) {
                  const input = form.elements.namedItem(fieldName);
                  if (!input) continue;
                  const error = _validateField(input.value, rule);
                  if (error) {
                    errors[fieldName] = error;
                    _showError(input, error, errorClass, errorMsgClass);
                  } else {
                    _clearError(input, errorClass, errorMsgClass);
                  }
                }
                return errors;
              },
              getData() {
                const data = {};
                for (const fieldName of Object.keys(schema.fields)) {
                  const input = form.elements.namedItem(fieldName);
                  if (input) data[fieldName] = input.value;
                }
                return data;
              },
              setData(data) {
                for (const [key, value] of Object.entries(data)) {
                  const input = form.elements.namedItem(key);
                  if (input) input.value = value;
                }
              },
              reset() {
                form.reset();
                for (const fieldName of Object.keys(schema.fields)) {
                  const input = form.elements.namedItem(fieldName);
                  if (input) _clearError(input, errorClass, errorMsgClass);
                }
                const serverErr = form.querySelector(`[data-server-error]`);
                if (serverErr) serverErr.remove();
              },
              setFieldError(field, message) {
                const input = form.elements.namedItem(field);
                if (input) _showError(input, message, errorClass, errorMsgClass);
              },
              destroy() {
                for (const fn of cleanups) fn();
                cleanups.length = 0;
              }
            };
            _bindings.push(binding.destroy);
            return binding;
          }
        };
        return api;
      },
      destroy() {
        for (const fn of _bindings) fn();
        _bindings = [];
      }
    };
    return mod;
  };

  // src/modules/dev.ts
  var LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  var LOG_COLORS = {
    debug: "#888",
    info: "#4fc3f7",
    warn: "#ff9800",
    error: "#f44336"
  };
  var devModule = () => {
    let _level = "debug";
    let _devMode = false;
    let _slug = "";
    let _cleanups = [];
    function _shouldLog(level) {
      return _devMode && LOG_LEVELS[level] >= LOG_LEVELS[_level];
    }
    function _log(level, args) {
      if (!_shouldLog(level)) return;
      const timestamp = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      const prefix = `%c${timestamp} [${level.toUpperCase()}] ${_slug}`;
      const style = `color: ${LOG_COLORS[level]}; font-weight: bold;`;
      console[level === "debug" ? "log" : level](prefix, style, ...args);
    }
    const mod = {
      meta: {
        name: "dev",
        version: "0.1.0",
        description: "Development tools, logging, and tracing",
        category: "dev",
        dependencies: []
      },
      init(ctx) {
        _devMode = ctx.config.debug ?? false;
        _slug = ctx.config.slug;
        if (_devMode) {
          ctx.log("Dev module active \u2014 structured logging enabled");
        }
        const api = {
          debug(...args) {
            _log("debug", args);
          },
          info(...args) {
            _log("info", args);
          },
          warn(...args) {
            _log("warn", args);
          },
          error(...args) {
            _log("error", args);
          },
          setLevel(level) {
            _level = level;
          },
          trace() {
            if (!_devMode) return () => {
            };
            const connection = ctx.hasModule("connection") ? ctx.getModule("connection") : null;
            if (!connection) {
              console.warn("[ZRO:dev] Cannot trace \u2014 connection module not available");
              return () => {
              };
            }
            const origOn = connection.on;
            const tracedEvents = /* @__PURE__ */ new Set();
            const allEventHandler = (event) => (payload) => {
              _log("debug", [`\u2190 event ${event}`, payload]);
            };
            console.log(
              "%c[ZRO:dev] Trace started \u2014 incoming events will be logged",
              "color: #4fc3f7; font-weight: bold;"
            );
            return () => {
              console.log(
                "%c[ZRO:dev] Trace stopped",
                "color: #888; font-weight: bold;"
              );
            };
          },
          inspect() {
            if (!_devMode) return;
            console.group("%c[ZRO:dev] Inspection", "color: #4fc3f7; font-weight: bold;");
            console.log("Slug:", _slug);
            console.log("Debug mode:", _devMode);
            console.log("Log level:", _level);
            if (ctx.hasModule("transport")) {
              const transport = ctx.getModule("transport");
              console.log("Transport state:", transport.state);
            }
            if (ctx.hasModule("connection")) {
              const conn = ctx.getModule("connection");
              console.log("Instance ID:", conn.instanceId);
              console.log("Connection state:", conn.connectionState);
            }
            console.log("Modules available:");
            const moduleNames = [
              "transport",
              "connection",
              "state",
              "shell",
              "http",
              "lifecycle",
              "replay-buffer",
              "theme",
              "clipboard",
              "dnd",
              "keybindings",
              "notifications",
              "ipc",
              "storage",
              "router",
              "form",
              "window-mode",
              "taskbar",
              "launcher",
              "dev"
            ];
            for (const name of moduleNames) {
              if (ctx.hasModule(name)) {
                console.log(`  \u2713 ${name}`);
              }
            }
            console.groupEnd();
          },
          get isDevMode() {
            return _devMode;
          }
        };
        return api;
      },
      destroy() {
        for (const fn of _cleanups) fn();
        _cleanups = [];
      }
    };
    return mod;
  };

  // src/client.ts
  var DEFAULT_MODULES = [
    // Core
    transportModule,
    connectionModule,
    stateModule,
    lifecycleModule,
    replayBufferModule,
    // Shell
    shellModule,
    windowModeModule,
    taskbarModule,
    launcherModule,
    // Data
    httpModule,
    storageModule,
    ipcModule,
    // UX
    themeModule,
    clipboardModule,
    dndModule,
    keybindingsModule,
    notificationsModule,
    // Util
    routerModule,
    formModule,
    // Dev
    devModule
  ];
  var ZroApp = class {
    constructor(registry, config) {
      this._registry = registry;
      this._config = config;
    }
    /** Access the transport module API. */
    get transport() {
      return this._registry.get("transport");
    }
    /** Access the connection module API (invoke/on/emit). */
    get connection() {
      return this._registry.get("connection");
    }
    /** Access the persistent state module API. */
    get state() {
      return this._registry.get("state");
    }
    /** Access the shell integration module API. */
    get shell() {
      return this._registry.get("shell");
    }
    /** Access the HTTP client module API. */
    get http() {
      return this._registry.get("http");
    }
    /** Access the lifecycle module API. */
    get lifecycle() {
      return this._registry.get("lifecycle");
    }
    /** Access the replay buffer module API. */
    get replayBuffer() {
      return this._registry.get("replay-buffer");
    }
    /** Access the theme module API. */
    get theme() {
      return this._registry.get("theme");
    }
    /** Access the clipboard module API. */
    get clipboard() {
      return this._registry.get("clipboard");
    }
    /** Access the drag-and-drop module API. */
    get dnd() {
      return this._registry.get("dnd");
    }
    /** Access the keybindings module API. */
    get keybindings() {
      return this._registry.get("keybindings");
    }
    /** Access the notifications module API. */
    get notifications() {
      return this._registry.get("notifications");
    }
    /** Access the IPC module API. */
    get ipc() {
      return this._registry.get("ipc");
    }
    /** Access the scoped storage module API. */
    get storage() {
      return this._registry.get("storage");
    }
    /** Access the router module API. */
    get router() {
      return this._registry.get("router");
    }
    /** Access the form module API. */
    get form() {
      return this._registry.get("form");
    }
    /** Access the window mode module API. */
    get windowMode() {
      return this._registry.get("window-mode");
    }
    /** Access the taskbar module API. */
    get taskbar() {
      return this._registry.get("taskbar");
    }
    /** Access the launcher module API. */
    get launcher() {
      return this._registry.get("launcher");
    }
    /** Access the dev tools module API. */
    get dev() {
      return this._registry.get("dev");
    }
    /** Get any module by name. */
    module(name) {
      return this._registry.get(name);
    }
    /** Check if a module is available. */
    hasModule(name) {
      return this._registry.has(name);
    }
    /** List all initialized modules. */
    modules() {
      return this._registry.list();
    }
    /** App config. */
    get config() {
      return this._config;
    }
    /** Shortcut: invoke a backend command. */
    invoke(command, params) {
      return this.connection.invoke(command, params);
    }
    /** Shortcut: listen for a backend event. */
    on(event, handler) {
      this.connection.on(event, handler);
    }
    /** Shortcut: remove a backend event listener. */
    off(event, handler) {
      this.connection.off(event, handler);
    }
    /** Shortcut: fire-and-forget event to backend. */
    emit(event, data) {
      this.connection.emit(event, data);
    }
    /** Destroy the app and all modules. */
    async destroy() {
      await this._registry.destroy();
    }
  };
  function _parseUrlPath2() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const slug = parts[0] || null;
    const second = parts[1] || null;
    const instanceId = second && second !== "static" && second !== "api" ? second : null;
    return { slug, instanceId };
  }
  var ZroClient = {
    /**
     * Create a new ZRO app instance with all modules initialized.
     * This is the recommended modern API.
     *
     * @example
     *   const app = await ZroClient.create({
     *     slug: 'my-app',
     *     onConnect: (info) => console.log('Connected!', info),
     *   });
     */
    async create(config, extraModules) {
      const registry = new ModuleRegistry();
      registry.registerAll(DEFAULT_MODULES);
      if (extraModules) {
        registry.registerAll(extraModules);
      }
      await registry.init(config);
      return new ZroApp(registry, config);
    },
    /**
     * Legacy-compatible connect() — returns a Promise<ZroApp> that
     * resolves when connected. Wraps create() for backward compatibility.
     *
     * @example
     *   const app = await ZroClient.connect({ slug: 'echo' });
     *   const result = await app.invoke('ping');
     */
    async connect(options) {
      return this.create(options);
    },
    /** Whether the app is running inside the Shell (in an iframe). */
    get isInShell() {
      try {
        return window !== window.parent;
      } catch (_) {
        return true;
      }
    },
    /** Auto-detect the app slug from the current URL. */
    slugFromUrl() {
      return _parseUrlPath2().slug;
    },
    /** Auto-detect the instance ID from the current URL. */
    instanceIdFromUrl() {
      return _parseUrlPath2().instanceId;
    },
    /** Whether SharedWorker transport is available. */
    get hasSharedWorker() {
      return typeof SharedWorker !== "undefined";
    },
    /**
     * HTTP API call (standalone, no app instance needed).
     * Preserved for backward compatibility.
     */
    async api(slug, method, path, body, query) {
      const urlInfo = _parseUrlPath2();
      const prefix = urlInfo.slug === slug && urlInfo.instanceId ? `/${slug}/${urlInfo.instanceId}` : `/${slug}`;
      let url = `${prefix}/api${path}`;
      if (query) {
        const params = new URLSearchParams(query);
        url += `?${params.toString()}`;
      }
      const opts = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin"
      };
      if (body && method.toUpperCase() !== "GET") {
        opts.body = JSON.stringify(body);
      }
      const resp = await fetch(url, opts);
      if (!resp.ok) {
        const text2 = await resp.text();
        let parsed;
        try {
          parsed = JSON.parse(text2);
        } catch {
          parsed = { error: text2 };
        }
        const err = new Error(parsed.error || `HTTP ${resp.status}`);
        err.status = resp.status;
        err.data = parsed;
        throw err;
      }
      const text = await resp.text();
      if (!text) return {};
      return JSON.parse(text);
    }
  };

  // src/browser.ts
  var LegacyConnection = class {
    constructor(options) {
      this._app = null;
      this._queue = [];
      this._listeners = {};
      this._instanceId = null;
      this._connectionState = "connecting";
      this._slug = options.slug;
      ZroClient.create(options).then((app) => {
        this._app = app;
        this._instanceId = app.connection.instanceId;
        this._connectionState = app.connection.connectionState;
        for (const [event, handlers] of Object.entries(this._listeners)) {
          for (const handler of handlers) {
            app.connection.on(event, handler);
          }
        }
        for (const fn of this._queue) fn();
        this._queue = [];
      });
    }
    get connectionState() {
      return this._app?.connection.connectionState ?? this._connectionState;
    }
    get instanceId() {
      return this._app?.connection.instanceId ?? this._instanceId;
    }
    invoke(command, params, options) {
      if (this._app) {
        return this._app.connection.invoke(command, params, options);
      }
      return new Promise((resolve, reject) => {
        this._queue.push(() => {
          this._app.connection.invoke(command, params, options).then(resolve, reject);
        });
      });
    }
    listen(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
      if (this._app) {
        this._app.connection.on(event, handler);
      }
    }
    unlisten(event, handler) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter((fn) => fn !== handler);
      }
      if (this._app) {
        this._app.connection.off(event, handler);
      }
    }
    on(event, handler) {
      this.listen(event, handler);
    }
    off(event, handler) {
      this.unlisten(event, handler);
    }
    emit(event, data) {
      if (this._app) {
        this._app.connection.emit(event, data);
      } else {
        this._queue.push(() => this._app.connection.emit(event, data));
      }
    }
    send(event, data) {
      this.emit(event, data);
    }
    get state() {
      const self = this;
      return {
        save(key, value) {
          if (self._app) return self._app.state.save(key, value);
          return new Promise((resolve, reject) => {
            self._queue.push(() => self._app.state.save(key, value).then(resolve, reject));
          });
        },
        restore(key) {
          if (self._app) return self._app.state.restore(key);
          return new Promise((resolve, reject) => {
            self._queue.push(() => self._app.state.restore(key).then(resolve, reject));
          });
        },
        delete(key) {
          if (self._app) return self._app.state.delete(key);
          return new Promise((resolve, reject) => {
            self._queue.push(() => self._app.state.delete(key).then(resolve, reject));
          });
        },
        keys() {
          if (self._app) return self._app.state.keys();
          return new Promise((resolve, reject) => {
            self._queue.push(() => self._app.state.keys().then(resolve, reject));
          });
        }
      };
    }
    close() {
      if (this._app) {
        this._app.connection.close();
      } else {
        this._queue.push(() => this._app.connection.close());
      }
    }
  };
  function _parseUrlPath3() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const slug = parts[0] || null;
    const second = parts[1] || null;
    const instanceId = second && second !== "static" && second !== "api" ? second : null;
    return { slug, instanceId };
  }
  var _shellInstance = null;
  var BrowserZroClient = {
    /**
     * Modern API — create with all modules.
     */
    create: ZroClient.create.bind(ZroClient),
    /**
     * Legacy API — returns a LegacyConnection that handles async init.
     * Backward-compatible: returns synchronously with queued operations.
     */
    connect(options) {
      return new LegacyConnection(options);
    },
    get isInShell() {
      try {
        return window !== window.parent;
      } catch (_) {
        return true;
      }
    },
    get shell() {
      if (!_shellInstance) {
        const mod = shellModule();
        _shellInstance = mod.init({
          getModule: () => {
            throw new Error("No modules in standalone shell");
          },
          hasModule: () => false,
          config: { slug: "" },
          log: () => {
          }
        });
      }
      return _shellInstance;
    },
    slugFromUrl() {
      return _parseUrlPath3().slug;
    },
    instanceIdFromUrl() {
      return _parseUrlPath3().instanceId;
    },
    get hasSharedWorker() {
      return typeof SharedWorker !== "undefined";
    },
    api: ZroClient.api.bind(ZroClient),
    // Expose module system for advanced usage
    ModuleRegistry,
    modules: {
      transport: transportModule,
      connection: connectionModule,
      state: stateModule,
      shell: shellModule,
      http: httpModule,
      lifecycle: lifecycleModule,
      replayBuffer: replayBufferModule,
      theme: themeModule,
      clipboard: clipboardModule,
      dnd: dndModule,
      keybindings: keybindingsModule,
      notifications: notificationsModule,
      ipc: ipcModule,
      storage: storageModule,
      router: routerModule,
      form: formModule,
      windowMode: windowModeModule,
      taskbar: taskbarModule,
      launcher: launcherModule,
      dev: devModule
    }
  };
  window.ZroClient = BrowserZroClient;
  return __toCommonJS(browser_exports);
})();
//# sourceMappingURL=zro-client.js.map
