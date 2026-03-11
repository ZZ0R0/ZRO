/**
 * desktop.js — Main orchestrator for Custom Shell
 *
 * This is the entry point that wires everything together:
 *   1. Creates WindowManager, Taskbar, Launcher
 *   2. Connects to the runtime via ZroClient (WebSocket)
 *   3. Restores window state from last session
 *   4. Listens for postMessage Shell API from apps in iframes
 *   5. Handles desktop notifications
 *
 * ── How to customize ──────────────────────────────────────
 *
 *   • Change the look → edit style.css (all theming is in :root variables)
 *   • Add desktop widgets → create DOM in init(), update in an interval
 *   • Add system tray items → extend the taskbar HTML + taskbar.js
 *   • Add right-click menu → listen for 'contextmenu' on #desktop
 *   • Change window behavior → edit window-manager.js
 *   • Add backend commands → edit backend/src/main.rs, call via conn.invoke()
 */
(function () {
    'use strict';

    let conn     = null;   // ZroConnection (WS)
    let wm       = null;   // WindowManager
    let taskbar  = null;   // Taskbar
    let launcher = null;   // Launcher

    // ── State persistence ────────────────────────────────

    let _saveTimer = null;

    function scheduleSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(async () => {
            if (!conn || !wm) return;
            try {
                await conn.state.save('__windows', wm.serialize());
            } catch (e) {
                console.warn('[Shell] state save failed', e);
            }
        }, 500);
    }

    async function restoreWindows() {
        if (!conn || !wm) return;
        try {
            const data = await conn.state.restore('__windows');
            if (data?.windows) {
                for (const w of data.windows) {
                    wm.open({
                        slug: w.slug, name: w.name, instanceId: w.instanceId,
                        x: w.x, y: w.y, width: w.width, height: w.height,
                        maximized: w.maximized,
                    });
                    if (w.minimized) wm.minimize(w.instanceId);
                }
            }
        } catch (e) {
            console.warn('[Shell] state restore failed', e);
        }
    }

    // ── Shell API (postMessage from iframes) ─────────────

    function handleShellMessage(event) {
        if (event.origin !== window.location.origin) return;
        const msg = event.data;
        if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('zro:shell:')) return;

        const winId = wm.findBySource(event.source);
        if (!winId) return;

        const method = msg.type.replace('zro:shell:', '');

        const respond = (payload, ok) => {
            try {
                event.source.postMessage({
                    type: 'zro:shell:response',
                    requestId: msg.requestId,
                    success: ok !== false,
                    payload: payload || {},
                }, window.location.origin);
            } catch (_) { /* iframe may have navigated */ }
        };

        switch (method) {
            case 'setTitle':     wm.setTitle(winId, msg.payload?.title || ''); respond(); break;
            case 'notify':       showNotification(msg.payload || {});          respond(); break;
            case 'setBadgeCount': wm.setBadge(winId, msg.payload?.count || 0); respond(); break;
            case 'requestFocus': wm.focus(winId);                              respond(); break;
            case 'minimize':     wm.minimize(winId);                           respond(); break;
            case 'maximize':     wm.maximize(winId);                           respond(); break;
            case 'restore':      wm.restore(winId);                            respond(); break;
            case 'close':        wm.close(winId);                              respond(); break;
            case 'getWindowInfo': respond(wm.getWindowInfo(winId) || {});                  break;
            default:              respond({ error: `Unknown: ${method}` }, false);
        }
    }

    // ── Notifications ────────────────────────────────────

    function showNotification(opts) {
        const container = document.getElementById('notifications');
        const el = document.createElement('div');
        el.className = 'notification';

        let html = '';
        if (opts.title) html += `<div class="notif-title">${esc(opts.title)}</div>`;
        if (opts.body)  html += `<div class="notif-body">${esc(opts.body)}</div>`;
        el.innerHTML = html || '<div class="notif-body">Notification</div>';

        container.appendChild(el);
        const timeout = opts.timeout ?? 5000;
        if (timeout > 0) setTimeout(() => el.remove(), timeout);
        el.addEventListener('click', () => el.remove());
    }

    // ── Init ─────────────────────────────────────────────

    function init() {
        wm       = new WindowManager(document.getElementById('desktop'));
        taskbar  = new Taskbar(wm);
        launcher = new Launcher(wm);

        // Connect to the runtime WS as our shell app
        conn = ZroClient.connect({
            slug: ZroClient.slugFromUrl() || 'custom-shell',
            onConnect: async (info) => {
                console.log(`[Shell] ${info.reconnected ? 'Reconnected' : 'Connected'}`);
                await restoreWindows();
                // Show launcher if desktop is empty
                if (wm.windows.size === 0) launcher.show();
            },
            onDisconnect: () => console.log('[Shell] Disconnected'),
            onError:      (e) => console.warn('[Shell] WS error', e),
        });

        // Persist window layout on every change
        document.addEventListener('zro:wm:change', () => scheduleSave());

        // Listen for Shell API from iframes
        window.addEventListener('message', handleShellMessage);

        // Listen for popup-blocked notifications from WM
        document.addEventListener('zro:shell:notify', (e) => {
            showNotification(e.detail || {});
        });

        // ── Right-click on desktop → show launcher ───────
        document.getElementById('desktop').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            launcher.show();
        });
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // ── Boot ─────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
