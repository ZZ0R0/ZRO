(function () {
    'use strict';

    const SLUG = ZroClient.slugFromUrl() || 'terminal';
    const statusEl = document.getElementById('status');
    const container = document.getElementById('terminal-container');

    // Initialize xterm.js
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        theme: {
            background: '#1e1e2e',
            foreground: '#cdd6f4',
            cursor: '#89b4fa',
            cursorAccent: '#1e1e2e',
            selectionBackground: 'rgba(137, 180, 250, 0.3)',
            black: '#45475a',
            red: '#f38ba8',
            green: '#a6e3a1',
            yellow: '#f9e2af',
            blue: '#89b4fa',
            magenta: '#f5c2e7',
            cyan: '#94e2d5',
            white: '#bac2de',
            brightBlack: '#585b70',
            brightRed: '#f38ba8',
            brightGreen: '#a6e3a1',
            brightYellow: '#f9e2af',
            brightBlue: '#89b4fa',
            brightMagenta: '#f5c2e7',
            brightCyan: '#94e2d5',
            brightWhite: '#a6adc8',
        },
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    if (typeof WebLinksAddon !== 'undefined') {
        const webLinksAddon = new WebLinksAddon.WebLinksAddon();
        term.loadAddon(webLinksAddon);
    }

    term.open(container);
    fitAddon.fit();

    // WebSocket connection
    let conn = null;

    function setStatus(text, cls) {
        statusEl.textContent = text;
        statusEl.className = 'status' + (cls ? ' ' + cls : '');
    }

    conn = ZroClient.connect({
        slug: SLUG,
        onConnect: function (info) {
            console.log('[TERM] onConnect', info, 'instanceId=' + conn.instanceId, 'useWorker=' + ZroClient.hasSharedWorker);
            setStatus('Connected', 'connected');
            // Send initial resize
            const dims = fitAddon.proposeDimensions();
            if (dims) {
                conn.invoke('term_resize', { cols: dims.cols, rows: dims.rows });
            }
        },
        onDisconnect: function () {
            console.log('[TERM] onDisconnect');
            setStatus('Disconnected', 'error');
        },
        onError: function (e) {
            console.error('[TERM] WS error:', e);
        },
    });

    console.log('[TERM] Created connection, slug=' + SLUG, 'instanceId=' + conn.instanceId);

    // Receive terminal output from backend
    conn.on('term:output', function (data) {
        console.log('[TERM] term:output received, data.data length=' + (data && data.data ? data.data.length : 'null'));
        if (data && data.data) {
            term.write(data.data);
        }
    });

    // Shell exited
    conn.on('term:exit', function (data) {
        term.write('\r\n\x1b[31m[Process exited');
        if (data && data.code !== undefined) {
            term.write(' with code ' + data.code);
        }
        term.write(']\x1b[0m\r\n');
        setStatus('Exited', 'error');
    });

    // Send keyboard input
    term.onData(function (data) {
        console.log('[TERM] onData (keyboard input), length=' + data.length);
        conn.invoke('term_input', { data: data });
    });

    // Handle resize
    window.addEventListener('resize', function () {
        fitAddon.fit();
    });

    // Use ResizeObserver if available
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function () {
            fitAddon.fit();
        }).observe(container);
    }

    term.onResize(function (size) {
        conn.invoke('term_resize', { cols: size.cols, rows: size.rows });
    });

    // Focus terminal
    term.focus();
})();
