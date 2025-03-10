#!/bin/bash

# Check if virtual environment already exists
if [ ! -d ".venv" ]; then
  echo "Creating new virtual environment..."
  python3 -m venv .venv || { echo "Failed to create virtual environment"; exit 1; }
else
  echo "Virtual environment already exists."
fi

# Check if the virtual environment was created successfully
if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
else
  echo "Virtual environment activation script not found. Exiting."
  exit 1
fi

# Navigate to server directory
cd server

# Only install requirements if they haven't been installed already
# Using pip freeze to check if any packages are installed
if [ "$(pip freeze | wc -l)" -eq "0" ]; then
  echo "Installing dependencies..."
  pip install --no-cache-dir -r requirements.txt
else
  echo "Dependencies already installed, skipping installation."
fi

echo "Starting server..."
uvicorn main:app --host 0.0.0.0 --port 8080
