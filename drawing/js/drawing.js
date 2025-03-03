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

    // Visvalingam-Whyatt line simplification algorithm
    // Calculates the area of the triangle formed by three points
    function triangleArea(p1, p2, p3) {
        return 0.5 * Math.abs(
            (p2.x - p1.x) * (p3.y - p1.y) - 
            (p3.x - p1.x) * (p2.y - p1.y)
        );
    }

    // Simplify a path using enhanced Visvalingam-Whyatt algorithm with adaptive thresholds
    function simplifyPath(points) {
        // If we don't have enough points to simplify, return the original
        if (points.length <= Config.drawing.SIMPLIFICATION.MIN_POINTS) {
            return points;
        }

        // Only simplify if we have more than the minimum length for simplification
        if (points.length <= Config.drawing.SIMPLIFICATION.MIN_LENGTH_FOR_SIMPLIFICATION) {
            return points;
        }

        // Make a copy of the points array to work with
        let workingPoints = [...points];

        // Step 1: Preprocess the points - combine very close points if enabled
        if (Config.drawing.SIMPLIFICATION.COMBINE_CLOSE_POINTS) {
            workingPoints = combineClosePoints(workingPoints);
            
            // If preprocessing reduced the points below threshold, return them
            if (workingPoints.length <= Config.drawing.SIMPLIFICATION.MIN_LENGTH_FOR_SIMPLIFICATION) {
                return workingPoints;
            }
        }
        
        // Step 2: Calculate path metrics to determine complexity
        const pathMetrics = calculatePathMetrics(workingPoints);
        
        // Step 3: Perform the simplification based on the metrics
        if (Config.drawing.SIMPLIFICATION.PROGRESSIVE_SIMPLIFICATION && workingPoints.length > 50) {
            // For longer paths, use multi-stage simplification for better results
            workingPoints = performProgressiveSimplification(workingPoints, pathMetrics);
        } else {
            // For shorter paths, use standard simplification
            workingPoints = performStandardSimplification(workingPoints, pathMetrics);
        }
        
        // Log the results
        console.log(
            `Enhanced simplification: ${points.length} points → ${workingPoints.length} points ` +
            `(${Math.round((workingPoints.length / points.length) * 100)}%) | ` +
            `Path complexity: ${pathMetrics.complexityMetric.toFixed(3)}`
        );
        
        return workingPoints;
    }

    // Helper function to combine points that are very close to each other
    function combineClosePoints(points) {
        if (points.length <= 2) return points;
        
        const threshold = Config.drawing.SIMPLIFICATION.CLOSE_POINTS_THRESHOLD;
        const result = [points[0]]; // Always keep first point
        
        for (let i = 1; i < points.length; i++) {
            const prevPoint = result[result.length - 1];
            const currentPoint = points[i];
            
            // Calculate squared distance (more efficient than using sqrt)
            const dx = currentPoint.x - prevPoint.x;
            const dy = currentPoint.y - prevPoint.y;
            const distSquared = dx * dx + dy * dy;
            
            // Only add point if it's not too close to the previous one
            if (distSquared > threshold * threshold) {
                result.push(currentPoint);
            }
        }
        
        // Always ensure we keep the last point
        const lastPoint = points[points.length - 1];
        if (result[result.length - 1] !== lastPoint) {
            result.push(lastPoint);
        }
        
        return result;
    }
    
    // Calculate metrics about the path to determine its complexity
    function calculatePathMetrics(points) {
        // Calculate areas for each interior point
        const areas = [Infinity]; // First point has infinite area (always keep)
        for (let i = 1; i < points.length - 1; i++) {
            areas.push(triangleArea(points[i-1], points[i], points[i+1]));
        }
        areas.push(Infinity); // Last point has infinite area (always keep)
        
        // Calculate path length and bounding box
        let totalLength = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
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
        
        // Calculate area statistics
        let totalArea = 0;
        let maxArea = 0;
        let areaVariance = 0;
        
        for (let i = 1; i < areas.length - 1; i++) {
            totalArea += areas[i];
            maxArea = Math.max(maxArea, areas[i]);
        }
        
        const avgArea = totalArea / (areas.length - 2) || 0.0001;
        
        // Calculate variance to determine path complexity
        for (let i = 1; i < areas.length - 1; i++) {
            areaVariance += Math.pow(areas[i] - avgArea, 2);
        }
        areaVariance /= (areas.length - 2) || 1;
        
        // Calculate curvature - higher means more curved path
        const pathWidth = maxX - minX;
        const pathHeight = maxY - minY;
        const diagonalLength = Math.sqrt(pathWidth * pathWidth + pathHeight * pathHeight);
        const straightnessRatio = diagonalLength / (totalLength || 0.0001);
        
        // Combine metrics into a single complexity value (0-1, higher = more complex)
        const areaComplexity = Math.sqrt(areaVariance) / avgArea;
        const curvatureComplexity = 1 - straightnessRatio; // Invert so higher = more curved
        
        // Weight the metrics based on configuration
        const curveWeight = Config.drawing.SIMPLIFICATION.CURVATURE_WEIGHT;
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
    
    // Perform standard Visvalingam-Whyatt simplification
    function performStandardSimplification(points, metrics) {
        if (points.length <= 2) return points;
        
        const workingPoints = [...points];
        const areas = metrics.areas;
        
        // Calculate the adaptive threshold based on complexity
        const complexityAdjustment = Math.min(1, Math.max(0.1, 
            metrics.complexityMetric * Config.drawing.SIMPLIFICATION.COMPLEXITY_FACTOR));
        
        // Base threshold on average area and adjusted by complexity
        let areaThreshold = metrics.avgArea * Config.drawing.SIMPLIFICATION.AREA_THRESHOLD_FACTOR / complexityAdjustment;
        
        // For very complex paths (tight curves), lower the threshold further
        if (metrics.complexityMetric > 2) {
            areaThreshold *= 0.5;
        }
        
        // Ensure we keep at least the minimum number of points
        const minPointsToKeep = Math.max(
            Config.drawing.SIMPLIFICATION.MIN_POINTS,
            Math.floor(points.length * (1 - Config.drawing.SIMPLIFICATION.MAX_COMPRESSION_RATIO))
        );
        
        // Create array of points and areas for sorting and filtering
        const pointsWithAreas = workingPoints.map((point, index) => ({
            point,
            area: areas[index],
            index
        }));
        
        // Sort interior points by area (higher area = more important)
        const sortedInteriorPoints = pointsWithAreas
            .slice(1, -1)
            .sort((a, b) => b.area - a.area);
        
        // Keep points with area above threshold and ensure we keep the minimum required
        const pointsToKeep = Math.max(
            sortedInteriorPoints.filter(p => p.area > areaThreshold).length,
            minPointsToKeep - 2 // -2 because we always keep first and last
        );
        
        // If we're keeping most points anyway, return original
        if (pointsToKeep >= workingPoints.length - 2) {
            return points;
        }
        
        // Create a set of indices to keep
        const interiorIndices = new Set(
            sortedInteriorPoints
                .slice(0, pointsToKeep)
                .map(p => p.index)
        );
        
        // Always keep first and last points
        interiorIndices.add(0);
        interiorIndices.add(workingPoints.length - 1);
        
        // Create the simplified path preserving original order
        return workingPoints.filter((_, index) => interiorIndices.has(index));
    }
    
    // Use a multi-stage approach for better results on complex paths
    function performProgressiveSimplification(points, metrics) {
        // For very long paths, use a multi-stage approach
        const errorThreshold = Config.drawing.SIMPLIFICATION.ERROR_THRESHOLD;
        
        // Stage 1: Initial rough simplification - keep ~30% of points 
        let workingPoints = [...points];
        const initialKeepRatio = 0.3;
        const initialTargetPoints = Math.max(
            Config.drawing.SIMPLIFICATION.MIN_POINTS,
            Math.ceil(points.length * initialKeepRatio)
        );
        
        // Create a simplified version using Ramer-Douglas-Peucker algorithm
        // which is better for initial rough simplification
        workingPoints = rdpSimplify(workingPoints, errorThreshold);
        
        // If we already have few enough points, return them
        if (workingPoints.length <= initialTargetPoints) {
            return workingPoints;
        }
        
        // Stage 2: Fine-tune with Visvalingam-Whyatt which preserves more shape
        // Recalculate metrics for the simplified path
        const refinedMetrics = calculatePathMetrics(workingPoints);
        return performStandardSimplification(workingPoints, refinedMetrics);
    }
    
    // Ramer-Douglas-Peucker algorithm for line simplification
    function rdpSimplify(points, epsilon) {
        if (points.length <= 2) return points;
        
        // Find the point with the maximum distance from the line between start and end
        const findFurthest = (start, end) => {
            const lineLength = distance(points[start], points[end]);
            let maxDistance = 0;
            let maxIndex = 0;
            
            for (let i = start + 1; i < end; i++) {
                const d = perpendicularDistance(points[i], points[start], points[end]);
                if (d > maxDistance) {
                    maxDistance = d;
                    maxIndex = i;
                }
            }
            
            return { maxDistance, maxIndex };
        };
        
        // Calculate distance between two points
        const distance = (p1, p2) => {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            return Math.sqrt(dx * dx + dy * dy);
        };
        
        // Calculate perpendicular distance from point to line
        const perpendicularDistance = (point, lineStart, lineEnd) => {
            const dx = lineEnd.x - lineStart.x;
            const dy = lineEnd.y - lineStart.y;
            
            // Handle case where lineStart and lineEnd are the same point
            const lineLength = Math.sqrt(dx * dx + dy * dy);
            if (lineLength === 0) {
                return distance(point, lineStart);
            }
            
            // Calculate perpendicular distance
            const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (lineLength * lineLength);
            
            if (t < 0) {
                // Point is before line start
                return distance(point, lineStart);
            } else if (t > 1) {
                // Point is after line end
                return distance(point, lineEnd);
            } else {
                // Point projects onto line
                const projX = lineStart.x + t * dx;
                const projY = lineStart.y + t * dy;
                const projDx = point.x - projX;
                const projDy = point.y - projY;
                return Math.sqrt(projDx * projDx + projDy * projDy);
            }
        };
        
        // Run the recursive RDP algorithm
        const simplifySection = (start, end) => {
            const { maxDistance, maxIndex } = findFurthest(start, end);
            
            if (maxDistance > epsilon) {
                // Recursively simplify the two halves
                const results1 = simplifySection(start, maxIndex);
                const results2 = simplifySection(maxIndex, end);
                
                // Combine the results (excluding duplicate point)
                return [...results1.slice(0, -1), ...results2];
            } else {
                // No need to add intermediate points
                return [points[start], points[end]];
            }
        };
        
        // Convert epsilon from relative to absolute distance
        const absoluteEpsilon = epsilon * Math.sqrt(
            Config.canvas.VIRTUAL_WIDTH * Config.canvas.VIRTUAL_WIDTH + 
            Config.canvas.VIRTUAL_HEIGHT * Config.canvas.VIRTUAL_HEIGHT
        );
        
        return simplifySection(0, points.length - 1);
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
        getDrawingState,
        setColor,
        setWidth,
        processRemoteDrawing,
        undoLastDrawing,
        simplifyPath // Expose the simplification function for testing
    };
})();
