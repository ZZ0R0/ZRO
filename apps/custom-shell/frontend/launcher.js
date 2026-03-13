/**
 * launcher.js — App launcher for Custom Shell
 *
 * Full-featured launcher with search, categories, keyboard navigation,
 * favorites, and quick action buttons.
 *
 * Public API:
 *   launcher.toggle() / launcher.show() / launcher.hide()
 *   launcher.refresh()
 */
(function () {
    'use strict';

    class Launcher {
        constructor(wm) {
            this.wm = wm;
            this._el    = document.getElementById('launcher');
            this._grid  = document.getElementById('launcher-grid');
            this._search = document.getElementById('launcher-search');
            this._cats  = document.getElementById('launcher-categories');
            this._apps  = [];
            this._filtered = [];
            this._selectedIdx = -1;
            this._activeCat = 'all';

            // Launcher button
            document.getElementById('launcher-btn').addEventListener('click', () => this.toggle());

            // Backdrop close
            this._el.querySelector('.launcher-backdrop').addEventListener('click', () => this.hide());

            // Escape to close
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !this._el.classList.contains('hidden')) this.hide();
            });

            // Search input
            this._search.addEventListener('input', () => this._filter());

            // Category buttons
            this._cats.addEventListener('click', (e) => {
                var btn = e.target.closest('.cat-btn');
                if (!btn) return;
                this._activeCat = btn.dataset.cat;
                this._cats.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._filter();
            });

            // Keyboard navigation
            this._search.addEventListener('keydown', (e) => this._onSearchKey(e));

            // Action buttons
            document.getElementById('launcher-lock').addEventListener('click', () => {
                this.hide();
                document.dispatchEvent(new CustomEvent('zro:shell:lock'));
            });
            document.getElementById('launcher-logout').addEventListener('click', () => {
                this.hide();
                window.location.href = '/auth/logout';
            });
            document.getElementById('launcher-settings').addEventListener('click', () => {
                this.hide();
                this.wm.open({ slug: 'settings', name: 'Settings' });
            });

            this.refresh();
        }

        async refresh() {
            try {
                var resp = await fetch('/api/apps', { credentials: 'same-origin' });
                if (resp.ok) {
                    this._apps = await resp.json();
                    this._filter();
                }
            } catch (err) {
                console.warn('[Launcher] fetch apps failed', err);
            }
        }

        toggle() {
            if (this._el.classList.contains('hidden')) this.show();
            else this.hide();
        }

        show() {
            this._el.classList.remove('hidden');
            this._search.value = '';
            this._selectedIdx = -1;
            this._filter();
            // Focus search after animation
            setTimeout(() => this._search.focus(), 50);
        }

        hide() {
            this._el.classList.add('hidden');
            this._search.value = '';
        }

        _filter() {
            var query = this._search.value.trim().toLowerCase();
            var cat  = this._activeCat;

            this._filtered = this._apps.filter(function(a) {
                if (a.slug === 'custom-shell' || a.slug === 'shell') return false;
                // Category filter
                if (cat !== 'all') {
                    var appCat = (a.category || '').toLowerCase();
                    if (appCat !== cat) return false;
                }
                // Search filter
                if (query) {
                    var name = (a.name || '').toLowerCase();
                    var desc = (a.description || '').toLowerCase();
                    var slug = (a.slug || '').toLowerCase();
                    if (name.indexOf(query) === -1 && desc.indexOf(query) === -1 && slug.indexOf(query) === -1) {
                        return false;
                    }
                }
                return true;
            });

            this._selectedIdx = -1;
            this._render();
        }

        _onSearchKey(e) {
            var cols = Math.max(1, Math.floor(this._grid.offsetWidth / 108));
            var len = this._filtered.length;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._selectedIdx = Math.min(this._selectedIdx + cols, len - 1);
                this._highlightSelected();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._selectedIdx = Math.max(this._selectedIdx - cols, -1);
                this._highlightSelected();
            } else if (e.key === 'ArrowRight') {
                if (this._selectedIdx >= 0) {
                    e.preventDefault();
                    this._selectedIdx = Math.min(this._selectedIdx + 1, len - 1);
                    this._highlightSelected();
                }
            } else if (e.key === 'ArrowLeft') {
                if (this._selectedIdx >= 0) {
                    e.preventDefault();
                    this._selectedIdx = Math.max(this._selectedIdx - 1, 0);
                    this._highlightSelected();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this._selectedIdx >= 0 && this._selectedIdx < len) {
                    this._launch(this._filtered[this._selectedIdx]);
                } else if (len > 0) {
                    this._launch(this._filtered[0]);
                }
            }
        }

        _highlightSelected() {
            var cards = this._grid.querySelectorAll('.launcher-app');
            cards.forEach(function(c, i) {
                c.classList.toggle('selected', i === this._selectedIdx);
            }.bind(this));
        }

        _launch(app) {
            this.hide();
            this.wm.open({ slug: app.slug, name: app.name, icon: this._icon(app.slug) });
        }

        _render() {
            this._grid.innerHTML = '';
            var apps = this._filtered;

            if (apps.length === 0) {
                this._grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--shell-text-dim);padding:20px">No applications found</div>';
                return;
            }

            for (var i = 0; i < apps.length; i++) {
                var app = apps[i];
                var card = document.createElement('div');
                card.className = 'launcher-app';
                card.tabIndex = 0;
                card.setAttribute('role', 'button');
                card.setAttribute('aria-label', app.name);
                card.innerHTML =
                    '<div class="app-icon">' + this._icon(app.slug) + '</div>' +
                    '<div class="app-name">' + esc(app.name) + '</div>';
                card.addEventListener('click', (function(a) {
                    return function() { this._launch(a); }.bind(this);
                }.bind(this))(app));
                this._grid.appendChild(card);
            }
        }

        _icon(slug) {
            var icons = {
                notes: '\uD83D\uDCDD', files: '\uD83D\uDCC1', terminal: '\uD83D\uDCBB',
                tasks: '\u2705', monitor: '\uD83D\uDCCA',
                settings: '\u2699\uFE0F', browser: '\uD83C\uDF10', calculator: '\uD83E\uDDEE',
                camera: '\uD83D\uDCF7', screenshot: '\uD83D\uDCF8',
            };
            return icons[slug] || '\uD83D\uDCE6';
        }
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    window.Launcher = Launcher;
})();
