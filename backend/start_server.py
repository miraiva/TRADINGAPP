#!/usr/bin/env python3
"""
Start script for uvicorn that ensures subprocesses use the correct Python
"""
import sys
import os
import multiprocessing

# Get the current Python executable (should be venv Python)
venv_python = sys.executable

# Debug: Print which Python we're using
print(f"Using Python: {venv_python}", file=sys.stderr)
print(f"Python version: {sys.version}", file=sys.stderr)
print(f"Architecture: {__import__('platform').machine()}", file=sys.stderr)

# Set multiprocessing start method to 'spawn' which respects sys.executable
# This ensures subprocesses use the same Python interpreter
try:
    multiprocessing.set_start_method('spawn', force=True)
except RuntimeError:
    # Already set, that's fine
    pass

# Ensure sys.executable points to this Python (venv Python)
# This is critical for subprocesses spawned by uvicorn's reloader
sys.executable = venv_python

# Set environment variable so subprocesses know which Python to use
os.environ['PYTHON'] = venv_python
os.environ['_PYTHON_SYSCONFIGDATA_NAME'] = '_sysconfigdata__darwin_darwin'

# Now start uvicorn
import uvicorn

if __name__ == "__main__":
    # Disable reload to avoid multiprocessing architecture issues
    # The reloader spawns subprocesses that may use the wrong Python
    # For the app bundle, we don't need auto-reload anyway
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,  # Disabled to avoid architecture mismatch issues
        log_level="info"
    )

