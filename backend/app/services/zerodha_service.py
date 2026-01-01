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

# Get Zerodha credentials from environment variables only (R-SM-2, R-SM-3)
# Secrets must be injected at runtime via environment variables
# Never stored in database or committed to version control
# These can be updated at runtime via API (which updates .env file and reloads these values)
def _get_env_var(key: str, default: str = None) -> Optional[str]:
    """Helper to get environment variable (allows runtime updates)"""
    return os.getenv(key, default)

ZERODHA_API_KEY = _get_env_var("ZERODHA_API_KEY")
ZERODHA_API_SECRET = _get_env_var("ZERODHA_API_SECRET")
ZERODHA_REDIRECT_URL = _get_env_var("ZERODHA_REDIRECT_URL", "http://localhost:5173/auth/zerodha/callback")

# Cache for instruments list (to avoid downloading every time)
_instruments_cache = {}
_instruments_cache_timestamp = {}
_instruments_cache_ttl = timedelta(hours=24)  # Cache for 24 hours


def get_api_key_for_user(zerodha_user_id: Optional[str] = None, db: Optional[Session] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Get API key and secret from environment variables only.
    
    Per R-SM-2 and R-SM-3: Secrets are injected at runtime via environment variables,
    never stored in database.
    
    Args:
        zerodha_user_id: User ID (kept for API compatibility, not used for lookup)
        db: Database session (kept for API compatibility, not used for lookup)
    
    Returns:
        Tuple of (api_key, api_secret) from environment variables (reads fresh from env)
    """
    # R-SM-2, R-SM-3: Always use environment variables, never database
    # Read fresh from environment to allow runtime updates
    return (_get_env_var("ZERODHA_API_KEY"), _get_env_var("ZERODHA_API_SECRET"))


def get_kite_instance(access_token: str, api_key: Optional[str] = None, zerodha_user_id: Optional[str] = None, db: Optional[Session] = None) -> KiteConnect:
    """
    Get a KiteConnect instance with access token.
    
    Per R-SM-2: API key comes from environment variables only.
    """
    # R-SM-2: Use provided api_key or fallback to environment variable (read fresh)
    api_key_to_use = api_key or _get_env_var("ZERODHA_API_KEY")
    if not api_key_to_use:
        raise ValueError("ZERODHA_API_KEY environment variable not configured")
    
    kite = KiteConnect(api_key=api_key_to_use)
    kite.set_access_token(access_token)
    return kite


def get_login_url(zerodha_user_id: Optional[str] = None, db: Optional[Session] = None) -> str:
    """
    Get Zerodha OAuth login URL.
    
    Per R-SM-2: API key comes from environment variables only.
    Args zerodha_user_id and db are kept for API compatibility but not used.
    """
    api_key, _ = get_api_key_for_user(zerodha_user_id, db)
    
    if not api_key:
        raise ValueError(
            "ZERODHA_API_KEY environment variable not configured. "
            "Please set ZERODHA_API_KEY in your environment or configure via Settings UI."
        )
    
    kite = KiteConnect(api_key=api_key)
    login_url = kite.login_url()
    return login_url


def generate_session(
    request_token: str, 
    zerodha_user_id: Optional[str] = None,
    db: Optional[Session] = None
) -> Dict:
    """
    Exchange request token for access token.
    
    Per R-SM-2: API key and secret come from environment variables only.
    Args zerodha_user_id and db are kept for API compatibility but not used.
    """
    api_key, api_secret = get_api_key_for_user(zerodha_user_id, db)
    
    if not api_key or not api_secret:
        raise ValueError(
            "ZERODHA_API_KEY and ZERODHA_API_SECRET environment variables not configured. "
            "Please set these in your environment or configure via Settings UI."
        )
    
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
    validity: str = "DAY",
    variety: str = "regular",
    api_key: Optional[str] = None,
    zerodha_user_id: Optional[str] = None,
    db: Optional[Session] = None
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
        price: Price for LIMIT orders (required when order_type is LIMIT)
        validity: DAY, IOC, TTL
        variety: Order variety (default: "regular")
        api_key: Optional API key (for user-specific keys)
        zerodha_user_id: Optional user ID (for user-specific keys)
        db: Optional database session (for user-specific keys)
    
    Returns:
        Order response with order_id
        
    Raises:
        ValueError: If price is missing for LIMIT orders
    """
    try:
        kite = get_kite_instance(access_token, api_key=api_key, zerodha_user_id=zerodha_user_id, db=db)
        
        logger.info(f"Placing {transaction_type} order: {tradingsymbol} on {exchange}, qty={quantity}, type={order_type}, product={product}, variety={variety}")
        
        # Validate price for LIMIT orders
        if order_type == "LIMIT" and price is None:
            raise ValueError("price is required when order_type is LIMIT")
        
        # Build order parameters
        order_params = {
            "variety": variety,  # REQUIRED parameter
            "exchange": exchange,
            "tradingsymbol": tradingsymbol,
            "transaction_type": transaction_type,
            "quantity": quantity,
            "order_type": order_type,
            "product": product,
            "validity": validity,
        }
        
        # Add price only for LIMIT orders
        if order_type == "LIMIT" and price is not None:
            order_params["price"] = price
        
        order_id = kite.place_order(**order_params)
        
        logger.info(f"Order placed successfully: order_id={order_id}, symbol={tradingsymbol}, type={order_type}")
        
        return {
            "order_id": str(order_id),
            "status": "success"
        }
    except Exception as e:
        logger.error(f"Error placing order for {tradingsymbol}: {e}", exc_info=True)
        raise


def get_order_status(access_token: str, order_id: str, api_key: Optional[str] = None, zerodha_user_id: Optional[str] = None, db: Optional[Session] = None) -> Dict:
    """Get status of an order"""
    try:
        kite = get_kite_instance(access_token, api_key=api_key, zerodha_user_id=zerodha_user_id, db=db)
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


