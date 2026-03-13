/**
 * desktop.js — Main orchestrator for Custom Shell
 *
 * Wires all components: WindowManager, Taskbar, Launcher, Keybindings,
 * plus manages: wallpaper, context menu, quick settings, notification center,
 * lock screen, system metrics polling, clipboard proxy.
 */
(function () {
    'use strict';

    var conn     = null;   // ZroConnection (WS)
    var wm       = null;
    var taskbar  = null;
    var launcher = null;
    var keys     = null;

    // State
    var _saveTimer    = null;
    var _dndMode      = false;
    var _notifications = [];   // { id, app, title, body, time, read }
    var _notifIdCounter = 0;
    var _systemMetrics = null;
    var _metricsInterval = null;
    var _lockTimeout = null;
    var _idleTimer = null;
    var _lockTimeoutMinutes = 15;  // auto lock after N minutes idle

    /* ── State persistence ─────────────────────────── */

    function scheduleSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(async function() {
            if (!conn || !wm) return;
            try { await conn.state.save('__windows', wm.serialize()); }
            catch (e) { console.warn('[Shell] save failed', e); }
        }, 500);
    }

    async function restoreWindows() {
        if (!conn || !wm) return;
        try {
            var data = await conn.state.restore('__windows');
            if (data && data.windows) {
                for (var i = 0; i < data.windows.length; i++) {
                    var w = data.windows[i];
                    wm.open({
                        slug: w.slug, name: w.name, instanceId: w.instanceId, icon: w.icon,
                        x: w.x, y: w.y, width: w.width, height: w.height, maximized: w.maximized,
                    });
                    if (w.minimized) wm.minimize(w.instanceId);
                    if (w.snapped) wm.snap(w.instanceId, w.snapped);
                }
            }
        } catch (e) { console.warn('[Shell] restore failed', e); }
    }

    /* ── Wallpaper ─────────────────────────────────── */

    async function loadWallpaper() {
        if (!conn) return;
        try {
            var data = await conn.state.restore('__wallpaper');
            if (data) applyWallpaper(data);
        } catch (_) {}
    }

    async function loadTheme() {
        if (!conn) return;
        try {
            var theme = await conn.state.restore('__theme');
            if (theme) {
                document.documentElement.setAttribute('data-theme', theme);
            }
        } catch (_) {}
    }

    function applyWallpaper(cfg) {
        var desktop = document.getElementById('desktop');
        if (cfg.type === 'color') {
            desktop.style.backgroundImage = 'none';
            desktop.style.backgroundColor = cfg.value || '#1a1a2e';
        } else if (cfg.type === 'image') {
            desktop.style.backgroundImage = 'url(' + cfg.value + ')';
            desktop.style.backgroundColor = '';
        } else {
            // default
            desktop.style.backgroundImage = 'none';
            desktop.style.backgroundColor = 'var(--shell-bg)';
        }
    }

    function initWallpaperPicker() {
        var picker  = document.getElementById('wallpaper-picker');
        var grid    = document.getElementById('wp-grid');
        var closeBtn = document.getElementById('wp-close');
        var solidBtn = document.getElementById('wp-solid-color');
        var colorInp = document.getElementById('wp-color-picker');
        var backdrop = picker.querySelector('.wp-backdrop');

        // Built-in solid colors
        var colors = [
            '#1a1a2e','#16213e','#0f3460','#533483','#2c3e50',
            '#1b2631','#1c2833','#0e4d45','#34495e','#2c2c54',
        ];

        function show() {
            grid.innerHTML = '';
            for (var i = 0; i < colors.length; i++) {
                var thumb = document.createElement('div');
                thumb.className = 'wp-thumb';
                thumb.style.backgroundColor = colors[i];
                thumb.addEventListener('click', (function(c) {
                    return function() { setWallpaper('color', c); };
                })(colors[i]));
                grid.appendChild(thumb);
            }
            picker.classList.remove('hidden');
        }

        function hide() { picker.classList.add('hidden'); }

        function setWallpaper(type, value) {
            var cfg = { type: type, value: value };
            applyWallpaper(cfg);
            if (conn) conn.state.save('__wallpaper', cfg).catch(function() {});
            hide();
        }

        closeBtn.addEventListener('click', hide);
        backdrop.addEventListener('click', hide);
        solidBtn.addEventListener('click', function() {
            setWallpaper('color', colorInp.value);
        });
        colorInp.addEventListener('change', function() {
            setWallpaper('color', colorInp.value);
        });

        // Expose show function
        window.__showWallpaperPicker = show;
    }

    /* ── Desktop context menu ──────────────────────── */

    function initContextMenu() {
        var desktop = document.getElementById('desktop');
        var menu = document.getElementById('desktop-ctx-menu');

        desktop.addEventListener('contextmenu', function(e) {
            // Only trigger on desktop itself, not on windows
            if (e.target !== desktop && !e.target.closest('#desktop-ctx-menu')) return;
            e.preventDefault();
            menu.style.left = e.clientX + 'px';
            menu.style.top  = e.clientY + 'px';
            menu.classList.remove('hidden');

            // Clamp to viewport
            requestAnimationFrame(function() {
                var r = menu.getBoundingClientRect();
                if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 4) + 'px';
                if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 4) + 'px';
            });
        });

        document.addEventListener('click', function(e) {
            if (!menu.contains(e.target)) menu.classList.add('hidden');
        });

        menu.addEventListener('click', function(e) {
            var item = e.target.closest('.ctx-item');
            if (!item) return;
            menu.classList.add('hidden');
            var action = item.dataset.action;
            switch (action) {
                case 'wallpaper':
                    if (window.__showWallpaperPicker) window.__showWallpaperPicker();
                    break;
                case 'terminal':
                    wm.open({ slug: 'terminal', name: 'Terminal' });
                    break;
                case 'settings':
                    wm.open({ slug: 'settings', name: 'Settings' });
                    break;
                case 'refresh':
                    if (launcher) launcher.refresh();
                    break;
            }
        });
    }

    /* ── Quick Settings ────────────────────────────── */

    function initQuickSettings() {
        var qs = document.getElementById('quick-settings');
        var trayUser = document.getElementById('tray-user');
        var trayCpu  = document.getElementById('tray-cpu');

        // Open on user tray click
        trayUser.addEventListener('click', function(e) {
            e.stopPropagation();
            qs.classList.toggle('hidden');
            // Close notification center if open
            document.getElementById('notif-center').classList.add('hidden');
        });

        // Also on CPU indicator click
        trayCpu.addEventListener('click', function(e) {
            e.stopPropagation();
            qs.classList.toggle('hidden');
            document.getElementById('notif-center').classList.add('hidden');
        });

        // Close on outside click
        document.addEventListener('click', function(e) {
            if (!qs.contains(e.target) && !trayUser.contains(e.target) && !trayCpu.contains(e.target)) {
                qs.classList.add('hidden');
            }
        });

        // Theme toggle
        document.getElementById('qs-theme-toggle').addEventListener('click', function() {
            // Toggle theme placeholder — just swap some CSS vars
            document.body.classList.toggle('theme-light');
            this.textContent = document.body.classList.contains('theme-light') ? '\u2600 Light' : '\uD83C\uDF19 Dark';
        });

        // DND toggle
        document.getElementById('qs-dnd-toggle').addEventListener('click', function() {
            _dndMode = !_dndMode;
            this.textContent = _dndMode ? '\uD83D\uDD14 DND On' : '\uD83D\uDD14 DND Off';
            this.classList.toggle('active', _dndMode);
        });

        // Action buttons
        document.getElementById('qs-settings').addEventListener('click', function() {
            qs.classList.add('hidden');
            wm.open({ slug: 'settings', name: 'Settings' });
        });
        document.getElementById('qs-lock').addEventListener('click', function() {
            qs.classList.add('hidden');
            showLockScreen();
        });
        document.getElementById('qs-logout').addEventListener('click', function() {
            qs.classList.add('hidden');
            window.location.href = '/auth/logout';
        });
    }

    /* ── Notification center ───────────────────────── */

    function initNotificationCenter() {
        var nc   = document.getElementById('notif-center');
        var list = document.getElementById('nc-list');
        var empty = document.getElementById('nc-empty');
        var trayNotif = document.getElementById('tray-notif');

        trayNotif.addEventListener('click', function(e) {
            e.stopPropagation();
            nc.classList.toggle('hidden');
            document.getElementById('quick-settings').classList.add('hidden');
            renderNcList();
        });

        document.addEventListener('click', function(e) {
            if (!nc.contains(e.target) && !trayNotif.contains(e.target)) {
                nc.classList.add('hidden');
            }
        });

        document.getElementById('nc-clear-all').addEventListener('click', function() {
            _notifications = [];
            renderNcList();
            updateNotifBadge();
        });
    }

    function renderNcList() {
        var list = document.getElementById('nc-list');
        var empty = document.getElementById('nc-empty');
        list.innerHTML = '';

        if (_notifications.length === 0) {
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        for (var i = _notifications.length - 1; i >= 0; i--) {
            var n = _notifications[i];
            var item = document.createElement('div');
            item.className = 'nc-item';
            if (!n.read) item.classList.add('unread');

            var timeStr = '';
            if (n.time) {
                var d = new Date(n.time);
                timeStr = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
            }

            item.innerHTML =
                '<button class="nc-item-close" data-nid="' + n.id + '">\u2715</button>' +
                '<div class="nc-item-header">' +
                    '<span class="nc-item-app">' + esc(n.app || 'System') + '</span>' +
                    '<span class="nc-item-time">' + timeStr + '</span>' +
                '</div>' +
                (n.title ? '<div class="nc-item-title">' + esc(n.title) + '</div>' : '') +
                (n.body ? '<div class="nc-item-body">' + esc(n.body) + '</div>' : '');

            list.appendChild(item);
        }

        // Delete buttons
        list.querySelectorAll('.nc-item-close').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var nid = parseInt(btn.dataset.nid);
                _notifications = _notifications.filter(function(n) { return n.id !== nid; });
                renderNcList();
                updateNotifBadge();
            });
        });
    }

    function updateNotifBadge() {
        var unread = _notifications.filter(function(n) { return !n.read; }).length;
        if (taskbar) taskbar.setNotifBadge(unread);
    }

    /* ── Toast notifications ───────────────────────── */

    function showNotification(opts) {
        // Add to notification center
        var notif = {
            id: ++_notifIdCounter,
            app: opts.app || opts.title || 'System',
            title: opts.title || '',
            body: opts.body || '',
            time: Date.now(),
            read: false,
        };
        _notifications.push(notif);
        updateNotifBadge();

        // If DND, skip toast
        if (_dndMode) return;

        // Show toast
        var container = document.getElementById('notifications');
        var el = document.createElement('div');
        el.className = 'notification';

        var html = '';
        if (opts.icon) html += '<span class="notif-icon">' + opts.icon + '</span>';
        if (opts.title) html += '<div class="notif-title">' + esc(opts.title) + '</div>';
        if (opts.body) html += '<div class="notif-body">' + esc(opts.body) + '</div>';
        el.innerHTML = html || '<div class="notif-body">Notification</div>';

        container.appendChild(el);
        var timeout = opts.timeout != null ? opts.timeout : 5000;
        if (timeout > 0) setTimeout(function() { el.remove(); }, timeout);
        el.addEventListener('click', function() { el.remove(); });
    }

    /* ── Lock screen ───────────────────────────────── */

    function showLockScreen() {
        var ls = document.getElementById('lock-screen');
        ls.classList.remove('hidden');
        sessionStorage.setItem('zro-locked', '1');
        updateLockClock();
        document.getElementById('lock-password').value = '';
        document.getElementById('lock-error').classList.add('hidden');
        setTimeout(function() {
            document.getElementById('lock-password').focus();
        }, 100);
    }

    function hideLockScreen() {
        document.getElementById('lock-screen').classList.add('hidden');
        sessionStorage.removeItem('zro-locked');
        resetIdleTimer();
    }

    function updateLockClock() {
        var now = new Date();
        var h = String(now.getHours()).padStart(2, '0');
        var m = String(now.getMinutes()).padStart(2, '0');
        document.getElementById('lock-clock').textContent = h + ':' + m;
        var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        document.getElementById('lock-date').textContent = days[now.getDay()] + ' ' + now.getDate() + ' ' + months[now.getMonth()];
    }

    function initLockScreen() {
        document.getElementById('lock-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            var pwd = document.getElementById('lock-password').value;
            if (!pwd) return;

            try {
                var resp = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ password: pwd }),
                });
                if (resp.ok) {
                    hideLockScreen();
                } else {
                    document.getElementById('lock-error').textContent = 'Incorrect password';
                    document.getElementById('lock-error').classList.remove('hidden');
                    document.getElementById('lock-password').value = '';
                }
            } catch (err) {
                document.getElementById('lock-error').textContent = 'Authentication failed';
                document.getElementById('lock-error').classList.remove('hidden');
            }
        });

        // Listen for lock events
        document.addEventListener('zro:shell:lock', function() { showLockScreen(); });

        // Update lock clock every minute
        setInterval(function() {
            if (!document.getElementById('lock-screen').classList.contains('hidden')) {
                updateLockClock();
            }
        }, 30000);
    }

    /* ── Idle detection / auto lock ────────────────── */

    function resetIdleTimer() {
        if (_idleTimer) clearTimeout(_idleTimer);
        _idleTimer = setTimeout(function() {
            showLockScreen();
        }, _lockTimeoutMinutes * 60 * 1000);
    }

    function initIdleDetection() {
        var events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
        var throttled = false;
        function onActivity() {
            if (throttled) return;
            throttled = true;
            setTimeout(function() { throttled = false; }, 5000);
            // Only reset if NOT locked
            if (document.getElementById('lock-screen').classList.contains('hidden')) {
                resetIdleTimer();
            }
        }
        for (var i = 0; i < events.length; i++) {
            document.addEventListener(events[i], onActivity, { passive: true });
        }
        resetIdleTimer();
    }

    /* ── System metrics polling ─────────────────────── */

    function startMetricsPolling() {
        async function poll() {
            if (!conn) return;
            try {
                var result = await conn.invoke('get_system_info', {});
                if (result) {
                    _systemMetrics = result;
                    if (taskbar) taskbar.updateTray(result);
                }
            } catch (_) {
                // Backend may not have this command yet
            }
        }
        poll();
        _metricsInterval = setInterval(poll, 10000);
    }

    /* ── Shell API (postMessage from iframes) ──────── */

    function handleShellMessage(event) {
        if (event.origin !== window.location.origin) return;
        var msg = event.data;
        if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('zro:shell:')) return;

        var winId = wm.findBySource(event.source);
        if (!winId && msg.type !== 'zro:shell:notify') return;

        var method = msg.type.replace('zro:shell:', '');

        var respond = function(payload, ok) {
            try {
                event.source.postMessage({
                    type: 'zro:shell:response',
                    requestId: msg.requestId,
                    success: ok !== false,
                    payload: payload || {},
                }, window.location.origin);
            } catch (_) {}
        };

        switch (method) {
            case 'setTitle':      wm.setTitle(winId, msg.payload && msg.payload.title || ''); respond(); break;
            case 'notify':        showNotification(msg.payload || {}); respond(); break;
            case 'setBadgeCount': wm.setBadge(winId, msg.payload && msg.payload.count || 0); respond(); break;
            case 'requestFocus':  wm.focus(winId);     respond(); break;
            case 'minimize':      wm.minimize(winId);  respond(); break;
            case 'maximize':      wm.maximize(winId);  respond(); break;
            case 'restore':       wm.restore(winId);   respond(); break;
            case 'close':         wm.close(winId);     respond(); break;
            case 'getWindowInfo': respond(wm.getWindowInfo(winId) || {}); break;
            // Theme/wallpaper from settings app
            case 'applyTheme':
                if (msg.payload && msg.payload.theme) {
                    document.documentElement.setAttribute('data-theme', msg.payload.theme);
                    // Propagate to all open app iframes
                    wm.windows.forEach(function(info) {
                        try {
                            if (info.iframe && info.iframe.contentDocument) {
                                info.iframe.contentDocument.documentElement.setAttribute('data-theme', msg.payload.theme);
                            }
                        } catch (_) {}
                    });
                    // Save theme preference
                    if (conn) conn.state.save('__theme', msg.payload.theme).catch(function() {});
                }
                respond();
                break;
            case 'applyWallpaper':
                if (msg.payload) {
                    applyWallpaper(msg.payload);
                    if (conn) conn.state.save('__wallpaper', msg.payload).catch(function() {});
                }
                respond();
                break;
            // Clipboard proxy
            case 'clipboard:copy':
                if (msg.payload && msg.payload.text && navigator.clipboard) {
                    navigator.clipboard.writeText(msg.payload.text).then(
                        function() { respond(); },
                        function() { respond({ error: 'clipboard write failed' }, false); }
                    );
                } else { respond(); }
                break;
            case 'clipboard:paste':
                if (navigator.clipboard) {
                    navigator.clipboard.readText().then(
                        function(text) { respond({ text: text }); },
                        function() { respond({ text: '' }); }
                    );
                } else { respond({ text: '' }); }
                break;
            default: respond({ error: 'Unknown: ' + method }, false);
        }
    }

    /* ── User info ─────────────────────────────────── */

    async function loadUserInfo() {
        if (!conn) return;
        try {
            var user = await conn.invoke('get_user_info', {});
            if (user) {
                if (taskbar) taskbar.setUser(user.username || 'user');
                var qsUser = document.getElementById('qs-username');
                var qsRole = document.getElementById('qs-role');
                var lockUser = document.getElementById('lock-username');
                if (qsUser) qsUser.textContent = user.username || 'user';
                if (qsRole) qsRole.textContent = user.role || '';
                if (lockUser) lockUser.textContent = user.username || 'user';
            }
        } catch (_) {}
    }

    /* ── Init ──────────────────────────────────────── */

    function init() {
        wm       = new WindowManager(document.getElementById('desktop'));
        taskbar  = new Taskbar(wm);
        launcher = new Launcher(wm);
        keys     = new Keybindings(wm, launcher);

        conn = ZroClient.connect({
            slug: ZroClient.slugFromUrl() || 'custom-shell',
            onConnect: async function(info) {
                console.log('[Shell] ' + (info.reconnected ? 'Reconnected' : 'Connected'));
                await restoreWindows();
                await loadWallpaper();
                await loadTheme();
                await loadUserInfo();
                startMetricsPolling();
                if (wm.windows.size === 0) launcher.show();
            },
            onDisconnect: function() { console.log('[Shell] Disconnected'); },
            onError: function(e) { console.warn('[Shell] WS error', e); },
        });

        // Persist window layout on every change
        document.addEventListener('zro:wm:change', function() { scheduleSave(); });

        // Listen for Shell API from iframes
        window.addEventListener('message', handleShellMessage);

        // Listen for notify events from WM
        document.addEventListener('zro:shell:notify', function(e) {
            showNotification(e.detail || {});
        });

        // Initialize subsystems
        initContextMenu();
        initWallpaperPicker();
        initQuickSettings();
        initNotificationCenter();
        initLockScreen();
        initIdleDetection();

        // Restore lock state after reload
        if (sessionStorage.getItem('zro-locked') === '1') {
            showLockScreen();
        }

        // Prevent Ctrl+Shift+R / Ctrl+R / F5 from bypassing lock screen
        document.addEventListener('keydown', function(e) {
            var locked = !document.getElementById('lock-screen').classList.contains('hidden');
            if (!locked) return;
            if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
