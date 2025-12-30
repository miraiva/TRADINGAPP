"""
Market Data Service
Fetches real-time prices, historical data, and static stock information
Supports multiple data sources: RapidAPI (Yahoo Finance), Zerodha
"""

import os
import requests
from typing import Dict, List, Optional
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# RapidAPI Configuration
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY")
RAPIDAPI_HOST = os.getenv("RAPIDAPI_HOST", "yahoo-finance15.p.rapidapi.com")

# Price cache (in-memory, 1 minute TTL)
_price_cache = {}
_cache_timestamps = {}


def _get_cached_price(symbol: str, exchange: str) -> Optional[float]:
    """Get cached price if still valid"""
    cache_key = f"{exchange}:{symbol}"
    if cache_key in _price_cache:
        timestamp = _cache_timestamps.get(cache_key)
        if timestamp and (datetime.now() - timestamp).seconds < 60:
            return _price_cache[cache_key]
    return None

 
def _set_cached_price(symbol: str, exchange: str, price: float):
    """Cache price with timestamp"""
    cache_key = f"{exchange}:{symbol}"
    _price_cache[cache_key] = price
    _cache_timestamps[cache_key] = datetime.now()


def get_real_time_price(symbol: str, exchange: str = "NSE", source: str = "ZERODHA", access_token: Optional[str] = None) -> Dict:
    """Get real-time price for a symbol"""
    try:
        # Check cache first
        cached_price = _get_cached_price(symbol, exchange)
        if cached_price:
            return {
                "success": True,
                "data": {
                    "symbol": symbol,
                    "exchange": exchange,
                    "current_price": cached_price,
                    "cached": True
                }
            }
        
        if source == "ZERODHA":
            if not access_token:
                return {"success": False, "error": "Zerodha access token required"}
            return _get_price_zerodha(symbol, exchange, access_token)
        elif source == "RAPIDAPI":
            return _get_price_rapidapi(symbol, exchange)
        else:
            return {"success": False, "error": f"Unknown data source: {source}"}
    except Exception as e:
        logger.error(f"Error getting price for {symbol}: {e}")
        return {"success": False, "error": str(e)}


def _get_price_rapidapi(symbol: str, exchange: str) -> Dict:
    """Get price from RapidAPI (Yahoo Finance)"""
    if not RAPIDAPI_KEY:
        return {"success": False, "error": "RAPIDAPI_KEY not configured"}
    
    try:
        # Map exchange to Yahoo Finance format
        yahoo_symbol = f"{symbol}.NS" if exchange == "NSE" else f"{symbol}.BO"
        
        url = f"https://{RAPIDAPI_HOST}/api/v1/markets/stock/quotes"
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": RAPIDAPI_HOST
        }
        params = {"ticker": yahoo_symbol}
        
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data and len(data) > 0:
            quote = data[0]
            price = quote.get("regularMarketPrice", 0)
            
            # Cache the price
            _set_cached_price(symbol, exchange, price)
            
            return {
                "success": True,
                "data": {
                    "symbol": symbol,
                    "exchange": exchange,
                    "current_price": price,
                    "cached": False
                }
            }
        else:
            return {"success": False, "error": "No data returned"}
    except Exception as e:
        logger.error(f"RapidAPI error: {e}")
        return {"success": False, "error": str(e)}


