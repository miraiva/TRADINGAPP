"""
Sync Service
Synchronizes trades with Zerodha positions and holdings
"""

from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from app.models.trade import Trade, TradeStatus
from app.models.snapshot_symbol_price import SnapshotSymbolPrice
from app.services import zerodha_service
import logging

logger = logging.getLogger(__name__)

# Store last Zerodha API responses for debugging
_last_sync_data = {
    "positions": None,
    "holdings": None,
    "quotes": None,
    "timestamp": None
}


def _get_snapshot_ltp(db: Session, symbol: str) -> Optional[float]:
    """Get LTP from snapshot table for a symbol. Returns None if not found."""
    try:
        symbol_price = db.query(SnapshotSymbolPrice).filter(
            SnapshotSymbolPrice.symbol == symbol.upper()
        ).first()
        if symbol_price and symbol_price.ltp and symbol_price.ltp > 0:
            return symbol_price.ltp
        return None
    except Exception as e:
        logger.debug(f"Error getting snapshot LTP for {symbol}: {e}")
        return None


def _calculate_day_change_from_quote(quote: Dict, db: Optional[Session] = None, symbol: Optional[str] = None) -> Tuple[Optional[float], Optional[float]]:
    """
    Calculate day change from quote data. Returns (net_change, net_change_percentage)
    ALWAYS uses snapshot LTP for calculation, ignoring Zerodha's day change values.
    
    Args:
        quote: Zerodha quote dictionary (only used for last_price)
        db: Database session (required for snapshot LTP)
        symbol: Symbol name (required for snapshot LTP)
    """
    if not quote:
        logger.warning("Quote is empty or None")
        return None, None
    
    # Get current price from Zerodha quote
    last_price = quote.get("last_price")
    if not last_price or last_price <= 0:
        logger.warning(f"No valid last_price in quote for {symbol}")
        return None, None
    
    # Always use snapshot LTP for day change calculation (ignore Zerodha's net_change values)
    if not db or not symbol:
        logger.warning(f"Cannot calculate day change: db={db is not None}, symbol={symbol}")
        return None, None
    
    snapshot_ltp = _get_snapshot_ltp(db, symbol)
    
    if snapshot_ltp and snapshot_ltp > 0:
        # Calculate day change using snapshot LTP as baseline
        net_change = last_price - snapshot_ltp
        net_change_percentage = ((last_price - snapshot_ltp) / snapshot_ltp) * 100
        logger.debug(f"Calculated day change for {symbol} using snapshot: current={last_price:.2f}, snapshot={snapshot_ltp:.2f}, change={net_change:.2f} ({net_change_percentage:.2f}%)")
        return net_change, net_change_percentage
    else:
        logger.warning(f"No snapshot LTP found for {symbol} - cannot calculate day change")
        return None, None


def sync_positions(access_token: str, db: Session) -> Dict:
    """
    Sync positions from Zerodha with local trades
    Updates ALL open trades with LTP, day change, and day change % based on their symbols
    """
    try:
        # Get all open trades from database
        open_trades = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
        
        if not open_trades:
            logger.info("No open trades to sync")
            return {
                "success": True,
                "updated": 0,
                "message": "No open trades to sync"
            }
        
        # Get unique symbols from open trades
        symbols = list(set([trade.symbol for trade in open_trades]))
        logger.info(f"Syncing {len(open_trades)} open trades for {len(symbols)} unique symbols")
        
        # Batch fetch quotes for all symbols
        quotes = {}
        try:
            logger.info(f"Batch fetching quotes for {len(symbols)} symbols from NSE")
            quotes = zerodha_service.get_batch_quotes(access_token, symbols, "NSE")
            
            # Find symbols that weren't found in NSE
            missing_symbols = [s for s in symbols if s not in quotes or not quotes[s].get("last_price")]
            
            # Try BSE for missing symbols
            if missing_symbols:
                logger.info(f"Fetching {len(missing_symbols)} missing symbols from BSE")
                quotes_bse = zerodha_service.get_batch_quotes(access_token, missing_symbols, "BSE")
                quotes.update(quotes_bse)
            
            # Store quotes for debugging
            global _last_sync_data
            _last_sync_data["quotes"] = quotes
            _last_sync_data["timestamp"] = datetime.utcnow().isoformat()
        except Exception as e:
            logger.error(f"Failed to batch fetch quotes: {e}", exc_info=True)
            raise
        
        # Update all open trades with quote data
        updated_count = 0
        for trade in open_trades:
            symbol = trade.symbol
            if symbol in quotes and quotes[symbol]:
                quote = quotes[symbol]
                
                # Get LTP from quote
                ltp = quote.get("last_price")
                if ltp and ltp > 0:
                    trade.current_price = ltp
                
                # Calculate day change (with snapshot backup)
                net_change, net_change_percentage = _calculate_day_change_from_quote(quote, db, symbol)
                trade.day_change = net_change
                trade.day_change_percentage = net_change_percentage
                trade.last_synced_at = datetime.now(timezone.utc)
                
                updated_count += 1
                
                # Log the result for debugging
                if net_change is not None:
                    logger.debug(f"Updated {symbol} (trade {trade.id}): LTP={ltp}, day_change={net_change} ({net_change_percentage}%)")
                else:
                    logger.warning(f"Day change is None for {symbol} (trade {trade.id}). Quote keys: {list(quote.keys())}, last_price: {quote.get('last_price')}, ohlc: {quote.get('ohlc')}")
            else:
                logger.warning(f"Could not get quote for {symbol} (trade {trade.id}) from any exchange")
        
        db.commit()
        
        logger.info(f"Successfully updated {updated_count} trades")
        return {
            "success": True,
            "updated": updated_count,
            "message": f"Synced {updated_count} open trades"
        }
    except Exception as e:
        logger.error(f"Error syncing positions: {e}")
        db.rollback()
        raise


