const Config = {
    canvas: {
        VIRTUAL_WIDTH: 1920, // The width of the virtual canvas
        VIRTUAL_HEIGHT: 1080, // The height of the virtual canvas
        DEFAULT_COLOR: '#ff0000', // The default color for drawing
        DEFAULT_WIDTH: 5, // The default width for drawing
        MIN_ZOOM: 0.1, // The minimum zoom level
        MAX_ZOOM: 5, // The maximum zoom level
        DEFAULT_ZOOM: 0.9 // The default zoom level
    },
    network: {
        LOCAL_WS_URL: 'ws://127.0.0.1:8000/ws/draw', // The WebSocket URL for local development
        GCP_WS_URL: 'ws://34.148.39.39:8080/ws/draw', // The WebSocket URL for Google Cloud Platform deployment
        HEARTBEAT_INTERVAL: 15000, // The interval (in milliseconds) for sending heartbeat messages
        HEARTBEAT_TIMEOUT: 45000, // The timeout (in milliseconds) for waiting for a heartbeat response
        STATE_CHECK_INTERVAL: 2000, // New parameter for state checking frequency
        STATE_CHECK_INTERVAL_IDLE: 100000, // Longer interval when no activity
        STATE_CHECK_INTERVAL_ACTIVE: 1000, // Shorter interval during drawing activity
        ACTIVITY_TIMEOUT: 5000 // Time before returning to idle checking
    },
    drawing: {
        MIN_INTERPOLATION_DISTANCE: 0.002 // The minimum distance for interpolating drawing points
    }
};