def _get_price_zerodha(symbol: str, exchange: str, access_token: str) -> Dict:
    """Get price from Zerodha API - tries both NSE and BSE if needed"""
    try:
        from app.services import zerodha_service
        
        # Try the specified exchange first, then try the alternate exchange
        exchanges_to_try = [exchange]
        if exchange == "NSE":
            exchanges_to_try.append("BSE")
        elif exchange == "BSE":
            exchanges_to_try.append("NSE")
        else:
            # If exchange is something else, try both NSE and BSE
            exchanges_to_try.extend(["NSE", "BSE"])
        
        quote = None
        successful_exchange = None
        
        for exch in exchanges_to_try:
            try:
                quote = zerodha_service.get_quote(access_token, exch, symbol)
                if quote and quote.get("last_price"):
                    successful_exchange = exch
                    break
            except Exception as e:
                logger.debug(f"Failed to get quote for {symbol} from {exch}: {e}")
                continue
        
        if quote:
            # Extract last traded price
            # Zerodha quote structure: {'last_price': 123.45, 'ohlc': {'open': ..., 'high': ..., 'low': ..., 'close': ...}, ...}
            last_price = quote.get("last_price") or quote.get("ohlc", {}).get("close")
            ohlc = quote.get("ohlc", {})
            previous_close = ohlc.get("close")
            
            # Log quote structure for debugging
            logger.debug(f"Quote for {symbol} on {successful_exchange or exchange}: last_price={last_price}, ohlc={ohlc}, previous_close={previous_close}")
            
            # Calculate day change from OHLC data (previous day's close)
            # Try to get from API first, if not available, calculate from OHLC
            net_change = quote.get("net_change")
            net_change_percentage = quote.get("net_change_percentage")
            
            # Also check for other possible field names
            if net_change is None:
                net_change = quote.get("change")  # Sometimes it's just "change"
            
            # If not available from API, calculate from previous close
            if net_change is None and last_price and previous_close and previous_close > 0:
                net_change = last_price - previous_close
                net_change_percentage = ((last_price - previous_close) / previous_close) * 100
                logger.debug(f"Calculated day change for {symbol}: net_change={net_change}, net_change_percentage={net_change_percentage}")
            elif net_change is None:
                logger.warning(f"Could not calculate day change for {symbol}: last_price={last_price}, previous_close={previous_close}")
            
            if last_price and last_price > 0:
                # Cache the price with the successful exchange
                _set_cached_price(symbol, successful_exchange or exchange, last_price)
                
                return {
                    "success": True,
                    "data": {
                        "symbol": symbol,
                        "exchange": successful_exchange or exchange,
                        "current_price": last_price,
                        "day_change": net_change,  # From Zerodha API
                        "day_change_percentage": net_change_percentage,  # From Zerodha API
                        "cached": False
                    }
                }
            else:
                return {"success": False, "error": f"No valid price found for {symbol}"}
        else:
            return {"success": False, "error": f"No quote data returned for {symbol} from any exchange"}
    except Exception as e:
        logger.error(f"Zerodha price error for {symbol}: {e}")
        return {"success": False, "error": str(e)}


def get_batch_prices(symbols: List[str], exchange: str = "NSE", source: str = "ZERODHA", access_token: Optional[str] = None) -> Dict:
    """Get prices for multiple symbols efficiently
    Tries the specified exchange first, then tries the other exchange (NSE/BSE) if it fails
    """
    results = {}
    failed_symbols = []
    
    # Determine alternate exchange
    alternate_exchange = "BSE" if exchange == "NSE" else "NSE"
    
    for symbol in symbols:
        # Try primary exchange first
        result = get_real_time_price(symbol, exchange, source, access_token)
        if result.get("success"):
            results[symbol] = result["data"]
        else:
            # Try alternate exchange
            logger.debug(f"Failed to fetch {symbol} from {exchange}, trying {alternate_exchange}")
            result_alt = get_real_time_price(symbol, alternate_exchange, source, access_token)
            if result_alt.get("success"):
                results[symbol] = result_alt["data"]
                logger.info(f"Found {symbol} on {alternate_exchange} instead of {exchange}")
            else:
                failed_symbols.append(f"{symbol}: {result.get('error', 'Unknown error')}")
                logger.warning(f"Failed to fetch price for {symbol} from both {exchange} and {alternate_exchange}")
    
    if failed_symbols:
        logger.warning(f"Failed to fetch prices for {len(failed_symbols)} symbols: {', '.join(failed_symbols[:5])}")
    
    return {"success": True, "data": results}


def get_historical_candles(
    symbol: str,
    exchange: str = "NSE",
    interval: str = "1d",
    period: str = "1mo",
    source: str = "ZERODHA",
    access_token: Optional[str] = None
) -> Dict:
    """Get historical candle data"""
    if source == "ZERODHA":
        if not access_token:
            return {"success": False, "error": "Zerodha access token required"}
        # TODO: Implement Zerodha historical candles
        return {"success": False, "error": "Zerodha historical candles not yet implemented"}
    elif source == "RAPIDAPI":
        return _get_candles_rapidapi(symbol, exchange, interval, period)
    else:
        return {"success": False, "error": f"Unknown data source: {source}"}


def _get_candles_rapidapi(symbol: str, exchange: str, interval: str, period: str) -> Dict:
    """Get candles from RapidAPI"""
    if not RAPIDAPI_KEY:
        return {"success": False, "error": "RAPIDAPI_KEY not configured"}
    
    try:
        yahoo_symbol = f"{symbol}.NS" if exchange == "NSE" else f"{symbol}.BO"
        
        url = f"https://{RAPIDAPI_HOST}/api/v1/markets/stock/history"
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": RAPIDAPI_HOST
        }
        params = {
            "ticker": yahoo_symbol,
            "interval": interval,
            "range": period
        }
        
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"RapidAPI candles error: {e}")
        return {"success": False, "error": str(e)}


