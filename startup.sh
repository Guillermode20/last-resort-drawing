#!/bin/bash

python3 -m venv .venv || { echo "Failed to create virtual environment"; exit 1; }

# Check if the virtual environment was created successfully
if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
else
  echo "Virtual environment activation script not found.  Exiting."
  exit 1
fi

cd server
pip install --no-cache-dir -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8080
