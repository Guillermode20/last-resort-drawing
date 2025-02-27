# Last Resort Drawing Board

## How It Works

1.  **Drawing Input (drawing.html):**

    *   User interacts with the canvas (mouse/touch) on the `drawing.html` page.

2.  **Point Capture & Transformation (drawing.html):**

    *   Application captures the coordinates of the drawing input (mouse/touch positions).
    *   Coordinates are transformed into normalized virtual canvas coordinates (range 0-1).

3.  **Drawing on Canvas (drawing.html):**

    *   The transformed input is drawn onto the local canvas in `drawing.html`, providing immediate visual feedback to the user.

4.  **Data Batching (drawing.html):**

    *   The drawn points are batched into a data structure for efficient transmission.

5.  **WebSocket Transmission (drawing.html):**

    *   The drawing data (points, color, width, etc.) is sent to the WebSocket server as a JSON message.

6.  **Server Broadcast:**

    *   The WebSocket server receives the drawing data.
    *   The server broadcasts the drawing data to all connected clients (both drawing and display clients).

7.  **Display Client Reception (display.html):**

    *   The `display.html` page receives the drawing data via WebSocket.

8.  **Drawing on Display Canvas (display.html):**

    *   The display client transforms the normalized coordinates received from the server back into canvas coordinates appropriate for its canvas size.
    *   The transformed coordinates are used to draw lines on the display client's canvas, replicating the drawing.

9. **State Management:**
    * **Drawing Client (drawing.html):**
        * The drawing client stores the drawing commands in a local array called `drawingState`.
    * **Display Client (display.html):**
        * The display client stores the drawing commands in a local array called `drawingState`.

10. **Clear Canvas:**

    *   A "clear" command is sent via WebSocket to the server.
    *   The server broadcasts the clear command to all clients.
    *   Upon receiving the clear command:
        *   Both the drawing and display canvases are cleared.
        *   The `drawingState` arrays on both drawing and display clients are emptied.

11. **Initial State Request:**

    *   When a client connects to the server:
        *   It sends a "join" message via WebSocket.
            *   The `drawing.html` page sends a "join" message.
            *   The `display.html` page sends a "join" message.
    *   The server, upon receiving a "join" message, sends the current `drawingState` to the requesting client. This allows new clients to catch up to the current drawing.


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
```

### Deactivating the Virtual Environment

When you are done working on the project, you can deactivate the virtual environment with:

```sh
deactivate
```