def get_static_data(symbol: str, exchange: str = "NSE", source: str = "ZERODHA", access_token: Optional[str] = None) -> Dict:
    """Get static data (company name, industry, etc.)"""
    if source == "ZERODHA":
        if not access_token:
            return {"success": False, "error": "Zerodha access token required"}
        return _get_static_data_zerodha(symbol, exchange, access_token)
    elif source == "RAPIDAPI":
        return _get_static_data_rapidapi(symbol, exchange)
    else:
        return {"success": False, "error": f"Unknown data source: {source}"}


def _get_static_data_zerodha(symbol: str, exchange: str, access_token: str) -> Dict:
    """Get static data from Zerodha API"""
    try:
        from app.services import zerodha_service
        
        # Get company name from instruments API (more reliable)
        company_name = zerodha_service.get_company_name(access_token, exchange, symbol)
        
        # If we got company name, return it
        if company_name:
            return {
                "success": True,
                "data": {
                    "symbol": symbol,
                    "name": company_name,
                    "industry": None,  # Zerodha doesn't provide industry in instruments
                    "sector": None,    # Zerodha doesn't provide sector in instruments
                    "exchange": exchange
                }
            }
        
        # Fallback: try quote API
        quote = zerodha_service.get_quote(access_token, exchange, symbol)
        if quote:
            # Use quote name if available, otherwise fall back to symbol
            name = quote.get("name") or symbol
            return {
                "success": True,
                "data": {
                    "symbol": symbol,
                    "name": name if name != symbol else symbol,  # Only use if different from symbol
                    "industry": None,
                    "sector": None,
                    "exchange": exchange
                }
            }
        
        return {"success": False, "error": "No data returned from Zerodha"}
    except Exception as e:
        logger.error(f"Zerodha static data error: {e}")
        return {"success": False, "error": str(e)}


def _get_static_data_rapidapi(symbol: str, exchange: str) -> Dict:
    """Get static data from RapidAPI"""
    if not RAPIDAPI_KEY:
        return {"success": False, "error": "RAPIDAPI_KEY not configured"}
    
    try:
        yahoo_symbol = f"{symbol}.NS" if exchange == "NSE" else f"{symbol}.BO"
        
        url = f"https://{RAPIDAPI_HOST}/api/v1/markets/stock/quotes"
        headers = {
            "X-RapidAPI-Key": RAPIDAPI_KEY,
            "X-RapidAPI-Host": RAPIDAPI_HOST
        }
        params = {"ticker": yahoo_symbol}
        
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data and len(data) > 0:
            quote = data[0]
            return {
                "success": True,
                "data": {
                    "symbol": symbol,
                    "name": quote.get("longName", quote.get("shortName", "")),
                    "industry": quote.get("sector", ""),
                    "exchange": exchange
                }
            }
        else:
            return {"success": False, "error": "No data returned"}
    except Exception as e:
        logger.error(f"RapidAPI static data error: {e}")
        return {"success": False, "error": str(e)}


def get_stocks_list(exchange: str = "NSE", source: str = "ZERODHA") -> Dict:
    """Get list of available stocks"""
    # For now, return a curated list of popular NSE stocks
    # In production, this could fetch from an API
    popular_stocks = [
        {"symbol": "RELIANCE", "name": "Reliance Industries Ltd", "industry": "Oil & Gas"},
        {"symbol": "TCS", "name": "Tata Consultancy Services", "industry": "IT Services"},
        {"symbol": "HDFCBANK", "name": "HDFC Bank Ltd", "industry": "Banking"},
        {"symbol": "INFY", "name": "Infosys Ltd", "industry": "IT Services"},
        {"symbol": "HINDUNILVR", "name": "Hindustan Unilever Ltd", "industry": "FMCG"},
        {"symbol": "ICICIBANK", "name": "ICICI Bank Ltd", "industry": "Banking"},
        {"symbol": "SBIN", "name": "State Bank of India", "industry": "Banking"},
        {"symbol": "BHARTIARTL", "name": "Bharti Airtel Ltd", "industry": "Telecom"},
        {"symbol": "ITC", "name": "ITC Ltd", "industry": "FMCG"},
        {"symbol": "KOTAKBANK", "name": "Kotak Mahindra Bank", "industry": "Banking"},
    ]
    
    return {
        "success": True,
        "data": {
            "exchange": exchange,
            "stocks": popular_stocks
        }
    }

