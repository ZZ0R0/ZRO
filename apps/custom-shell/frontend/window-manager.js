/**
 * window-manager.js — Window Manager for Custom Shell
 *
 * Creates, moves, resizes, focuses, minimizes, maximizes, snaps, and closes windows.
 * Each window loads a ZRO app inside an <iframe>.
 *
 * Public API:
 *   wm.open({ slug, name, icon?, instanceId?, x?, y?, width?, height?, maximized? }) → instanceId
 *   wm.close(id)
 *   wm.focus(id)
 *   wm.minimize(id) / wm.maximize(id) / wm.restore(id)
 *   wm.snap(id, zone) / wm.unsnap(id)
 *   wm.setTitle(id, title) / wm.setBadge(id, count)
 *   wm.serialize() → { windows: [...] }
 *   wm.findBySource(windowProxy) → instanceId | null
 *   wm.showDesktop() / wm.getList()
 *
 * Emits `zro:wm:change` on document after every mutation.
 */
(function () {
    'use strict';

    const SNAP_EDGE = 16;           // px from screen edge to trigger snap
    const MIN_W = 360, MIN_H = 240;
    const ANIM_DURATION = 200;      // ms — matches CSS --shell-anim

    class WindowManager {
        constructor(desktopEl) {
            this.desktop = desktopEl;
            this.windows = new Map();
            this._topZ = 100;
            this._counter = 0;
            this._snapPreview = document.getElementById('snap-preview');
            this._desktopShown = false;
            this._savedBeforeDesktop = null;
        }

        /* ────────────── Snap zone detection ───────────────── */

        /**
         * Given cursor position, return a snap zone name or null.
         * Zones: 'left','right','top','top-left','top-right','bottom-left','bottom-right'
         */
        _getSnapZone(cx, cy) {
            const dRect = this.desktop.getBoundingClientRect();
            const w = dRect.width, h = dRect.height;
            const nearL = cx - dRect.left < SNAP_EDGE;
            const nearR = dRect.right - cx < SNAP_EDGE;
            const nearT = cy - dRect.top < SNAP_EDGE;
            const nearB = dRect.bottom - cy < SNAP_EDGE;

            if (nearT && nearL) return 'top-left';
            if (nearT && nearR) return 'top-right';
            if (nearB && nearL) return 'bottom-left';
            if (nearB && nearR) return 'bottom-right';
            if (nearL)          return 'left';
            if (nearR)          return 'right';
            if (nearT)          return 'top';
            return null;
        }

        /** Get pixel rect for a snap zone. */
        _snapRect(zone) {
            const d = this.desktop.getBoundingClientRect();
            const hw = Math.round(d.width / 2), hh = Math.round(d.height / 2);
            switch (zone) {
                case 'left':         return { x: d.left, y: d.top, w: hw, h: d.height };
                case 'right':        return { x: d.left + hw, y: d.top, w: d.width - hw, h: d.height };
                case 'top':          return { x: d.left, y: d.top, w: d.width, h: d.height }; // maximize
                case 'top-left':     return { x: d.left, y: d.top, w: hw, h: hh };
                case 'top-right':    return { x: d.left + hw, y: d.top, w: d.width - hw, h: hh };
                case 'bottom-left':  return { x: d.left, y: d.top + hh, w: hw, h: d.height - hh };
                case 'bottom-right': return { x: d.left + hw, y: d.top + hh, w: d.width - hw, h: d.height - hh };
                default:             return null;
            }
        }

        _showSnapPreview(zone) {
            if (!zone) { this._hideSnapPreview(); return; }
            const r = this._snapRect(zone);
            if (!r) { this._hideSnapPreview(); return; }
            Object.assign(this._snapPreview.style, {
                left: r.x + 'px', top: r.y + 'px',
                width: r.w + 'px', height: r.h + 'px',
            });
            this._snapPreview.classList.remove('hidden');
        }

        _hideSnapPreview() {
            this._snapPreview.classList.add('hidden');
        }

        /* ────────────── Snap / Unsnap ─────────────────── */

        snap(id, zone) {
            const info = this.windows.get(id);
            if (!info) return;
            if (zone === 'top') { this.maximize(id); return; }
            const r = this._snapRect(zone);
            if (!r) return;
            // Save original rect for unsnap
            if (!info.snapped) {
                const s = info.el.style;
                info._snapRestore = { left: s.left, top: s.top, width: s.width, height: s.height };
            }
            info.snapped = zone;
            info.maximized = false;
            info.el.classList.remove('maximized');
            info.el.classList.add('snapped');
            const dRect = this.desktop.getBoundingClientRect();
            Object.assign(info.el.style, {
                left:   (r.x - dRect.left) + 'px',
                top:    (r.y - dRect.top) + 'px',
                width:  r.w + 'px',
                height: r.h + 'px',
            });
            this._emit();
        }

        unsnap(id) {
            const info = this.windows.get(id);
            if (!info || !info.snapped) return;
            info.snapped = null;
            info.el.classList.remove('snapped');
            if (info._snapRestore) {
                Object.assign(info.el.style, info._snapRestore);
                info._snapRestore = null;
            }
            this._emit();
        }

        /* ───────────────── Open / Close ───────────────── */

        open(opts) {
            const id = opts.instanceId || opts.slug + '-' + (++this._counter);

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
            el.className = 'window focused wm-opening';
            el.dataset.id = id;
            Object.assign(el.style, {
                left: x + 'px', top: y + 'px',
                width: w + 'px', height: h + 'px',
                zIndex: ++this._topZ,
            });

            const icon = opts.icon || this._defaultIcon(opts.slug);

            el.innerHTML =
                '<div class="window-titlebar">' +
                    '<span class="window-icon">' + icon + '</span>' +
                    '<span class="window-title">' + esc(opts.name || opts.slug) + '</span>' +
                    '<div class="window-controls">' +
                        '<button class="btn-popout"   title="Open in new window"></button>' +
                        '<button class="btn-minimize" title="Minimize"></button>' +
                        '<button class="btn-maximize" title="Maximize"></button>' +
                        '<button class="btn-close"    title="Close"></button>' +
                    '</div>' +
                '</div>' +
                '<iframe src="/' + encodeURIComponent(opts.slug) + '/' + encodeURIComponent(id) + '/?_v=' + Date.now() + '" ' +
                    'class="window-content" ' +
                    'allow="camera; microphone; display-capture" ' +
                    'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"></iframe>' +
                '<div class="resize resize-n"></div>' +
                '<div class="resize resize-s"></div>' +
                '<div class="resize resize-w"></div>' +
                '<div class="resize resize-e"></div>' +
                '<div class="resize resize-nw"></div>' +
                '<div class="resize resize-ne"></div>' +
                '<div class="resize resize-sw"></div>' +
                '<div class="resize resize-se"></div>';

            this.desktop.appendChild(el);

            const info = {
                id, el, slug: opts.slug,
                name: opts.name || opts.slug,
                icon: icon,
                iframe: el.querySelector('iframe'),
                minimized: false, maximized: false,
                snapped: null, badge: 0,
                _restore: null, _snapRestore: null,
            };
            this.windows.set(id, info);

            this._bindDrag(info);
            this._bindResize(info);
            this._bindControls(info);
            this._bindContextMenu(info);
            el.addEventListener('mousedown', () => this.focus(id), true);

            // Remove opening animation class
            setTimeout(() => el.classList.remove('wm-opening'), ANIM_DURATION);

            if (opts.maximized) this.maximize(id);
            this._emit();
            return id;
        }

        close(id) {
            const info = this.windows.get(id);
            if (!info) return;
            info.el.classList.add('wm-closing');
            // Remove after animation
            setTimeout(() => {
                info.el.remove();
                this.windows.delete(id);
                this._emit();
            }, 150);
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
            info.snapped = null;
            info.el.classList.remove('snapped');
            info.el.classList.add('maximized');
            this._emit();
        }

        restore(id) {
            const info = this.windows.get(id);
            if (!info) return;
            if (info.snapped) { this.unsnap(id); return; }
            if (!info.maximized) return;
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
            if (info.maximized || info.snapped) this.restore(id);
            else this.maximize(id);
        }

        /* ────────────── Show Desktop (Super+D) ────────── */

        showDesktop() {
            if (this._desktopShown) {
                // Restore all minimized windows
                if (this._savedBeforeDesktop) {
                    for (const id of this._savedBeforeDesktop) {
                        const info = this.windows.get(id);
                        if (info) {
                            info.minimized = false;
                            info.el.classList.remove('minimized');
                        }
                    }
                    this._savedBeforeDesktop = null;
                }
                this._desktopShown = false;
            } else {
                this._savedBeforeDesktop = [];
                for (const [id, info] of this.windows) {
                    if (!info.minimized) {
                        this._savedBeforeDesktop.push(id);
                        info.minimized = true;
                        info.el.classList.add('minimized');
                    }
                }
                this._desktopShown = true;
            }
            this._emit();
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
                if (info.iframe && info.iframe.contentWindow === source) return id;
            }
            return null;
        }

        getWindowInfo(id) {
            const info = this.windows.get(id);
            if (!info) return null;
            return {
                id: id, slug: info.slug, name: info.name, icon: info.icon,
                minimized: info.minimized, maximized: info.maximized, snapped: info.snapped,
            };
        }

        /** Get list of all windows (for alt-tab, etc.). */
        getList() {
            const list = [];
            for (const [id, info] of this.windows) {
                list.push({
                    id: id, slug: info.slug, name: info.name, icon: info.icon,
                    minimized: info.minimized, maximized: info.maximized,
                    focused: info.el.classList.contains('focused'),
                });
            }
            return list;
        }

        /** Get the focused window id. */
        getFocusedId() {
            for (const [id, info] of this.windows) {
                if (info.el.classList.contains('focused') && !info.minimized) return id;
            }
            return null;
        }

        serialize() {
            const wins = [];
            for (const [, info] of this.windows) {
                const r = info.el.getBoundingClientRect();
                wins.push({
                    slug: info.slug, name: info.name, instanceId: info.id, icon: info.icon,
                    x: parseInt(info.el.style.left) || 0,
                    y: parseInt(info.el.style.top) || 0,
                    width:  info.maximized ? (info._restore ? parseInt(info._restore.width)  : r.width)  : r.width,
                    height: info.maximized ? (info._restore ? parseInt(info._restore.height) : r.height) : r.height,
                    minimized: info.minimized, maximized: info.maximized, snapped: info.snapped,
                });
            }
            return { windows: wins };
        }

        /* ────────────── Internal: drag with snapping ──── */

        _bindDrag(info) {
            const bar = info.el.querySelector('.window-titlebar');
            let startX, startY, origX, origY;
            let rafId = 0, lastE = null;
            let currentSnap = null;

            const applyMove = () => {
                rafId = 0;
                if (!lastE) return;
                const dx = lastE.clientX - startX;
                const dy = lastE.clientY - startY;
                info.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
                // Detect snap zone
                const zone = this._getSnapZone(lastE.clientX, lastE.clientY);
                if (zone !== currentSnap) {
                    currentSnap = zone;
                    this._showSnapPreview(zone);
                }
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
                    info.el.style.top  = (origY + lastE.clientY - startY) + 'px';
                }
                info.el.style.transform = '';
                info.el.style.willChange = '';
                this.desktop.classList.remove('wm-dragging');
                this._hideSnapPreview();

                // Apply snap if in zone
                if (currentSnap) {
                    this.snap(info.id, currentSnap);
                }
                currentSnap = null;
                this._emit();
            };

            bar.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                // If maximized or snapped, unsnap/restore on drag start
                if (info.maximized) {
                    // Calculate proportional position before restoring
                    const pct = e.clientX / window.innerWidth;
                    this.restore(info.id);
                    const newW = parseInt(info.el.style.width) || 820;
                    info.el.style.left = (e.clientX - newW * pct) + 'px';
                    info.el.style.top = e.clientY - 19 + 'px';
                } else if (info.snapped) {
                    this.unsnap(info.id);
                }
                this.focus(info.id);
                startX = e.clientX; startY = e.clientY;
                origX = parseInt(info.el.style.left) || 0;
                origY = parseInt(info.el.style.top) || 0;
                lastE = null; currentSnap = null;
                info.el.style.willChange = 'transform';
                this.desktop.classList.add('wm-dragging');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                e.preventDefault();
            });

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
                    if (info.snapped) this.unsnap(info.id);
                    this.focus(info.id);

                    const dir = ([...handle.classList].find(c => c.startsWith('resize-')) || '').replace('resize-', '');
                    const startX = e.clientX, startY = e.clientY;
                    const origL = parseInt(info.el.style.left) || 0;
                    const origT = parseInt(info.el.style.top)  || 0;
                    const origW = parseInt(info.el.style.width)  || info.el.offsetWidth;
                    const origH = parseInt(info.el.style.height) || info.el.offsetHeight;
                    let rafId = 0, lastEv = null;

                    const applyResize = () => {
                        rafId = 0;
                        if (!lastEv) return;
                        const dx = lastEv.clientX - startX, dy = lastEv.clientY - startY;
                        let l = origL, t = origT, w = origW, h = origH;
                        if (dir.includes('e')) w = Math.max(MIN_W, origW + dx);
                        if (dir.includes('s')) h = Math.max(MIN_H, origH + dy);
                        if (dir.includes('w')) { w = Math.max(MIN_W, origW - dx); l = origL + origW - w; }
                        if (dir.includes('n')) { h = Math.max(MIN_H, origH - dy); t = origT + origH - h; }
                        Object.assign(info.el.style, {
                            left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px',
                        });
                    };

                    const onMove = (ev) => { lastEv = ev; if (!rafId) rafId = requestAnimationFrame(applyResize); };
                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                        if (lastEv) applyResize();
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
            var url = '/' + encodeURIComponent(info.slug) + '/' + encodeURIComponent(info.id) + '/';
            var opened = window.open(url, '_blank');
            if (opened) {
                this.minimize(id);
            } else {
                document.dispatchEvent(new CustomEvent('zro:shell:notify', {
                    detail: { title: 'Popup blocked', body: 'Please allow popups for this site.' }
                }));
            }
        }

        /* ────────────── Internal: controls ────────────── */

        _bindControls(info) {
            info.el.querySelector('.btn-popout').addEventListener('click', () => this.popOut(info.id));
            info.el.querySelector('.btn-minimize').addEventListener('click', () => this.minimize(info.id));
            info.el.querySelector('.btn-maximize').addEventListener('click', () => this.toggleMaximize(info.id));
            info.el.querySelector('.btn-close').addEventListener('click', () => this.close(info.id));
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
            this._removeContextMenu();
            const menu = document.createElement('div');
            menu.className = 'wm-context-menu';
            menu.style.left = x + 'px';
            menu.style.top  = y + 'px';

            var items = [
                { label: 'Open in new window', icon: '\u2197', action: () => this.popOut(info.id) },
                { label: 'separator' },
                { label: 'Snap Left',  icon: '\u25E7', action: () => this.snap(info.id, 'left') },
                { label: 'Snap Right', icon: '\u25E8', action: () => this.snap(info.id, 'right') },
                { label: 'separator' },
                { label: 'Minimize',   icon: '\u2014', action: () => this.minimize(info.id) },
                { label: info.maximized ? 'Restore' : 'Maximize', icon: '\u25A1', action: () => this.toggleMaximize(info.id) },
                { label: 'separator' },
                { label: 'Close',      icon: '\u2715', action: () => this.close(info.id) },
            ];

            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.label === 'separator') {
                    var sep = document.createElement('div');
                    sep.className = 'wm-ctx-sep';
                    menu.appendChild(sep);
                    continue;
                }
                var row = document.createElement('div');
                row.className = 'wm-ctx-item';
                row.innerHTML = '<span class="wm-ctx-icon">' + (item.icon || '') + '</span><span>' + esc(item.label) + '</span>';
                row.addEventListener('click', (function(act) { return function() { this._removeContextMenu(); act(); }.bind(this); }.bind(this))(item.action));
                menu.appendChild(row);
            }

            document.body.appendChild(menu);
            requestAnimationFrame(() => {
                var rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
                if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
            });

            var self = this;
            var close = function(e) { if (!menu.contains(e.target)) self._removeContextMenu(); };
            var closeKey = function(e) { if (e.key === 'Escape') self._removeContextMenu(); };
            setTimeout(function() {
                document.addEventListener('mousedown', close, { once: true, capture: true });
                document.addEventListener('keydown', closeKey, { once: true });
            }, 0);
            this._ctxMenu = { el: menu, close: close, closeKey: closeKey };
        }

        _removeContextMenu() {
            if (!this._ctxMenu) return;
            this._ctxMenu.el.remove();
            document.removeEventListener('mousedown', this._ctxMenu.close, { capture: true });
            document.removeEventListener('keydown', this._ctxMenu.closeKey);
            this._ctxMenu = null;
        }

        /* ────────────── Internal: helpers ──────────────── */

        _defaultIcon(slug) {
            var icons = {
                notes: '\uD83D\uDCDD', files: '\uD83D\uDCC1', terminal: '\uD83D\uDCBB',
                tasks: '\u2705', shell: '\uD83D\uDDA5',
                monitor: '\uD83D\uDCCA', settings: '\u2699\uFE0F', browser: '\uD83C\uDF10',
                calculator: '\uD83E\uDDEE', camera: '\uD83D\uDCF7',
                screenshot: '\uD83D\uDCF8',
            };
            return icons[slug] || '\uD83D\uDCE6';
        }

        _emit() {
            document.dispatchEvent(new CustomEvent('zro:wm:change'));
        }
    }

    function esc(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    window.WindowManager = WindowManager;
})();
