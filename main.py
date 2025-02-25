import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import Dict, Set, List
import asyncio

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - [%(name)s] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('WebSocket-Server')

# Add StreamHandler to ensure logging outputs to the terminal
stream_handler = logging.StreamHandler()
stream_handler.setLevel(logging.DEBUG)
stream_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - [%(name)s] - %(message)s'))
logger.addHandler(stream_handler)

app = FastAPI()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {
            'draw': set(),
            'display': set()
        }
        self.drawing_state: List[dict] = []
        self.last_update_time = 0
        self.state_version = 0  # Track state changes
        self.client_versions: Dict[WebSocket, int] = {}
        self.last_ping_times: Dict[WebSocket, float] = {}  # Track last ping time for each connection
        logger.info("ConnectionManager initialized")

    async def connect(self, websocket: WebSocket, client_type: str):
        client_info = f"Client connecting - Type: {client_type} | Client Address: {websocket.client.host}:{websocket.client.port}"
        logger.info(client_info)
        logger.debug(f"Current active connections before accept - Draw: {len(self.active_connections['draw'])} | Display: {len(self.active_connections['display'])}")
        
        await websocket.accept()
        self.active_connections[client_type].add(websocket)
        self.client_versions[websocket] = 0  # New client starts at version 0
        self.last_ping_times[websocket] = asyncio.get_event_loop().time()
        
        logger.info(f"Client successfully connected - {client_info}")
        logger.debug(f"New connection details - Headers: {websocket.headers}")
        logger.debug(f"Updated active connections - Draw: {len(self.active_connections['draw'])} | Display: {len(self.active_connections['display'])}")
        
        # Send current state to new client
        state_size = len(self.drawing_state)
        logger.debug(f"Sending initial state to new client - State size: {state_size} elements")
        await websocket.send_json({"type": "state", "state": self.drawing_state})

    def disconnect(self, websocket: WebSocket, client_type: str):
        logger.info(f"Client disconnecting - Type: {client_type} | Client Address: {websocket.client.host}:{websocket.client.port}")
        self.active_connections[client_type].remove(websocket)
        if websocket in self.client_versions:
            del self.client_versions[websocket]
        if websocket in self.last_ping_times:
            del self.last_ping_times[websocket]
        logger.debug(f"Updated active connections after disconnect - Draw: {len(self.active_connections['draw'])} | Display: {len(self.active_connections['display'])}")

    async def broadcast(self, message: dict, exclude: WebSocket = None):
        # Update drawing state for draw events
        if message.get("type") == "draw":
            self.drawing_state.append(message)
            self.last_update_time = asyncio.get_event_loop().time()
            self.state_version += 1  # Increment version on state change
        elif message.get("type") == "clear":
            self.drawing_state.clear()
            self.last_update_time = asyncio.get_event_loop().time()
            self.state_version += 1  # Increment version on state change

        # Broadcast to all connections except the sender
        for client_type in self.active_connections:
            for connection in self.active_connections[client_type]:
                if connection != exclude:
                    await connection.send_json(message)
                    if message.get("type") in ["draw", "clear"]:
                        self.client_versions[connection] = self.state_version

    async def check_connection(self, websocket: WebSocket) -> bool:
        try:
            await websocket.send_json({"type": "ping"})
            return True
        except:
            return False

    async def remove_dead_connections(self):
        current_time = asyncio.get_event_loop().time()
        for client_type in list(self.active_connections.keys()):
            for connection in list(self.active_connections[client_type]):
                # Check if connection hasn't responded in 30 seconds
                if current_time - self.last_ping_times.get(connection, 0) > 30:
                    if not await self.check_connection(connection):
                        self.disconnect(connection, client_type)

    async def periodic_state_check(self):
        while True:
            await asyncio.sleep(2)  # Check every 2 seconds
            try:
                await self.remove_dead_connections()  # Check for dead connections
                for client_type in self.active_connections:
                    for connection in self.active_connections[client_type]:
                        # Only send updates to clients that are behind the current state
                        if connection in self.client_versions and \
                           self.client_versions[connection] < self.state_version:
                            try:
                                await connection.send_json({"type": "state", "state": self.drawing_state})
                                self.client_versions[connection] = self.state_version
                            except:
                                continue
            except:
                continue  # Handle any unexpected errors gracefully

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(manager.periodic_state_check())

@app.get("/test")
async def test_endpoint():
    return {"message": "Test endpoint is working"}

@app.websocket("/ws/{client_type}")
async def websocket_endpoint(websocket: WebSocket, client_type: str):
    logger.info(f"New WebSocket connection request - Client Type: {client_type}")
    logger.debug(f"Connection details - Client: {websocket.client.host}:{websocket.client.port}")
    logger.debug(f"Headers: {websocket.headers}")
    
    if client_type not in ['draw', 'display']:
        logger.warning(f"Invalid client type attempted to connect: {client_type}")
        await websocket.close(code=1003)  # Unsupported data
        return

    await manager.connect(websocket, client_type)

    try:
        # If this is a new client, broadcast new-client event
        if client_type == 'draw':
            logger.info(f"New drawing client connected - Broadcasting new-client event")
            await manager.broadcast({"type": "new-client"}, exclude=websocket)

        while True:
            data = await websocket.receive_json()
            # Update last ping time when we receive any message
            manager.last_ping_times[websocket] = asyncio.get_event_loop().time()
            
            # Handle ping messages specially
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
                
            # Relay other messages to all other clients
            await manager.broadcast(data, exclude=websocket)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected - Client Type: {client_type} | Address: {websocket.client.host}:{websocket.client.port}")
        manager.disconnect(websocket, client_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)