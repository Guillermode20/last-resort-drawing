# Last Resort Drawing

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