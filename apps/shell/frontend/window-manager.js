/**
 * WindowManager — Creates, moves, resizes, focuses, and destroys windows.
 *
 * Each window contains an <iframe> that loads a ZRO app.
 */
(function () {
    'use strict';

    class WindowManager {
        constructor(desktop) {
            this.desktop = desktop;
            this.windows = new Map(); // instanceId → WindowInfo
            this._topZ = 100;
            this._instanceCounter = 0;
        }

        /**
         * Open a new window for an app.
         * @param {object} opts - { slug, name, instanceId?, x?, y?, width?, height?, maximized? }
         * @returns {string} instanceId
         */
        open(opts) {
            const id = opts.instanceId || `${opts.slug}-${++this._instanceCounter}`;
            if (this.windows.has(id)) {
                this.focus(id);
                return id;
            }

            const x = opts.x ?? (80 + (this.windows.size % 8) * 30);
            const y = opts.y ?? (60 + (this.windows.size % 8) * 30);
            const width = opts.width ?? 800;
            const height = opts.height ?? 550;

            const el = document.createElement('div');
            el.className = 'zro-window focused';
            el.dataset.instanceId = id;
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            el.style.width = width + 'px';
            el.style.height = height + 'px';
            el.style.zIndex = ++this._topZ;

            el.innerHTML = `
                <div class="zro-window-titlebar">
                    <span class="zro-window-title">${this._esc(opts.name || opts.slug)}</span>
                    <div class="zro-window-controls">
                        <button class="zro-minimize" title="Minimize">&#x2013;</button>
                        <button class="zro-maximize" title="Maximize">&#x25A1;</button>
                        <button class="zro-close" title="Close">&#x2715;</button>
                    </div>
                </div>
                <iframe
                    src="/${encodeURIComponent(opts.slug)}/${encodeURIComponent(id)}/"
                    class="zro-window-content"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                ></iframe>
                <div class="zro-resize zro-resize-n"></div>
                <div class="zro-resize zro-resize-s"></div>
                <div class="zro-resize zro-resize-w"></div>
                <div class="zro-resize zro-resize-e"></div>
                <div class="zro-resize zro-resize-nw"></div>
                <div class="zro-resize zro-resize-ne"></div>
                <div class="zro-resize zro-resize-sw"></div>
                <div class="zro-resize zro-resize-se"></div>
            `;

            const desktopEl = document.getElementById('desktop');
            desktopEl.appendChild(el);

            const info = {
                id,
                slug: opts.slug,
                name: opts.name || opts.slug,
                el,
                iframe: el.querySelector('iframe'),
                minimized: false,
                maximized: false,
                badge: 0,
                _restoreRect: null,
            };
            this.windows.set(id, info);

            this._bindTitlebarDrag(info);
            this._bindResize(info);
            this._bindControls(info);
            this._bindFocusClick(info);

            if (opts.maximized) this.maximize(id);

            this._dispatchChange();
            return id;
        }

        /** Bring window to front */
        focus(id) {
            const info = this.windows.get(id);
            if (!info) return;
            // Unfocus all
            this.windows.forEach((w) => w.el.classList.remove('focused'));
            info.el.style.zIndex = ++this._topZ;
            info.el.classList.add('focused');
            if (info.minimized) {
                info.minimized = false;
                info.el.classList.remove('minimized');
            }
            this._sendShellEvent(info, 'focus', {});
            this._dispatchChange();
        }

        minimize(id) {
            const info = this.windows.get(id);
            if (!info) return;
            info.minimized = true;
            info.el.classList.add('minimized');
            info.el.classList.remove('focused');
            this._sendShellEvent(info, 'blur', {});
            this._dispatchChange();
        }

        maximize(id) {
            const info = this.windows.get(id);
            if (!info) return;
            if (info.maximized) {
                this.restore(id);
                return;
            }
            info._restoreRect = {
                x: parseInt(info.el.style.left),
                y: parseInt(info.el.style.top),
                width: parseInt(info.el.style.width),
                height: parseInt(info.el.style.height),
            };
            info.maximized = true;
            info.el.classList.add('maximized');
            this.focus(id);
            this._sendShellEvent(info, 'maximize', {});
            this._dispatchChange();
        }

        restore(id) {
            const info = this.windows.get(id);
            if (!info || !info.maximized) return;
            info.maximized = false;
            info.el.classList.remove('maximized');
            if (info._restoreRect) {
                const r = info._restoreRect;
                info.el.style.left = r.x + 'px';
                info.el.style.top = r.y + 'px';
                info.el.style.width = r.width + 'px';
                info.el.style.height = r.height + 'px';
            }
            this.focus(id);
            this._sendShellEvent(info, 'restore', {});
            this._dispatchChange();
        }

        /**
         * Close a window (with optional grace period for the app to save state).
         */
        close(id) {
            const info = this.windows.get(id);
            if (!info) return;

            // Notify the iframe that it's being closed (app can save state)
            this._sendShellEvent(info, 'closing', {});

            // Give the app 2s to respond with confirmClose/cancelClose
            const timer = setTimeout(() => this._doClose(id), 2000);
            info._closingTimer = timer;
            info._closeId = id;
        }

        /** Internal: actually remove the window. */
        _doClose(id) {
            const info = this.windows.get(id);
            if (!info) return;
            if (info._closingTimer) clearTimeout(info._closingTimer);
            info.el.remove();
            this.windows.delete(id);
            this._dispatchChange();
        }

        confirmClose(id) {
            this._doClose(id);
        }

        cancelClose(id) {
            const info = this.windows.get(id);
            if (!info) return;
            if (info._closingTimer) {
                clearTimeout(info._closingTimer);
                info._closingTimer = null;
            }
        }

        setTitle(id, title) {
            const info = this.windows.get(id);
            if (!info) return;
            info.name = title;
            info.el.querySelector('.zro-window-title').textContent = title;
            this._dispatchChange();
        }

        setBadge(id, count) {
            const info = this.windows.get(id);
            if (!info) return;
            info.badge = count;
            this._dispatchChange();
        }

        getWindowInfo(id) {
            const info = this.windows.get(id);
            if (!info) return null;
            return {
                instanceId: id,
                appSlug: info.slug,
                x: parseInt(info.el.style.left) || 0,
                y: parseInt(info.el.style.top) || 0,
                width: parseInt(info.el.style.width) || 0,
                height: parseInt(info.el.style.height) || 0,
                maximized: info.maximized,
                minimized: info.minimized,
                focused: info.el.classList.contains('focused'),
            };
        }

        /** Find window by its iframe's contentWindow (for postMessage origin matching). */
        findBySource(source) {
            for (const [id, info] of this.windows) {
                if (info.iframe && info.iframe.contentWindow === source) {
                    return id;
                }
            }
            return null;
        }

        /** Serialise all window positions for state:save. */
        serialize() {
            const wins = [];
            for (const [id, info] of this.windows) {
                wins.push({
                    instanceId: id,
                    slug: info.slug,
                    name: info.name,
                    x: parseInt(info.el.style.left) || 0,
                    y: parseInt(info.el.style.top) || 0,
                    width: parseInt(info.el.style.width) || 0,
                    height: parseInt(info.el.style.height) || 0,
                    maximized: info.maximized,
                    minimized: info.minimized,
                    zIndex: parseInt(info.el.style.zIndex) || 0,
                });
            }
            return { windows: wins };
        }

        /** Get the currently focused window id (or null). */
        get activeId() {
            for (const [id, info] of this.windows) {
                if (info.el.classList.contains('focused')) return id;
            }
            return null;
        }

        // ─── Drag ────────────────────────────────────────────

        _bindTitlebarDrag(info) {
            const titlebar = info.el.querySelector('.zro-window-titlebar');
            let startX, startY, origX, origY;
            let rafId = 0;
            let lastE = null;

            const applyMove = () => {
                rafId = 0;
                if (!lastE) return;
                const dx = lastE.clientX - startX;
                const dy = lastE.clientY - startY;
                info.el.style.transform = `translate(${dx}px, ${Math.max(-origY, dy)}px)`;
            };

            const onMove = (e) => {
                lastE = e;
                if (!rafId) rafId = requestAnimationFrame(applyMove);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                // Commit final position
                if (lastE) {
                    info.el.style.left = (origX + lastE.clientX - startX) + 'px';
                    info.el.style.top = Math.max(0, origY + lastE.clientY - startY) + 'px';
                }
                info.el.style.transform = '';
                info.el.style.willChange = '';
                this._enableIframes();
                this._dispatchChange();
            };

            titlebar.addEventListener('mousedown', (e) => {
                if (e.target.closest('.zro-window-controls')) return;
                if (info.maximized) return;
                this.focus(info.id);
                startX = e.clientX;
                startY = e.clientY;
                origX = parseInt(info.el.style.left) || 0;
                origY = parseInt(info.el.style.top) || 0;
                lastE = null;
                info.el.style.willChange = 'transform';
                this._disableIframes();
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                e.preventDefault();
            });
        }

        // ─── Resize ──────────────────────────────────────────

        _bindResize(info) {
            const handles = info.el.querySelectorAll('.zro-resize');
            handles.forEach((handle) => {
                handle.addEventListener('mousedown', (e) => {
                    if (info.maximized) return;
                    this.focus(info.id);
                    const dir = Array.from(handle.classList)
                        .find((c) => c.startsWith('zro-resize-') && c !== 'zro-resize')
                        ?.replace('zro-resize-', '') || '';
                    this._startResize(info, dir, e);
                    e.preventDefault();
                });
            });
        }

        _startResize(info, dir, e) {
            const startX = e.clientX;
            const startY = e.clientY;
            const origX = parseInt(info.el.style.left) || 0;
            const origY = parseInt(info.el.style.top) || 0;
            const origW = parseInt(info.el.style.width) || 320;
            const origH = parseInt(info.el.style.height) || 200;
            const minW = 320;
            const minH = 200;
            let rafId = 0;
            let lastEv = null;

            this._disableIframes();

            const applyResize = () => {
                rafId = 0;
                if (!lastEv) return;
                const dx = lastEv.clientX - startX;
                const dy = lastEv.clientY - startY;
                let x = origX, y = origY, w = origW, h = origH;

                if (dir.includes('e')) w = Math.max(minW, origW + dx);
                if (dir.includes('s')) h = Math.max(minH, origH + dy);
                if (dir.includes('w')) {
                    const newW = Math.max(minW, origW - dx);
                    x = origX + (origW - newW);
                    w = newW;
                }
                if (dir.includes('n')) {
                    const newH = Math.max(minH, origH - dy);
                    y = Math.max(0, origY + (origH - newH));
                    h = newH;
                }

                info.el.style.left = x + 'px';
                info.el.style.top = y + 'px';
                info.el.style.width = w + 'px';
                info.el.style.height = h + 'px';
            };

            const onMove = (ev) => {
                lastEv = ev;
                if (!rafId) rafId = requestAnimationFrame(applyResize);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                if (lastEv) applyResize();  // commit final position
                this._enableIframes();
                this._sendShellEvent(info, 'resize', {
                    width: parseInt(info.el.style.width),
                    height: parseInt(info.el.style.height),
                });
                this._dispatchChange();
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }

        // ─── Controls (min/max/close) ───────────────────────

        _bindControls(info) {
            info.el.querySelector('.zro-minimize').addEventListener('click', () => this.minimize(info.id));
            info.el.querySelector('.zro-maximize').addEventListener('click', () => this.maximize(info.id));
            info.el.querySelector('.zro-close').addEventListener('click', () => this.close(info.id));
        }

        _bindFocusClick(info) {
            info.el.addEventListener('mousedown', () => {
                this.focus(info.id);
            });
        }

        // ─── Helpers ─────────────────────────────────────────

        /** Disable pointer events on iframes during drag/resize so mousemove works. */
        _disableIframes() {
            document.querySelectorAll('.zro-window-content').forEach((f) => {
                f.style.pointerEvents = 'none';
            });
        }

        _enableIframes() {
            document.querySelectorAll('.zro-window-content').forEach((f) => {
                f.style.pointerEvents = '';
            });
        }

        /** Send a Shell event to an app's iframe via postMessage. */
        _sendShellEvent(info, event, payload) {
            try {
                info.iframe?.contentWindow?.postMessage(
                    { type: 'zro:shell:event', event, payload },
                    window.location.origin,
                );
            } catch (_) {}
        }

        /** Notify the desktop (taskbar, state persistence) that windows changed. */
        _dispatchChange() {
            document.dispatchEvent(new CustomEvent('zro:wm:change'));
        }

        _esc(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    }

    window.WindowManager = WindowManager;
})();
