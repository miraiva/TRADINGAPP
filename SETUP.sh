#!/bin/bash

# Trading App Setup Script
# This script sets up both backend and frontend

echo "🚀 Setting up Personal Trading App..."
echo ""

# Backend Setup
echo "📦 Setting up Backend..."
cd backend

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit backend/.env and add your API keys!"
fi

# Create data directory
mkdir -p data
mkdir -p uploads

cd ..

# Frontend Setup
echo ""
echo "📦 Setting up Frontend..."
cd frontend

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install
else
    echo "Node modules already installed, skipping..."
fi

cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit backend/.env and add your API keys"
echo "2. Start backend: cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000"
echo "3. Start frontend: cd frontend && npm run dev"
echo ""
echo "Backend will run on http://localhost:8000"
echo "Frontend will run on http://localhost:3000"



