"""
Account Management API Endpoints
Handles account details (user_name, account_type, trading_strategy) storage
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from app.db.database import get_db
from app.models.account_detail import AccountDetail

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class AccountDetailRequest(BaseModel):
    zerodha_user_id: str
    user_name: Optional[str] = None
    account_type: Optional[str] = 'TRADING_ONLY'  # MAIN, TRADING_ONLY
    trading_strategy: Optional[str] = 'SWING'  # SWING, LONG_TERM


class AccountDetailResponse(BaseModel):
    id: int
    zerodha_user_id: str
    user_name: Optional[str]
    account_type: Optional[str]
    trading_strategy: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]

    class Config:
        from_attributes = True


@router.post("/details", response_model=AccountDetailResponse)
async def save_account_detail(request: AccountDetailRequest, db: Session = Depends(get_db)):
    """Save or update account details for a user"""
    try:
        # Check if account detail already exists
        existing = db.query(AccountDetail).filter(
            AccountDetail.zerodha_user_id == request.zerodha_user_id
        ).first()
        
        if existing:
            # Update existing
            if request.user_name is not None:
                existing.user_name = request.user_name
            if request.account_type is not None:
                existing.account_type = request.account_type
            if request.trading_strategy is not None:
                existing.trading_strategy = request.trading_strategy
        else:
            # Create new
            account_detail = AccountDetail(
                zerodha_user_id=request.zerodha_user_id,
                user_name=request.user_name,
                account_type=request.account_type,
                trading_strategy=request.trading_strategy
            )
            db.add(account_detail)
        
        db.commit()
        db.refresh(existing if existing else account_detail)
        return (existing if existing else account_detail).to_dict()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save account details: {str(e)}")


@router.get("/details/{zerodha_user_id}", response_model=AccountDetailResponse)
async def get_account_detail(zerodha_user_id: str, db: Session = Depends(get_db)):
    """Get account details for a specific user"""
    try:
        account_detail = db.query(AccountDetail).filter(
            AccountDetail.zerodha_user_id == zerodha_user_id
        ).first()
        
        if not account_detail:
            raise HTTPException(status_code=404, detail="Account details not found")
        
        return account_detail.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get account details: {str(e)}")


@router.get("/details", response_model=List[AccountDetailResponse])
async def get_all_account_details(db: Session = Depends(get_db)):
    """Get all account details"""
    try:
        account_details = db.query(AccountDetail).all()
        return [detail.to_dict() for detail in account_details]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get account details: {str(e)}")


@router.delete("/details/{zerodha_user_id}")
async def delete_account_detail(zerodha_user_id: str, db: Session = Depends(get_db)):
    """Delete account details for a specific user"""
    try:
        account_detail = db.query(AccountDetail).filter(
            AccountDetail.zerodha_user_id == zerodha_user_id
        ).first()
        
        if not account_detail:
            raise HTTPException(status_code=404, detail="Account details not found")
        
        db.delete(account_detail)
        db.commit()
        return {"message": "Account details deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete account details: {str(e)}")

