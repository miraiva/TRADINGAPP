#!/bin/bash
# Wrapper script to ensure uvicorn uses the venv Python
# This is needed because uvicorn's reloader spawns subprocesses

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python3"

# Ensure we're using the venv Python
exec "$VENV_PYTHON" -m uvicorn app.main:app "$@"

