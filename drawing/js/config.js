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
        MIN_INTERPOLATION_DISTANCE: 0.002, // The minimum distance for interpolating drawing points
        SIMPLIFICATION: {
            ENABLED: true, // Whether to simplify paths before sending to server
            MAX_POINTS: 100, // Maximum number of points to keep after simplification
            MIN_POINTS: 5, // Minimum number of points to keep (for very short strokes)
            MIN_LENGTH_FOR_SIMPLIFICATION: 10, // Only simplify paths longer than this many points
            // Adaptive simplification parameters
            AREA_THRESHOLD_FACTOR: 0.00001, // Base threshold for triangle area importance
            COMPLEXITY_FACTOR: 0.1, // Factor to adjust simplification based on path complexity (0-1, lower = more simplification)
            MAX_COMPRESSION_RATIO: 0.7, // Maximum compression (0.7 = keep at least 30% of points)
            
            // Enhanced compression parameters
            ERROR_THRESHOLD: 0.0008, // Maximum allowed error as a fraction of the virtual canvas size
            CURVATURE_WEIGHT: 0.6, // Weight to give to curvature vs. straight lines (0-1)
            PROGRESSIVE_SIMPLIFICATION: true, // Use a multi-pass approach for better results
            COMBINE_CLOSE_POINTS: true, // Combine points that are very close together
            CLOSE_POINTS_THRESHOLD: 0.0004 // Distance threshold for combining points (relative to canvas size)
        }
    }
};
