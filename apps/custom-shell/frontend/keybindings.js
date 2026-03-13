/**
 * keybindings.js — Global keyboard shortcuts for Custom Shell
 *
 * Captures keyboard events at the document level and dispatches
 * shell actions. Works with the WindowManager, Launcher, etc.
 *
 * Shortcuts:
 *   Meta (Super)        → Toggle launcher
 *   Alt+Tab             → Application switcher
 *   Alt+F4              → Close focused window
 *   Super+D             → Show desktop (minimize all)
 *   Super+Left/Right    → Snap left/right
 *   Super+Up            → Maximize
 *   Super+Down          → Restore/minimize
 *   Super+L             → Lock screen
 *   Ctrl+Alt+T          → Open terminal
 *   Super+E             → Open file manager
 */
(function () {
    'use strict';

    class Keybindings {
        constructor(wm, launcher) {
            this.wm = wm;
            this.launcher = launcher;
            this._altTabActive = false;
            this._altTabIndex = 0;
            this._metaAlone = false;

            this._switcherEl = document.getElementById('switcher');
            this._switcherPanel = document.getElementById('switcher-panel');

            document.addEventListener('keydown', (e) => this._onKeyDown(e), true);
            document.addEventListener('keyup', (e) => this._onKeyUp(e), true);
        }

        _onKeyDown(e) {
            // Track Meta key alone (no combos)
            if (e.key === 'Meta') {
                this._metaAlone = true;
                return;
            }
            if (this._metaAlone && e.key !== 'Meta') {
                this._metaAlone = false;
            }

            // Alt+Tab — Application switcher
            if (e.altKey && e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                if (!this._altTabActive) {
                    this._startAltTab();
                } else {
                    this._cycleAltTab(e.shiftKey ? -1 : 1);
                }
                return;
            }

            // Alt+F4 — Close focused window
            if (e.altKey && e.key === 'F4') {
                e.preventDefault();
                var focused = this.wm.getFocusedId();
                if (focused) this.wm.close(focused);
                return;
            }

            // Super + key combos
            if (e.metaKey) {
                this._metaAlone = false;
                switch (e.key) {
                    case 'd': case 'D':
                        e.preventDefault();
                        this.wm.showDesktop();
                        break;
                    case 'l': case 'L':
                        e.preventDefault();
                        document.dispatchEvent(new CustomEvent('zro:shell:lock'));
                        break;
                    case 'e': case 'E':
                        e.preventDefault();
                        this.wm.open({ slug: 'files', name: 'Files' });
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        this._snapFocused('left');
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        this._snapFocused('right');
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        var fid = this.wm.getFocusedId();
                        if (fid) this.wm.maximize(fid);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        var fid2 = this.wm.getFocusedId();
                        if (fid2) {
                            var info = this.wm.windows.get(fid2);
                            if (info && (info.maximized || info.snapped)) this.wm.restore(fid2);
                            else if (fid2) this.wm.minimize(fid2);
                        }
                        break;
                }
                return;
            }

            // Ctrl+Alt+T — Open terminal
            if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
                e.preventDefault();
                this.wm.open({ slug: 'terminal', name: 'Terminal' });
                return;
            }
        }

        _onKeyUp(e) {
            // Meta released alone → toggle launcher
            if (e.key === 'Meta' && this._metaAlone) {
                this._metaAlone = false;
                this.launcher.toggle();
                return;
            }

            // Alt released → commit alt-tab selection
            if ((e.key === 'Alt' || !e.altKey) && this._altTabActive) {
                this._commitAltTab();
                return;
            }
        }

        _snapFocused(zone) {
            var fid = this.wm.getFocusedId();
            if (fid) this.wm.snap(fid, zone);
        }

        /* ──────── Alt+Tab Switcher ──────── */

        _startAltTab() {
            var list = this.wm.getList();
            if (list.length < 2) return;

            this._altTabActive = true;
            this._altTabList = list;
            this._altTabIndex = 1; // Start on second window

            this._renderSwitcher();
            this._switcherEl.classList.remove('hidden');
        }

        _cycleAltTab(dir) {
            if (!this._altTabList || this._altTabList.length === 0) return;
            this._altTabIndex += dir;
            var len = this._altTabList.length;
            if (this._altTabIndex < 0) this._altTabIndex = len - 1;
            if (this._altTabIndex >= len) this._altTabIndex = 0;
            this._renderSwitcher();
        }

        _renderSwitcher() {
            this._switcherPanel.innerHTML = '';
            for (var i = 0; i < this._altTabList.length; i++) {
                var win = this._altTabList[i];
                var item = document.createElement('div');
                item.className = 'switcher-item';
                if (i === this._altTabIndex) item.classList.add('selected');
                item.innerHTML =
                    '<span class="sw-icon">' + (win.icon || '\uD83D\uDCE6') + '</span>' +
                    '<span class="sw-title">' + esc(win.name) + '</span>';
                this._switcherPanel.appendChild(item);
            }
        }

        _commitAltTab() {
            this._altTabActive = false;
            this._switcherEl.classList.add('hidden');
            if (this._altTabList && this._altTabList.length > 0) {
                var selected = this._altTabList[this._altTabIndex];
                if (selected) this.wm.focus(selected.id);
            }
            this._altTabList = null;
        }
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    window.Keybindings = Keybindings;
})();
