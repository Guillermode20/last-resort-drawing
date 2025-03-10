# Last Resort Drawing Board

## How It Works

The project uses real-time WebSocket connections to synchronize drawing to enable collaboration. 

- **Server Setup**:  
  A FastAPI server (run via Uvicorn) manages WebSocket connections and maintains a versioned drawing state. It can be hosted locally or on the Google Cloud Virtual Machine. The server handles state synchronization, heartbeat monitoring, and memory management by pruning old drawing data.

- **Drawing Interface**:  
  The `drawing.html` page is designed for mobile devices or tablets. Users can draw using touch or mouse events, and the corresponding JavaScript modules capture drawing events (start, draw, end, undo). These events are sent as drawing data to the server via WebSocket.

- **Multiple Instances & Syncing**:  
  Multiple devices running `drawing.html` can draw concurrently. The server merges these inputs and broadcasts the updated drawing state to all connected clients, ensuring real-time synchronization across all drawing devices.

- **Collaborative Whiteboard Display**:  
  The `display.html` is meant for the large screen in the bar where the collaborative drawing is shown live as a whiteboard. It receives and renders the latest drawing data from the server in real time.

- **State Management & Undo**:  
  The server manages a versioned state to resolve conflicts and supports undo operations for individual drawing sessions. It also uses differential updates for efficient state sync among the connected clients.

## Getting Started

Follow these instructions to set up the project on your local machine.

### Prerequisites

- Python 3.x
- pip (Python package installer)

### Setup

1. Clone the repository:

    ```sh
    git clone https://github.com/your-username/last-resort-drawing.git
    cd last-resort-drawing
    ```

2. Create a virtual environment:

    ```sh
    python -m venv venv
    ```

3. Activate the virtual environment:

    - On Windows:

        ```sh
        .\venv\Scripts\activate
        ```

    - On macOS and Linux:

        ```sh
        source venv/bin/activate
        ```

4. Install the required dependencies:

    ```sh
    pip install -r requirements.txt
    ```

### Running the Project

To run the project, use the following command:

```sh
uvicorn main:app --host 0.0.0.0 --port 8080
```

This command starts the Uvicorn server, using `main.py` as the entry point and enabling hot reloading for development.

### Deactivating the Virtual Environment

When you are done working on the project, you can deactivate the virtual environment with:

```sh
deactivate
```