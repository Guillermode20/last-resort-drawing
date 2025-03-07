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
        if (points.length <= Config.drawing.SIMPLIFICATION.MIN_POINTS) {
            return points;
        }

        // Filter close points first - this is most efficient
        const filteredPoints = combineClosePoints(points);
        
        if (filteredPoints.length <= Config.drawing.SIMPLIFICATION.MIN_LENGTH_FOR_SIMPLIFICATION) {
            return filteredPoints;
        }

        // Calculate path metrics to select the best algorithm and parameters
        const pathMetrics = calculatePathMetrics(filteredPoints);
        
        // Choose simplification method based on path complexity
        if (pathMetrics.complexityMetric > 1.5 && filteredPoints.length > 50) {
            // For complex paths, use Ramer-Douglas-Peucker algorithm
            return rdpSimplifyWithMinPoints(filteredPoints, 
                adaptiveEpsilon(pathMetrics), 
                Math.max(Config.drawing.SIMPLIFICATION.MIN_POINTS, 
                         Math.floor(filteredPoints.length * (1 - Config.drawing.SIMPLIFICATION.MAX_COMPRESSION_RATIO))));
        } else {
            // For smoother paths, use optimized Visvalingam-Whyatt algorithm
            return optimizedVisvalingamSimplify(filteredPoints, pathMetrics);
        }
    }

    function adaptiveEpsilon(metrics) {
        const baseEpsilon = Config.drawing.SIMPLIFICATION.ERROR_THRESHOLD || 0.003;
        
        // Scale epsilon based on path characteristics
        const complexityFactor = Math.max(0.7, Math.min(1.3, 1 / (metrics.complexityMetric || 1)));
        const lengthFactor = Math.max(0.8, Math.min(1.2, metrics.totalLength / 500));
        
        return baseEpsilon * complexityFactor * lengthFactor;
    }

    function combineClosePoints(points) {
        if (points.length <= 2) return points;

        const threshold = Config.drawing.SIMPLIFICATION.CLOSE_POINTS_THRESHOLD || 0.0001;
        const result = [points[0]];
        
        // Track the last added point for better performance
        let lastAddedIdx = 0;

        for (let i = 1; i < points.length; i++) {
            const prevPoint = points[lastAddedIdx];
            const currentPoint = points[i];
            const dx = currentPoint.x - prevPoint.x;
            const dy = currentPoint.y - prevPoint.y;
            const distSquared = dx * dx + dy * dy;

            if (distSquared > threshold * threshold) {
                result.push(currentPoint);
                lastAddedIdx = i;
            }
        }

        // Always include the last point if it's not already included
        const lastPoint = points[points.length - 1];
        if (result[result.length - 1] !== lastPoint) {
            result.push(lastPoint);
        }

        return result;
    }

    function calculatePathMetrics(points) {
        // Initialize metrics
        const areas = [Infinity];
        let totalLength = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let totalArea = 0;
        let maxArea = 0;

        // Calculate area for each point and accumulate stats
        for (let i = 1; i < points.length - 1; i++) {
            const area = triangleArea(points[i-1], points[i], points[i+1]);
            areas.push(area);
            totalArea += area;
            maxArea = Math.max(maxArea, area);
        }
        
        areas.push(Infinity); // Last point always kept
        
        // Calculate length and bounding box
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);

            if (i > 0) {
                const prev = points[i-1];
                const dx = p.x - prev.x;
                const dy = p.y - prev.y;
                totalLength += Math.sqrt(dx * dx + dy * dy);
            }
        }

        // Calculate area variance and average
        const avgArea = totalArea / Math.max(1, (points.length - 2));
        let areaVariance = 0;

        for (let i = 1; i < areas.length - 1; i++) {
            areaVariance += Math.pow(areas[i] - avgArea, 2);
        }
        areaVariance /= Math.max(1, (points.length - 2));

        // Calculate straightness metrics
        const pathWidth = maxX - minX;
        const pathHeight = maxY - minY;
        const diagonalLength = Math.sqrt(pathWidth * pathWidth + pathHeight * pathHeight);
        const straightnessRatio = diagonalLength / Math.max(0.0001, totalLength);

        // Combine metrics into complexity
        const areaComplexity = Math.sqrt(areaVariance) / Math.max(0.0001, avgArea);
        const curvatureComplexity = 1 - straightnessRatio;
        const curveWeight = Config.drawing.SIMPLIFICATION.CURVATURE_WEIGHT || 0.6;
        const complexityMetric = (areaComplexity * (1 - curveWeight)) + (curvatureComplexity * curveWeight);

        return {
            areas,
            avgArea,
            maxArea,
            areaVariance,
            totalLength,
            diagonalLength,
            straightnessRatio,
            complexityMetric,
            boundingBox: { minX, minY, maxX, maxY, width: pathWidth, height: pathHeight }
        };
    }

    // Optimized implementation of Visvalingam-Whyatt that uses an efficient data structure
    function optimizedVisvalingamSimplify(points, metrics) {
        if (points.length <= 2) return points;
        
        // Calculate adaptive threshold based on path characteristics
        const complexityAdjustment = Math.min(1, Math.max(0.1, 
            metrics.complexityMetric * Config.drawing.SIMPLIFICATION.COMPLEXITY_FACTOR || 1));
            
        let areaThreshold = metrics.avgArea * 
            (Config.drawing.SIMPLIFICATION.AREA_THRESHOLD_FACTOR || 0.5) / complexityAdjustment;
            
        if (metrics.complexityMetric > 2) {
            areaThreshold *= 0.5;
        }

        // Calculate minimum points to keep
        const minPointsToKeep = Math.max(
            Config.drawing.SIMPLIFICATION.MIN_POINTS || 3,
            Math.floor(points.length * (1 - (Config.drawing.SIMPLIFICATION.MAX_COMPRESSION_RATIO || 0.8)))
        );
        
        // Exit early if we're already below or at our point limit
        if (points.length <= minPointsToKeep) {
            return points;
        }
        
        // Create array to track effective areas
        const areas = new Array(points.length);
        const toKeep = new Array(points.length).fill(true);
        
        // Calculate initial areas
        for (let i = 1; i < points.length - 1; i++) {
            areas[i] = triangleArea(points[i-1], points[i], points[i+1]);
        }
        
        // Always keep the endpoints
        areas[0] = areas[points.length - 1] = Infinity;
        
        // Build a sorted array of interior points by area
        const pointsByArea = Array.from({ length: points.length - 2 }, (_, i) => i + 1)
            .sort((a, b) => areas[a] - areas[b]);
        
        // Calculate how many points to remove
        const pointsToRemove = Math.min(
            points.length - minPointsToKeep,
            pointsByArea.filter(i => areas[i] <= areaThreshold).length
        );
        
        // Remove points in order of increasing area
        for (let i = 0; i < pointsToRemove; i++) {
            toKeep[pointsByArea[i]] = false;
        }
        
        // Build the result array
        const result = [];
        for (let i = 0; i < points.length; i++) {
            if (toKeep[i]) {
                result.push(points[i]);
            }
        }
        
        return result;
    }

    // RDP algorithm with guaranteed minimum points
    function rdpSimplifyWithMinPoints(points, epsilon, minPoints) {
        // Handle simple cases
        if (points.length <= 2 || points.length <= minPoints) return points;
        
        // Calculate perpendicular distances for all points
        const dMax = { index: 0, distance: 0 };
        const lineStart = points[0];
        const lineEnd = points[points.length - 1];
        
        // Find the point with the maximum distance
        for (let i = 1; i < points.length - 1; i++) {
            const distance = perpendicularDistance(points[i], lineStart, lineEnd);
            if (distance > dMax.distance) {
                dMax.index = i;
                dMax.distance = distance;
            }
        }
        
        // If the maximum distance is greater than epsilon, recursively simplify
        if (dMax.distance > epsilon) {
            // Recursive case - split at the furthest point
            const firstSegment = rdpSimplifyWithMinPoints(
                points.slice(0, dMax.index + 1), 
                epsilon, 
                Math.max(2, Math.floor(minPoints * (dMax.index / points.length)))
            );
            
            const secondSegment = rdpSimplifyWithMinPoints(
                points.slice(dMax.index), 
                epsilon, 
                Math.max(2, Math.floor(minPoints * ((points.length - dMax.index) / points.length)))
            );
            
            // Combine the two segments, removing the duplicate point
            return [...firstSegment.slice(0, -1), ...secondSegment];
        } 
        // If we're already at or below the minimum points, return the original
        else if (points.length <= minPoints) {
            return points;
        }
        // Otherwise, we need to keep the most significant points to meet the minimum
        else {
            // Calculate the significance of each interior point
            const significance = [];
            for (let i = 1; i < points.length - 1; i++) {
                significance.push({
                    index: i,
                    distance: perpendicularDistance(points[i], lineStart, lineEnd)
                });
            }
            
            // Sort by distance (most significant first)
            significance.sort((a, b) => b.distance - a.distance);
            
            // Select the top points to keep
            const toKeep = new Set([0, points.length - 1]); // Always keep endpoints
            for (let i = 0; i < Math.min(significance.length, minPoints - 2); i++) {
                toKeep.add(significance[i].index);
            }
            
            // Create the result with the kept points (in original order)
            return points.filter((_, i) => toKeep.has(i));
        }
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