/**
 * taskbar.js — Taskbar for Custom Shell
 *
 * Shows window buttons with icons, system tray indicators, and enhanced clock.
 * Listens to `zro:wm:change` to auto-refresh window list.
 *
 * Public API:
 *   taskbar.render()
 *   taskbar.updateTray({ cpu, ram, disk, uptime })
 *   taskbar.setNotifBadge(count)
 *   taskbar.setUser(username)
 */
(function () {
    'use strict';

    class Taskbar {
        constructor(wm) {
            this.wm = wm;
            this._winsEl   = document.getElementById('taskbar-windows');
            this._clockTime = document.getElementById('clock-time');
            this._clockDate = document.getElementById('clock-date');
            this._cpuVal   = document.getElementById('tray-cpu-val');
            this._notifBadge = document.getElementById('tray-notif-badge');
            this._userName = document.getElementById('tray-user-name');

            document.addEventListener('zro:wm:change', () => this.render());
            this._tick();
            setInterval(() => this._tick(), 10000);
        }

        render() {
            this._winsEl.innerHTML = '';

            for (var entry of this.wm.windows) {
                var id = entry[0], info = entry[1];
                var btn = document.createElement('button');
                btn.className = 'taskbar-btn';
                if (info.el.classList.contains('focused') && !info.minimized) {
                    btn.classList.add('active');
                }

                var label = '<span class="taskbar-win-icon">' + (info.icon || '') + '</span> ' + esc(info.name);
                if (info.badge > 0) {
                    label += '<span class="taskbar-badge">' + info.badge + '</span>';
                }
                btn.innerHTML = label;

                btn.addEventListener('click', (function(winId, winInfo) {
                    return function() {
                        if (winInfo.minimized || !winInfo.el.classList.contains('focused')) {
                            this.wm.focus(winId);
                        } else {
                            this.wm.minimize(winId);
                        }
                    }.bind(this);
                }.bind(this))(id, info));

                this._winsEl.appendChild(btn);
            }
        }

        updateTray(data) {
            if (data.cpu != null) this._cpuVal.textContent = data.cpu + '%';
            // Also update quick settings metrics if visible
            var qsCpu  = document.getElementById('qs-cpu');
            var qsRam  = document.getElementById('qs-ram');
            var qsDisk = document.getElementById('qs-disk');
            var qsUp   = document.getElementById('qs-uptime');
            if (data.cpu != null && qsCpu)  qsCpu.textContent = data.cpu + '%';
            if (data.ram != null && qsRam)  qsRam.textContent = data.ram + '%';
            if (data.disk != null && qsDisk) qsDisk.textContent = data.disk + '%';
            if (data.uptime != null && qsUp) qsUp.textContent = data.uptime;
        }

        setNotifBadge(count) {
            if (count > 0) {
                this._notifBadge.textContent = count > 99 ? '99+' : count;
                this._notifBadge.classList.remove('hidden');
            } else {
                this._notifBadge.classList.add('hidden');
            }
        }

        setUser(username) {
            this._userName.textContent = username;
        }

        _tick() {
            var now = new Date();
            var h = String(now.getHours()).padStart(2, '0');
            var m = String(now.getMinutes()).padStart(2, '0');
            this._clockTime.textContent = h + ':' + m;

            var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            this._clockDate.textContent = days[now.getDay()] + ' ' + now.getDate() + ' ' + months[now.getMonth()];
        }
    }

    function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    window.Taskbar = Taskbar;
})();
