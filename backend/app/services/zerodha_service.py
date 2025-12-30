"""
Zerodha Kite API Service
Handles all interactions with Zerodha's Kite Connect API
"""

import os
from kiteconnect import KiteConnect
from typing import Dict, Optional, List, Tuple
import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Get Zerodha credentials from environment (fallback for backward compatibility)
ZERODHA_API_KEY = os.getenv("ZERODHA_API_KEY")
ZERODHA_API_SECRET = os.getenv("ZERODHA_API_SECRET")
ZERODHA_REDIRECT_URL = os.getenv("ZERODHA_REDIRECT_URL", "http://localhost:5173/auth/zerodha/callback")

# Cache for instruments list (to avoid downloading every time)
_instruments_cache = {}
_instruments_cache_timestamp = {}
_instruments_cache_ttl = timedelta(hours=24)  # Cache for 24 hours


def get_api_key_for_user(zerodha_user_id: Optional[str], db: Optional[Session] = None) -> Tuple[Optional[str], Optional[str]]:
    """Get API key and secret for a specific user from database"""
    if not zerodha_user_id or not db:
        # Fallback to environment variables for backward compatibility
        return (ZERODHA_API_KEY, ZERODHA_API_SECRET)
    
    try:
        from app.models.zerodha_api_key import ZerodhaApiKey
        api_key_record = db.query(ZerodhaApiKey).filter(
            ZerodhaApiKey.zerodha_user_id == zerodha_user_id,
            ZerodhaApiKey.is_active == True
        ).first()
        
        if api_key_record:
            return (api_key_record.api_key, api_key_record.api_secret)
        else:
            # Fallback to environment variables if not found in database
            logger.warning(f"API key not found for user {zerodha_user_id}, using environment variable")
            return (ZERODHA_API_KEY, ZERODHA_API_SECRET)
    except Exception as e:
        logger.error(f"Error getting API key for user {zerodha_user_id}: {e}")
        # Fallback to environment variables
        return (ZERODHA_API_KEY, ZERODHA_API_SECRET)


def get_kite_instance(access_token: str, api_key: Optional[str] = None) -> KiteConnect:
    """Get a KiteConnect instance with access token"""
    api_key_to_use = api_key or ZERODHA_API_KEY
    if not api_key_to_use:
        raise ValueError("API key not configured")
    
    kite = KiteConnect(api_key=api_key_to_use)
    kite.set_access_token(access_token)
    return kite


def get_login_url(zerodha_user_id: Optional[str] = None, db: Optional[Session] = None) -> str:
    """Get Zerodha OAuth login URL for a specific user"""
    api_key, _ = get_api_key_for_user(zerodha_user_id, db)
    
    if not api_key:
        if zerodha_user_id:
            raise ValueError(
                f"API key not configured for user {zerodha_user_id}. "
                "Please configure API key in Settings before connecting."
            )
        else:
            raise ValueError("ZERODHA_API_KEY not configured")
    
    kite = KiteConnect(api_key=api_key)
    login_url = kite.login_url()
    return login_url


def generate_session(
    request_token: str, 
    zerodha_user_id: Optional[str] = None,
    db: Optional[Session] = None
) -> Dict:
    """Exchange request token for access token using user-specific API key"""
    api_key, api_secret = get_api_key_for_user(zerodha_user_id, db)
    
    if not api_key or not api_secret:
        if zerodha_user_id:
            raise ValueError(
                f"API key not configured for user {zerodha_user_id}. "
                "Please configure API key and secret in Settings before connecting."
            )
        else:
            raise ValueError("Zerodha credentials not configured")
    
    try:
        kite = KiteConnect(api_key=api_key)
        data = kite.generate_session(request_token, api_secret=api_secret)
        
        return {
            "access_token": data["access_token"],
            "user_id": data.get("user_id", ""),
            "user_name": data.get("user_name", ""),
            "user_email": data.get("user_email", ""),
            "user_shortname": data.get("user_shortname", ""),
            "broker": data.get("broker", ""),
        }
    except Exception as e:
        error_message = str(e)
        # Check for specific Zerodha error messages
        if "not enabled for the app" in error_message.lower() or "InputException" in error_message:
            raise ValueError(
                "This Zerodha account is not enabled for API access. "
                "Please enable API access in your Zerodha account settings:\n"
                "1. Log in to Kite (kite.zerodha.com)\n"
                "2. Go to Settings → API → Enable API access\n"
                "3. Make sure the API key is whitelisted for this account\n"
                "4. Try connecting again"
            )
        raise


