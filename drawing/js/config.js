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
        MIN_INTERPOLATION_DISTANCE: 0.005, // Reduced to capture more detail during initial drawing
        SIMPLIFICATION: {
            ENABLED: true,
            MIN_LENGTH_FOR_SIMPLIFICATION: 4, // Slightly increased minimum points needed for simplification
            
            // Adaptive simplification parameters - tuned for better balance
            AREA_THRESHOLD_FACTOR: 0.00008, // Increased to preserve more details in complex areas
            COMPLEXITY_FACTOR: 0.6, // Increased to better handle complex paths
            MAX_COMPRESSION_RATIO: 0.85, // Reduced from 0.95 to preserve more detail
            
            // Enhanced compression parameters - optimized thresholds
            ERROR_THRESHOLD: 0.0015, // Slightly increased for better performance
            CURVATURE_WEIGHT: 0.65, // Reduced to balance between curves and straight lines
            COMBINE_CLOSE_POINTS: true,
            CLOSE_POINTS_THRESHOLD: 0.002 // Reduced for more precise point combination
        }
    }
};
