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
# R-SM-3: ZerodhaApiKey model import removed - secrets no longer stored in database

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


# R-SM-2: Secrets are managed via environment variables (saved to .env file via UI)
class ApiKeyRequest(BaseModel):
    """Request model for saving API keys to .env file (not database)"""
    zerodha_user_id: str  # Kept for API compatibility
    api_key: str
    api_secret: str

class LoginUrlRequest(BaseModel):
    zerodha_user_id: str


class ExchangeTokenWithUserIdRequest(BaseModel):
    request_token: str
    zerodha_user_id: str


@router.get("/login-url")
async def get_login_url(
    zerodha_user_id: Optional[str] = Query(None, description="Zerodha User ID to get login URL for")
):
    """Get Zerodha OAuth login URL for a specific user"""
    try:
        login_url = zerodha_service.get_login_url(zerodha_user_id=zerodha_user_id)
        return {"login_url": login_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login-url")
async def get_login_url_post(request: LoginUrlRequest, db: Session = Depends(get_db)):
    """
    Get Zerodha OAuth login URL.
    
    Per R-SM-2: API key comes from environment variables only.
    The db parameter is kept for API compatibility but not used.
    """
    try:
        # R-SM-2: API key from environment variables, db parameter not used
        login_url = zerodha_service.get_login_url(zerodha_user_id=request.zerodha_user_id, db=None)
        return {"login_url": login_url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/exchange-token")
async def exchange_token(request: ExchangeTokenRequest, db: Session = Depends(get_db)):
    """
    Exchange request token for access token (legacy - without user_id).
    
    Per R-SM-2: API key comes from environment variables only.
    The db parameter is kept for API compatibility but not used.
    """
    try:
        # R-SM-2: API key from environment variables, db parameter not used
        result = zerodha_service.generate_session(request.request_token, zerodha_user_id=None, db=None)
        
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
    """
    Exchange request token for access token with user_id.
    
    Per R-SM-2: API key comes from environment variables only.
    The db parameter is kept for API compatibility but not used.
    """
    try:
        # R-SM-2: API key from environment variables, db parameter not used
        result = zerodha_service.generate_session(
            request.request_token, 
            zerodha_user_id=request.zerodha_user_id,
            db=None
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
    """
    Save API key and secret to .env file (not database).
    
    Per R-SM-2 and R-SM-3: Secrets are stored in environment variables (.env file),
    never in the database.
    
    Note: After saving, the application needs to be restarted for changes to take effect,
    or the .env file will be reloaded on next request.
    """
    import os
    from pathlib import Path
    from dotenv import set_key
    
    try:
        # Get .env file path (same as used in main.py)
        env_path = Path(__file__).resolve().parent.parent.parent / ".env"
        
        # Ensure .env file exists
        env_path.touch(exist_ok=True)
        
        # Update .env file with new values
        set_key(env_path, "ZERODHA_API_KEY", request.api_key)
        set_key(env_path, "ZERODHA_API_SECRET", request.api_secret)
        
        # Reload environment variables in current process
        # Note: This only affects the current process. For persistent changes,
        # the application should be restarted
        from dotenv import load_dotenv
        load_dotenv(env_path, override=True)
        
        # Update the service-level variables
        import app.services.zerodha_service as zerodha_service
        zerodha_service.ZERODHA_API_KEY = request.api_key
        zerodha_service.ZERODHA_API_SECRET = request.api_secret
        
        return {
            "message": "API key saved successfully to .env file",
            "zerodha_user_id": request.zerodha_user_id,
            "note": "Application restart recommended for changes to persist across all processes"
        }
    except Exception as e:
        # Security: Never log API keys or secrets in error messages
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to save API key to .env file: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="Failed to save API key to .env file")


@router.get("/api-keys")
async def get_all_api_keys(db: Session = Depends(get_db)):
    """
    Get API key configuration status (without exposing secrets).
    
    Per R-SM-7: Secrets are never returned in API responses.
    This endpoint confirms if API keys are configured and returns user IDs from account_details.
    """
    import os
    from pathlib import Path
    from dotenv import load_dotenv
    
    # Reload .env file to get latest values
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)
    
    api_key_configured = bool(os.getenv("ZERODHA_API_KEY"))
    api_secret_configured = bool(os.getenv("ZERODHA_API_SECRET"))
    
    # For UI compatibility, return structure that includes user IDs from account_details
    # Since API key is shared (from env var), we return user IDs from frontend's account_details
    # The frontend will populate these from localStorage
    return {
        "api_keys": [{
            "zerodha_user_id": "shared",  # API key is shared, not per-user
            "api_key": "***" if api_key_configured else None,
            "api_secret": "***",  # Never expose secret
            "is_active": api_key_configured and api_secret_configured,
            "configured": api_key_configured and api_secret_configured
        }] if api_key_configured and api_secret_configured else [],
        "configured": api_key_configured and api_secret_configured
    }


@router.get("/api-keys/{zerodha_user_id}")
async def get_api_key(zerodha_user_id: str, db: Session = Depends(get_db)):
    """
    Get API key configuration status for a user (without exposing secrets).
    
    Per R-SM-7: Secrets are never returned in API responses.
    The API key is shared (from environment variables), not per-user.
    """
    import os
    from pathlib import Path
    from dotenv import load_dotenv
    
    # Reload .env file to get latest values
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)
    
    api_key_configured = bool(os.getenv("ZERODHA_API_KEY"))
    api_secret_configured = bool(os.getenv("ZERODHA_API_SECRET"))
    
    if not api_key_configured or not api_secret_configured:
        raise HTTPException(status_code=404, detail="API key not configured. Please set ZERODHA_API_KEY and ZERODHA_API_SECRET in .env file or via Settings UI.")
    
    return {
        "zerodha_user_id": zerodha_user_id,
        "api_key": "***",  # Never expose actual key
        "api_secret": "***",  # Never expose secret
        "is_active": True,
        "configured": True,
        "note": "API key is shared across all accounts (configured via environment variables in .env file)"
    }


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

