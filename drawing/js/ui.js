const UIManager = (function() {
    const zoomValueDisplay = document.getElementById('zoom-value');
    const widthControl = document.getElementById('width-control');
    
    function init() {
        // Set up color buttons
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelector('.color-btn.active').classList.remove('active');
                btn.classList.add('active');
                DrawingManager.setColor(btn.dataset.color);
            });
        });
        
        // Set up width control
        widthControl.addEventListener('input', (e) => {
            DrawingManager.setWidth(parseInt(e.target.value));
        });
        
        // Set up zoom buttons
        document.getElementById('zoom-in-btn').addEventListener('click', () => {
            CanvasManager.adjustZoom(0.1);
        });
        
        document.getElementById('zoom-out-btn').addEventListener('click', () => {
            CanvasManager.adjustZoom(-0.1);
        });
        
        document.getElementById('reset-zoom-btn').addEventListener('click', () => {
            CanvasManager.resetZoom();
        });
        
        // Set up keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === '=' || e.key === '+') {
                CanvasManager.adjustZoom(0.1);
            } else if (e.key === '-' || e.key === '_') {
                CanvasManager.adjustZoom(-0.1);
            } else if (e.key === '0') {
                CanvasManager.resetZoom();
            }
        });
        
        // Set up canvas event listeners
        const canvas = CanvasManager.getCanvas();
        
        // Mouse events
        canvas.addEventListener('mousedown', function(e) {
            if (e.button === 1 || (e.button === 0 && e.altKey)) {
                DrawingManager.startPanning(e);
            } else {
                DrawingManager.startDrawing(e);
            }
        });
        
        canvas.addEventListener('mousemove', function(e) {
            if (e.button === 1 || (e.button === 0 && e.altKey)) {
                DrawingManager.pan(e);
            } else {
                DrawingManager.draw(e);
            }
        });
        
        canvas.addEventListener('mouseup', function(e) {
            if (e.button === 1 || (e.button === 0 && e.altKey)) {
                DrawingManager.endPanning();
            } else {
                DrawingManager.endDrawing();
            }
        });
        
        canvas.addEventListener('mouseleave', function() {
            DrawingManager.endPanning();
            DrawingManager.endDrawing();
        });
        
        // Touch events
        canvas.addEventListener('touchstart', function(e) {
            if (e.touches.length === 2) {
                DrawingManager.startPanning(e);
            } else {
                DrawingManager.startDrawing(e);
            }
        });
        
        canvas.addEventListener('touchmove', function(e) {
            if (e.touches.length === 2) {
                DrawingManager.pan(e);
            } else {
                DrawingManager.draw(e);
            }
        });
        
        canvas.addEventListener('touchend', function() {
            DrawingManager.endPanning();
            DrawingManager.endDrawing();
        });
        
        // Wheel event for zooming
        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            CanvasManager.adjustZoom(delta);
        }, { passive: false });
        
        // Window resize event
        window.addEventListener('resize', function() {
            CanvasManager.resize();
            DrawingManager.redrawCanvasWithState();
        });
    }
    
    function updateControlsPosition() {
        const controls = document.getElementById('controls');
        // Position controls at the bottom of the screen
        controls.style.bottom = '10px';
        controls.style.top = 'auto';
    }
    
    function updateZoomDisplay(zoomLevel) {
        zoomValueDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
    }
    
    // Public API
    return {
        init,
        updateControlsPosition,
        updateZoomDisplay
    };
})();
