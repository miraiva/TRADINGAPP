#!/bin/bash

# Trading App Startup Script
# This script starts both backend and frontend services with static URLs

echo "🚀 Starting Trading App..."

# Kill any existing instances
echo "Stopping existing instances..."
pkill -f "uvicorn app.main:app" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 2

# Start Backend
echo "Starting backend on http://localhost:8000..."
cd "$(dirname "$0")/backend"
python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 > /tmp/trading_app_backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

# Wait a bit for backend to start
sleep 3

# Start Frontend
echo "Starting frontend on http://localhost:5173..."
cd "$(dirname "$0")/frontend"
npm run dev > /tmp/trading_app_frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"

# Wait for services to be ready
sleep 5

# Check if services are running
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Backend is running at http://localhost:8000"
else
    echo "❌ Backend failed to start. Check /tmp/trading_app_backend.log"
fi

if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo "✅ Frontend is running at http://localhost:5173"
    echo ""
    echo "📱 Open your browser to: http://localhost:5173"
else
    echo "❌ Frontend failed to start. Check /tmp/trading_app_frontend.log"
fi

echo ""
echo "To stop the services, run: ./stop_app.sh"
echo "To view logs:"
echo "  Backend:  tail -f /tmp/trading_app_backend.log"
echo "  Frontend: tail -f /tmp/trading_app_frontend.log"