def sync_holdings(access_token: str, db: Session) -> Dict:
    """
    Sync holdings from Zerodha with local trades
    Updates ALL open trades with LTP, day change, and day change % based on their symbols
    """
    try:
        # Get all open trades from database
        open_trades = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
        
        if not open_trades:
            logger.info("No open trades to sync")
            return {
                "success": True,
                "updated": 0,
                "message": "No open trades to sync"
            }
        
        # Get unique symbols from open trades
        symbols = list(set([trade.symbol for trade in open_trades]))
        logger.info(f"Syncing {len(open_trades)} open trades for {len(symbols)} unique symbols")
        
        # Batch fetch quotes for all symbols
        quotes = {}
        try:
            logger.info(f"Batch fetching quotes for {len(symbols)} symbols from NSE")
            quotes = zerodha_service.get_batch_quotes(access_token, symbols, "NSE")
            
            # Find symbols that weren't found in NSE
            missing_symbols = [s for s in symbols if s not in quotes or not quotes[s].get("last_price")]
            
            # Try BSE for missing symbols
            if missing_symbols:
                logger.info(f"Fetching {len(missing_symbols)} missing symbols from BSE")
                quotes_bse = zerodha_service.get_batch_quotes(access_token, missing_symbols, "BSE")
                quotes.update(quotes_bse)
            
            # Store quotes for debugging
            global _last_sync_data
            _last_sync_data["quotes"] = quotes
            _last_sync_data["timestamp"] = datetime.utcnow().isoformat()
        except Exception as e:
            logger.error(f"Failed to batch fetch quotes: {e}", exc_info=True)
            raise
        
        # Update all open trades with quote data
        updated_count = 0
        for trade in open_trades:
            symbol = trade.symbol
            if symbol in quotes and quotes[symbol]:
                quote = quotes[symbol]
                
                # Get LTP from quote
                ltp = quote.get("last_price")
                if ltp and ltp > 0:
                    trade.current_price = ltp
                
                # Calculate day change (with snapshot backup)
                net_change, net_change_percentage = _calculate_day_change_from_quote(quote, db, symbol)
                trade.day_change = net_change
                trade.day_change_percentage = net_change_percentage
                trade.last_synced_at = datetime.now(timezone.utc)
                
                updated_count += 1
                
                # Log the result for debugging
                if net_change is not None:
                    logger.debug(f"Updated {symbol} (trade {trade.id}): LTP={ltp}, day_change={net_change} ({net_change_percentage}%)")
                else:
                    logger.warning(f"Day change is None for {symbol} (trade {trade.id}). Quote keys: {list(quote.keys())}, last_price: {quote.get('last_price')}, ohlc: {quote.get('ohlc')}")
            else:
                logger.warning(f"Could not get quote for {symbol} (trade {trade.id}) from any exchange")
        
        db.commit()
        
        logger.info(f"Successfully updated {updated_count} trades")
        return {
            "success": True,
            "updated": updated_count,
            "message": f"Synced {updated_count} open trades"
        }
    except Exception as e:
        logger.error(f"Error syncing holdings: {e}")
        db.rollback()
        raise


def sync_all(access_token: str, db: Session) -> Dict:
    """Sync both positions and holdings"""
    try:
        # Fetch positions and holdings from Zerodha for debugging
        global _last_sync_data
        try:
            positions_raw = zerodha_service.get_positions(access_token)
            holdings_raw = zerodha_service.get_holdings(access_token)
            _last_sync_data["positions"] = positions_raw
            _last_sync_data["holdings"] = holdings_raw
        except Exception as e:
            logger.warning(f"Failed to fetch positions/holdings for debugging: {e}")
        
        positions_result = sync_positions(access_token, db)
        holdings_result = sync_holdings(access_token, db)
        
        total_updated = positions_result.get("updated", 0) + holdings_result.get("updated", 0)
        
        return {
            "success": True,
            "updated": total_updated,
            "message": f"Synced {total_updated} trades total",
            "positions": positions_result,
            "holdings": holdings_result
        }
    except Exception as e:
        logger.error(f"Error syncing all: {e}")
        raise


def get_last_sync_data() -> Dict:
    """Get the last Zerodha API responses for debugging"""
    global _last_sync_data
    return _last_sync_data.copy()



