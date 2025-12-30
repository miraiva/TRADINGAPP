"""
Service to populate reference data with popular stocks
This runs on app startup to ensure we have cached data
"""

import logging
from sqlalchemy.orm import Session
from app.models.stock_reference import StockReference
from app.services import reference_data_service

logger = logging.getLogger(__name__)

# Popular NSE stocks to pre-populate
POPULAR_STOCKS = [
    "RELIANCE", "TCS", "HDFCBANK", "INFY", "HINDUNILVR", "ICICIBANK", "SBIN",
    "BHARTIARTL", "ITC", "KOTAKBANK", "LT", "AXISBANK", "ASIANPAINT", "MARUTI",
    "ULTRACEMCO", "TITAN", "NESTLEIND", "BAJFINANCE", "SUNPHARMA", "WIPRO",
    "ONGC", "POWERGRID", "NTPC", "COALINDIA", "TECHM", "HCLTECH", "TATAMOTORS",
    "JSWSTEEL", "ADANIENT", "TATASTEEL", "DIVISLAB", "BAJAJFINSV", "HDFCLIFE",
    "DRREDDY", "CIPLA", "GRASIM", "M&M", "BRITANNIA", "INDUSINDBK", "APOLLOHOSP",
    "EICHERMOT", "BAJAJ-AUTO", "HEROMOTOCO", "DABUR", "MARICO", "GODREJCP",
    "PIDILITIND", "BERGEPAINT", "HAVELLS", "VOLTAS", "WHIRLPOOL", "CROMPTON",
    "ORIENTELEC", "VGUARD", "POLICYBZR", "ZOMATO", "PAYTM", "NYKAA", "DELHIVERY"
]


# Basic company names mapping (fallback when API fails)
COMPANY_NAMES = {
    "RELIANCE": "Reliance Industries Ltd",
    "TCS": "Tata Consultancy Services",
    "HDFCBANK": "HDFC Bank Ltd",
    "INFY": "Infosys Ltd",
    "HINDUNILVR": "Hindustan Unilever Ltd",
    "ICICIBANK": "ICICI Bank Ltd",
    "SBIN": "State Bank of India",
    "BHARTIARTL": "Bharti Airtel Ltd",
    "ITC": "ITC Ltd",
    "KOTAKBANK": "Kotak Mahindra Bank",
    "LT": "Larsen & Toubro",
    "AXISBANK": "Axis Bank Ltd",
    "ASIANPAINT": "Asian Paints Ltd",
    "MARUTI": "Maruti Suzuki India Ltd",
    "ULTRACEMCO": "UltraTech Cement Ltd",
    "TITAN": "Titan Company Ltd",
    "NESTLEIND": "Nestle India Ltd",
    "BAJFINANCE": "Bajaj Finance Ltd",
    "SUNPHARMA": "Sun Pharmaceutical Industries",
    "WIPRO": "Wipro Ltd",
    "ONGC": "Oil and Natural Gas Corporation",
    "POWERGRID": "Power Grid Corporation of India",
    "NTPC": "NTPC Ltd",
    "COALINDIA": "Coal India Ltd",
    "TECHM": "Tech Mahindra Ltd",
    "HCLTECH": "HCL Technologies Ltd",
    "TATAMOTORS": "Tata Motors Ltd",
    "JSWSTEEL": "JSW Steel Ltd",
    "ADANIENT": "Adani Enterprises Ltd",
    "TATASTEEL": "Tata Steel Ltd",
    "DIVISLAB": "Dr. Reddy's Laboratories",
    "BAJAJFINSV": "Bajaj Finserv Ltd",
    "HDFCLIFE": "HDFC Life Insurance Company",
    "DRREDDY": "Dr. Reddy's Laboratories",
    "CIPLA": "Cipla Ltd",
    "GRASIM": "Grasim Industries Ltd",
    "M&M": "Mahindra & Mahindra Ltd",
    "BRITANNIA": "Britannia Industries Ltd",
    "INDUSINDBK": "IndusInd Bank Ltd",
    "APOLLOHOSP": "Apollo Hospitals Enterprise",
    "EICHERMOT": "Eicher Motors Ltd",
    "BAJAJ-AUTO": "Bajaj Auto Ltd",
    "HEROMOTOCO": "Hero MotoCorp Ltd",
    "DABUR": "Dabur India Ltd",
    "MARICO": "Marico Ltd",
    "GODREJCP": "Godrej Consumer Products",
    "PIDILITIND": "Pidilite Industries Ltd",
    "BERGEPAINT": "Berger Paints India Ltd",
    "HAVELLS": "Havells India Ltd",
    "VOLTAS": "Voltas Ltd",
    "WHIRLPOOL": "Whirlpool of India Ltd",
    "CROMPTON": "Crompton Greaves Consumer",
    "ORIENTELEC": "Orient Electric Ltd",
    "VGUARD": "V-Guard Industries Ltd",
    "POLICYBZR": "Policybazaar",
    "ZOMATO": "Zomato Ltd",
    "PAYTM": "One97 Communications (Paytm)",
    "NYKAA": "FSN E-Commerce (Nykaa)",
    "DELHIVERY": "Delhivery Ltd"
}


