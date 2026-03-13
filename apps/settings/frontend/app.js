(function() {
    const SLUG = ZroClient.slugFromUrl() || 'settings';
    let conn = null;
    let currentTheme = null;

    // Shell communication via postMessage (settings runs in iframe inside shell)
    function tellShell(method, payload) {
        try {
            window.parent.postMessage({
                type: 'zro:shell:' + method,
                payload: payload || {}
            }, window.location.origin);
        } catch (_) {}
    }

    // Navigation
    document.getElementById('nav').addEventListener('click', e => {
        const btn = e.target.closest('.nav-item');
        if (!btn) return;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('page-' + btn.dataset.page).classList.add('active');
    });

    // Themes
    async function loadThemes() {
        try {
            const themes = await conn.invoke('get_available_themes');
            const grid = document.getElementById('theme-grid');
            grid.innerHTML = '';
            themes.forEach(t => {
                const card = document.createElement('div');
                card.className = 'theme-card' + (t.id === currentTheme ? ' selected' : '');
                card.innerHTML = `<div class="theme-name">${t.name}</div><div class="theme-type">${t.type}</div>`;
                // Show a preview swatch
                card.style.borderLeft = '4px solid var(--zro-accent, #89b4fa)';
                card.addEventListener('click', () => {
                    document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    currentTheme = t.id;
                    conn.invoke('__kv:set', { key: 'theme', value: t.id });
                    // Apply locally (this iframe) + notify shell
                    document.documentElement.setAttribute('data-theme', t.id);
                    tellShell('applyTheme', { theme: t.id });
                });
                grid.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load themes', err);
        }
    }

    // Wallpaper — color
    document.getElementById('apply-wallpaper').addEventListener('click', () => {
        const color = document.getElementById('wallpaper-color').value;
        const cfg = { type: 'color', value: color };
        conn.invoke('__kv:set', { key: 'wallpaper', value: JSON.stringify(cfg) });
        tellShell('applyWallpaper', cfg);
    });

    // Wallpaper — image URL
    document.getElementById('apply-wallpaper-img').addEventListener('click', () => {
        const url = document.getElementById('wallpaper-url').value.trim();
        if (!url) return;
        const cfg = { type: 'image', value: url };
        conn.invoke('__kv:set', { key: 'wallpaper', value: JSON.stringify(cfg) });
        tellShell('applyWallpaper', cfg);
    });

    // Font size
    document.getElementById('font-size').addEventListener('change', e => {
        conn.invoke('__kv:set', { key: 'font_size', value: e.target.value });
    });

    // Notification settings
    document.getElementById('notif-enabled').addEventListener('change', e => {
        conn.invoke('__kv:set', { key: 'notif_enabled', value: String(e.target.checked) });
    });
    document.getElementById('notif-dnd').addEventListener('change', e => {
        conn.invoke('__kv:set', { key: 'notif_dnd', value: String(e.target.checked) });
    });
    document.getElementById('notif-duration').addEventListener('change', e => {
        conn.invoke('__kv:set', { key: 'notif_duration', value: e.target.value });
    });

    // Account
    async function loadAccount() {
        try {
            const info = await conn.invoke('get_settings');
            document.getElementById('acct-username').textContent = info.username || '—';
            document.getElementById('acct-role').textContent = info.role || '—';
        } catch (err) { console.error(err); }
    }

    // About
    async function loadAbout() {
        try {
            const about = await conn.invoke('get_system_about');
            document.getElementById('about-hostname').textContent = about.hostname || '—';
            document.getElementById('about-os').textContent = about.os || '—';
            document.getElementById('about-kernel').textContent = about.kernel || '—';
            document.getElementById('about-arch').textContent = about.arch || '—';
            document.getElementById('about-uptime').textContent = about.uptime || '—';
            document.getElementById('about-runtime').textContent = 'v' + (about.runtime_version || '?');
        } catch (err) { console.error(err); }
    }

    // Load saved settings
    async function loadSaved() {
        try {
            const theme = await conn.invoke('__kv:get', { key: 'theme' });
            if (theme) {
                currentTheme = theme;
                document.documentElement.setAttribute('data-theme', theme);
            }
            const fontSize = await conn.invoke('__kv:get', { key: 'font_size' });
            if (fontSize) document.getElementById('font-size').value = fontSize;
            const dnd = await conn.invoke('__kv:get', { key: 'notif_dnd' });
            if (dnd === 'true') document.getElementById('notif-dnd').checked = true;
            const wallpaper = await conn.invoke('__kv:get', { key: 'wallpaper' });
            if (wallpaper) {
                try {
                    const cfg = JSON.parse(wallpaper);
                    if (cfg.type === 'color') {
                        document.getElementById('wallpaper-color').value = cfg.value;
                    } else if (cfg.type === 'image') {
                        document.getElementById('wallpaper-url').value = cfg.value;
                    }
                } catch (_) {}
            }
        } catch (_) {}
    }

    conn = ZroClient.connect({
        slug: SLUG,
        async onConnect() {
            await loadSaved();
            loadThemes();
            loadAccount();
            loadAbout();
        },
        onDisconnect() { console.warn('settings: disconnected'); },
        onError(e) { console.error('settings: WS error', e); },
    });
})();
