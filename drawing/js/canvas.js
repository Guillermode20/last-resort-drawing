const CanvasManager = (function () {
    let canvas, ctx;
    let scale = 1;
    let zoomLevel = Config.canvas.DEFAULT_ZOOM;
    let offsetX = 0;
    let offsetY = 0;
    let panOffsetX = 0;
    let panOffsetY = 0;

    function init() {
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d');
        resize();

        // Set initial styles
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        updateScale();
    }

    function updateScale() {
        // Calculate the base scale to fit the virtual canvas while maintaining aspect ratio
        const containerAspectRatio = canvas.width / canvas.height;
        const virtualAspectRatio = Config.canvas.VIRTUAL_WIDTH / Config.canvas.VIRTUAL_HEIGHT;

        let baseScale;
        if (containerAspectRatio > virtualAspectRatio) {
            // Window is wider than needed
            baseScale = canvas.height / Config.canvas.VIRTUAL_HEIGHT;
            offsetX = (canvas.width - Config.canvas.VIRTUAL_WIDTH * baseScale) / 2;
            offsetY = 0;
        } else {
            // Window is taller than needed
            baseScale = canvas.width / Config.canvas.VIRTUAL_WIDTH;
            offsetX = 0;
            offsetY = (canvas.height - Config.canvas.VIRTUAL_HEIGHT * baseScale) / 2;
        }

        // Apply the zoom level to the base scale
        scale = baseScale * zoomLevel;

        // Calculate center point
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        // Apply transform with zoom and pan
        ctx.setTransform(
            scale, 0, 0, scale,
            centerX - (Config.canvas.VIRTUAL_WIDTH / 2 * scale) + panOffsetX,
            centerY - (Config.canvas.VIRTUAL_HEIGHT / 2 * scale) + panOffsetY
        );

        // Position controls
        UIManager.updateControlsPosition();
    }

    function clearAndDrawBorder() {
        // Clear the entire canvas
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Draw border around virtual canvas
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2 / zoomLevel; // Adjust border width based on zoom
        ctx.strokeRect(0, 0, Config.canvas.VIRTUAL_WIDTH, Config.canvas.VIRTUAL_HEIGHT);
    }

    function adjustZoom(delta) {
        const newZoom = Math.max(Config.canvas.MIN_ZOOM, Math.min(Config.canvas.MAX_ZOOM, zoomLevel + delta));
        zoomLevel = newZoom;
        UIManager.updateZoomDisplay(zoomLevel);
        updateScale();
        DrawingManager.redrawCanvasWithState();
    }

    function resetZoom() {
        zoomLevel = Config.canvas.DEFAULT_ZOOM;
        panOffsetX = 0;
        panOffsetY = 0;
        UIManager.updateZoomDisplay(zoomLevel);
        updateScale();
        DrawingManager.redrawCanvasWithState();
    }

    function updatePan(dx, dy) {
        panOffsetX += dx;
        panOffsetY += dy;
        updateScale();
        DrawingManager.redrawCanvasWithState();
    }

    function getContext() {
        return ctx;
    }

    function getCanvas() {
        return canvas;
    }

    function getZoomLevel() {
        return zoomLevel;
    }

    function getVirtualPoint(clientX, clientY) {
        // Get the current transform matrix
        const transform = ctx.getTransform();

        // Convert screen coordinates to canvas coordinates
        const transformedX = (clientX - transform.e) / transform.a;
        const transformedY = (clientY - transform.f) / transform.d;

        // Normalize to 0-1 range and clamp
        return {
            x: Math.max(0, Math.min(1, transformedX / Config.canvas.VIRTUAL_WIDTH)),
            y: Math.max(0, Math.min(1, transformedY / Config.canvas.VIRTUAL_HEIGHT))
        };
    }

    // Public API
    return {
        init,
        resize,
        clearAndDrawBorder,
        adjustZoom,
        resetZoom,
        updatePan,
        getContext,
        getCanvas,
        getZoomLevel,
        getVirtualPoint,
        updateScale
    };
})();
