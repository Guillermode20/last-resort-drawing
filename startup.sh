#!/bin/bash

source .venv/bin/activate
cd server
uvicorn main:app --host 0.0.0.0 --port 8080