#!/bin/bash

python3 -m venv venv
source .venv/bin/activate
cd server
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080