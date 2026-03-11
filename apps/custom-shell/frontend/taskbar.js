/**
 * taskbar.js — Taskbar for Custom Shell
 *
 * Shows a button for each open window and a clock.
 * Listens to `zro:wm:change` events to auto-refresh.
 */
(function () {
    'use strict';

    class Taskbar {
        constructor(wm) {
            this.wm = wm;
            this._winsEl  = document.getElementById('taskbar-windows');
            this._clockEl = document.getElementById('taskbar-clock');

            document.addEventListener('zro:wm:change', () => this.render());
            this._tick();
            setInterval(() => this._tick(), 10_000);
        }

        render() {
            this._winsEl.innerHTML = '';

            for (const [id, info] of this.wm.windows) {
                const btn = document.createElement('button');
                btn.className = 'taskbar-btn';
                if (info.el.classList.contains('focused') && !info.minimized) {
                    btn.classList.add('active');
                }

                let label = esc(info.name);
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

                this._winsEl.appendChild(btn);
            }
        }

        _tick() {
            const now = new Date();
            this._clockEl.textContent =
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0');
        }
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    window.Taskbar = Taskbar;
})();
