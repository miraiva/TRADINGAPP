"""
Zerodha API Endpoints
Handles Zerodha authentication and direct API calls
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from app.services import zerodha_service
from app.db.database import get_db
from app.models.zerodha_api_key import ZerodhaApiKey

router = APIRouter(prefix="/api/zerodha", tags=["zerodha"])


class ExchangeTokenRequest(BaseModel):
    request_token: str


class PlaceOrderRequest(BaseModel):
    access_token: str
    exchange: str
    tradingsymbol: str
    transaction_type: str
    quantity: int
    order_type: str = "MARKET"
    product: str = "CNC"
    price: Optional[float] = None
    validity: str = "DAY"
    variety: str = "regular"


class ApiKeyRequest(BaseModel):
    zerodha_user_id: str
    api_key: str
    api_secret: str

class LoginUrlRequest(BaseModel):
    zerodha_user_id: str


class ExchangeTokenWithUserIdRequest(BaseModel):
    request_token: str
    zerodha_user_id: str


@router.get("/login-url")
async def get_login_url(
    zerodha_user_id: Optional[str] = Query(None, description="Zerodha User ID to get login URL for"),
    db: Session = Depends(get_db)
):
    """Get Zerodha OAuth login URL for a specific user"""
    try:
        login_url = zerodha_service.get_login_url(zerodha_user_id=zerodha_user_id, db=db)
        return {"login_url": login_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login-url")
async def get_login_url_post(request: LoginUrlRequest, db: Session = Depends(get_db)):
    """Get Zerodha OAuth login URL for a specific user (POST method)"""
    try:
        login_url = zerodha_service.get_login_url(zerodha_user_id=request.zerodha_user_id, db=db)
        return {"login_url": login_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/exchange-token")
async def exchange_token(request: ExchangeTokenRequest, db: Session = Depends(get_db)):
    """Exchange request token for access token (legacy - without user_id)"""
    try:
        result = zerodha_service.generate_session(request.request_token, db=db)
        
        # Trigger one-time migration if not done yet
        from app.services.migration_service import is_migration_done, migrate_holdings
        from app.db.database import SessionLocal
        
        if result.get("access_token") and result.get("user_id"):
            # Check if migration needed for this specific account
            user_id = result["user_id"]
            if not is_migration_done(user_id):
                try:
                    db = SessionLocal()
                    migration_result = migrate_holdings(result["access_token"], user_id, db)
                    db.close()
                    # Add migration info to response
                    result["migration"] = migration_result
                except Exception as migration_error:
                    # Don't fail token exchange if migration fails
                    import logging
                    logging.getLogger(__name__).error(f"Migration failed for {user_id}: {migration_error}")
        
        return result
    except ValueError as e:
        # Handle specific error messages with better user guidance
        error_msg = str(e)
        if "not enabled for API access" in error_msg:
            raise HTTPException(
                status_code=403,
                detail={
                    "message": error_msg,
                    "error_type": "API_NOT_ENABLED",
                    "help": "Please enable API access in your Zerodha account settings"
                }
            )
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        error_msg = str(e)
        # Check for Zerodha API errors
        if "not enabled" in error_msg.lower() or "InputException" in error_msg:
            raise HTTPException(
                status_code=403,
                detail={
                    "message": "This Zerodha account is not enabled for API access. Please enable API access in your Zerodha account settings.",
                    "error_type": "API_NOT_ENABLED",
                    "help": "Go to Kite → Settings → API → Enable API access"
                }
            )
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {error_msg}")


@router.post("/exchange-token-with-user")
async def exchange_token_with_user(request: ExchangeTokenWithUserIdRequest, db: Session = Depends(get_db)):
    """Exchange request token for access token with user_id"""
    try:
        result = zerodha_service.generate_session(
            request.request_token, 
            zerodha_user_id=request.zerodha_user_id,
            db=db
        )
        
        # Trigger one-time migration if not done yet
        from app.services.migration_service import is_migration_done, migrate_holdings
        from app.db.database import SessionLocal
        
        if result.get("access_token") and result.get("user_id"):
            # Check if migration needed for this specific account
            user_id = result["user_id"]
            if not is_migration_done(user_id):
                try:
                    migration_db = SessionLocal()
                    migration_result = migrate_holdings(result["access_token"], user_id, migration_db)
                    migration_db.close()
                    # Add migration info to response
                    result["migration"] = migration_result
                except Exception as migration_error:
                    # Don't fail token exchange if migration fails
                    import logging
                    logging.getLogger(__name__).error(f"Migration failed for {user_id}: {migration_error}")
        
        return result
    except ValueError as e:
        # Handle specific error messages with better user guidance
        error_msg = str(e)
        if "not enabled for API access" in error_msg or "API key not found" in error_msg:
            raise HTTPException(
                status_code=403,
                detail={
                    "message": error_msg,
                    "error_type": "API_NOT_ENABLED",
                    "help": "Please configure API key for this user in Settings"
                }
            )
        raise HTTPException(status_code=400, detail=error_msg)
    except Exception as e:
        error_msg = str(e)
        # Check for Zerodha API errors
        if "not enabled" in error_msg.lower() or "InputException" in error_msg:
            raise HTTPException(
                status_code=403,
                detail={
                    "message": "This Zerodha account is not enabled for API access. Please enable API access in your Zerodha account settings.",
                    "error_type": "API_NOT_ENABLED",
                    "help": "Go to Kite → Settings → API → Enable API access"
                }
            )
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {error_msg}")


@router.post("/api-keys")
async def save_api_key(request: ApiKeyRequest, db: Session = Depends(get_db)):
    """Save or update API key for a user in database"""
    try:
        # Check if API key already exists
        existing = db.query(ZerodhaApiKey).filter(
            ZerodhaApiKey.zerodha_user_id == request.zerodha_user_id
        ).first()
        
        if existing:
            # Update existing
            existing.api_key = request.api_key
            existing.api_secret = request.api_secret
            existing.is_active = True
        else:
            # Create new
            api_key_record = ZerodhaApiKey(
                zerodha_user_id=request.zerodha_user_id,
                api_key=request.api_key,
                api_secret=request.api_secret,
                is_active=True
            )
            db.add(api_key_record)
        
        db.commit()
        return {"message": "API key saved successfully", "zerodha_user_id": request.zerodha_user_id}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save API key: {str(e)}")


@router.get("/api-keys")
async def get_all_api_keys(db: Session = Depends(get_db)):
    """Get all API keys (without exposing secrets)"""
    try:
        api_keys = db.query(ZerodhaApiKey).filter(
            ZerodhaApiKey.is_active == True
        ).all()
        
        return {"api_keys": [key.to_dict() for key in api_keys]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get API keys: {str(e)}")


@router.get("/api-keys/{zerodha_user_id}")
async def get_api_key(zerodha_user_id: str, db: Session = Depends(get_db)):
    """Get API key for a user (without exposing secret)"""
    try:
        api_key_record = db.query(ZerodhaApiKey).filter(
            ZerodhaApiKey.zerodha_user_id == zerodha_user_id,
            ZerodhaApiKey.is_active == True
        ).first()
        
        if not api_key_record:
            raise HTTPException(status_code=404, detail="API key not found for this user")
        
        return api_key_record.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get API key: {str(e)}")


@router.post("/place-order")
async def place_order(request: PlaceOrderRequest):
    """Place an order via Zerodha API"""
    try:
        result = zerodha_service.place_order(
            access_token=request.access_token,
            exchange=request.exchange,
            tradingsymbol=request.tradingsymbol,
            transaction_type=request.transaction_type,
            quantity=request.quantity,
            order_type=request.order_type,
            product=request.product,
            price=request.price,
            validity=request.validity,
            variety=request.variety
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Order placement failed: {str(e)}")


@router.get("/order-status")
async def get_order_status(
    access_token: str = Query(...),
    order_id: str = Query(...)
):
    """Get status of an order"""
    try:
        result = zerodha_service.get_order_status(access_token, order_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get order status: {str(e)}")


@router.get("/positions")
async def get_positions(access_token: str = Query(...)):
    """Get current positions from Zerodha"""
    try:
        positions = zerodha_service.get_positions(access_token)
        return {"positions": positions}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get positions: {str(e)}")


@router.get("/holdings")
async def get_holdings(access_token: str = Query(...)):
    """Get current holdings from Zerodha"""
    try:
        holdings = zerodha_service.get_holdings(access_token)
        return {"holdings": holdings}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get holdings: {str(e)}")


@router.get("/quote")
async def get_quote(
    access_token: str = Query(...),
    exchange: str = Query(...),
    symbol: str = Query(...)
):
    """Get quote for a symbol"""
    try:
        quote = zerodha_service.get_quote(access_token, exchange, symbol)
        return {"quote": quote}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get quote: {str(e)}")


@router.get("/margins")
async def get_margins(access_token: str = Query(...)):
    """Get margin details including available funds from Zerodha"""
    try:
        margins = zerodha_service.get_margins(access_token)
        return {"margins": margins}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get margins: {str(e)}")

