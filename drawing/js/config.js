const Config = {
    canvas: {
        VIRTUAL_WIDTH: 1920,
        VIRTUAL_HEIGHT: 1080,
        DEFAULT_COLOR: '#ff0000',
        DEFAULT_WIDTH: 5,
        MIN_ZOOM: 0.1,
        MAX_ZOOM: 5,
        DEFAULT_ZOOM: 0.9
    },
    network: {
        LOCAL_WS_URL: 'ws://127.0.0.1:8000/ws/draw',
        GCP_WS_URL: 'ws://34.148.39.39:8080/ws/draw',
        HEARTBEAT_INTERVAL: 15000,
        HEARTBEAT_TIMEOUT: 45000,
        STATE_CHECK_INTERVAL: 2000 // New parameter for state checking frequency
    },
    drawing: {
        MIN_INTERPOLATION_DISTANCE: 0.002
    }
};
