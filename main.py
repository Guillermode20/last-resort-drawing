import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import Dict, Set, List, Optional, Any
import asyncio
import time

START_TIME = time.time()
import struct

def setup_logger(name: str):
    """Configure and return a logger with the given name."""
    return None

# Initialize logger
logger = setup_logger('WebSocket-Server')

app = FastAPI()

def decode_draw_message(binary_data: bytes) -> dict:
    # Decode binary drawing message:
    header_size = struct.calcsize('!B I')  # type, version
    if len(binary_data) < header_size:
        return {}
        
    msg_type, version = struct.unpack('!B I', binary_data[:header_size])
    
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
            return {}
    elif msg_type == 2:
        return {"type": "clear", "version": version}
    elif msg_type == 3:
        return {"type": "undo", "version": version}
    else:
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

    async def connect(self, websocket: WebSocket, client_type: str):
        await websocket.accept()
        self.active_connections[client_type].add(websocket)
        self.client_versions[websocket] = 0  # New client starts at version 0
        self.last_ping_times[websocket] = asyncio.get_event_loop().time()
        
        # Send current state to new client with version information
        state_size = len(self.drawing_state)
        await websocket.send_json({
            "type": "state", 
            "state": self.drawing_state,
            "version": self.state_version
        })

    def disconnect(self, websocket: WebSocket, client_type: str):
        self.active_connections[client_type].remove(websocket)
        if websocket in self.client_versions:
            del self.client_versions[websocket]
        if websocket in self.last_ping_times:
            del self.last_ping_times[websocket]

    async def broadcast(self, message: dict, exclude: WebSocket = None, client_ip: str = None):
        # For logging
        msg_type = message.get("type", "unknown")
        
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
            else:
                return  # No drawings to undo, don't broadcast

        # Broadcast to all connections except the sender
        failed_connections = set()
        for client_type in self.active_connections:
            for connection in self.active_connections[client_type]:
                if connection != exclude:
                    try:
                        if message.get("type") in ["draw", "clear", "undo"] and binary_message:
                            await connection.send_bytes(binary_message)
                            self.client_versions[connection] = self.state_version
                        else:
                            await connection.send_json(message)
                    except Exception as e:
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
                        pass

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
                await asyncio.sleep(10)

manager = ConnectionManager()

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(manager.periodic_state_check())
    asyncio.create_task(manager.start_heartbeat())

@app.get("/test")
async def test_endpoint():
    return {"message": "Test endpoint is working"}

@app.get("/health")
async def health_check():
    import psutil
    return {
        "status": "healthy",
        "memory_usage": psutil.virtual_memory().percent,
        "cpu_usage": psutil.cpu_percent(interval=0.1),
        "active_connections": sum(len(conns) for conns in manager.active_connections.values()),
        "drawing_count": len(manager.drawing_state),
        "uptime_seconds": time.time() - START_TIME  # Add START_TIME at app init
    }

@app.websocket("/ws/{client_type}")
async def websocket_endpoint(websocket: WebSocket, client_type: str):
    if client_type not in ['draw', 'display']:
        await websocket.close(code=1003)  # Unsupported data
        return

    await manager.connect(websocket, client_type)

    try:
        # If this is a new client, broadcast new-client event
        if client_type == 'draw':
            await manager.broadcast({"type": "new-client"}, exclude=websocket)

        while True:
            data = await websocket.receive()
            client_ip = websocket.client.host
            
            if "text" in data:
                try:
                    msg = json.loads(data["text"])
                except json.JSONDecodeError:
                    continue
            elif "bytes" in data:
                try:
                    msg = decode_draw_message(data["bytes"])
                except Exception as e:
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
                await manager.broadcast(msg, exclude=websocket, client_ip=client_ip)
            else:
                await manager.broadcast(msg, exclude=websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket, client_type)
    except Exception as e:
        manager.disconnect(websocket, client_type)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)