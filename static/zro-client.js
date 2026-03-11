/**
 * zro-client.js — Frontend SDK for ZRO applications.
 *
 * Three normalized communication channels:
 *
 * 1. WS invoke (req/resp):
 *    const result = await conn.invoke('command_name', { param1: 'value' });
 *
 * 2. WS events (fire-and-forget / push):
 *    conn.emit('event_name', data);               // send to backend
 *    conn.on('event_name', (payload) => { ... });  // receive from backend
 *
 * 3. HTTP API (req/resp):
 *    const data = await ZroClient.api(slug, 'GET', '/items');
 *
 * Additional:
 *    conn.state.save(key, value)  // persist UI state (SQLite-backed)
 *    ZroClient.shell.*            // Shell window management (postMessage)
 *
 * Transport layer:
 *    Uses a SharedWorker (/static/zro-shared-worker.js) that owns the single
 *    WebSocket connection. All tabs/iframes share the same WS through ports.
 *    When a window is popped out or moved back to the shell, the same WS
 *    connection persists — zero interruption for streams, commands, or state.
 *    Falls back to direct WebSocket if SharedWorker is unavailable.
 */
(function () {
    'use strict';

    // ── Debug logging ─────────────────────────────────
    function _log() {
        var args = ['[ZRO]'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    // ── Instance ID helpers ──────────────────────────────
    let _instanceCounter = 0;

    /**
     * Parse URL path to extract slug and optional instanceId.
     * Supports:  /{slug}/  →  { slug, instanceId: null }
     *            /{slug}/{instanceId}/  →  { slug, instanceId }
     */
    function _parseUrlPath() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        const slug = parts[0] || null;
        const second = parts[1] || null;
        const instanceId = (second && second !== 'static' && second !== 'api') ? second : null;
        return { slug, instanceId };
    }

    // ── SharedWorker singleton ───────────────────────────
    //
    // One SharedWorker per origin. All ZroConnection instances in this
    // page share the same worker port (but each registers its own instanceId).

    let _worker = null;
    let _workerPort = null;
    let _workerSupported = typeof SharedWorker !== 'undefined';

    /** Callbacks registered on the worker port, keyed by instanceId. */
    const _portCallbacks = new Map();

    /** Global state listeners (for connection state changes). */
    const _stateListeners = new Set();

    function _getWorkerPort() {
        if (_workerPort) return _workerPort;
        if (!_workerSupported) {
            _log('SharedWorker NOT supported in this context');
            return null;
        }

        try {
            _log('Creating SharedWorker("/static/zro-shared-worker.js", { name: "zro" })');
            _worker = new SharedWorker('/static/zro-shared-worker.js', { name: 'zro' });
            _workerPort = _worker.port;

            _workerPort.onmessage = function (e) {
                var data = e.data;

                // Relay worker logs to page console
                if (data.type === 'log') {
                    console.log(data.msg);
                    return;
                }

                if (data.type === 'state') {
                    _log('WORKER state:', data.state);
                    for (var cb of _stateListeners) {
                        try { cb(data.state); } catch (_) {}
                    }
                    return;
                }

                if (data.type === 'registered' && data.instanceId) {
                    _log('WORKER registered instanceId=' + data.instanceId, 'reconnected=' + data.reconnected);
                    var regCb = _portCallbacks.get(data.instanceId);
                    if (regCb) {
                        regCb({ type: 'registered', reconnected: data.reconnected });
                    } else {
                        _log('WORKER registered — NO callback for', data.instanceId, '(callbacks:', [..._portCallbacks.keys()].join(', '), ')');
                    }
                    return;
                }

                if (data.type === 'message' && data.instanceId) {
                    var payload = data.payload;
                    _log('WORKER message instanceId=' + data.instanceId, 'type=' + (payload && payload.type), payload && payload.event ? 'event=' + payload.event : '');
                    var msgCb = _portCallbacks.get(data.instanceId);
                    if (msgCb) {
                        msgCb({ type: 'ws_message', payload: data.payload });
                    } else {
                        _log('WORKER message — NO callback for', data.instanceId, '(callbacks:', [..._portCallbacks.keys()].join(', '), ')');
                    }
                    return;
                }

                _log('WORKER unknown message type:', data.type, JSON.stringify(data).substring(0, 200));
            };

            _workerPort.start();
            _log('SharedWorker port started successfully');
            return _workerPort;
        } catch (e) {
            _log('SharedWorker FAILED:', e.message);
            _workerSupported = false;
            return null;
        }
    }

    // ── ZroConnection ────────────────────────────────────

    class ZroConnection {
        constructor(options) {
            this._slug = options.slug;
            var urlInfo = _parseUrlPath();
            this._instanceId = options.instanceId
                || (urlInfo.slug === options.slug ? urlInfo.instanceId : null)
                || (options.slug + '-' + (++_instanceCounter));
            _log('NEW ZroConnection slug=' + this._slug, 'instanceId=' + this._instanceId, 'url=' + window.location.pathname, 'inShell=' + (window !== window.parent));
            this._onConnect = options.onConnect || function () {};
            this._onDisconnect = options.onDisconnect || function () {};
            this._onError = options.onError || function () {};
            this._listeners = {};
            this._pendingInvokes = {};
            this._connectionState = 'connecting';
            this._registered = false;
            this._closed = false;

            // Transport
            this._useWorker = false;
            this._ws = null;
            this._reconnectAttempts = 0;
            this._maxReconnectDelay = 30000;
            this._reconnectDelay = 1000;
            this._stateCallback = null;

            this._initTransport();
        }

        get connectionState() { return this._connectionState; }
        get instanceId() { return this._instanceId; }

        // ── Transport initialization ───────────────────

        _initTransport() {
            var port = _getWorkerPort();
            if (port) {
                this._useWorker = true;
                _log('TRANSPORT: SharedWorker for', this._slug, 'instanceId=' + this._instanceId);
                this._initSharedWorkerTransport(port);
            } else {
                this._useWorker = false;
                _log('TRANSPORT: Direct WebSocket (fallback) for', this._slug, 'instanceId=' + this._instanceId);
                this._initDirectWsTransport();
            }
        }

        // ── SharedWorker transport ─────────────────────

        _initSharedWorkerTransport(port) {
            var self = this;

            // Register instance callback
            _portCallbacks.set(this._instanceId, function (msg) {
                self._handleWorkerMessage(msg);
            });
            _log('Registered port callback for', this._instanceId, '(total callbacks:', _portCallbacks.size, ')');

            // Listen for global state changes
            this._stateCallback = function (state) {
                if (state === 'connected') {
                    self._connectionState = 'connected';
                } else if (state === 'disconnected') {
                    self._connectionState = 'disconnected';
                    self._registered = false;
                    self._onDisconnect();
                }
            };
            _stateListeners.add(this._stateCallback);

            // Register with the SharedWorker
            var regMsg = { type: 'register', instanceId: this._instanceId, slug: this._slug };
            _log('Sending to worker:', JSON.stringify(regMsg));
            port.postMessage(regMsg);
        }

        _handleWorkerMessage(msg) {
            if (this._closed) { _log(this._instanceId, 'handleWorkerMessage IGNORED (closed)'); return; }

            switch (msg.type) {
                case 'registered':
                    this._registered = true;
                    this._connectionState = 'connected';
                    _log(this._instanceId, 'REGISTERED reconnected=' + !!msg.reconnected);
                    this._onConnect({ reconnected: !!msg.reconnected });
                    break;

                case 'ws_message':
                    this._handleWsMessage(msg.payload);
                    break;

                default:
                    _log(this._instanceId, 'handleWorkerMessage unknown type:', msg.type);
            }
        }

        // ── Direct WebSocket transport (fallback) ──────

        _initDirectWsTransport() {
            this._connectDirect();
        }

        _connectDirect() {
            if (this._closed) return;
            var self = this;

            var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var url = proto + '//' + location.host + '/ws';
            _log(this._instanceId, 'DIRECT WS connecting to', url);

            try {
                this._ws = new WebSocket(url);
            } catch (e) {
                _log(this._instanceId, 'DIRECT WS connect ERROR:', e.message);
                this._onError(e);
                this._scheduleDirectReconnect();
                return;
            }

            this._ws.onopen = function () {
                _log(self._instanceId, 'DIRECT WS OPEN — sending register');
                self._connectionState = 'connected';
                self._reconnectAttempts = 0;
                self._reconnectDelay = 1000;
                self._ws.send(JSON.stringify({
                    type: 'register',
                    instance: self._instanceId,
                    app: self._slug,
                }));
            };

            this._ws.onclose = function (ev) {
                _log(self._instanceId, 'DIRECT WS CLOSE code=' + ev.code, 'reason=' + ev.reason);
                self._connectionState = 'disconnected';
                self._registered = false;
                self._onDisconnect();
                self._scheduleDirectReconnect();
            };

            this._ws.onerror = function (e) {
                _log(self._instanceId, 'DIRECT WS ERROR');
                self._onError(e);
            };

            this._ws.onmessage = function (e) {
                try {
                    var msg = JSON.parse(e.data);
                    _log(self._instanceId, 'DIRECT WS RECV type=' + msg.type, 'instance=' + msg.instance, msg.event ? 'event=' + msg.event : '');
                    if (msg.type === 'registered' && msg.instance === self._instanceId) {
                        self._registered = true;
                        self._onConnect({ reconnected: !!msg.reconnected });
                        return;
                    }
                    if (msg.instance && msg.instance !== self._instanceId) return;
                    self._handleWsMessage(msg);
                } catch (err) {
                    // malformed
                }
            };
        }

        _scheduleDirectReconnect() {
            if (this._closed) return;
            var self = this;
            this._reconnectAttempts++;
            var delay = Math.min(
                this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1),
                this._maxReconnectDelay
            );
            setTimeout(function () { self._connectDirect(); }, delay);
        }

        // ── Shared message handling ────────────────────

        _handleWsMessage(msg) {
            // Command response
            if (msg.type === 'response' && msg.id) {
                var pending = this._pendingInvokes[msg.id];
                if (pending) {
                    clearTimeout(pending.timer);
                    delete this._pendingInvokes[msg.id];
                    _log(this._instanceId, 'RESPONSE id=' + msg.id, msg.error ? 'ERROR: ' + msg.error : 'OK');
                    if (msg.error) {
                        pending.reject(new Error(msg.error));
                    } else {
                        pending.resolve(msg.result);
                    }
                } else {
                    _log(this._instanceId, 'RESPONSE id=' + msg.id, 'NO pending invoke!');
                }
                return;
            }

            // Backend event
            if (msg.type === 'event' && msg.event) {
                var listeners = this._listeners[msg.event];
                var count = listeners ? listeners.length : 0;
                _log(this._instanceId, 'EVENT', msg.event, 'listeners=' + count, msg.payload ? 'payload=' + JSON.stringify(msg.payload).substring(0, 100) : '');
                if (listeners) {
                    listeners.forEach(function (fn) {
                        try { fn(msg.payload); } catch (err) { console.error('Listener error:', err); }
                    });
                }
                return;
            }

            // Error from server
            if (msg.type === 'error') {
                _log(this._instanceId, 'SERVER ERROR:', msg.error);
                return;
            }

            _log(this._instanceId, 'UNHANDLED WS msg type=' + msg.type);
        }

        // ── Send helper ────────────────────────────────

        _sendRaw(payload) {
            if (this._useWorker) {
                var port = _getWorkerPort();
                if (port) {
                    _log(this._instanceId, 'SEND (worker) type=' + payload.type, payload.command || payload.event || '');
                    port.postMessage({
                        type: 'send',
                        instanceId: this._instanceId,
                        payload: payload,
                    });
                } else {
                    _log(this._instanceId, 'SEND FAILED — no worker port!');
                }
            } else {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    _log(this._instanceId, 'SEND (direct) type=' + payload.type, payload.command || payload.event || '');
                    this._ws.send(JSON.stringify(payload));
                } else {
                    _log(this._instanceId, 'SEND FAILED — WS not open, readyState=' + (this._ws ? this._ws.readyState : 'null'));
                }
            }
        }

        // ── Public API ─────────────────────────────────

        /**
         * Invoke a backend command (req/resp).
         * @param {string} command
         * @param {Object} [params={}]
         * @param {Object} [options]
         * @param {number} [options.timeout=30000]
         * @returns {Promise<*>}
         */
        invoke(command, params, options) {
            var self = this;
            var timeout = (options && options.timeout) || 30000;
            var id = crypto.randomUUID();

            return new Promise(function (resolve, reject) {
                var timer = setTimeout(function () {
                    delete self._pendingInvokes[id];
                    reject(new Error("invoke('" + command + "') timed out"));
                }, timeout);

                self._pendingInvokes[id] = { resolve: resolve, reject: reject, timer: timer };

                self._sendRaw({
                    type: 'invoke',
                    id: id,
                    instance: self._instanceId,
                    command: command,
                    params: params || {},
                });
            });
        }

        /**
         * Listen for backend events.
         */
        listen(event, handler) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(handler);
        }

        /**
         * Remove an event listener.
         */
        unlisten(event, handler) {
            if (!this._listeners[event]) return;
            this._listeners[event] = this._listeners[event].filter(function (fn) { return fn !== handler; });
        }

        /** Alias for listen(). */
        on(event, handler) { return this.listen(event, handler); }
        /** Alias for unlisten(). */
        off(event, handler) { return this.unlisten(event, handler); }
        /** Alias for emit(). */
        send(event, data) { return this.emit(event, data); }

        /**
         * Persistent state — save/restore UI state across sessions.
         */
        get state() {
            var self = this;
            return {
                save: function (key, value) {
                    return self.invoke('__state:save', {
                        key: key,
                        value: JSON.stringify(value),
                    });
                },
                restore: function (key) {
                    return self.invoke('__state:restore', { key: key }).then(function (raw) {
                        return raw ? JSON.parse(raw) : null;
                    });
                },
                delete: function (key) {
                    return self.invoke('__state:delete', { key: key });
                },
                keys: function () {
                    return self.invoke('__state:keys');
                },
            };
        }

        /**
         * Send a fire-and-forget event to the backend via WS.
         */
        emit(event, data) {
            this._sendRaw({
                type: 'emit',
                instance: this._instanceId,
                event: event,
                data: data || null,
            });
        }

        /** Close the connection — sends unregister first. */
        close() {
            this._closed = true;

            if (this._useWorker) {
                _portCallbacks.delete(this._instanceId);
                if (this._stateCallback) _stateListeners.delete(this._stateCallback);
                var port = _getWorkerPort();
                if (port) {
                    port.postMessage({
                        type: 'unregister',
                        instanceId: this._instanceId,
                    });
                }
            } else {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    try {
                        this._ws.send(JSON.stringify({
                            type: 'unregister',
                            instance: this._instanceId,
                        }));
                    } catch (_) {}
                    this._ws.close();
                }
            }

            // Reject all pending
            var invokes = this._pendingInvokes;
            this._pendingInvokes = {};
            Object.keys(invokes).forEach(function (k) {
                clearTimeout(invokes[k].timer);
                invokes[k].reject(new Error('Connection closed'));
            });
        }
    }

    // ── Shell API (postMessage protocol) ────────────────

    class ShellAPI {
        constructor() {
            this._pending = new Map();
            this._listeners = new Map();
            this._reqId = 0;
            var self = this;

            window.addEventListener('message', function (e) {
                if (!e.data || typeof e.data.type !== 'string') return;

                if (e.data.type === 'zro:shell:response' && e.data.requestId) {
                    var resolver = self._pending.get(e.data.requestId);
                    if (resolver) {
                        self._pending.delete(e.data.requestId);
                        if (e.data.success === false) {
                            resolver.reject(new Error((e.data.payload && e.data.payload.error) || 'Shell API error'));
                        } else {
                            resolver.resolve(e.data.payload);
                        }
                    }
                }

                if (e.data.type === 'zro:shell:event' && e.data.event) {
                    var handlers = self._listeners.get(e.data.event) || [];
                    handlers.forEach(function (h) {
                        try { h(e.data.payload); } catch (err) { console.error('ShellAPI listener error:', err); }
                    });
                }
            });
        }

        _send(method, payload) {
            var self = this;
            return new Promise(function (resolve, reject) {
                var requestId = 'req_' + (++self._reqId);
                self._pending.set(requestId, { resolve: resolve, reject: reject });
                parent.postMessage({
                    type: 'zro:shell:' + method,
                    requestId: requestId,
                    payload: payload || {},
                }, '*');
                setTimeout(function () {
                    if (self._pending.has(requestId)) {
                        self._pending.delete(requestId);
                        reject(new Error('Shell API timeout: ' + method));
                    }
                }, 5000);
            });
        }

        setTitle(title) { return this._send('setTitle', { title: title }); }
        notify(opts) { return this._send('notify', opts); }
        setBadgeCount(count) { return this._send('setBadgeCount', { count: count }); }
        requestFocus() { return this._send('requestFocus', {}); }
        minimize() { return this._send('minimize', {}); }
        maximize() { return this._send('maximize', {}); }
        restore() { return this._send('restore', {}); }
        close() { return this._send('close', {}); }
        confirmClose() { parent.postMessage({ type: 'zro:shell:confirmClose' }, '*'); }
        cancelClose() { parent.postMessage({ type: 'zro:shell:cancelClose' }, '*'); }
        setProgress(progress, type) { return this._send('setProgress', { progress: progress, type: type || 'normal' }); }
        getWindowInfo() { return this._send('getWindowInfo', {}); }

        on(event, handler) {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push(handler);
        }

        off(event, handler) {
            var arr = this._listeners.get(event);
            if (arr) this._listeners.set(event, arr.filter(function (h) { return h !== handler; }));
        }
    }

    class StandaloneShellStub {
        setTitle() { return Promise.resolve(); }
        notify() { return Promise.resolve(); }
        setBadgeCount() { return Promise.resolve(); }
        requestFocus() { return Promise.resolve(); }
        minimize() { return Promise.resolve(); }
        maximize() { return Promise.resolve(); }
        restore() { return Promise.resolve(); }
        close() { return Promise.resolve(); }
        confirmClose() {}
        cancelClose() {}
        setProgress() { return Promise.resolve(); }
        getWindowInfo() { return Promise.resolve(null); }
        on() {}
        off() {}
    }

    var _shellInstance = null;

    // ── Main API ─────────────────────────────────────────

    window.ZroClient = {
        /**
         * Create a connection to an app backend.
         * Uses SharedWorker transport (zero-interruption pop-out) when available,
         * falls back to direct WebSocket otherwise.
         */
        connect: function (options) {
            return new ZroConnection(options);
        },

        /** Whether the app is running inside the Shell (in an iframe). */
        get isInShell() {
            try { return window !== window.parent; } catch (_) { return true; }
        },

        /** Shell API — for apps to communicate with the Shell parent window. */
        get shell() {
            if (!_shellInstance) {
                _shellInstance = this.isInShell ? new ShellAPI() : new StandaloneShellStub();
            }
            return _shellInstance;
        },

        /** Auto-detect the app slug from the current URL path. */
        slugFromUrl: function () {
            return _parseUrlPath().slug;
        },

        /** Auto-detect the instance ID from the current URL path. */
        instanceIdFromUrl: function () {
            return _parseUrlPath().instanceId;
        },

        /** Whether SharedWorker transport is active. */
        get hasSharedWorker() {
            return _workerSupported && _workerPort !== null;
        },

        /**
         * HTTP API call to an app backend.
         */
        api: function (slug, method, path, body, query) {
            var urlInfo = _parseUrlPath();
            var prefix = (urlInfo.slug === slug && urlInfo.instanceId)
                ? '/' + slug + '/' + urlInfo.instanceId
                : '/' + slug;
            var url = prefix + '/api' + path;
            if (query) {
                var params = new URLSearchParams(query);
                url += '?' + params.toString();
            }
            var opts = {
                method: method.toUpperCase(),
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
            };
            if (body && method.toUpperCase() !== 'GET') {
                opts.body = JSON.stringify(body);
            }
            return fetch(url, opts).then(function (resp) {
                if (!resp.ok) {
                    return resp.text().then(function (text) {
                        var parsed;
                        try { parsed = JSON.parse(text); } catch (e) { parsed = { error: text }; }
                        var err = new Error(parsed.error || ('HTTP ' + resp.status));
                        err.status = resp.status;
                        err.data = parsed;
                        throw err;
                    });
                }
                return resp.text().then(function (text) {
                    if (!text) return {};
                    return JSON.parse(text);
                });
            });
        },
    };

    // "Back to Shell" button removed — the shell persists state and
    // auto-reclaims popped-out windows when the browser tab is closed.
})();
