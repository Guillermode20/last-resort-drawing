const NetworkManager = (function () {
    let ws = null;
    let reconnectAttempts = 0;
    let heartbeatInterval;
    let stateCheckInterval;
    let lastHeartbeat = 0;
    const statusElement = document.getElementById('status');
    let lastActivityTime = 0;
    let isActiveMode = false;

    function connect() {
        const localWsUrl = Config.network.LOCAL_WS_URL;
        const gcpWsUrl = Config.network.GCP_WS_URL;

        function attemptConnection(url) {
            if (ws) {
                try {
                    ws.close();
                } catch (e) {
                    console.error("Error closing existing connection:", e);
                }
            }

            ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";

            ws.onopen = () => {
                updateStatus('Connected to: ' + url);
                reconnectAttempts = 0;

                // Always request complete server state when connecting
                // This ensures we're using server as the source of truth
                requestCurrentState();

                // Start heartbeat
                startHeartbeat();
            };

            ws.onclose = (e) => {
                stopHeartbeat();
                updateStatus(`Disconnected from: ${url} (${e.code}) - Trying to reconnect...`);
                reconnectAttempts++;

                // Try the other server on the next attempt
                const nextUrl = url === localWsUrl ? gcpWsUrl : localWsUrl;
                const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000); // Exponential backoff with max

                setTimeout(() => {
                    attemptConnection(nextUrl);
                }, delay);
            };

            ws.onerror = (error) => {
                console.error("WebSocket error:", error);
                updateStatus(`Error on ${url} - Will try to reconnect`);
            };

            ws.onmessage = (event) => {
                if (typeof event.data === "string") {
                    try {
                        const data = JSON.parse(event.data);

                        if (data.type === 'ping') {
                            ws.send(JSON.stringify({
                                type: 'pong',
                                timestamp: data.timestamp
                            }));
                            return;
                        }

                        if (data.type === 'heartbeat') {
                            lastHeartbeat = Date.now();
                            return;
                        }

                        if (data.type === 'draw') {
                            DrawingManager.processRemoteDrawing(data);
                            if (data.version && data.version > DrawingManager.getStateVersion()) {
                                DrawingManager.updateStateVersion(data.version);
                            }
                            // Request full state update if version gap is too wide
                            if (data.version && (data.version - DrawingManager.getStateVersion() > 1)) {
                                ws.send(JSON.stringify({
                                    type: 'state_request',
                                    client: 'draw',
                                    current_version: 0
                                }));
                            }
                        } else if (data.type === 'clear') {
                            if (data.version && data.version > DrawingManager.getStateVersion()) {
                                DrawingManager.updateStateVersion(data.version);
                                DrawingManager.clearCanvas(false);
                            }
                        } else if (data.type === 'state') {
                            DrawingManager.updateDrawingState(data.state, data.version);
                            console.log(`Received state from server with version ${data.version}, state size: ${data.state.length}`);
                        } else if (data.type === 'undo') {
                            if (data.version && data.version > DrawingManager.getStateVersion()) {
                                DrawingManager.updateStateVersion(data.version);
                                // Request full state after undo
                                requestCurrentState();
                            }
                        }
                    } catch (error) {
                        console.error("Error processing message:", error);
                    }
                } else if (event.data instanceof ArrayBuffer) {
                    const msg = decodeDrawingMessage(event.data);
                    if (msg.type === 'draw') {
                        DrawingManager.processRemoteDrawing(msg);
                        if (msg.version && msg.version > DrawingManager.getStateVersion()) {
                            DrawingManager.updateStateVersion(msg.version);
                        }
                        if (msg.version && (msg.version - DrawingManager.getStateVersion() > 1)) {
                            ws.send(JSON.stringify({
                                type: 'state_request',
                                client: 'draw',
                                current_version: 0
                            }));
                        }
                    } else if (msg.type === 'clear') {
                        if (msg.version && msg.version > DrawingManager.getStateVersion()) {
                            DrawingManager.updateStateVersion(msg.version);
                            DrawingManager.clearCanvas(false);
                        }
                    } else if (msg.type === 'undo') {
                        if (msg.version && msg.version > DrawingManager.getStateVersion()) {
                            DrawingManager.updateStateVersion(msg.version);
                            // Request full state refresh after undo
                            requestCurrentState();
                        }
                    }
                }
            };
        }

        attemptConnection(localWsUrl);
    }

    function decodeDrawingMessage(buffer) {
        const view = new DataView(buffer);
        let offset = 0;
        const msgType = view.getUint8(offset);
        offset += 1;

        console.log("Received binary message type:", msgType);

        if (msgType === 1) {
            const version = view.getUint32(offset, false);
            offset += 4;
            const colorInt = view.getUint32(offset, false);
            offset += 4;
            const color = '#' + colorInt.toString(16).padStart(6, '0');
            const width = view.getFloat32(offset, false);
            offset += 4;
            const numPoints = view.getUint32(offset, false);
            offset += 4;
            const points = [];
            for (let i = 0; i < numPoints; i++) {
                const x = view.getFloat32(offset, false);
                offset += 4;
                const y = view.getFloat32(offset, false);
                offset += 4;
                points.push({ x, y });
            }
            return { type: 'draw', version, color, width, points };
        } else if (msgType === 2) {
            const version = view.getUint32(offset, false);
            return { type: 'clear', version };
        } else if (msgType === 3) { // Undo
            const version = view.getUint32(1, false);
            console.log("Decoded undo message with version:", version);
            if (version > DrawingManager.getStateVersion()) {
                DrawingManager.updateStateVersion(version);
                // Request full state refresh after undo
                requestCurrentState();
            }
        }
        return {};
    }

    function handleMessage(event) {
        try {
            const data = JSON.parse(event.data);

            if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: data.timestamp
                }));
                return;
            }

            if (data.type === 'heartbeat') {
                lastHeartbeat = Date.now();
                return;
            }

            if (data.type === 'draw') {
                DrawingManager.processRemoteDrawing(data);
                if (data.version && data.version > DrawingManager.getStateVersion()) {
                    DrawingManager.updateStateVersion(data.version);
                }
                if (data.version && (data.version - DrawingManager.getStateVersion() > 1)) {
                    ws.send(JSON.stringify({
                        type: 'state_request',
                        client: 'draw',
                        current_version: 0
                    }));
                }
            } else if (data.type === 'clear') {
                if (data.version && data.version > DrawingManager.getStateVersion()) {
                    DrawingManager.updateStateVersion(data.version);
                    DrawingManager.clearCanvas(false);
                }
            } else if (data.type === 'undo') {
                if (data.version && data.version > DrawingManager.getStateVersion()) {
                    DrawingManager.updateStateVersion(data.version);
                    DrawingManager.redrawCanvasWithState();
                }
            } else if (data.type === 'state') {
                DrawingManager.updateDrawingState(data.state, data.version);
                console.log(`Received state from server with version ${data.version}, state size: ${data.state.length}`);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    }

    function startHeartbeat() {
        lastHeartbeat = Date.now();

        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }

        heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'ping',
                    timestamp: Date.now()
                }));

                if (Date.now() - lastHeartbeat > Config.network.HEARTBEAT_TIMEOUT) {
                    updateStatus("Connection lost - Reconnecting...");
                    ws.close();
                }
            }
        }, Config.network.HEARTBEAT_INTERVAL);

        startStateCheck();
    }

    function startStateCheck() {
        // Initialize as idle mode
        isActiveMode = false;
        updateStateCheckInterval();
    }

    function updateStateCheckInterval() {
        if (stateCheckInterval) {
            clearInterval(stateCheckInterval);
        }
        
        // Set interval based on activity state
        const interval = isActiveMode ? 
            Config.network.STATE_CHECK_INTERVAL_ACTIVE : 
            Config.network.STATE_CHECK_INTERVAL_IDLE;
            
        stateCheckInterval = setInterval(() => {
            // Check if we should switch back to idle mode
            if (isActiveMode && (Date.now() - lastActivityTime > Config.network.ACTIVITY_TIMEOUT)) {
                isActiveMode = false;
                updateStateCheckInterval();
                return;
            }
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'state_version_check',
                    current_version: DrawingManager.getStateVersion()
                }));
            }
        }, interval);
    }

    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }

        if (stateCheckInterval) {
            clearInterval(stateCheckInterval);
            stateCheckInterval = null;
        }
    }

    function updateStatus(message) {
        statusElement.textContent = message;
    }

    function requestCurrentState() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            console.log("Requesting current state from server");
            ws.send(JSON.stringify({
                type: 'state_request',
                client: 'draw',
                current_version: 0
            }));
        } else {
            console.log("WebSocket not ready, will request state when connected");
        }
    }

    function sendDrawing(drawData) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                // Mark activity occurred
                markActivity();
                
                const numPoints = drawData.points.length;
                const buffer = new ArrayBuffer(17 + numPoints * 8);
                const view = new DataView(buffer);
                let offset = 0;
                view.setUint8(offset, 1); offset += 1;
                view.setUint32(offset, drawData.version || 0, false); offset += 4;
                const colorInt = parseInt(drawData.color.slice(1), 16);
                view.setUint32(offset, colorInt, false); offset += 4;
                view.setFloat32(offset, drawData.width, false); offset += 4;
                view.setUint32(offset, numPoints, false); offset += 4;
                for (let i = 0; i < numPoints; i++) {
                    view.setFloat32(offset, drawData.points[i].x, false); offset += 4;
                    view.setFloat32(offset, drawData.points[i].y, false); offset += 4;
                }
                ws.send(buffer);
            } catch (error) {
                console.error("Error sending drawing data:", error);
            }
        }
    }

    function sendUndo() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                // Mark activity occurred
                markActivity();
                
                console.log("Sending undo request to server");

                // Send binary message for undo request only
                const buffer = new ArrayBuffer(5); // 1 byte for type, 4 bytes for version
                const view = new DataView(buffer);
                view.setUint8(0, 3); // Type 3 = undo
                view.setUint32(1, DrawingManager.getStateVersion() || 0, false);
                ws.send(buffer);

                // Removed JSON format to optimize data serialization
            } catch (error) {
                console.error("Error sending undo data:", error);
            }
        } else {
            console.error("WebSocket not ready for sending undo");
        }
    }
    
    function markActivity() {
        lastActivityTime = Date.now();
        
        // If currently in idle mode, switch to active mode
        if (!isActiveMode) {
            isActiveMode = true;
            updateStateCheckInterval();
        }
    }

    return {
        connect,
        requestCurrentState,
        sendDrawing,
        sendUndo,
        markActivity  // Expose function to mark activity
    };
})();
