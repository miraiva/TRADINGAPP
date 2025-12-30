"""
Reference Data Service - Manages stock reference data caching
"""

import logging
from typing import Dict, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.stock_reference import StockReference
from app.services import market_data_service

logger = logging.getLogger(__name__)


def get_or_create_stock_reference(
    db: Session,
    symbol: str,
    exchange: str = "NSE",
    force_refresh: bool = False,
    access_token: Optional[str] = None
) -> Optional[StockReference]:
    """
    Get stock reference from database, or fetch and cache if not exists.
    By default, only uses database - no API calls unless force_refresh=True.
    """
    symbol = symbol.upper()
    
    # Check if exists in database
    stock_ref = db.query(StockReference).filter(
        StockReference.symbol == symbol,
        StockReference.exchange == exchange
    ).first()
    
    # If exists and not forcing refresh, return it (preferred - fast, no API call)
    # This ensures UI always gets data from DB, not from Zerodha API
    if stock_ref and not force_refresh:
        return stock_ref
    
    # Only fetch from API if we don't have it, or if force_refresh is True
    # If we have it but force_refresh is False, we already returned above
    if not stock_ref or force_refresh:
        # Fetch from market data API
        try:
            # Use Zerodha by default if access_token is available
            data_source = "ZERODHA" if access_token else "RAPIDAPI"
            static_data = market_data_service.get_static_data(symbol, exchange, data_source, access_token)
            
            if static_data.get("success") and static_data.get("data"):
                data = static_data["data"]
                
                if stock_ref:
                    # Update existing
                    stock_ref.company_name = data.get("name")
                    stock_ref.industry = data.get("industry")
                    stock_ref.sector = data.get("sector")
                    stock_ref.market_cap = data.get("market_cap")
                    from datetime import datetime
                    stock_ref.last_synced_at = datetime.utcnow()
                else:
                    # Create new
                    stock_ref = StockReference(
                        symbol=symbol,
                        exchange=exchange,
                        company_name=data.get("name"),
                        industry=data.get("industry"),
                        sector=data.get("sector"),
                        market_cap=data.get("market_cap")
                    )
                    db.add(stock_ref)
                
                db.commit()
                db.refresh(stock_ref)
                logger.info(f"Cached reference data for {symbol}")
                return stock_ref
            else:
                logger.warn(f"Failed to fetch reference data for {symbol}")
                # If API failed but we don't have an entry, create a basic one with just the symbol
                if not stock_ref:
                    stock_ref = StockReference(
                        symbol=symbol,
                        exchange=exchange,
                        company_name=symbol  # Use symbol as placeholder name
                    )
                    db.add(stock_ref)
                    try:
                        db.commit()
                        db.refresh(stock_ref)
                        logger.info(f"Created basic reference entry for {symbol}")
                    except Exception as commit_err:
                        logger.error(f"Error committing basic reference for {symbol}: {commit_err}")
                        db.rollback()
                        return None
                return stock_ref
        except Exception as e:
            logger.error(f"Error fetching reference data for {symbol}: {e}")
            db.rollback()
            # If API failed but we don't have an entry, create a basic one with just the symbol
            if not stock_ref:
                try:
                    stock_ref = StockReference(
                        symbol=symbol,
                        exchange=exchange,
                        company_name=symbol  # Use symbol as placeholder name
                    )
                    db.add(stock_ref)
                    db.commit()
                    db.refresh(stock_ref)
                    logger.info(f"Created basic reference entry for {symbol} after API error")
                except Exception as create_err:
                    logger.error(f"Error creating basic reference for {symbol}: {create_err}")
                    db.rollback()
                    return None
            return stock_ref
    
    return stock_ref


def search_stocks(
    db: Session,
    query: str,
    exchange: str = "NSE",
    limit: int = 50,
    access_token: Optional[str] = None
) -> List[StockReference]:
    """
    Search stocks by symbol or company name
    If exact symbol match not found, try to fetch from API
    """
    query = query.upper().strip()
    if not query:
        return []
    
    # Search in database
    results = db.query(StockReference).filter(
        StockReference.exchange == exchange,
        or_(
            StockReference.symbol.like(f"%{query}%"),
            StockReference.company_name.ilike(f"%{query}%")
        )
    ).limit(limit).all()
    
    # If no results and query looks like a symbol (short, alphanumeric, no spaces)
    # Try to fetch it from API and create entry
    if not results and len(query) <= 20 and query.replace('_', '').replace('-', '').isalnum():
        try:
            # Try to get or create the stock reference
            ref = get_or_create_stock_reference(
                db=db,
                symbol=query,
                exchange=exchange,
                force_refresh=False,
                access_token=access_token
            )
            
            # If we got a reference, add it to results
            if ref:
                results = [ref]
        except Exception as e:
            logger.debug(f"Could not fetch {query} from API: {e}")
            # Continue with empty results
    
    return results


def get_stock_reference(
    db: Session,
    symbol: str,
    exchange: str = "NSE"
) -> Optional[StockReference]:
    """
    Get stock reference from database only (no API call)
    """
    symbol = symbol.upper()
    return db.query(StockReference).filter(
        StockReference.symbol == symbol,
        StockReference.exchange == exchange
    ).first()


def bulk_update_references(
    db: Session,
    symbols: List[str],
    exchange: str = "NSE"
) -> Dict[str, bool]:
    """
    Bulk update reference data for multiple symbols
    Returns dict with symbol -> success status
    """
    results = {}
    
    for symbol in symbols:
        try:
            ref = get_or_create_stock_reference(db, symbol, exchange, force_refresh=False)
            results[symbol] = ref is not None
        except Exception as e:
            logger.error(f"Error updating reference for {symbol}: {e}")
            results[symbol] = False
    
    return results

