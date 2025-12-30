"""
Migration API Endpoints
Handles one-time migration of Zerodha holdings
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db
from app.services import migration_service

router = APIRouter(prefix="/api/migration", tags=["migration"])


class MigrationRequest(BaseModel):
    access_token: str


@router.post("/holdings")
async def migrate_holdings(
    request: MigrationRequest,
    db: Session = Depends(get_db)
):
    """One-time migration of Zerodha holdings"""
    try:
        result = migration_service.migrate_holdings(request.access_token, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Migration failed: {str(e)}")



