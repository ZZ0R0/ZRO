(function() {
    const video = document.getElementById('video');
    const snapCanvas = document.getElementById('snap-canvas');
    const cameraSelect = document.getElementById('camera-select');
    const filterSelect = document.getElementById('filter-select');
    const galleryGrid = document.getElementById('gallery-grid');
    const noCamera = document.getElementById('no-camera');
    let stream = null;
    const captures = [];

    async function listDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        cameraSelect.innerHTML = '';
        cams.forEach((cam, i) => {
            const opt = document.createElement('option');
            opt.value = cam.deviceId;
            opt.textContent = cam.label || `Camera ${i + 1}`;
            cameraSelect.appendChild(opt);
        });
    }

    async function startCamera(deviceId) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera API not available (requires HTTPS or localhost)');
            }
            const constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false };
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            video.style.display = 'block';
            noCamera.style.display = 'none';
            await listDevices();
        } catch (err) {
            console.warn('Camera error:', err.name, err.message);
            video.style.display = 'none';
            noCamera.style.display = 'block';
            if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                noCamera.innerHTML = '<p>📷 No camera detected</p><p>No webcam found on this device</p>';
            } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                noCamera.innerHTML = '<p>📷 Camera access denied</p><p>Grant camera permission in your browser settings</p>';
            } else if (err.name === 'NotReadableError') {
                noCamera.innerHTML = '<p>📷 Camera in use</p><p>Another application may be using the camera</p>';
            } else {
                noCamera.innerHTML = '<p>📷 Camera not available</p><p>' + (err.message || 'Unknown error') + '</p>';
            }
        }
    }

    cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value));

    // Filter
    filterSelect.addEventListener('change', () => {
        video.style.filter = filterSelect.value === 'none' ? '' : filterSelect.value;
    });

    // Capture
    document.getElementById('btn-capture').addEventListener('click', () => {
        if (!stream) return;
        snapCanvas.width = video.videoWidth;
        snapCanvas.height = video.videoHeight;
        const ctx = snapCanvas.getContext('2d');
        // Apply filter to canvas
        ctx.filter = filterSelect.value === 'none' ? 'none' : filterSelect.value;
        ctx.drawImage(video, 0, 0);
        ctx.filter = 'none';
        const dataUrl = snapCanvas.toDataURL('image/png');
        captures.unshift(dataUrl);
        if (captures.length > 20) captures.pop();
        renderGallery();
    });

    function renderGallery() {
        galleryGrid.innerHTML = '';
        captures.forEach(dataUrl => {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = 'capture-' + Date.now() + '.png';
                a.click();
            });
            galleryGrid.appendChild(img);
        });
    }

    startCamera();
})();
