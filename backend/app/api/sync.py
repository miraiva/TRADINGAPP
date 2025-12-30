"""
Sync API Endpoints
Handles synchronization with Zerodha
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db
from app.services import sync_service

router = APIRouter(prefix="/api/sync", tags=["sync"])


class SyncRequest(BaseModel):
    access_token: str


@router.post("/positions")
async def sync_positions(
    request: SyncRequest,
    db: Session = Depends(get_db)
):
    """Sync positions from Zerodha"""
    try:
        result = sync_service.sync_positions(request.access_token, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Sync failed: {str(e)}")


@router.post("/holdings")
async def sync_holdings(
    request: SyncRequest,
    db: Session = Depends(get_db)
):
    """Sync holdings from Zerodha"""
    try:
        result = sync_service.sync_holdings(request.access_token, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Sync failed: {str(e)}")


@router.post("/all")
async def sync_all(
    request: SyncRequest,
    db: Session = Depends(get_db)
):
    """Sync both positions and holdings"""
    try:
        result = sync_service.sync_all(request.access_token, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Sync failed: {str(e)}")


@router.get("/last-sync-data")
async def get_last_sync_data():
    """Get the last Zerodha API responses for debugging"""
    try:
        data = sync_service.get_last_sync_data()
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get last sync data: {str(e)}")



