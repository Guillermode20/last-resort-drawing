const NetworkManager = (function () {
    let ws = null;
    let reconnectAttempts = 0;
    let heartbeatInterval;
    let stateCheckInterval;
    let lastHeartbeat = 0;
    const statusElement = document.getElementById('status');

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
                            // Process drawing data from other clients
                            DrawingManager.processRemoteDrawing(data);
                            // Update state version if the received version is newer
                            if (data.version && data.version > DrawingManager.getStateVersion()) {
                                DrawingManager.updateStateVersion(data.version);
                            }
                        } else if (data.type === 'clear') {
                            // Always respect the server's state version
                            if (data.version && data.version > DrawingManager.getStateVersion()) {
                                DrawingManager.updateStateVersion(data.version);
                                DrawingManager.clearCanvas(false);
                            }
                        } else if (data.type === 'state') {
                            // State from server is authoritative - always apply it and update our version
                            DrawingManager.updateDrawingState(data.state, data.version);
                            console.log(`Received state from server with version ${data.version}, state size: ${data.state.length}`);
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
                    } else if (msg.type === 'clear') {
                        if (msg.version && msg.version > DrawingManager.getStateVersion()) {
                            DrawingManager.updateStateVersion(msg.version);
                            DrawingManager.clearCanvas(false);
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
                // Process drawing data from other clients
                DrawingManager.processRemoteDrawing(data);
                // Update state version if the received version is newer
                if (data.version && data.version > DrawingManager.getStateVersion()) {
                    DrawingManager.updateStateVersion(data.version);
                }
            } else if (data.type === 'clear') {
                // Always respect the server's state version
                if (data.version && data.version > DrawingManager.getStateVersion()) {
                    DrawingManager.updateStateVersion(data.version);
                    DrawingManager.clearCanvas(false);
                }
            } else if (data.type === 'state') {
                // State from server is authoritative - always apply it and update our version
                DrawingManager.updateDrawingState(data.state, data.version);
                console.log(`Received state from server with version ${data.version}, state size: ${data.state.length}`);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    }

    function startHeartbeat() {
        lastHeartbeat = Date.now();

        // Clear any existing interval
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }

        // Send ping every 15 seconds
        heartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'ping',
                    timestamp: Date.now()
                }));

                // Check if we've received a heartbeat in the last 45 seconds
                if (Date.now() - lastHeartbeat > Config.network.HEARTBEAT_TIMEOUT) {
                    updateStatus("Connection lost - Reconnecting...");
                    ws.close();
                    // Reconnection will be handled by onclose
                }
            }
        }, Config.network.HEARTBEAT_INTERVAL);

        // Start periodic state checking - more frequent checks
        startStateCheck();
    }

    function startStateCheck() {
        // Clear any existing interval
        if (stateCheckInterval) {
            clearInterval(stateCheckInterval);
        }

        // Check for state updates more frequently (every 1 second)
        stateCheckInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                // Request current state version from server to verify we're in sync
                ws.send(JSON.stringify({
                    type: 'state_version_check',
                    current_version: DrawingManager.getStateVersion()
                }));
            }
        }, 1000); // Check every second for better synchronization
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
                current_version: 0 // Always request full state by using version 0
            }));
        } else {
            console.log("WebSocket not ready, will request state when connected");
            // Will try again when connection is established
        }
    }

    function sendDrawing(drawData) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
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

    // Public API
    return {
        connect,
        requestCurrentState,
        sendDrawing
    };
})();
