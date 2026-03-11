/**
 * launcher.js — App launcher for Custom Shell
 *
 * Fetches available apps from /api/apps and displays a grid overlay.
 * Clicking an app opens it in a new window via the WindowManager.
 */
(function () {
    'use strict';

    class Launcher {
        constructor(wm) {
            this.wm = wm;
            this._el   = document.getElementById('launcher');
            this._grid = document.getElementById('launcher-grid');
            this._apps = [];

            // Toggle launcher
            document.getElementById('launcher-btn').addEventListener('click', () => this.toggle());

            // Close on backdrop click
            this._el.querySelector('.launcher-backdrop').addEventListener('click', () => this.hide());

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !this._el.classList.contains('hidden')) this.hide();
            });

            this.refresh();
        }

        async refresh() {
            try {
                const resp = await fetch('/api/apps', { credentials: 'same-origin' });
                if (resp.ok) {
                    this._apps = await resp.json();
                    this._render();
                }
            } catch (err) {
                console.warn('[Launcher] failed to fetch apps', err);
            }
        }

        toggle() { this._el.classList.toggle('hidden'); }
        show()   { this._el.classList.remove('hidden'); }
        hide()   { this._el.classList.add('hidden'); }

        _render() {
            this._grid.innerHTML = '';

            // Filter out the shell itself
            const apps = this._apps.filter(a => a.slug !== 'custom-shell');

            if (apps.length === 0) {
                this._grid.innerHTML =
                    '<div style="grid-column:1/-1;text-align:center;color:var(--shell-text-dim)">No applications installed</div>';
                return;
            }

            for (const app of apps) {
                const card = document.createElement('div');
                card.className = 'launcher-app';
                card.innerHTML = `
                    <div class="app-icon">${this._icon(app.slug)}</div>
                    <div class="app-name">${esc(app.name)}</div>
                    <div class="app-desc">${esc(app.description || '')}</div>
                `;
                card.addEventListener('click', () => {
                    this.hide();
                    this.wm.open({ slug: app.slug, name: app.name });
                });
                this._grid.appendChild(card);
            }
        }

        /** Return a simple emoji icon based on slug. Override with real icons later. */
        _icon(slug) {
            const icons = {
                notes:    '📝',
                files:    '📁',
                terminal: '💻',
                tasks:    '✅',
                echo:     '🔊',
            };
            return icons[slug] || '📦';
        }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    window.Launcher = Launcher;
})();
