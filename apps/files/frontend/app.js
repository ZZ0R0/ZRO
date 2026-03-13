(function () {
    'use strict';

    const SLUG = ZroClient.slugFromUrl() || 'files';
    let currentPath = '/';
    let entries = [];
    let selectedEntry = null;
    let conn = null;

    // DOM refs
    const breadcrumb = document.getElementById('breadcrumb');
    const fileTbody = document.getElementById('file-tbody');
    const previewPanel = document.getElementById('preview-panel');
    const previewFilename = document.getElementById('preview-filename');
    const previewContent = document.getElementById('preview-content');
    const pathInput = document.getElementById('path-input');
    const btnBack = document.getElementById('btn-back');
    const btnGo = document.getElementById('btn-go');
    const btnClosePreview = document.getElementById('btn-close-preview');
    const ctxMenu = document.getElementById('ctx-menu');

    // --- Connect ---
    conn = ZroClient.connect({
        slug: SLUG,
        onConnect() { navigate('/'); },
        onDisconnect() { console.warn('files: disconnected'); },
        onError(e) { console.error('files: WS error', e); },
    });

    // --- Navigation ---
    async function navigate(path) {
        currentPath = path || '/';
        selectedEntry = null;
        closePreview();
        if (pathInput) pathInput.value = currentPath;
        try {
            const data = await conn.invoke('ls', { path: currentPath });
            entries = data.entries || [];
            renderBreadcrumb();
            renderFileList();
        } catch (e) {
            console.error('Failed to list directory:', e);
            entries = [];
            renderBreadcrumb();
            renderFileList();
        }
    }

    // --- Render ---
    function renderBreadcrumb() {
        const parts = currentPath.split('/').filter(Boolean);
        let html = '<span class="crumb" data-path="/">/</span>';
        let accumulated = '';
        for (let i = 0; i < parts.length; i++) {
            accumulated += '/' + parts[i];
            const isCurrent = i === parts.length - 1;
            html += '<span class="crumb-sep">/</span>';
            html += `<span class="crumb${isCurrent ? ' current' : ''}" data-path="${escapeAttr(accumulated)}">${escapeHtml(parts[i])}</span>`;
        }
        breadcrumb.innerHTML = html;

        breadcrumb.querySelectorAll('.crumb:not(.current)').forEach(el => {
            el.addEventListener('click', () => navigate(el.dataset.path));
        });
    }

    function renderFileList() {
        if (entries.length === 0) {
            fileTbody.innerHTML = '<tr class="empty-row"><td colspan="4">Empty directory</td></tr>';
            return;
        }
        fileTbody.innerHTML = entries.map((e, i) => {
            const icon = e.type === 'dir' ? '📁' : fileIcon(e.name);
            const size = e.type === 'dir' ? '—' : formatSize(e.size);
            const date = e.modified ? new Date(e.modified).toLocaleString() : '';
            return `<tr data-index="${i}" data-name="${escapeAttr(e.name)}" data-type="${e.type}">
                <td class="file-icon">${icon}</td>
                <td>${escapeHtml(e.name)}</td>
                <td class="file-size">${size}</td>
                <td class="file-date">${date}</td>
            </tr>`;
        }).join('');

        fileTbody.querySelectorAll('tr').forEach(tr => {
            tr.addEventListener('click', () => onRowClick(tr));
            tr.addEventListener('dblclick', () => onRowDblClick(tr));
            tr.addEventListener('contextmenu', (e) => onRowContext(e, tr));
        });
    }

    // --- File interactions ---
    function onRowClick(tr) {
        fileTbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
        const idx = parseInt(tr.dataset.index);
        selectedEntry = entries[idx];

        if (selectedEntry && selectedEntry.type === 'file') {
            openPreview(selectedEntry.name);
        } else {
            closePreview();
        }
    }

    function onRowDblClick(tr) {
        const idx = parseInt(tr.dataset.index);
        const entry = entries[idx];
        if (entry && entry.type === 'dir') {
            const newPath = currentPath === '/' ? '/' + entry.name : currentPath + '/' + entry.name;
            navigate(newPath);
        }
    }

    // --- Preview ---
    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];

    function getExt(name) {
        return (name.split('.').pop() || '').toLowerCase();
    }

    function isImageFile(name) {
        return IMAGE_EXTS.includes(getExt(name));
    }

    function mimeFromExt(name) {
        const ext = getExt(name);
        const map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif',
                      svg:'image/svg+xml', webp:'image/webp', bmp:'image/bmp', ico:'image/x-icon' };
        return map[ext] || 'application/octet-stream';
    }

    async function openPreview(filename) {
        const filePath = currentPath === '/' ? '/' + filename : currentPath + '/' + filename;
        previewFilename.textContent = filename;
        previewContent.innerHTML = '<span>Loading…</span>';
        previewPanel.classList.remove('hidden');
        try {
            const data = await conn.invoke('read_file', { path: filePath });
            if (data.binary && data.base64 && isImageFile(filename)) {
                const mime = mimeFromExt(filename);
                previewContent.innerHTML = '<img src="data:' + mime + ';base64,' + data.base64 + '" style="max-width:100%;max-height:80vh;object-fit:contain;" />';
            } else if (data.binary && data.base64) {
                previewContent.innerHTML = '<span>[Binary file — ' + formatSize(data.size) + ']</span>';
            } else if (data.error) {
                previewContent.innerHTML = '';
                previewContent.textContent = data.error;
            } else {
                previewContent.innerHTML = '';
                previewContent.textContent = data.content;
            }
        } catch (e) {
            previewContent.innerHTML = '';
            previewContent.textContent = 'Error: ' + (e.message || e);
        }
    }

    function closePreview() {
        previewPanel.classList.add('hidden');
    }

    btnClosePreview.addEventListener('click', closePreview);

    // --- Context menu ---
    let ctxTarget = null;

    function onRowContext(e, tr) {
        e.preventDefault();
        const idx = parseInt(tr.dataset.index);
        ctxTarget = entries[idx] || null;
        selectedEntry = ctxTarget;

        fileTbody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');

        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        ctxMenu.classList.remove('hidden');
    }

    // Also show ctx menu on background right-click
    document.getElementById('file-list').addEventListener('contextmenu', (e) => {
        if (e.target.closest('tr')) return; // handled by row handler
        e.preventDefault();
        ctxTarget = null;
        ctxMenu.style.left = e.clientX + 'px';
        ctxMenu.style.top = e.clientY + 'px';
        ctxMenu.classList.remove('hidden');
    });

    document.addEventListener('click', () => {
        ctxMenu.classList.add('hidden');
    });

    ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
        item.addEventListener('click', async () => {
            const action = item.dataset.action;
            ctxMenu.classList.add('hidden');

            if (action === 'open' && ctxTarget) {
                if (ctxTarget.type === 'dir') {
                    const newPath = currentPath === '/' ? '/' + ctxTarget.name : currentPath + '/' + ctxTarget.name;
                    navigate(newPath);
                } else {
                    openPreview(ctxTarget.name);
                }
            } else if (action === 'download' && ctxTarget && ctxTarget.type === 'file') {
                downloadFile(ctxTarget.name);
            } else if (action === 'delete' && ctxTarget) {
                if (!confirm('Delete "' + ctxTarget.name + '"?')) return;
                const targetPath = currentPath === '/' ? '/' + ctxTarget.name : currentPath + '/' + ctxTarget.name;
                try {
                    await conn.invoke('rm', { path: targetPath });
                    navigate(currentPath);
                } catch (e) {
                    alert('Delete failed: ' + (e.message || e));
                }
            } else if (action === 'new-file') {
                const name = prompt('File name:');
                if (!name) return;
                const targetPath = currentPath === '/' ? '/' + name : currentPath + '/' + name;
                try {
                    await conn.invoke('touch', { path: targetPath });
                    navigate(currentPath);
                } catch (e) {
                    alert('Create failed: ' + (e.message || e));
                }
            } else if (action === 'new-folder') {
                const name = prompt('Folder name:');
                if (!name) return;
                const targetPath = currentPath === '/' ? '/' + name : currentPath + '/' + name;
                try {
                    await conn.invoke('mkdir', { path: targetPath });
                    navigate(currentPath);
                } catch (e) {
                    alert('Create failed: ' + (e.message || e));
                }
            }
        });
    });

    // --- Download ---
    async function downloadFile(filename) {
        const filePath = currentPath === '/' ? '/' + filename : currentPath + '/' + filename;
        try {
            const data = await conn.invoke('read_file', { path: filePath });
            let blob;
            if (data.binary && data.base64) {
                const raw = atob(data.base64);
                const arr = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
                blob = new Blob([arr], { type: mimeFromExt(filename) });
            } else if (data.content !== undefined) {
                blob = new Blob([data.content], { type: 'text/plain;charset=utf-8' });
            } else {
                alert('Cannot download this file');
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('Download failed: ' + (e.message || e));
        }
    }

    // --- Helpers ---
    function fileIcon(name) {
        const ext = (name.split('.').pop() || '').toLowerCase();
        const icons = {
            js: '📄', ts: '📄', py: '🐍', rs: '🦀', go: '📄',
            html: '🌐', css: '🎨', json: '📋', toml: '⚙️', yaml: '⚙️', yml: '⚙️',
            md: '📝', txt: '📝', log: '📝',
            png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼', webp: '🖼',
            zip: '📦', tar: '📦', gz: '📦',
            sh: '⚡', bash: '⚡',
        };
        return icons[ext] || '📄';
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const val = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
        return val + ' ' + units[i];
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // --- Toolbar handlers ---
    btnBack.addEventListener('click', () => {
        if (currentPath === '/') return;
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        navigate(parts.length ? '/' + parts.join('/') : '/');
    });

    btnGo.addEventListener('click', () => {
        const val = pathInput.value.trim();
        if (val) navigate(val);
    });

    pathInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = pathInput.value.trim();
            if (val) navigate(val);
        }
    });

    // --- Init (navigate will be called by onConnect) ---
})();
