"""
Portfolio Snapshot API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime, timedelta
import logging

from app.db.database import get_db
from app.models.portfolio_snapshot import PortfolioSnapshot
from app.services.snapshot_service import create_snapshot, calculate_portfolio_metrics

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


class SnapshotResponse(BaseModel):
    id: int
    snapshot_date: date
    nav: Optional[float] = None
    portfolio_value: float
    total_payin: float
    booked_pl: float
    float_pl: float
    open_positions: float
    balance: float
    utilisation_percent: Optional[float] = None
    xirr: Optional[float] = None
    absolute_profit_percent: Optional[float] = None
    zerodha_user_id: Optional[str] = None
    trading_strategy: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class CreateSnapshotRequest(BaseModel):
    snapshot_date: Optional[date] = None  # If None, uses today
    zerodha_user_id: Optional[str] = None
    trading_strategy: Optional[str] = None  # 'SWING', 'LONG_TERM', or 'OVERALL'
    account_ids: Optional[List[str]] = None  # For OVERALL view


@router.post("/", response_model=SnapshotResponse)
async def create_snapshot_endpoint(
    request: CreateSnapshotRequest,
    db: Session = Depends(get_db)
):
    """Create a new portfolio snapshot"""
    try:
        snapshot_date = request.snapshot_date or date.today()
        
        snapshot = create_snapshot(
            db=db,
            snapshot_date=snapshot_date,
            zerodha_user_id=request.zerodha_user_id,
            trading_strategy=request.trading_strategy,
            account_ids=request.account_ids
        )
        
        return snapshot.to_dict()
    except Exception as e:
        logger.error(f"Error creating snapshot: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create snapshot: {str(e)}")


@router.get("/", response_model=List[SnapshotResponse])
async def get_snapshots(
    zerodha_user_id: Optional[str] = Query(None, description="Filter by Zerodha user ID"),
    trading_strategy: Optional[str] = Query(None, description="Filter by trading strategy"),
    start_date: Optional[date] = Query(None, description="Start date for date range"),
    end_date: Optional[date] = Query(None, description="End date for date range"),
    limit: Optional[int] = Query(100, description="Maximum number of snapshots to return"),
    db: Session = Depends(get_db)
):
    """Get portfolio snapshots with optional filters"""
    try:
        query = db.query(PortfolioSnapshot)
        
        if zerodha_user_id:
            query = query.filter(PortfolioSnapshot.zerodha_user_id == zerodha_user_id)
        
        if trading_strategy:
            query = query.filter(PortfolioSnapshot.trading_strategy == trading_strategy)
        
        if start_date:
            query = query.filter(PortfolioSnapshot.snapshot_date >= start_date)
        
        if end_date:
            query = query.filter(PortfolioSnapshot.snapshot_date <= end_date)
        
        snapshots = query.order_by(PortfolioSnapshot.snapshot_date.desc()).limit(limit).all()
        
        return [snapshot.to_dict() for snapshot in snapshots]
    except Exception as e:
        logger.error(f"Error fetching snapshots: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch snapshots: {str(e)}")


@router.get("/id/{snapshot_id}", response_model=SnapshotResponse)
async def get_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """Get a specific snapshot by ID"""
    try:
        snapshot = db.query(PortfolioSnapshot).filter(PortfolioSnapshot.id == snapshot_id).first()
        
        if not snapshot:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        
        return snapshot.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching snapshot: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch snapshot: {str(e)}")


@router.delete("/id/{snapshot_id}")
async def delete_snapshot(snapshot_id: int, db: Session = Depends(get_db)):
    """Delete a snapshot"""
    try:
        snapshot = db.query(PortfolioSnapshot).filter(PortfolioSnapshot.id == snapshot_id).first()
        
        if not snapshot:
            raise HTTPException(status_code=404, detail="Snapshot not found")
        
        db.delete(snapshot)
        db.commit()
        
        logger.info(f"Deleted snapshot: {snapshot_id}")
        
        return {"message": "Snapshot deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting snapshot: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete snapshot: {str(e)}")


@router.get("/latest-nav")
async def get_latest_nav(
    zerodha_user_id: Optional[str] = Query(None, description="Filter by Zerodha user ID"),
    trading_strategy: Optional[str] = Query('SWING', description="Trading strategy (default: SWING)"),
    db: Session = Depends(get_db)
):
    """Get the latest NAV from the most recent snapshot for a given strategy"""
    try:
        query = db.query(PortfolioSnapshot).filter(
            PortfolioSnapshot.trading_strategy == trading_strategy
        )
        
        if zerodha_user_id:
            query = query.filter(PortfolioSnapshot.zerodha_user_id == zerodha_user_id)
        
        # Get the most recent snapshot
        snapshot = query.order_by(PortfolioSnapshot.snapshot_date.desc()).first()
        
        if not snapshot or not snapshot.nav:
            # If no snapshot found, return None
            return {
                "nav": None,
                "snapshot_date": None,
                "message": f"No {trading_strategy} snapshot found"
            }
        
        return {
            "nav": snapshot.nav,
            "snapshot_date": snapshot.snapshot_date.isoformat(),
            "snapshot_id": snapshot.id
        }
    except Exception as e:
        logger.error(f"Error fetching latest NAV: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch latest NAV: {str(e)}")


@router.post("/create-daily")
async def create_daily_snapshots(db: Session = Depends(get_db)):
    """
    Create daily snapshots for all active accounts/strategies
    This endpoint can be called by a scheduled job
    """
    try:
        today = date.today()
        created_count = 0
        
        # Get all unique account IDs from payins
        from app.models.payin import Payin
        account_ids = db.query(Payin.zerodha_user_id).distinct().all()
        account_ids = [acc[0] for acc in account_ids if acc[0]]
        
        # Create snapshot for each account
        for account_id in account_ids:
            try:
                create_snapshot(
                    db=db,
                    snapshot_date=today,
                    zerodha_user_id=account_id,
                    trading_strategy=None
                )
                created_count += 1
            except Exception as e:
                logger.warning(f"Failed to create snapshot for {account_id}: {e}")
        
        # Also create snapshots for OVERALL view (combine all accounts)
        if account_ids:
            create_snapshot(
                db=db,
                snapshot_date=today,
                trading_strategy="OVERALL",
                account_ids=account_ids
            )
            created_count += 1
        
        logger.info(f"Created {created_count} daily snapshots for {today}")
        
        return {
            "message": f"Created {created_count} snapshots",
            "date": today.isoformat(),
            "count": created_count
        }
    except Exception as e:
        logger.error(f"Error creating daily snapshots: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create daily snapshots: {str(e)}")


class CreateManualSnapshotRequest(BaseModel):
    trading_strategy: Optional[str] = None  # 'SWING', 'LONG_TERM', or 'OVERALL'
    account_ids: Optional[List[str]] = None  # List of account IDs for the view
    snapshot_date: Optional[date] = None  # Date for snapshot (defaults to today)


@router.post("/create-manual")
async def create_manual_snapshot(
    request: CreateManualSnapshotRequest,
    db: Session = Depends(get_db)
):
    """
    Manually create a snapshot for the current view/strategy
    If a snapshot for the date already exists, it will be updated with latest data
    
    The frontend should pass:
    - trading_strategy: 'SWING', 'LONG_TERM', or 'OVERALL'
    - account_ids: List of account IDs for the current view (required for OVERALL)
    - snapshot_date: Optional date (defaults to today)
    """
    try:
        target_date = request.snapshot_date or date.today()
        trading_strategy = request.trading_strategy or "OVERALL"
        account_ids = request.account_ids or []
        
        if trading_strategy == "OVERALL":
            if not account_ids:
                # Get all account IDs from payins if not provided
                from app.models.payin import Payin
                all_accounts = db.query(Payin.zerodha_user_id).distinct().all()
                account_ids = [acc[0] for acc in all_accounts if acc[0]]
            
            # Create snapshot for OVERALL view
            snapshot = create_snapshot(
                db=db,
                snapshot_date=target_date,
                trading_strategy="OVERALL",
                account_ids=account_ids
            )
            
            return {
                "message": f"Snapshot created/updated for {target_date} (OVERALL view)",
                "date": target_date.isoformat(),
                "strategy": "OVERALL",
                "snapshot": snapshot.to_dict()
            }
        elif trading_strategy in ["SWING", "LONG_TERM"]:
            if not account_ids:
                raise HTTPException(
                    status_code=400, 
                    detail=f"account_ids required for {trading_strategy} strategy"
                )
            
            # Create a single snapshot that aggregates all accounts in the strategy
            # This creates one snapshot for the entire strategy view
            snapshot = create_snapshot(
                db=db,
                snapshot_date=target_date,
                trading_strategy=trading_strategy,
                account_ids=account_ids  # Pass all account IDs to aggregate them
            )
            
            return {
                "message": f"Snapshot created/updated for {target_date} ({trading_strategy} view)",
                "date": target_date.isoformat(),
                "strategy": trading_strategy,
                "snapshot": snapshot.to_dict()
            }
        else:
            raise HTTPException(status_code=400, detail="Invalid trading_strategy. Must be SWING, LONG_TERM, or OVERALL")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating manual snapshot: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create snapshot: {str(e)}")

