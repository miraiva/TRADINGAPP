#!/bin/bash

# Trading App Stop Script
# This script stops both backend and frontend services

echo "🛑 Stopping Trading App..."

# Kill backend
pkill -f "uvicorn app.main:app"
if [ $? -eq 0 ]; then
    echo "✅ Backend stopped"
else
    echo "⚠️  No backend process found"
fi

# Kill frontend
pkill -f "vite"
if [ $? -eq 0 ]; then
    echo "✅ Frontend stopped"
else
    echo "⚠️  No frontend process found"
fi

echo "All services stopped."

