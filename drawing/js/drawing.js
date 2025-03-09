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
        if (currentPoints.length % 10 === 0) {
            NetworkManager.markActivity();
        }

        const point = getPoint(e);
        
        // Only add the point if it's far enough from the last point
        if (currentPoints.length === 0 || isSignificantPoint(point)) {
            currentPoints.push(point);

            const ctx = CanvasManager.getContext();

            // Draw immediately on canvas
            if (currentPoints.length >= 2) {
                const lastPoint = currentPoints[currentPoints.length - 2];
                
                // Draw direct line between points - removed interpolation for smoother real-time drawing
                ctx.beginPath();
                ctx.strokeStyle = currentColor;
                ctx.lineWidth = currentWidth;
                ctx.moveTo(lastPoint.x * Config.canvas.VIRTUAL_WIDTH, lastPoint.y * Config.canvas.VIRTUAL_HEIGHT);
                ctx.lineTo(point.x * Config.canvas.VIRTUAL_WIDTH, point.y * Config.canvas.VIRTUAL_HEIGHT);
                ctx.stroke();
            }
        }
    }

    function isSignificantPoint(newPoint) {
        if (currentPoints.length === 0) return true;
        
        const lastPoint = currentPoints[currentPoints.length - 1];
        const dx = newPoint.x - lastPoint.x;
        const dy = newPoint.y - lastPoint.y;
        const distSquared = dx * dx + dy * dy;
        
        // Use a larger threshold during drawing to reduce points
        // This is more aggressive than the final simplification threshold
        return distSquared > (Config.drawing.MIN_INTERPOLATION_DISTANCE * Config.drawing.MIN_INTERPOLATION_DISTANCE);
    }

    function endDrawing() {
        if (!isDrawing) return;
        isDrawing = false;

        // Only process the drawing when it's complete
        if (currentPoints.length > 0) {
            // Create the drawing data with all points for local rendering
            const localDrawData = {
                type: 'draw',
                points: [...currentPoints], // Make a copy of the points
                color: currentColor,
                width: currentWidth
            };
            
            // Add the full-detail version to our local state for rendering
            drawingState.push(localDrawData);
            localDrawings.push(localDrawData);
            
            // Apply simplification for network transmission if enabled and we have enough points
            let pointsToSend = currentPoints;
            if (Config.drawing.SIMPLIFICATION.ENABLED && 
                currentPoints.length > Config.drawing.SIMPLIFICATION.MIN_LENGTH_FOR_SIMPLIFICATION) {
                
                // Simplify the path for sending to server
                pointsToSend = simplifyPath(currentPoints);
                
                console.log(
                    `Path simplified: ${currentPoints.length} points reduced to ${pointsToSend.length} points ` +
                    `(${Math.round((pointsToSend.length / currentPoints.length) * 100)}%)`
                );
            }
            
            // Send the simplified version to the server
            const drawData = {
                type: 'draw',
                points: pointsToSend,
                color: currentColor,
                width: currentWidth
            };
            
            NetworkManager.sendDrawing(drawData);
            
            // Clear the current points array for the next drawing
            currentPoints = [];
        }
    }

    // Improved triangle area calculation with better numerical stability
    function triangleArea(p1, p2, p3) {
        // Use the cross product formula for better numerical stability
        return 0.5 * Math.abs(
            (p2.x - p1.x) * (p3.y - p1.y) - 
            (p3.x - p1.x) * (p2.y - p1.y)
        );
    }

    // Improved line simplification logic
    function simplifyPath(points) {
        if (points.length <= Config.drawing.SIMPLIFICATION.MIN_LENGTH_FOR_SIMPLIFICATION) {
            return points;
        }
        // Use only Douglas-Peucker algorithm with error threshold from config
        return rdpSimplify(points, Config.drawing.SIMPLIFICATION.ERROR_THRESHOLD);
    }

    // RDP algorithm with guaranteed minimum points
    function rdpSimplify(points, epsilon) {
        if (points.length <= 2) return points;
        
        let maxDist = 0;
        let index = 0;
        const end = points.length - 1;
        
        // Find the point with max distance from line between start and end
        for (let i = 1; i < end; i++) {
            const dist = perpendicularDistance(points[i], points[0], points[end]);
            if (dist > maxDist) {
                index = i;
                maxDist = dist;
            }
        }
        
        // If max distance is greater than epsilon, recursively simplify
        if (maxDist > epsilon) {
            const leftPart = rdpSimplify(points.slice(0, index + 1), epsilon);
            const rightPart = rdpSimplify(points.slice(index), epsilon);
            return [...leftPart.slice(0, -1), ...rightPart];
        }
        
        return [points[0], points[end]];
    }
    
    // Calculate perpendicular distance from a point to a line
    function perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;
        
        // Handle case where line is just a point
        const lineLengthSquared = dx * dx + dy * dy;
        if (lineLengthSquared === 0) {
            const pointDx = point.x - lineStart.x;
            const pointDy = point.y - lineStart.y;
            return Math.sqrt(pointDx * pointDx + pointDy * pointDy);
        }
        
        // Calculate projection parameter
        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSquared;
        
        // Handle cases where projection falls outside the line segment
        if (t < 0) {
            // Point projects before start of line
            const pointDx = point.x - lineStart.x;
            const pointDy = point.y - lineStart.y;
            return Math.sqrt(pointDx * pointDx + pointDy * pointDy);
        } else if (t > 1) {
            // Point projects after end of line
            const pointDx = point.x - lineEnd.x;
            const pointDy = point.y - lineEnd.y;
            return Math.sqrt(pointDx * pointDx + pointDy * pointDy);
        } else {
            // Point projects onto line segment
            const projX = lineStart.x + t * dx;
            const projY = lineStart.y + t * dy;
            const pointDx = point.x - projX;
            const pointDy = point.y - projY;
            return Math.sqrt(pointDx * pointDx + pointDy * pointDy);
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

    // Public API - maintains original interface exactly
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
        getDrawingState,
        setColor,
        setWidth,
        processRemoteDrawing,
        undoLastDrawing,
        simplifyPath // Expose the simplification function for testing
    };
})();