/**
 * Taskbar — Buttons for open windows, launcher trigger, and clock.
 */
(function () {
    'use strict';

    class Taskbar {
        constructor(wm) {
            this.wm = wm;
            this._appsEl = document.getElementById('taskbar-apps');
            this._clockEl = document.getElementById('taskbar-clock');

            // Re-render whenever windows change
            document.addEventListener('zro:wm:change', () => this.render());

            // Start clock
            this._updateClock();
            setInterval(() => this._updateClock(), 10000);
        }

        render() {
            this._appsEl.innerHTML = '';

            for (const [id, info] of this.wm.windows) {
                const btn = document.createElement('button');
                btn.className = 'taskbar-btn';
                if (info.el.classList.contains('focused') && !info.minimized) {
                    btn.classList.add('active');
                }

                let label = this._esc(info.name);
                if (info.badge > 0) {
                    label += `<span class="taskbar-badge">${info.badge}</span>`;
                }
                btn.innerHTML = label;

                btn.addEventListener('click', () => {
                    if (info.minimized || !info.el.classList.contains('focused')) {
                        this.wm.focus(id);
                    } else {
                        this.wm.minimize(id);
                    }
                });

                this._appsEl.appendChild(btn);
            }
        }

        _updateClock() {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            this._clockEl.textContent = `${hh}:${mm}`;
        }

        _esc(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }
    }

    window.Taskbar = Taskbar;
})();
