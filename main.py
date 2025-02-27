import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import Dict, Set, List, Optional, Any
import asyncio
import time
import struct

def setup_logger(name: str) -> logging.Logger:
    """Configure and return a logger with the given name."""
    logger = logging.getLogger(name)
    
    # Configure basic logging
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(levelname)s - [%(name)s] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Add StreamHandler to ensure logging outputs to the terminal
    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.DEBUG)
    stream_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - [%(name)s] - %(message)s'))
    logger.addHandler(stream_handler)
    
    return logger

# Initialize logger
logger = setup_logger('WebSocket-Server')

app = FastAPI()

def decode_draw_message(binary_data: bytes) -> dict:
    # Decode binary drawing message:
    header_size = struct.calcsize('!B I')  # type, version
    if len(binary_data) < header_size:
        logger.error(f"Binary message too short: {len(binary_data)} bytes")
        return {}
        
    msg_type, version = struct.unpack('!B I', binary_data[:header_size])
    
    logger.debug(f"Decoded binary message: type={msg_type}, version={version}")
    
    if msg_type == 1:
        # Continue with draw message decoding
        try:
            color_width_size = struct.calcsize('!I f I')
            color_int, width, num_points = struct.unpack('!I f I', binary_data[header_size:header_size+color_width_size])
            points = []
            point_size = struct.calcsize('!f f')
            offset = header_size + color_width_size
            for _ in range(num_points):
                x, y = struct.unpack('!f f', binary_data[offset:offset+point_size])
                points.append({'x': x, 'y': y})
                offset += point_size
            color = f"#{color_int:06x}"
            return {"type": "draw", "version": version, "color": color, "width": width, "points": points}
        except Exception as e:
            logger.error(f"Error decoding draw message: {e}")
            return {}
    elif msg_type == 2:
        return {"type": "clear", "version": version}
    elif msg_type == 3:
        logger.info(f"Received undo message with version {version}")
        return {"type": "undo", "version": version}
    else:
        logger.warning(f"Unknown binary message type: {msg_type}")
    return {}