def place_order(
    access_token: str,
    exchange: str,
    tradingsymbol: str,
    transaction_type: str,
    quantity: int,
    order_type: str = "MARKET",
    product: str = "CNC",
    price: Optional[float] = None,
    validity: str = "DAY"
) -> Dict:
    """
    Place an order via Zerodha API
    
    Args:
        access_token: Zerodha access token
        exchange: Exchange (NSE, BSE, etc.)
        tradingsymbol: Trading symbol (e.g., "RELIANCE")
        transaction_type: BUY or SELL
        quantity: Quantity
        order_type: MARKET, LIMIT, SL, SL-M
        product: CNC, MIS, NRML
        price: Price for LIMIT orders
        validity: DAY, IOC, TTL
    
    Returns:
        Order response with order_id
    """
    try:
        kite = get_kite_instance(access_token)
        
        order_params = {
            "exchange": exchange,
            "tradingsymbol": tradingsymbol,
            "transaction_type": transaction_type,
            "quantity": quantity,
            "order_type": order_type,
            "product": product,
            "validity": validity,
        }
        
        if price and order_type == "LIMIT":
            order_params["price"] = price
        
        order_id = kite.place_order(**order_params)
        
        logger.info(f"Order placed: {order_id} for {tradingsymbol}")
        
        return {
            "order_id": str(order_id),
            "status": "success"
        }
    except Exception as e:
        logger.error(f"Error placing order: {e}")
        raise


def get_order_status(access_token: str, order_id: str) -> Dict:
    """Get status of an order"""
    try:
        kite = get_kite_instance(access_token)
        orders = kite.orders()
        
        for order in orders:
            if str(order["order_id"]) == str(order_id):
                return order
        
        return {"error": "Order not found"}
    except Exception as e:
        logger.error(f"Error getting order status: {e}")
        raise


def get_positions(access_token: str) -> List[Dict]:
    """Get current positions from Zerodha"""
    try:
        kite = get_kite_instance(access_token)
        positions = kite.positions()
        
        # Return net positions (day + net)
        net_positions = positions.get("net", [])
        return net_positions
    except Exception as e:
        logger.error(f"Error getting positions: {e}")
        raise


def get_holdings(access_token: str) -> List[Dict]:
    """Get current holdings from Zerodha"""
    try:
        kite = get_kite_instance(access_token)
        holdings = kite.holdings()
        return holdings
    except Exception as e:
        logger.error(f"Error getting holdings: {e}")
        raise


def get_quote(access_token: str, exchange: str, tradingsymbol: str) -> Dict:
    """Get quote for a symbol"""
    try:
        kite = get_kite_instance(access_token)
        instrument = f"{exchange}:{tradingsymbol}"
        quote = kite.quote(instrument)
        return quote.get(instrument, {})
    except Exception as e:
        logger.error(f"Error getting quote: {e}")
        raise


def get_batch_quotes(access_token: str, symbols: List[str], exchange: str = "NSE") -> Dict[str, Dict]:
    """Get quotes for multiple symbols in a single API call (much faster)"""
    try:
        kite = get_kite_instance(access_token)
        # Create instrument list: ["NSE:RELIANCE", "NSE:TCS", ...]
        instruments = [f"{exchange}:{symbol}" for symbol in symbols]
        
        # Fetch all quotes in one API call
        quotes = kite.quote(instruments)
        
        # Convert to dict keyed by symbol (without exchange prefix)
        result = {}
        for instrument, quote_data in quotes.items():
            # Extract symbol from "NSE:RELIANCE" -> "RELIANCE"
            symbol = instrument.split(":")[-1] if ":" in instrument else instrument
            result[symbol.upper()] = quote_data
        
        return result
    except Exception as e:
        logger.error(f"Error getting batch quotes: {e}")
        raise


def get_company_name(access_token: str, exchange: str, tradingsymbol: str) -> Optional[str]:
    """Get company name from Zerodha instruments API (with caching)"""
    try:
        kite = get_kite_instance(access_token)
        
        # Check cache first
        cache_key = exchange
        now = datetime.now()
        
        if cache_key in _instruments_cache:
            cache_time = _instruments_cache_timestamp.get(cache_key)
            if cache_time and (now - cache_time) < _instruments_cache_ttl:
                # Use cached instruments
                instruments = _instruments_cache[cache_key]
                logger.debug(f"Using cached instruments for {exchange}")
            else:
                # Cache expired, refresh it
                instruments = None
        else:
            instruments = None
        
        # Download instruments if not cached
        if instruments is None:
            logger.info(f"Downloading instruments list for {exchange} (this may take a moment)...")
            instruments = kite.instruments(exchange)
            # Cache it
            _instruments_cache[cache_key] = instruments
            _instruments_cache_timestamp[cache_key] = now
            logger.info(f"Cached {len(instruments)} instruments for {exchange}")
        
        # Find the matching instrument
        tradingsymbol_upper = tradingsymbol.upper()
        for instrument in instruments:
            if instrument.get("tradingsymbol", "").upper() == tradingsymbol_upper:
                return instrument.get("name")  # This is the full company name
        
        logger.warning(f"Instrument {tradingsymbol} not found in {exchange} instruments list")
        return None
    except Exception as e:
        logger.error(f"Error getting company name for {tradingsymbol}: {e}")
        return None


def get_margins(access_token: str) -> Dict:
    """Get margin details including available funds from Zerodha"""
    try:
        kite = get_kite_instance(access_token)
        margins = kite.margins()
        return margins
    except Exception as e:
        logger.error(f"Error getting margins: {e}")
        raise


