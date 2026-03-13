(function() {
    const SLUG = ZroClient.slugFromUrl() || 'monitor';
    let conn = null;
    const cpuHistory = [];
    const MAX_HISTORY = 60;
    let allProcs = [];

    // Tabs
    document.getElementById('tabs').addEventListener('click', e => {
        const btn = e.target.closest('.tab');
        if (!btn) return;
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });

    // Gauge helper: set arc based on percent (0-100)
    function setGauge(id, pct) {
        const el = document.getElementById(id);
        if (!el) return;
        const maxDash = 126;
        el.style.strokeDashoffset = maxDash - (maxDash * Math.min(pct, 100) / 100);
    }

    // --- Polling ---
    async function pollCpu() {
        try {
            const data = await conn.invoke('get_cpu_usage');
            document.getElementById('val-cpu').textContent = data.overall + '%';
            setGauge('gauge-cpu', data.overall);
            cpuHistory.push(data.overall);
            if (cpuHistory.length > MAX_HISTORY) cpuHistory.shift();
            drawCpuChart();
            // Per-core
            const grid = document.getElementById('cpu-cores');
            grid.innerHTML = '';
            (data.cores || []).forEach(c => {
                const d = document.createElement('div');
                d.className = 'core-item';
                d.innerHTML = `<div class="core-label">Core ${c.core}</div><div class="core-val">${c.usage}%</div>`;
                grid.appendChild(d);
            });
        } catch (_) {}
    }

    async function pollMem() {
        try {
            const m = await conn.invoke('get_memory_info');
            document.getElementById('val-mem').textContent = m.percent + '%';
            setGauge('gauge-mem', m.percent);
            document.getElementById('ram-detail').textContent = `${m.used_mb} / ${m.total_mb} MB`;
            document.getElementById('bar-ram').style.width = m.percent + '%';
            const swapPct = m.swap_total_mb > 0 ? (m.swap_used_mb / m.swap_total_mb * 100).toFixed(0) : 0;
            document.getElementById('swap-detail').textContent = `${m.swap_used_mb} / ${m.swap_total_mb} MB`;
            document.getElementById('bar-swap').style.width = swapPct + '%';
        } catch (_) {}
    }

    async function pollLoad() {
        try {
            const l = await conn.invoke('get_load_average');
            document.getElementById('val-load1').textContent = l.load1.toFixed(2);
            document.getElementById('val-load5').textContent = l.load5.toFixed(2);
            document.getElementById('val-load15').textContent = l.load15.toFixed(2);
        } catch (_) {}
    }

    async function pollProcs() {
        try {
            allProcs = await conn.invoke('get_processes');
            renderProcs();
        } catch (_) {}
    }

    async function pollDisks() {
        try {
            const disks = await conn.invoke('get_disk_usage');
            const list = document.getElementById('disk-list');
            list.innerHTML = '';
            disks.forEach(d => {
                const card = document.createElement('div');
                card.className = 'disk-card';
                card.innerHTML = `<div class="disk-mount">${d.mount}</div>
                    <div class="disk-info">${d.used_gb.toFixed(1)} / ${d.total_gb.toFixed(1)} GB (${d.percent}%)</div>
                    <div class="bar"><div class="bar-fill" style="width:${d.percent}%"></div></div>`;
                list.appendChild(card);
            });
        } catch (_) {}
    }

    // Process table
    function renderProcs() {
        const filter = (document.getElementById('proc-search').value || '').toLowerCase();
        const body = document.getElementById('proc-body');
        body.innerHTML = '';
        const filtered = allProcs.filter(p => !filter || p.command.toLowerCase().includes(filter) || String(p.pid).includes(filter) || p.user.toLowerCase().includes(filter));
        filtered.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${p.pid}</td><td>${p.user}</td><td>${p.cpu}</td><td>${p.mem}</td><td>${p.state}</td><td title="${esc(p.command)}">${esc(p.command)}</td>`;
            body.appendChild(tr);
        });
    }
    document.getElementById('proc-search').addEventListener('input', renderProcs);

    function esc(s) {
        const d = document.createElement('span');
        d.textContent = s;
        return d.innerHTML;
    }

    // CPU chart (simple canvas sparkline)
    function drawCpuChart() {
        const canvas = document.getElementById('cpu-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.clientWidth;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        if (cpuHistory.length < 2) return;
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--zro-accent').trim() || '#89b4fa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const step = w / (MAX_HISTORY - 1);
        cpuHistory.forEach((v, i) => {
            const x = i * step;
            const y = h - (v / 100 * h);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        // Fill
        ctx.lineTo((cpuHistory.length - 1) * step, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fillStyle = (ctx.strokeStyle || '#89b4fa') + '22';
        ctx.fill();
    }

    // Poll loop
    async function poll() {
        await Promise.all([pollCpu(), pollMem(), pollLoad(), pollDisks()]);
        // Only poll procs when that tab is visible
        if (document.getElementById('tab-processes').classList.contains('active')) {
            await pollProcs();
        }
    }

    conn = ZroClient.connect({
        slug: SLUG,
        onConnect() {
            poll();
            setInterval(poll, 2000);
        },
        onDisconnect() { console.warn('monitor: disconnected'); },
        onError(e) { console.error('monitor: WS error', e); },
    });
})();
