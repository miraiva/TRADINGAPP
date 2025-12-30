# Static URLs Configuration

This application uses static URLs that remain consistent:

## Development URLs

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **WebSocket**: ws://localhost:8000

## Configuration Files

- Frontend API URL is configured in `frontend/.env.local`
- Backend runs on port 8000 (configured in `backend/app/main.py`)
- Frontend runs on port 5173 (configured in `frontend/vite.config.js`)

## To Change URLs

1. Update `frontend/.env.local` for frontend API URL
2. Update `frontend/vite.config.js` for frontend port
3. Update backend port in the uvicorn command or `backend/app/main.py`

These URLs are static and will not change unless manually modified.

