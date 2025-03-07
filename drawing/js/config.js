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
        MIN_INTERPOLATION_DISTANCE: 0.006, // Increased to further reduce point density while drawing
        SIMPLIFICATION: {
            ENABLED: true, // Whether to simplify paths before sending to server
            MAX_POINTS: 40, // Further reduced for more aggressive optimization
            MIN_POINTS: 4, // Increased slightly to ensure enough points for smooth curves
            MIN_LENGTH_FOR_SIMPLIFICATION: 6, // Reduced to catch even more cases
            // Adaptive simplification parameters
            AREA_THRESHOLD_FACTOR: 0.00003, // Reduced to preserve curve details
            COMPLEXITY_FACTOR: 0.25, // Increased for more aggressive straight line optimization
            MAX_COMPRESSION_RATIO: 0.90, // Increased compression (keep only 10% of points)
            
            // Enhanced compression parameters
            ERROR_THRESHOLD: 0.0008, // Decreased to maintain curve fidelity
            CURVATURE_WEIGHT: 0.8, // Increased significantly to favor curve preservation
            PROGRESSIVE_SIMPLIFICATION: true, // Use a multi-pass approach for better results
            COMBINE_CLOSE_POINTS: true, // Combine points that are very close together
            CLOSE_POINTS_THRESHOLD: 0.002 // Increased for more aggressive point combining
        }
    }
};
