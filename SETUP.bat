@echo off
REM Trading App Setup Script for Windows

echo 🚀 Setting up Personal Trading App...
echo.

REM Backend Setup
echo 📦 Setting up Backend...
cd backend

REM Create virtual environment
if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing Python dependencies...
python -m pip install --upgrade pip
pip install -r requirements.txt

REM Create .env file if it doesn't exist
if not exist ".env" (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo ⚠️  Please edit backend\.env and add your API keys!
)

REM Create data directory
if not exist "data" mkdir data
if not exist "uploads" mkdir uploads

cd ..

REM Frontend Setup
echo.
echo 📦 Setting up Frontend...
cd frontend

REM Install dependencies
if not exist "node_modules" (
    echo Installing Node.js dependencies...
    call npm install
) else (
    echo Node modules already installed, skipping...
)

cd ..

echo.
echo ✅ Setup complete!
echo.
echo Next steps:
echo 1. Edit backend\.env and add your API keys
echo 2. Start backend: cd backend ^&^& venv\Scripts\activate ^&^& uvicorn app.main:app --reload --port 8000
echo 3. Start frontend: cd frontend ^&^& npm run dev
echo.
echo Backend will run on http://localhost:8000
echo Frontend will run on http://localhost:3000

pause



