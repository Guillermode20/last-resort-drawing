const DrawingManager = (function () {
    let isDrawing = false;
    let isPanning = false;
    let lastPanPoint = { x: 0, y: 0 };
    let currentColor = Config.canvas.DEFAULT_COLOR;
    let currentWidth = Config.canvas.DEFAULT_WIDTH;
    let currentPoints = [];
    let drawingState = [];
    let stateVersion = 0;
    let localDrawings = []; // Track local drawings for better undo UX

    function startDrawing(e) {
        // Don't start drawing if we're panning
        if (isPanning || (e.button === 1 || (e.button === 0 && e.altKey))) return;

        // Mark activity for state check optimization
        NetworkManager.markActivity();
        
        isDrawing = true;
        currentPoints = [];
        const point = getPoint(e);
        currentPoints.push(point);

        const ctx = CanvasManager.getContext();
        ctx.beginPath();
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentWidth;
        ctx.moveTo(point.x * Config.canvas.VIRTUAL_WIDTH, point.y * Config.canvas.VIRTUAL_HEIGHT);
    }

    function draw(e) {
        if (!isDrawing || isPanning) return;
        e.preventDefault();

        // Mark activity for state check optimization
        if (currentPoints.length % 10 === 0) { // Only mark occasionally during continuous drawing
            NetworkManager.markActivity();
        }

        const point = getPoint(e);
        currentPoints.push(point);

        const ctx = CanvasManager.getContext();

        // Draw immediately on canvas with improved interpolation
        if (currentPoints.length >= 2) {
            const lastPoint = currentPoints[currentPoints.length - 2];
            const currentPoint = point;

            // Calculate distance between points
            const dx = currentPoint.x - lastPoint.x;
            const dy = currentPoint.y - lastPoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Create interpolated points for smoother lines
            const interpolatedPoints = [];
            const minDistance = Config.drawing.MIN_INTERPOLATION_DISTANCE;

            if (dist > minDistance) {
                const steps = Math.ceil(dist / minDistance);
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    interpolatedPoints.push({
                        x: lastPoint.x + dx * t,
                        y: lastPoint.y + dy * t
                    });
                }
            } else {
                interpolatedPoints.push(currentPoint);
            }

            // Draw the interpolated points
            ctx.beginPath();
            ctx.strokeStyle = currentColor;
            ctx.lineWidth = currentWidth;
            ctx.moveTo(lastPoint.x * Config.canvas.VIRTUAL_WIDTH, lastPoint.y * Config.canvas.VIRTUAL_HEIGHT);

            interpolatedPoints.forEach(p => {
                ctx.lineTo(p.x * Config.canvas.VIRTUAL_WIDTH, p.y * Config.canvas.VIRTUAL_HEIGHT);
                // Store interpolated points for the full stroke
                // Only add points that aren't already in currentPoints
                if (p !== currentPoint) {
                    currentPoints.push(p);
                }
            });

            ctx.stroke();
        }
    }

    function endDrawing() {
        if (!isDrawing) return;
        isDrawing = false;

        // Only send the complete stroke when the drawing ends
        if (currentPoints.length > 0) {
            const drawData = {
                type: 'draw',
                points: currentPoints,
                color: currentColor,
                width: currentWidth
            };

            NetworkManager.sendDrawing(drawData);
            drawingState.push(drawData);
            localDrawings.push(drawData); // Track local drawing
            currentPoints = [];
        }
    }

    function startPanning(e) {
        if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle button or Alt+Left click
            isPanning = true;
            const x = e.touches ? e.touches[0].clientX : e.clientX;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            lastPanPoint = { x, y };
            e.preventDefault();
        }
    }

    function pan(e) {
        if (!isPanning) return;
        e.preventDefault();

        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const y = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = x - lastPanPoint.x;
        const dy = y - lastPanPoint.y;

        lastPanPoint = { x, y };
        CanvasManager.updatePan(dx, dy);
    }

    function endPanning() {
        isPanning = false;
    }

    function getPoint(e) {
        const x = (e.touches ? e.touches[0].clientX : e.clientX);
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        return CanvasManager.getVirtualPoint(x, y);
    }

    function drawPoint(point, color = currentColor, width = currentWidth) {
        const ctx = CanvasManager.getContext();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(
            point.x * Config.canvas.VIRTUAL_WIDTH,
            point.y * Config.canvas.VIRTUAL_HEIGHT,
            width / 2, 0, Math.PI * 2
        );
        ctx.fill();
    }

    function clearCanvas() {
        CanvasManager.clearAndDrawBorder();
        drawingState = []; // Clear local state
    }

    function redrawCanvasWithState() {
        // Clear with proper transform and draw border
        CanvasManager.clearAndDrawBorder();

        const ctx = CanvasManager.getContext();

        // Redraw all stored strokes
        drawingState.forEach(item => {
            const points = item.points;
            if (points.length === 1) {
                drawPoint({ x: points[0].x, y: points[0].y }, item.color, item.width);
            } else {
                // Draw the complete stroke with all points
                ctx.beginPath();
                ctx.strokeStyle = item.color;
                ctx.lineWidth = item.width;
                ctx.moveTo(points[0].x * Config.canvas.VIRTUAL_WIDTH, points[0].y * Config.canvas.VIRTUAL_HEIGHT);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x * Config.canvas.VIRTUAL_WIDTH, points[i].y * Config.canvas.VIRTUAL_HEIGHT);
                }
                ctx.stroke();
            }
        });
    }

    function updateDrawingState(newState, version) {
        console.log(`Updating drawing state: received version ${version}, current version ${stateVersion}`);

        // Always trust the server state
        if (newState && Array.isArray(newState)) {
            drawingState = newState.filter(item => item.type === 'draw');
            stateVersion = version || 0;
            console.log(`State updated to version ${stateVersion} with ${drawingState.length} elements`);
            // Redraw canvas with the new state
            redrawCanvasWithState();

            // Reset local drawings as we've received an authoritative state
            localDrawings = [];
        } else {
            console.warn("Received invalid state from server");
        }
    }

    function updateStateVersion(version) {
        if (version > stateVersion) {
            stateVersion = version;
        }
    }

    function getStateVersion() {
        return stateVersion;
    }

    function setColor(color) {
        currentColor = color;
    }

    function setWidth(width) {
        currentWidth = width;
    }

    function processRemoteDrawing(drawData) {
        // Add to our drawing state
        drawingState.push(drawData);

        // Update our state version
        if (drawData.version > stateVersion) {
            stateVersion = drawData.version;
        }

        // Draw the stroke on our canvas
        const ctx = CanvasManager.getContext();
        const points = drawData.points;

        if (points && points.length > 0) {
            if (points.length === 1) {
                // Draw a single point
                drawPoint({ x: points[0].x, y: points[0].y }, drawData.color, drawData.width);
            } else {
                // Draw a line
                ctx.beginPath();
                ctx.strokeStyle = drawData.color;
                ctx.lineWidth = drawData.width;
                ctx.moveTo(points[0].x * Config.canvas.VIRTUAL_WIDTH, points[0].y * Config.canvas.VIRTUAL_HEIGHT);

                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x * Config.canvas.VIRTUAL_WIDTH, points[i].y * Config.canvas.VIRTUAL_HEIGHT);
                }
                ctx.stroke();
            }
        }
    }

    function undoLastDrawing() {
        console.log("Undo triggered, local drawings:", localDrawings.length);

        // Send undo request to server regardless of local state
        // The server will check if there are drawings to undo for this IP
        NetworkManager.sendUndo();

        // For immediate visual feedback, we'll remove the last local stroke
        // Note: This is just a visual effect, the real state will come from the server
        if (localDrawings.length > 0) {
            const lastDrawing = localDrawings.pop();

            // Also remove from drawing state if it exists there
            const index = drawingState.indexOf(lastDrawing);
            if (index !== -1) {
                drawingState.splice(index, 1);
                redrawCanvasWithState();
            }

            console.log("Removed local drawing for visual feedback");
        } else {
            console.log("No local drawings to provide visual feedback for undo");
        }
    }

    function getDrawingState() {
        return drawingState;
    }

    // Public API
    return {
        startDrawing,
        draw,
        endDrawing,
        startPanning,
        pan,
        endPanning,
        clearCanvas,
        redrawCanvasWithState,
        updateDrawingState,
        updateStateVersion,
        getStateVersion,
        getDrawingState,  // Add new method
        setColor,
        setWidth,
        processRemoteDrawing,
        undoLastDrawing
    };
})();
