"""
Migration Service
One-time migration of Zerodha holdings to local database
"""

import os
from pathlib import Path
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Dict, List
from app.models.trade import Trade, TradeStatus
from app.services import zerodha_service
import logging

logger = logging.getLogger(__name__)

# Migration flag directory
MIGRATION_FLAG_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "migration_flags"
MIGRATION_FLAG_DIR.mkdir(parents=True, exist_ok=True)


def get_migration_flag_file(user_id: str) -> Path:
    """Get migration flag file path for a specific user_id"""
    return MIGRATION_FLAG_DIR / f".migration_done_{user_id}"


def is_migration_done(user_id: str = None) -> bool:
    """
    Check if migration has been completed for a specific user_id
    If user_id is None, checks if ANY migration has been done (backward compatibility)
    """
    if user_id:
        return get_migration_flag_file(user_id).exists()
    else:
        # Backward compatibility: check for old global flag
        old_flag = Path(__file__).resolve().parent.parent.parent / "data" / ".migration_done"
        if old_flag.exists():
            return True
        # Check if any per-account flags exist
        return any(MIGRATION_FLAG_DIR.glob(".migration_done_*"))


def set_migration_done(user_id: str):
    """Mark migration as completed for a specific user_id"""
    flag_file = get_migration_flag_file(user_id)
    flag_file.parent.mkdir(parents=True, exist_ok=True)
    flag_file.touch()
    logger.info(f"Migration flag set for user_id: {user_id}")


