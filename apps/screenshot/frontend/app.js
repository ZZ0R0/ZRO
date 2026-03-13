(function() {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const placeholder = document.getElementById('placeholder');
    const annoBar = document.getElementById('annotation-bar');
    let baseImage = null;
    let currentTool = 'select';
    let strokes = []; // undo stack
    let drawing = false;
    let startX, startY;

    async function capture(delay) {
        if (delay) await new Promise(r => setTimeout(r, delay));
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const track = stream.getVideoTracks()[0];
            const imageCapture = new ImageCapture(track);
            const bitmap = await imageCapture.grabFrame();
            track.stop();
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            ctx.drawImage(bitmap, 0, 0);
            baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
            bitmap.close();
            canvas.style.display = 'block';
            placeholder.style.display = 'none';
            annoBar.style.display = 'flex';
            document.getElementById('btn-save').disabled = false;
            document.getElementById('btn-copy').disabled = false;
            strokes = [];
        } catch (err) {
            console.error('Capture failed:', err);
        }
    }

    document.getElementById('btn-capture').addEventListener('click', () => capture(0));
    document.getElementById('btn-delay').addEventListener('click', () => capture(3000));

    document.getElementById('btn-save').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = 'screenshot-' + Date.now() + '.png';
        a.click();
    });

    document.getElementById('btn-copy').addEventListener('click', async () => {
        try {
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        } catch (_) {}
    });

    // Tool selection
    document.getElementById('annotation-bar').addEventListener('click', e => {
        const btn = e.target.closest('.tool');
        if (!btn) return;
        currentTool = btn.dataset.tool;
        document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });

    // Drawing
    canvas.addEventListener('mousedown', e => {
        if (currentTool === 'select') return;
        drawing = true;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        startX = (e.clientX - rect.left) * scaleX;
        startY = (e.clientY - rect.top) * scaleY;
        if (currentTool === 'pen') {
            strokes.push({ type: 'pen', color: document.getElementById('anno-color').value, size: parseInt(document.getElementById('anno-size').value), points: [{ x: startX, y: startY }] });
        }
    });

    canvas.addEventListener('mousemove', e => {
        if (!drawing) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        if (currentTool === 'pen') {
            const stroke = strokes[strokes.length - 1];
            stroke.points.push({ x, y });
            redraw();
        }
    });

    canvas.addEventListener('mouseup', e => {
        if (!drawing) return;
        drawing = false;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const endX = (e.clientX - rect.left) * scaleX;
        const endY = (e.clientY - rect.top) * scaleY;
        if (currentTool === 'rect') {
            strokes.push({ type: 'rect', color: document.getElementById('anno-color').value, size: parseInt(document.getElementById('anno-size').value), x: startX, y: startY, w: endX - startX, h: endY - startY });
            redraw();
        } else if (currentTool === 'text') {
            const text = prompt('Enter text:');
            if (text) {
                strokes.push({ type: 'text', color: document.getElementById('anno-color').value, size: parseInt(document.getElementById('anno-size').value) * 5 + 12, x: startX, y: startY, text });
                redraw();
            }
        }
    });

    function redraw() {
        if (baseImage) ctx.putImageData(baseImage, 0, 0);
        strokes.forEach(s => {
            ctx.strokeStyle = s.color;
            ctx.fillStyle = s.color;
            ctx.lineWidth = s.size;
            if (s.type === 'pen' && s.points.length > 1) {
                ctx.beginPath();
                ctx.moveTo(s.points[0].x, s.points[0].y);
                s.points.forEach(p => ctx.lineTo(p.x, p.y));
                ctx.stroke();
            } else if (s.type === 'rect') {
                ctx.strokeRect(s.x, s.y, s.w, s.h);
            } else if (s.type === 'text') {
                ctx.font = s.size + 'px sans-serif';
                ctx.fillText(s.text, s.x, s.y);
            }
        });
    }

    document.getElementById('btn-undo').addEventListener('click', () => {
        strokes.pop();
        redraw();
    });
})();
