/**
 * desktop.js — Main orchestrator for the ZRO Shell.
 *
 * Responsibilities:
 *   - Initialize WS connection (via ZroClient.connect)
 *   - Create WindowManager, Taskbar, Launcher
 *   - Restore windows from state:restore('__windows')
 *   - Save window state on changes
 *   - Handle postMessage Shell API from apps in iframes
 *   - Show desktop notifications
 */
(function () {
    'use strict';

    let conn = null;   // ZroConnection
    let wm = null;     // WindowManager
    let taskbar = null; // Taskbar
    let launcher = null; // Launcher

    // ── State persistence ────────────────────────────────

    let _saveTimer = null;
    function scheduleSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(async () => {
            if (!conn || !wm) return;
            try {
                await conn.state.save('__windows', wm.serialize());
            } catch (e) {
                console.warn('desktop: state save failed', e);
            }
        }, 500);
    }

    async function restoreWindows() {
        if (!conn || !wm) return;
        try {
            const data = await conn.state.restore('__windows');
            if (data && data.windows) {
                for (const w of data.windows) {
                    wm.open({
                        slug: w.slug,
                        name: w.name,
                        instanceId: w.instanceId,
                        x: w.x,
                        y: w.y,
                        width: w.width,
                        height: w.height,
                        maximized: w.maximized,
                    });
                    if (w.minimized) wm.minimize(w.instanceId);
                }
            }
        } catch (e) {
            console.warn('desktop: state restore failed', e);
        }
    }

    // ── postMessage Shell API handler ────────────────────

    function handleShellMessage(event) {
        // Only accept messages from our own origin
        if (event.origin !== window.location.origin) return;
        const msg = event.data;
        if (!msg || typeof msg.type !== 'string') return;
        if (!msg.type.startsWith('zro:shell:')) return;

        // Find which window sent this message
        const winId = wm.findBySource(event.source);
        if (!winId) return;

        const method = msg.type.replace('zro:shell:', '');

        const respond = (payload, success) => {
            try {
                event.source.postMessage({
                    type: 'zro:shell:response',
                    requestId: msg.requestId,
                    success: success !== false,
                    payload: payload || {},
                }, window.location.origin);
            } catch (_) {}
        };

        switch (method) {
            case 'setTitle':
                wm.setTitle(winId, msg.payload?.title || '');
                respond();
                break;

            case 'notify':
                showNotification(msg.payload || {});
                respond();
                break;

            case 'setBadgeCount':
                wm.setBadge(winId, msg.payload?.count || 0);
                respond();
                break;

            case 'requestFocus':
                wm.focus(winId);
                respond();
                break;

            case 'minimize':
                wm.minimize(winId);
                respond();
                break;

            case 'maximize':
                wm.maximize(winId);
                respond();
                break;

            case 'restore':
                wm.restore(winId);
                respond();
                break;

            case 'close':
                wm.close(winId);
                respond();
                break;

            case 'confirmClose':
                wm.confirmClose(winId);
                break;

            case 'cancelClose':
                wm.cancelClose(winId);
                break;

            case 'setProgress':
                // TODO: show progress indicator on taskbar button
                respond();
                break;

            case 'getWindowInfo': {
                const info = wm.getWindowInfo(winId);
                respond(info || {});
                break;
            }

            default:
                respond({ error: 'Unknown shell method: ' + method }, false);
        }
    }

    // ── Notifications ────────────────────────────────────

    function showNotification(opts) {
        const container = document.getElementById('notifications');
        const el = document.createElement('div');
        el.className = 'zro-notification';

        let html = '';
        if (opts.title) html += `<div class="notif-title">${esc(opts.title)}</div>`;
        if (opts.body) html += `<div class="notif-body">${esc(opts.body)}</div>`;
        el.innerHTML = html || '<div class="notif-body">Notification</div>';

        container.appendChild(el);

        const timeout = opts.timeout || 5000;
        if (timeout > 0) {
            setTimeout(() => el.remove(), timeout);
        }
        // Click to dismiss
        el.addEventListener('click', () => el.remove());
    }

    // ── Init ─────────────────────────────────────────────

    function init() {
        // Create the Window Manager
        wm = new WindowManager(document.getElementById('desktop'));

        // Create Taskbar and Launcher
        taskbar = new Taskbar(wm);
        launcher = new Launcher(wm);

        // Connect to the WS as the "shell" app
        conn = ZroClient.connect({
            slug: ZroClient.slugFromUrl() || 'shell',
            onConnect: async (info) => {
                if (info.reconnected) {
                    console.log('[ZRO Shell] Reconnected');
                } else {
                    console.log('[ZRO Shell] Connected');
                }
                // Restore window layout
                await restoreWindows();

                // If no windows restored, show the launcher
                if (wm.windows.size === 0) {
                    launcher.show();
                }
            },
            onDisconnect: () => {
                console.log('[ZRO Shell] Disconnected');
            },
            onError: (e) => {
                console.warn('[ZRO Shell] WS error', e);
            },
        });

        // Auto-save window state on changes
        document.addEventListener('zro:wm:change', () => scheduleSave());

        // Listen for postMessage from iframes (Shell API)
        window.addEventListener('message', handleShellMessage);
    }

    // ── Helpers ──────────────────────────────────────────

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ── Boot ─────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