def migrate_holdings(access_token: str, user_id: str, db: Session) -> Dict:
    """
    One-time migration of Zerodha holdings to local database
    Only creates trades that don't already exist
    Uses per-account migration flags
    """
    if is_migration_done(user_id):
        return {
            "success": False,
            "message": f"Migration already completed for account {user_id}. Use sync to update existing trades."
        }
    
    try:
        holdings = zerodha_service.get_holdings(access_token)
        created_count = 0
        updated_count = 0
        
        for holding in holdings:
            quantity = holding.get("quantity", 0)
            if quantity <= 0:
                continue
            
            symbol = holding.get("tradingsymbol", "").upper()
            if not symbol:
                continue
            
            # Check if trade already exists
            existing_trade = db.query(Trade).filter(
                Trade.symbol == symbol,
                Trade.quantity == quantity,
                Trade.status == TradeStatus.OPEN
            ).first()
            
            if existing_trade:
                # Update existing trade
                existing_trade.current_price = holding.get("last_price")
                existing_trade.current_quantity = quantity
                existing_trade.last_synced_at = datetime.utcnow()
                # Update user_id if not set
                if not existing_trade.zerodha_user_id:
                    existing_trade.zerodha_user_id = user_id
                
                # Get day change from Zerodha quote API (not from average_price)
                # Try both NSE and BSE exchanges
                try:
                    from app.services import zerodha_service
                    quote = None
                    # Try the exchange from holding first, then try both NSE and BSE
                    exchanges_to_try = [holding.get("exchange", "NSE"), "NSE", "BSE"]
                    # Remove duplicates while preserving order
                    exchanges_to_try = list(dict.fromkeys(exchanges_to_try))
                    
                    for exchange in exchanges_to_try:
                        try:
                            quote = zerodha_service.get_quote(access_token, exchange, symbol)
                            if quote and quote.get("last_price"):
                                # Calculate day change from OHLC if not available directly
                                last_price = quote.get("last_price")
                                ohlc = quote.get("ohlc", {})
                                previous_close = ohlc.get("close")
                                
                                net_change = quote.get("net_change")
                                net_change_percentage = quote.get("net_change_percentage")
                                
                                # If not available from API, calculate from previous close
                                if net_change is None and last_price and previous_close and previous_close > 0:
                                    net_change = last_price - previous_close
                                    net_change_percentage = ((last_price - previous_close) / previous_close) * 100
                                
                                if net_change is not None:
                                    break
                        except Exception as e:
                            logger.debug(f"Failed to get quote for {symbol} from {exchange}: {e}")
                            continue
                    
                    if quote:
                        # Get calculated values or from API
                        last_price = quote.get("last_price")
                        ohlc = quote.get("ohlc", {})
                        previous_close = ohlc.get("close")
                        
                        net_change = quote.get("net_change")
                        net_change_percentage = quote.get("net_change_percentage")
                        
                        # If not available from API, calculate from previous close
                        if net_change is None and last_price and previous_close and previous_close > 0:
                            net_change = last_price - previous_close
                            net_change_percentage = ((last_price - previous_close) / previous_close) * 100
                        
                        existing_trade.day_change = net_change
                        existing_trade.day_change_percentage = net_change_percentage
                    else:
                        existing_trade.day_change = None
                        existing_trade.day_change_percentage = None
                except Exception as e:
                    logger.warning(f"Failed to get day change from quote API for {symbol}: {e}")
                    existing_trade.day_change = None
                    existing_trade.day_change_percentage = None
                
                updated_count += 1
                logger.info(f"Updated existing trade {existing_trade.id} ({symbol})")
            else:
                # Create new trade
                avg_price = holding.get("average_price", 0)
                buy_amount = avg_price * quantity
                
                # Get or create reference data (will cache company name and industry)
                industry_name = None
                try:
                    from app.services import reference_data_service
                    ref_data = reference_data_service.get_or_create_stock_reference(db, symbol, "NSE", force_refresh=False)
                    if ref_data:
                        industry_name = ref_data.industry
                except Exception as e:
                    logger.warn(f"Failed to fetch reference data for {symbol}: {e}")
                
                trade = Trade(
                    symbol=symbol,
                    buy_date=datetime.now().date(),  # Placeholder - Zerodha doesn't provide buy date in holdings
                    buy_price=avg_price,
                    quantity=quantity,
                    buy_amount=buy_amount,
                    buy_charges=0.0,
                    industry=industry_name,  # Fetched from market data API
                    trader=None,
                    status=TradeStatus.OPEN,
                    current_price=holding.get("last_price"),
                    current_quantity=quantity,
                    last_synced_at=datetime.utcnow(),
                    executed_via_api="ZERODHA",
                    zerodha_user_id=user_id
                )
                
                # Get day change from Zerodha quote API (not from average_price)
                # Try both NSE and BSE exchanges
                try:
                    from app.services import zerodha_service
                    quote = None
                    # Try the exchange from holding first, then try both NSE and BSE
                    exchanges_to_try = [holding.get("exchange", "NSE"), "NSE", "BSE"]
                    # Remove duplicates while preserving order
                    exchanges_to_try = list(dict.fromkeys(exchanges_to_try))
                    
                    for exchange in exchanges_to_try:
                        try:
                            quote = zerodha_service.get_quote(access_token, exchange, symbol)
                            if quote and quote.get("last_price"):
                                # Calculate day change from OHLC if not available directly
                                last_price = quote.get("last_price")
                                ohlc = quote.get("ohlc", {})
                                previous_close = ohlc.get("close")
                                
                                net_change = quote.get("net_change")
                                net_change_percentage = quote.get("net_change_percentage")
                                
                                # If not available from API, calculate from previous close
                                if net_change is None and last_price and previous_close and previous_close > 0:
                                    net_change = last_price - previous_close
                                    net_change_percentage = ((last_price - previous_close) / previous_close) * 100
                                
                                if net_change is not None:
                                    break
                        except Exception as e:
                            logger.debug(f"Failed to get quote for {symbol} from {exchange}: {e}")
                            continue
                    
                    if quote:
                        # Get calculated values or from API
                        last_price = quote.get("last_price")
                        ohlc = quote.get("ohlc", {})
                        previous_close = ohlc.get("close")
                        
                        net_change = quote.get("net_change")
                        net_change_percentage = quote.get("net_change_percentage")
                        
                        # If not available from API, calculate from previous close
                        if net_change is None and last_price and previous_close and previous_close > 0:
                            net_change = last_price - previous_close
                            net_change_percentage = ((last_price - previous_close) / previous_close) * 100
                        
                        trade.day_change = net_change
                        trade.day_change_percentage = net_change_percentage
                    else:
                        trade.day_change = None
                        trade.day_change_percentage = None
                except Exception as e:
                    logger.warning(f"Failed to get day change from quote API for {symbol}: {e}")
                    trade.day_change = None
                    trade.day_change_percentage = None
                
                db.add(trade)
                created_count += 1
                logger.info(f"Created new trade for {symbol}")
        
        db.commit()
        
        # Update prices for all migrated trades (in case last_price was missing or stale)
        try:
            from app.services import market_data_service
            open_trades = db.query(Trade).filter(
                Trade.status == TradeStatus.OPEN,
                Trade.zerodha_user_id == user_id
            ).all()
            
            if open_trades:
                symbols = list(set([trade.symbol for trade in open_trades]))
                logger.info(f"Updating prices for {len(symbols)} migrated symbols")
                
                price_result = market_data_service.get_batch_prices(
                    symbols=symbols,
                    exchange="NSE",
                    source="ZERODHA",
                    access_token=access_token
                )
                
                if price_result.get("success") and price_result.get("data"):
                    price_data = price_result["data"]
                    updated_prices = 0
                    
                    for trade in open_trades:
                        if trade.symbol in price_data:
                            price_info = price_data[trade.symbol]
                            new_price = price_info.get("current_price")
                            
                            if new_price and new_price > 0:
                                trade.current_price = new_price
                                trade.last_synced_at = datetime.utcnow()
                                
                                # Use day change from Zerodha API (from price_info, which comes from get_batch_prices)
                                trade.day_change = price_info.get("day_change")
                                trade.day_change_percentage = price_info.get("day_change_percentage")
                                
                                updated_prices += 1
                    
                    if updated_prices > 0:
                        db.commit()
                        logger.info(f"Updated prices for {updated_prices} migrated trades")
                else:
                    logger.warning(f"Failed to update prices after migration: {price_result.get('error')}")
        except Exception as e:
            logger.warn(f"Failed to update prices after migration: {e}")
            # Don't fail migration if price update fails
        
        # Populate reference data for migrated symbols
        try:
            from app.services import populate_reference_data
            populate_result = populate_reference_data.populate_from_trades(db)
            logger.info(f"Populated reference data for {populate_result['success_count']} symbols")
        except Exception as e:
            logger.warn(f"Failed to populate reference data after migration: {e}")
        
        # Mark migration as done for this account
        set_migration_done(user_id)
        
        return {
            "success": True,
            "created": created_count,
            "updated": updated_count,
            "message": f"Migration completed: {created_count} created, {updated_count} updated"
        }
    except Exception as e:
        logger.error(f"Error migrating holdings: {e}")
        db.rollback()
        raise

