"""
Debug API Endpoints
For debugging Zerodha data
"""

from fastapi import APIRouter, HTTPException, Query

from app.services import zerodha_service

router = APIRouter(prefix="/api/debug", tags=["debug"])


@router.get("/positions")
async def get_debug_positions(access_token: str = Query(...)):
    """Get raw positions data from Zerodha for debugging"""
    try:
        positions = zerodha_service.get_positions(access_token)
        return {"positions": positions}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get positions: {str(e)}")


@router.get("/holdings")
async def get_debug_holdings(access_token: str = Query(...)):
    """Get raw holdings data from Zerodha for debugging"""
    try:
        holdings = zerodha_service.get_holdings(access_token)
        return {"holdings": holdings}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get holdings: {str(e)}")


@router.get("/quote")
async def get_debug_quote(
    access_token: str = Query(...),
    exchange: str = Query("NSE"),
    symbol: str = Query(...)
):
    """Get raw quote data from Zerodha for debugging - shows all fields"""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"Debug: Fetching quote for {symbol} on {exchange}")
    
    try:
        quote = zerodha_service.get_quote(access_token, exchange, symbol)
        logger.info(f"Debug: Quote received for {symbol}, keys: {list(quote.keys()) if quote else 'None'}")
        
        # Also try BSE if NSE fails
        if not quote or not quote.get("last_price"):
            logger.info(f"Debug: Quote from {exchange} failed, trying BSE...")
            try:
                quote_bse = zerodha_service.get_quote(access_token, "BSE", symbol)
                if quote_bse and quote_bse.get("last_price"):
                    logger.info(f"Debug: Got quote from BSE for {symbol}")
                    return {
                        "exchange": "BSE",
                        "quote": quote_bse,
                        "quote_keys": list(quote_bse.keys()) if quote_bse else [],
                        "ohlc": quote_bse.get("ohlc", {}) if quote_bse else {}
                    }
            except Exception as e:
                logger.warning(f"Debug: BSE quote also failed: {e}")
        
        ohlc = quote.get("ohlc", {}) if quote else {}
        previous_close = ohlc.get("close") if isinstance(ohlc, dict) else None
        
        logger.info(f"Debug: Quote data - last_price={quote.get('last_price') if quote else None}, "
                   f"net_change={quote.get('net_change') if quote else None}, "
                   f"previous_close={previous_close}, "
                   f"ohlc={ohlc}")
        
        return {
            "exchange": exchange,
            "quote": quote,
            "quote_keys": list(quote.keys()) if quote else [],
            "ohlc": ohlc,
            "last_price": quote.get("last_price") if quote else None,
            "net_change": quote.get("net_change") if quote else None,
            "net_change_percentage": quote.get("net_change_percentage") if quote else None,
            "previous_close": previous_close,
            "calculated_day_change": (quote.get("last_price") - previous_close) if (quote and quote.get("last_price") and previous_close) else None
        }
    except Exception as e:
        logger.error(f"Debug: Error fetching quote: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to get quote: {str(e)}")



