/**
 * window-manager.js — Window Manager for Custom Shell
 *
 * Creates, moves, resizes, focuses, minimizes, maximizes, and closes windows.
 * Each window loads a ZRO app inside an <iframe>.
 *
 * Public API:
 *   wm.open({ slug, name, instanceId?, x?, y?, width?, height?, maximized? }) → instanceId
 *   wm.close(id)
 *   wm.focus(id)
 *   wm.minimize(id) / wm.maximize(id) / wm.restore(id)
 *   wm.setTitle(id, title) / wm.setBadge(id, count)
 *   wm.serialize() → [{ slug, name, instanceId, x, y, ... }]
 *   wm.findBySource(windowProxy) → instanceId | null
 *
 * Emits custom event `zro:wm:change` on the document after every mutation
 * so Taskbar and other modules can react.
 */
(function () {
    'use strict';

    class WindowManager {
        constructor(desktopEl) {
            /** @type {HTMLElement} */
            this.desktop = desktopEl;
            /** @type {Map<string, object>} instanceId → window info */
            this.windows = new Map();
            this._topZ = 100;
            this._counter = 0;
        }

        /* ───────────────── Open / Close ───────────────── */

        open(opts) {
            const id = opts.instanceId || `${opts.slug}-${++this._counter}`;

            // If already open, just focus
            if (this.windows.has(id)) {
                this.focus(id);
                return id;
            }

            const cascade = this.windows.size % 10;
            const x = opts.x ?? (100 + cascade * 28);
            const y = opts.y ?? ( 60 + cascade * 28);
            const w = opts.width  ?? 820;
            const h = opts.height ?? 560;

            const el = document.createElement('div');
            el.className = 'window focused';
            el.dataset.id = id;
            Object.assign(el.style, {
                left:   x + 'px',
                top:    y + 'px',
                width:  w + 'px',
                height: h + 'px',
                zIndex: ++this._topZ,
            });

            el.innerHTML = `
                <div class="window-titlebar">
                    <span class="window-title">${esc(opts.name || opts.slug)}</span>
                    <div class="window-controls">
                        <button class="btn-popout"   title="Open in new window"></button>
                        <button class="btn-minimize" title="Minimize"></button>
                        <button class="btn-maximize" title="Maximize"></button>
                        <button class="btn-close"    title="Close"></button>
                    </div>
                </div>
                <iframe
                    src="/${encodeURIComponent(opts.slug)}/${encodeURIComponent(id)}/"
                    class="window-content"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                ></iframe>
                <div class="resize resize-n"></div>
                <div class="resize resize-s"></div>
                <div class="resize resize-w"></div>
                <div class="resize resize-e"></div>
                <div class="resize resize-nw"></div>
                <div class="resize resize-ne"></div>
                <div class="resize resize-sw"></div>
                <div class="resize resize-se"></div>
            `;

            this.desktop.appendChild(el);

            const info = {
                id, el,
                slug:  opts.slug,
                name:  opts.name || opts.slug,
                iframe: el.querySelector('iframe'),
                minimized: false,
                maximized: false,
                badge: 0,
                _restore: null,  // saved rect before maximize
            };
            this.windows.set(id, info);

            this._bindDrag(info);
            this._bindResize(info);
            this._bindControls(info);
            this._bindContextMenu(info);
            el.addEventListener('mousedown', () => this.focus(id), true);

            if (opts.maximized) this.maximize(id);
            this._emit();
            return id;
        }

        close(id) {
            const info = this.windows.get(id);
            if (!info) return;
            info.el.remove();
            this.windows.delete(id);
            this._emit();
        }

        /* ──────────── Focus / Minimize / Maximize ──────── */

        focus(id) {
            const info = this.windows.get(id);
            if (!info) return;
            this.windows.forEach(w => w.el.classList.remove('focused'));
            info.el.style.zIndex = ++this._topZ;
            info.el.classList.add('focused');
            if (info.minimized) {
                info.minimized = false;
                info.el.classList.remove('minimized');
            }
            this._emit();
        }

        minimize(id) {
            const info = this.windows.get(id);
            if (!info) return;
            info.minimized = true;
            info.el.classList.add('minimized');
            this._emit();
        }

        maximize(id) {
            const info = this.windows.get(id);
            if (!info || info.maximized) return;
            const s = info.el.style;
            info._restore = { left: s.left, top: s.top, width: s.width, height: s.height };
            info.maximized = true;
            info.el.classList.add('maximized');
            this._emit();
        }

        restore(id) {
            const info = this.windows.get(id);
            if (!info || !info.maximized) return;
            info.maximized = false;
            info.el.classList.remove('maximized');
            if (info._restore) {
                Object.assign(info.el.style, info._restore);
                info._restore = null;
            }
            this._emit();
        }

        toggleMaximize(id) {
            const info = this.windows.get(id);
            if (!info) return;
            info.maximized ? this.restore(id) : this.maximize(id);
        }

        /* ──────────────── Metadata helpers ─────────────── */

        setTitle(id, title) {
            const info = this.windows.get(id);
            if (!info) return;
            info.name = title;
            info.el.querySelector('.window-title').textContent = title;
            this._emit();
        }

        setBadge(id, count) {
            const info = this.windows.get(id);
            if (!info) return;
            info.badge = count;
            this._emit();
        }

        findBySource(source) {
            for (const [id, info] of this.windows) {
                if (info.iframe?.contentWindow === source) return id;
            }
            return null;
        }

        getWindowInfo(id) {
            const info = this.windows.get(id);
            if (!info) return null;
            return { id, slug: info.slug, name: info.name, minimized: info.minimized, maximized: info.maximized };
        }

        /** Serialize all windows for state persistence. */
        serialize() {
            const wins = [];
            for (const [, info] of this.windows) {
                const r = info.el.getBoundingClientRect();
                wins.push({
                    slug: info.slug,
                    name: info.name,
                    instanceId: info.id,
                    x: parseInt(info.el.style.left) || 0,
                    y: parseInt(info.el.style.top)  || 0,
                    width:  info.maximized ? (info._restore ? parseInt(info._restore.width)  : r.width)  : r.width,
                    height: info.maximized ? (info._restore ? parseInt(info._restore.height) : r.height) : r.height,
                    minimized: info.minimized,
                    maximized: info.maximized,
                });
            }
            return { windows: wins };
        }

        /* ────────────── Internal: drag ────────────────── */

        _bindDrag(info) {
            const bar = info.el.querySelector('.window-titlebar');
            let startX, startY, origX, origY;
            let rafId = 0;
            let lastE = null;

            const applyMove = () => {
                rafId = 0;
                if (!lastE) return;
                const dx = lastE.clientX - startX;
                const dy = lastE.clientY - startY;
                info.el.style.transform = `translate(${dx}px, ${dy}px)`;
            };

            const onMove = (e) => {
                lastE = e;
                if (!rafId) rafId = requestAnimationFrame(applyMove);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                // Commit final position to left/top, clear transform
                if (lastE) {
                    info.el.style.left = (origX + lastE.clientX - startX) + 'px';
                    info.el.style.top  = (origY + lastE.clientY - startY) + 'px';
                }
                info.el.style.transform = '';
                info.el.style.willChange = '';
                this.desktop.classList.remove('wm-dragging');
                this._emit();
            };

            bar.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                if (info.maximized) return;
                this.focus(info.id);
                startX = e.clientX; startY = e.clientY;
                origX = parseInt(info.el.style.left) || 0;
                origY = parseInt(info.el.style.top)  || 0;
                lastE = null;
                // GPU-accelerate & block iframe pointer events
                info.el.style.willChange = 'transform';
                this.desktop.classList.add('wm-dragging');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                e.preventDefault();
            });

            // Double-click titlebar → toggle maximize
            bar.addEventListener('dblclick', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                this.toggleMaximize(info.id);
            });
        }

        /* ────────────── Internal: resize ──────────────── */

        _bindResize(info) {
            info.el.querySelectorAll('.resize').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    if (info.maximized) return;
                    this.focus(info.id);

                    const dir = [...handle.classList].find(c => c.startsWith('resize-'))?.replace('resize-', '') || '';
                    const startX = e.clientX, startY = e.clientY;
                    const origL = parseInt(info.el.style.left) || 0;
                    const origT = parseInt(info.el.style.top)  || 0;
                    const origW = parseInt(info.el.style.width) || info.el.getBoundingClientRect().width;
                    const origH = parseInt(info.el.style.height) || info.el.getBoundingClientRect().height;
                    const minW = 360, minH = 240;
                    let rafId = 0;
                    let lastEv = null;

                    const applyResize = () => {
                        rafId = 0;
                        if (!lastEv) return;
                        const dx = lastEv.clientX - startX;
                        const dy = lastEv.clientY - startY;
                        let l = origL, t = origT, w = origW, h = origH;

                        if (dir.includes('e')) w = Math.max(minW, origW + dx);
                        if (dir.includes('s')) h = Math.max(minH, origH + dy);
                        if (dir.includes('w')) { w = Math.max(minW, origW - dx); l = origL + origW - w; }
                        if (dir.includes('n')) { h = Math.max(minH, origH - dy); t = origT + origH - h; }

                        Object.assign(info.el.style, {
                            left: l + 'px', top: t + 'px',
                            width: w + 'px', height: h + 'px',
                        });
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
                        this.desktop.classList.remove('wm-dragging');
                        this._emit();
                    };
                    this.desktop.classList.add('wm-dragging');
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                    e.preventDefault();
                });
            });
        }

        /* ────────────── Pop out to browser tab ────────── */

        popOut(id) {
            const info = this.windows.get(id);
            if (!info) return;

            const url = `/${encodeURIComponent(info.slug)}/${encodeURIComponent(info.id)}/`;
            const opened = window.open(url, '_blank');
            if (opened) {
                // Just minimize — the iframe stays alive and synchronized via SharedWorker.
                // User can restore it anytime; both views stay in sync.
                this.minimize(id);
            } else {
                document.dispatchEvent(new CustomEvent('zro:shell:notify', {
                    detail: { title: 'Popup blocked', body: 'Please allow popups for this site, then try again.' }
                }));
            }
        }

        /* ────────────── Internal: controls ────────────── */

        _bindControls(info) {
            info.el.querySelector('.btn-popout').addEventListener('click', () => this.popOut(info.id));
            info.el.querySelector('.btn-minimize').addEventListener('click', () => this.minimize(info.id));
            info.el.querySelector('.btn-maximize').addEventListener('click', () => this.toggleMaximize(info.id));
            info.el.querySelector('.btn-close').addEventListener('click',    () => this.close(info.id));
        }

        /* ────────────── Internal: context menu ─────────── */

        _bindContextMenu(info) {
            const bar = info.el.querySelector('.window-titlebar');
            bar.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._showContextMenu(info, e.clientX, e.clientY);
            });
        }

        _showContextMenu(info, x, y) {
            // Remove any existing menu
            this._removeContextMenu();

            const menu = document.createElement('div');
            menu.className = 'wm-context-menu';
            menu.style.left = x + 'px';
            menu.style.top  = y + 'px';

            const items = [
                { label: 'Open in new window', icon: '↗', action: () => this.popOut(info.id) },
                { label: 'separator' },
                { label: 'Minimize',  icon: '—', action: () => this.minimize(info.id) },
                { label: info.maximized ? 'Restore' : 'Maximize', icon: '□', action: () => this.toggleMaximize(info.id) },
                { label: 'separator' },
                { label: 'Close',     icon: '✕', action: () => this.close(info.id) },
            ];

            for (const item of items) {
                if (item.label === 'separator') {
                    const sep = document.createElement('div');
                    sep.className = 'wm-ctx-sep';
                    menu.appendChild(sep);
                    continue;
                }
                const row = document.createElement('div');
                row.className = 'wm-ctx-item';
                row.innerHTML = `<span class="wm-ctx-icon">${item.icon || ''}</span><span>${esc(item.label)}</span>`;
                row.addEventListener('click', () => {
                    this._removeContextMenu();
                    item.action();
                });
                menu.appendChild(row);
            }

            document.body.appendChild(menu);

            // Clamp to viewport
            requestAnimationFrame(() => {
                const rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
                if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
            });

            // Close on any click / Escape
            const close = (e) => {
                if (!menu.contains(e.target)) this._removeContextMenu();
            };
            const closeKey = (e) => {
                if (e.key === 'Escape') this._removeContextMenu();
            };
            // Delay to avoid the same click closing the menu
            setTimeout(() => {
                document.addEventListener('mousedown', close, { once: true, capture: true });
                document.addEventListener('keydown', closeKey, { once: true });
            }, 0);
            this._ctxMenu = { el: menu, close, closeKey };
        }

        _removeContextMenu() {
            if (!this._ctxMenu) return;
            this._ctxMenu.el.remove();
            document.removeEventListener('mousedown', this._ctxMenu.close, { capture: true });
            document.removeEventListener('keydown', this._ctxMenu.closeKey);
            this._ctxMenu = null;
        }

        /* ────────────── Internal: emit change ─────────── */

        _emit() {
            document.dispatchEvent(new CustomEvent('zro:wm:change'));
        }
    }

    /* ── Helpers ──────────────────────────────────────── */

    function esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    window.WindowManager = WindowManager;
})();