def populate_popular_stocks(db: Session, force_refresh: bool = False) -> dict:
    """
    Populate reference data table with popular stocks
    Creates basic entries even if API fails (for search functionality)
    Returns dict with success count and errors
    """
    from app.models.stock_reference import StockReference
    
    success_count = 0
    error_count = 0
    errors = []
    
    logger.info(f"Starting to populate {len(POPULAR_STOCKS)} popular stocks...")
    
    for symbol in POPULAR_STOCKS:
        try:
            # Check if already exists
            existing = db.query(StockReference).filter(
                StockReference.symbol == symbol,
                StockReference.exchange == "NSE"
            ).first()
            
            if existing:
                if not force_refresh:
                    success_count += 1
                    continue
                else:
                    # Update existing if force_refresh
                    ref = existing
            else:
                ref = None
            
            # Try to get from API first (only if not existing or force_refresh)
            if not existing or force_refresh:
                try:
                    ref = reference_data_service.get_or_create_stock_reference(
                        db, symbol, "NSE", force_refresh=force_refresh
                    )
                except Exception as api_err:
                    logger.warn(f"API call failed for {symbol}: {api_err}")
                    ref = None
            
            if ref:
                success_count += 1
            elif not existing:
                # Create basic entry with fallback data if API fails and doesn't exist
                company_name = COMPANY_NAMES.get(symbol, symbol)
                try:
                    ref = StockReference(
                        symbol=symbol,
                        exchange="NSE",
                        company_name=company_name,
                        industry=None  # Will be populated later when API is available
                    )
                    db.add(ref)
                    db.commit()
                    db.refresh(ref)
                    success_count += 1
                    logger.info(f"Created basic reference for {symbol} (API unavailable)")
                except Exception as create_err:
                    # Handle case where it was created between check and insert
                    if "UNIQUE constraint" in str(create_err):
                        success_count += 1  # Count as success since it exists
                    else:
                        raise
        except Exception as e:
            error_count += 1
            errors.append(f"{symbol}: {str(e)}")
            logger.error(f"Error populating {symbol}: {e}")
            db.rollback()
    
    db.commit()
    
    logger.info(f"Populated {success_count} stocks, {error_count} errors")
    
    return {
        "success_count": success_count,
        "error_count": error_count,
        "total": len(POPULAR_STOCKS),
        "errors": errors[:10]  # Limit errors in response
    }


def populate_from_trades(db: Session) -> dict:
    """
    Populate reference data for all symbols in existing trades
    """
    from app.models.trade import Trade
    
    trades = db.query(Trade).all()
    symbols = list(set([trade.symbol for trade in trades]))
    
    if not symbols:
        return {"success_count": 0, "error_count": 0, "total": 0}
    
    logger.info(f"Populating reference data for {len(symbols)} symbols from trades...")
    
    success_count = 0
    error_count = 0
    
    for symbol in symbols:
        try:
            ref = reference_data_service.get_or_create_stock_reference(
                db, symbol, "NSE", force_refresh=False
            )
            if ref:
                success_count += 1
        except Exception as e:
            error_count += 1
            logger.error(f"Error populating {symbol}: {e}")
    
    db.commit()
    
    return {
        "success_count": success_count,
        "error_count": error_count,
        "total": len(symbols)
    }

