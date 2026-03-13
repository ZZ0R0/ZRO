(function() {
    const SLUG = ZroClient.slugFromUrl() || 'browser';
    let conn = null;
    let tabs = [];
    let activeTabId = null;
    let nextId = 1;

    const frame = document.getElementById('web-frame');
    const urlInput = document.getElementById('url-input');
    const ntpEl = document.getElementById('new-tab-page');
    const tabsList = document.getElementById('tabs-list');

    // --- Tab management ---
    function createTab(url) {
        const tab = { id: nextId++, url: url || '', title: 'New Tab', history: [], histIdx: -1 };
        tabs.push(tab);
        switchTab(tab.id);
        renderTabs();
        return tab;
    }

    function switchTab(id) {
        activeTabId = id;
        const tab = tabs.find(t => t.id === id);
        if (!tab) return;
        if (tab.url) {
            navigate(tab.url, false);
        } else {
            frame.style.display = 'none';
            ntpEl.classList.add('visible');
            urlInput.value = '';
        }
        renderTabs();
    }

    function closeTab(id) {
        tabs = tabs.filter(t => t.id !== id);
        if (tabs.length === 0) {
            createTab();
        } else if (activeTabId === id) {
            switchTab(tabs[tabs.length - 1].id);
        }
        renderTabs();
    }

    function renderTabs() {
        tabsList.innerHTML = '';
        tabs.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'browser-tab' + (t.id === activeTabId ? ' active' : '');
            btn.innerHTML = `<span>${esc(t.title || 'New Tab')}</span><span class="tab-close" data-id="${t.id}">✕</span>`;
            btn.addEventListener('click', e => {
                if (e.target.classList.contains('tab-close')) {
                    closeTab(Number(e.target.dataset.id));
                } else {
                    switchTab(t.id);
                }
            });
            tabsList.appendChild(btn);
        });
    }

    document.getElementById('btn-new-tab').addEventListener('click', () => createTab());

    const errorEl = document.getElementById('frame-error');
    const errorUrlEl = document.getElementById('error-url');
    let currentRealUrl = '';

    // --- Navigation ---
    function navigate(url, addHistory) {
        if (!url) return;
        // Auto-add protocol
        if (!/^https?:\/\//i.test(url)) {
            if (/\.\w{2,}/.test(url) && !url.includes(' ')) {
                url = 'https://' + url;
            } else {
                url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
            }
        }
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) {
            if (addHistory !== false && tab.url) {
                tab.history.push(tab.url);
                tab.histIdx = tab.history.length;
            }
            tab.url = url;
            tab.title = new URL(url).hostname;
            // Record in backend history
            conn.invoke('add_history_entry', { url, title: tab.title }).catch(() => {});
        }
        currentRealUrl = url;
        errorEl.classList.add('hidden');
        frame.style.display = 'block';
        frame.src = url;
        ntpEl.classList.remove('visible');
        urlInput.value = url;
        renderTabs();
    }

    // Detect load errors (X-Frame-Options, CSP frame-ancestors block)
    frame.addEventListener('load', () => {
        try {
            // If we can access contentDocument, the frame loaded from same origin (shouldn't happen for external)
            // If blocked by X-Frame-Options, the frame shows an error page.
            // Some browsers fire 'load' even on blocked frames; we check if it's a blank/error page.
            const doc = frame.contentDocument;
            if (doc && doc.URL === 'about:blank' && currentRealUrl) {
                showFrameError(currentRealUrl);
            }
        } catch (_) {
            // Cross-origin: can't access contentDocument — that's normal and means it loaded
        }
    });

    frame.addEventListener('error', () => {
        if (currentRealUrl) showFrameError(currentRealUrl);
    });

    function showFrameError(url) {
        frame.style.display = 'none';
        errorUrlEl.textContent = url;
        errorEl.classList.remove('hidden');
    }

    document.getElementById('btn-open-external').addEventListener('click', () => {
        if (currentRealUrl) window.open(currentRealUrl, '_blank', 'noopener');
    });

    urlInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            navigate(urlInput.value.trim(), true);
        }
    });

    document.getElementById('btn-go').addEventListener('click', () => {
        navigate(urlInput.value.trim(), true);
    });

    document.getElementById('btn-back').addEventListener('click', () => {
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab && tab.history.length > 0) {
            const prev = tab.history.pop();
            navigate(prev, false);
        }
    });

    document.getElementById('btn-forward').addEventListener('click', () => {
        // Simple forward not tracked fully in this implementation
    });

    document.getElementById('btn-reload').addEventListener('click', () => {
        if (frame.src) frame.src = frame.src;
    });

    // --- Bookmarks ---
    document.getElementById('btn-bookmark').addEventListener('click', async () => {
        const tab = tabs.find(t => t.id === activeTabId);
        if (!tab || !tab.url) return;
        await conn.invoke('add_bookmark', { url: tab.url, title: tab.title });
        loadBookmarks();
    });

    document.getElementById('btn-bookmarks-panel').addEventListener('click', () => {
        togglePanel('bookmarks-panel');
        loadBookmarks();
    });

    async function loadBookmarks() {
        try {
            const bm = await conn.invoke('get_bookmarks');
            const list = document.getElementById('bookmarks-list');
            list.innerHTML = '';
            (bm || []).forEach(b => {
                const item = document.createElement('div');
                item.className = 'panel-item';
                item.innerHTML = `<span>${esc(b.title)}</span><span class="item-url">${esc(b.url)}</span>
                    <div class="item-actions"><button data-url="${esc(b.url)}">Open</button><button data-rm="${b.id}">Remove</button></div>`;
                item.querySelector('[data-url]').addEventListener('click', () => navigate(b.url, true));
                item.querySelector('[data-rm]').addEventListener('click', async () => {
                    await conn.invoke('remove_bookmark', { id: b.id });
                    loadBookmarks();
                });
                list.appendChild(item);
            });
            // Update NTP tiles
            const ntp = document.getElementById('ntp-bookmarks');
            ntp.innerHTML = '';
            (bm || []).slice(0, 8).forEach(b => {
                const tile = document.createElement('div');
                tile.className = 'ntp-tile';
                tile.innerHTML = `<span class="ntp-icon">🔗</span><span>${esc(b.title)}</span>`;
                tile.addEventListener('click', () => navigate(b.url, true));
                ntp.appendChild(tile);
            });
        } catch (_) {}
    }

    // --- History ---
    document.getElementById('btn-history-panel').addEventListener('click', () => {
        togglePanel('history-panel');
        loadHistory();
    });

    async function loadHistory() {
        try {
            const hist = await conn.invoke('get_history', { limit: 50 });
            const list = document.getElementById('history-list');
            list.innerHTML = '';
            (hist || []).forEach(h => {
                const item = document.createElement('div');
                item.className = 'panel-item';
                item.innerHTML = `<span>${esc(h.title || h.url)}</span><span class="item-url">${esc(h.url)}</span>`;
                item.addEventListener('click', () => navigate(h.url, true));
                list.appendChild(item);
            });
        } catch (_) {}
    }

    document.getElementById('btn-clear-history').addEventListener('click', async () => {
        await conn.invoke('clear_history');
        document.getElementById('history-list').innerHTML = '';
    });

    // --- Panels ---
    function togglePanel(id) {
        const panel = document.getElementById(id);
        const isOpen = panel.classList.contains('open');
        document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
        if (!isOpen) panel.classList.add('open');
    }

    document.querySelectorAll('.panel-close').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.dataset.close).classList.remove('open');
        });
    });

    // --- Escape helper ---
    function esc(s) {
        const d = document.createElement('span');
        d.textContent = s || '';
        return d.innerHTML;
    }

    conn = ZroClient.connect({
        slug: SLUG,
        onConnect() {
            createTab();
            loadBookmarks();
        },
        onDisconnect() { console.warn('browser: disconnected'); },
        onError(e) { console.error('browser: WS error', e); },
    });
})();
