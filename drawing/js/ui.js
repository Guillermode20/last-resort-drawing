const UIManager = (function () {
    const zoomValueDisplay = document.getElementById('zoom-value');
    const widthControl = document.getElementById('width-control');
    let drawingMode = true; // true = draw, false = pan
    let pinchStartDistance = 0;
    let currentPinchDistance = 0;
    let pinchStartZoom = 1;
    let pinchIndicatorTimeout = null;

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

        // Set up undo button
        document.getElementById('undo-btn').addEventListener('click', () => {
            DrawingManager.undoLastDrawing();
        });

        // Set up drawing mode toggle for mobile
        const modeToggle = document.getElementById('mode-toggle');
        if (modeToggle) {
            modeToggle.addEventListener('click', toggleDrawingMode);
            updateModeToggleUI();
        }

        // Set up keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === '=' || e.key === '+') {
                CanvasManager.adjustZoom(0.1);
            } else if (e.key === '-' || e.key === '_') {
                CanvasManager.adjustZoom(-0.1);
            } else if (e.key === '0') {
                CanvasManager.resetZoom();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                // Ctrl+Z or Cmd+Z for undo
                e.preventDefault();
                DrawingManager.undoLastDrawing();
            } else if (e.key === 'm') {
                // 'm' to toggle drawing mode
                toggleDrawingMode();
            }
        });

        // Set up canvas event listeners
        const canvas = CanvasManager.getCanvas();

        // Mouse events
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseLeave);

        // Touch events
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

        // Wheel event for zooming
        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.1 : -0.1;
            CanvasManager.adjustZoom(delta);
        }, { passive: false });

        // Window resize event
        window.addEventListener('resize', function () {
            CanvasManager.resize();
            DrawingManager.redrawCanvasWithState();
        });

        // Create pinch indicator overlay if it doesn't exist
        createPinchIndicator();
    }

    function createPinchIndicator() {
        if (!document.querySelector('.pinch-indicator')) {
            const indicator = document.createElement('div');
            indicator.className = 'pinch-indicator';
            indicator.textContent = 'Zooming...';
            document.body.appendChild(indicator);
        }
    }

    function showPinchIndicator() {
        const indicator = document.querySelector('.pinch-indicator');
        if (indicator) {
            indicator.classList.add('active');
            
            // Clear any existing timeout
            if (pinchIndicatorTimeout) {
                clearTimeout(pinchIndicatorTimeout);
            }
        }
    }

    function hidePinchIndicator() {
        const indicator = document.querySelector('.pinch-indicator');
        if (indicator) {
            // Use timeout to avoid flicker during continuous pinch operations
            pinchIndicatorTimeout = setTimeout(() => {
                indicator.classList.remove('active');
            }, 500);
        }
    }

    function toggleDrawingMode() {
        drawingMode = !drawingMode;
        updateModeToggleUI();
    }

    function updateModeToggleUI() {
        const modeToggle = document.getElementById('mode-toggle');
        if (modeToggle) {
            if (drawingMode) {
                modeToggle.classList.add('draw-mode');
                modeToggle.classList.remove('pan-mode');
                modeToggle.innerHTML = '<span class="mode-icon">✏️</span> Draw';
            } else {
                modeToggle.classList.add('pan-mode');
                modeToggle.classList.remove('draw-mode');
                modeToggle.innerHTML = '<span class="mode-icon">👆</span> Pan';
            }
        }
    }

    function handleMouseDown(e) {
        if (e.button === 1 || (e.button === 0 && e.altKey) || !drawingMode) {
            DrawingManager.startPanning(e);
        } else {
            DrawingManager.startDrawing(e);
        }
    }

    function handleMouseMove(e) {
        if (e.button === 1 || (e.button === 0 && e.altKey) || !drawingMode) {
            DrawingManager.pan(e);
        } else {
            DrawingManager.draw(e);
        }
    }

    function handleMouseUp(e) {
        if (e.button === 1 || (e.button === 0 && e.altKey) || !drawingMode) {
            DrawingManager.endPanning();
        } else {
            DrawingManager.endDrawing();
        }
    }

    function handleMouseLeave() {
        DrawingManager.endPanning();
        DrawingManager.endDrawing();
    }

    function handleTouchStart(e) {
        e.preventDefault();
        
        if (e.touches.length === 2) {
            // Two fingers = zoom/pan gesture
            pinchStartDistance = getTouchDistance(e.touches);
            pinchStartZoom = CanvasManager.getZoomLevel();
            showPinchIndicator();
            
            // Start pan with midpoint of two touches
            const midpoint = getTouchMidpoint(e.touches);
            const simulatedEvent = createSimulatedEvent(midpoint.x, midpoint.y);
            DrawingManager.startPanning(simulatedEvent);
        } 
        else if (!drawingMode) {
            // Pan mode - one finger pan
            DrawingManager.startPanning(e);
        } 
        else {
            // Draw mode - one finger draw
            DrawingManager.startDrawing(e);
        }
    }

    function handleTouchMove(e) {
        e.preventDefault();
        
        if (e.touches.length === 2) {
            // Handle pinch-to-zoom
            currentPinchDistance = getTouchDistance(e.touches);
            const zoomDelta = (currentPinchDistance / pinchStartDistance) - 1;
            
            // Apply zoom based on pinch scale
            const newZoom = Math.max(
                Config.canvas.MIN_ZOOM, 
                Math.min(
                    Config.canvas.MAX_ZOOM, 
                    pinchStartZoom * (1 + zoomDelta)
                )
            );
            
            CanvasManager.setZoom(newZoom);
            updateZoomDisplay(newZoom);
            
            // Pan to midpoint of pinch
            const midpoint = getTouchMidpoint(e.touches);
            const simulatedEvent = createSimulatedEvent(midpoint.x, midpoint.y);
            DrawingManager.pan(simulatedEvent);
        }
        else if (!drawingMode) {
            // Pan mode - one finger pan
            DrawingManager.pan(e);
        }
        else {
            // Draw mode - one finger draw
            DrawingManager.draw(e);
        }
    }

    function handleTouchEnd(e) {
        e.preventDefault();
        
        // Hide pinch indicator when zoom gesture ends
        if (e.touches.length < 2) {
            hidePinchIndicator();
        }
        
        DrawingManager.endPanning();
        DrawingManager.endDrawing();
        
        // Reset pinch values
        pinchStartDistance = 0;
        currentPinchDistance = 0;
    }

    function getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchMidpoint(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function createSimulatedEvent(x, y) {
        return {
            clientX: x,
            clientY: y,
            preventDefault: () => {}
        };
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

    function getDrawingMode() {
        return drawingMode;
    }

    // Public API
    return {
        init,
        updateControlsPosition,
        updateZoomDisplay,
        getDrawingMode,
        toggleDrawingMode
    };
})();