class ConnectionManager:
    """Manages WebSocket connections, client state tracking and broadcasting."""
    
    def __init__(self) -> None:
        """Initialize the connection manager with empty collections for tracking state."""
        # Client connections organized by type
        self.active_connections: Dict[str, Set[WebSocket]] = {
            'draw': set(),
            'display': set()
        }
        
        # Drawing state tracking
        self.drawing_state: List[dict] = []
        self.last_update_time: float = time.time()
        self.state_version: int = 0
        
        # IP-based drawing tracking
        self.drawings_by_ip: Dict[str, List[dict]] = {}
        
        # Client state tracking
        self.client_versions: Dict[WebSocket, int] = {}
        self.last_ping_times: Dict[WebSocket, float] = {}
        
        # Background task reference
        self.heartbeat_task: Optional[asyncio.Task] = None
        
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
        
        # Send current state to new client with version information
        state_size = len(self.drawing_state)
        logger.debug(f"Sending initial state to new client - State size: {state_size} elements, Version: {self.state_version}")
        await websocket.send_json({
            "type": "state", 
            "state": self.drawing_state,
            "version": self.state_version
        })

    def disconnect(self, websocket: WebSocket, client_type: str):
        logger.info(f"Client disconnecting - Type: {client_type} | Client Address: {websocket.client.host}:{websocket.client.port}")
        self.active_connections[client_type].remove(websocket)
        if websocket in self.client_versions:
            del self.client_versions[websocket]
        if websocket in self.last_ping_times:
            del self.last_ping_times[websocket]
        logger.debug(f"Updated active connections after disconnect - Draw: {len(self.active_connections['draw'])} | Display: {len(self.active_connections['display'])}")

    async def broadcast(self, message: dict, exclude: WebSocket = None, client_ip: str = None):
        # For logging
        msg_type = message.get("type", "unknown")
        logger.debug(f"Broadcasting message type: {msg_type}")
        
        binary_message = None
        
        # Update drawing state for draw events
        if message.get("type") == "draw":
            # Add client IP to the message if provided
            if client_ip:
                message["client_ip"] = client_ip
                
                # Store drawing by IP
                if client_ip not in self.drawings_by_ip:
                    self.drawings_by_ip[client_ip] = []
                self.drawings_by_ip[client_ip].append(message)
                logger.debug(f"Stored drawing for IP {client_ip}, total: {len(self.drawings_by_ip[client_ip])}")
                
            self.drawing_state.append(message)
            self.last_update_time = asyncio.get_event_loop().time()
            self.state_version += 1  # Increment version on state change
            # Include version in the outgoing message
            message["version"] = self.state_version
            # Pack drawing message as binary:
            points = message["points"]
            header = struct.pack('!B I I f I', 1, self.state_version, int(message["color"].lstrip('#'), 16), float(message["width"]), len(points))
            body = b''.join([struct.pack('!f f', p["x"], p["y"]) for p in points])
            binary_message = header + body
            
        elif message.get("type") == "clear":
            self.drawing_state.clear()
            # Clear IP-based drawings too
            self.drawings_by_ip.clear()
            self.last_update_time = asyncio.get_event_loop().time()
            self.state_version += 1  # Increment version on state change
            # Include version in the outgoing message
            message["version"] = self.state_version
            binary_message = struct.pack('!B I', 2, self.state_version)
            
        elif message.get("type") == "undo" and client_ip:
            # Handle undo event for specific client IP
            logger.info(f"Processing undo for IP {client_ip}")
            
            if client_ip in self.drawings_by_ip and self.drawings_by_ip[client_ip]:
                # Remove the latest drawing from this IP
                removed_drawing = self.drawings_by_ip[client_ip].pop()
                
                # Also remove it from global drawing state
                if removed_drawing in self.drawing_state:
                    self.drawing_state.remove(removed_drawing)
                
                self.last_update_time = asyncio.get_event_loop().time()
                self.state_version += 1  # Increment version on state change
                
                # Include version in the outgoing message
                message["version"] = self.state_version
                binary_message = struct.pack('!B I', 3, self.state_version)
                
                logger.info(f"Undo operation from IP {client_ip}: removed 1 drawing. Remaining drawings for this IP: {len(self.drawings_by_ip[client_ip])}")
            else:
                logger.warning(f"Undo operation from IP {client_ip}: No drawings to undo")
                return  # No drawings to undo, don't broadcast

        # Broadcast to all connections except the sender
        failed_connections = set()
        for client_type in self.active_connections:
            for connection in self.active_connections[client_type]:
                if connection != exclude:
                    try:
                        # Special case logging for undo
                        if message.get("type") == "undo":
                            logger.debug(f"Broadcasting undo to {client_type} client: {connection.client.host}:{connection.client.port}")
                        
                        if message.get("type") in ["draw", "clear", "undo"] and binary_message:
                            await connection.send_bytes(binary_message)
                            self.client_versions[connection] = self.state_version
                        else:
                            await connection.send_json(message)
                    except Exception as e:
                        logger.error(f"Failed to send to client: {e}")
                        failed_connections.add((connection, client_type))
        
        # Remove any connections that failed
        for connection, client_type in failed_connections:
            self.disconnect(connection, client_type)

    async def check_connection(self, websocket: WebSocket) -> bool:
        try:
            await websocket.send_json({"type": "ping", "timestamp": asyncio.get_event_loop().time()})
            return True
        except:
            return False

    async def remove_dead_connections(self):
        current_time = asyncio.get_event_loop().time()
        failed_connections = set()
        
        for client_type in list(self.active_connections.keys()):
            for connection in list(self.active_connections[client_type]):
                # Check if connection hasn't responded in 30 seconds
                if current_time - self.last_ping_times.get(connection, 0) > 30:
                    try:
                        if not await self.check_connection(connection):
                            failed_connections.add((connection, client_type))
                    except Exception:
                        failed_connections.add((connection, client_type))
                        
        for connection, client_type in failed_connections:
            self.disconnect(connection, client_type)

    async def periodic_state_check(self):
        while True:
            try:
                await self.remove_dead_connections()  # Check for dead connections
                await self.sync_client_states()  # Sync client states
                await asyncio.sleep(1)  # Reduced interval for quicker sync
            except Exception as e:
                logger.error(f"Error in periodic state check: {e}")
                await asyncio.sleep(1)

    async def sync_client_states(self):
        """Ensure all clients have the current state version"""
        for client_type in self.active_connections:
            for connection in list(self.active_connections[client_type]):
                # Force full state update if client's version does not match the server's
                if connection in self.client_versions and self.client_versions[connection] != self.state_version:
                    try:
                        await connection.send_json({
                            "type": "state", 
                            "state": self.drawing_state,
                            "version": self.state_version
                        })
                        self.client_versions[connection] = self.state_version
                    except Exception as e:
                        logger.error(f"Failed to sync state with client: {e}")

    async def start_heartbeat(self):
        """Start sending regular heartbeats to all clients"""
        while True:
            try:
                current_time = asyncio.get_event_loop().time()
                for client_type in self.active_connections:
                    for connection in list(self.active_connections[client_type]):
                        try:
                            await connection.send_json({
                                "type": "heartbeat", 
                                "timestamp": current_time
                            })
                        except:
                            # Will be handled by remove_dead_connections
                            pass
                await asyncio.sleep(10)  # Send heartbeat every 10 seconds
            except Exception as e:
                logger.error(f"Error in heartbeat: {e}")
                await asyncio.sleep(10)

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(manager.periodic_state_check())
    asyncio.create_task(manager.start_heartbeat())

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
            data = await websocket.receive()
            client_ip = websocket.client.host
            logger.debug(f"Received message from {client_ip}: {data.keys() if hasattr(data, 'keys') else type(data)}")
            
            if "text" in data:
                try:
                    msg = json.loads(data["text"])
                    logger.debug(f"Parsed JSON message: {msg}")
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON received: {data['text'][:100]}")
                    continue
            elif "bytes" in data:
                try:
                    msg = decode_draw_message(data["bytes"])
                    logger.debug(f"Decoded binary message: {msg}")
                except Exception as e:
                    logger.error(f"Error decoding binary message: {e}")
                    continue
            else:
                continue
                
            # Update last ping time when we receive any message
            manager.last_ping_times[websocket] = asyncio.get_event_loop().time()
            
            # Handle ping/pong messages specially
            if msg.get("type") == "ping":
                await websocket.send_json({
                    "type": "pong", 
                    "timestamp": msg.get("timestamp", asyncio.get_event_loop().time())
                })
                continue
            elif msg.get("type") == "pong":
                # Just update the ping time, which was already done above
                continue
            elif msg.get("type") == "state_request":
                # Handle specific request for complete state
                client_version = msg.get("current_version", 0)
                if client_version < manager.state_version:
                    await websocket.send_json({
                        "type": "state", 
                        "state": manager.drawing_state,
                        "version": manager.state_version
                    })
                    manager.client_versions[websocket] = manager.state_version
                continue
            elif msg.get("type") == "state_version_check":
                # Check if client needs a state update based on version
                client_version = msg.get("current_version", 0)
                if client_version < manager.state_version:
                    logger.debug(f"Client version ({client_version}) behind server version ({manager.state_version}), sending update")
                    # Send state update to this client
                    await websocket.send_json({
                        "type": "state", 
                        "state": manager.drawing_state,
                        "version": manager.state_version
                    })
                    manager.client_versions[websocket] = manager.state_version
                continue
                
            # Relay other messages to all clients
            # For drawing data and undo, include the client IP address
            if msg.get("type") in ["draw", "undo"]:
                logger.info(f"Broadcasting {msg.get('type')} message from {client_ip}")
                await manager.broadcast(msg, exclude=websocket, client_ip=client_ip)
            else:
                await manager.broadcast(msg, exclude=websocket)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected - Client Type: {client_type} | Address: {websocket.client.host}:{websocket.client.port}")
        manager.disconnect(websocket, client_type)
    except Exception as e:
        logger.error(f"Error handling WebSocket: {e}")
        manager.disconnect(websocket, client_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)