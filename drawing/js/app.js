// Main application initialization
document.addEventListener('DOMContentLoaded', function() {
    // Initialize canvas
    CanvasManager.init();
    
    // Set up UI
    UIManager.init();
    
    // Connect to WebSocket server
    NetworkManager.connect();
});