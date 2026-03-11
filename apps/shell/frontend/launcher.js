/**
 * Launcher — Fetches the list of apps from /api/apps and displays a grid overlay.
 */
(function () {
    'use strict';

    class Launcher {
        constructor(wm) {
            this.wm = wm;
            this._el = document.getElementById('launcher');
            this._grid = document.getElementById('launcher-apps');
            this._apps = [];

            // Toggle on launcher button click
            document.getElementById('launcher-btn').addEventListener('click', () => this.toggle());

            // Close on background click
            this._el.addEventListener('click', (e) => {
                if (e.target === this._el) this.hide();
            });

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !this._el.classList.contains('hidden')) {
                    this.hide();
                }
            });

            // Load apps list
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
                console.warn('Launcher: failed to fetch apps', err);
            }
        }

        toggle() {
            this._el.classList.toggle('hidden');
        }

        show() {
            this._el.classList.remove('hidden');
        }

        hide() {
            this._el.classList.add('hidden');
        }

        _render() {
            this._grid.innerHTML = '';
            for (const app of this._apps) {
                // Skip the shell itself (by slug)
                if (app.slug === 'shell') continue;

                const card = document.createElement('div');
                card.className = 'launcher-app';
                card.innerHTML = `
                    <div class="app-name">${this._esc(app.name)}</div>
                    <div class="app-desc">${this._esc(app.description || '')}</div>
                `;
                card.addEventListener('click', () => {
                    this.hide();
                    this.wm.open({ slug: app.slug, name: app.name });
                });
                this._grid.appendChild(card);
            }

            if (this._apps.filter((a) => a.slug !== 'shell').length === 0) {
                this._grid.innerHTML = '<div style="text-align:center;color:var(--zro-text-dim);grid-column:1/-1">No applications installed</div>';
            }
        }

        _esc(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    }

    window.Launcher = Launcher;
})();
