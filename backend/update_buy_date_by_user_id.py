"""
Script to update buy_date for all trades with a specific user_id
Usage: python3 update_buy_date_by_user_id.py <user_id> <buy_date>
Example: python3 update_buy_date_by_user_id.py UU6974 2021-12-01
"""

import sys
from datetime import datetime
from app.db.database import SessionLocal, init_db
from app.models.trade import Trade
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def update_buy_date_by_user_id(user_id: str, new_buy_date: str):
    """Update buy_date for all trades with a specific user_id"""
    # Initialize database
    init_db()
    
    # Parse the date
    try:
        buy_date = datetime.strptime(new_buy_date, '%Y-%m-%d').date()
    except ValueError:
        logger.error(f"Invalid date format: {new_buy_date}. Use YYYY-MM-DD format.")
        return 0
    
    db = SessionLocal()
    try:
        # Get all trades with this user_id
        trades = db.query(Trade).filter(Trade.zerodha_user_id == user_id).all()
        
        if not trades:
            logger.info(f"No trades found with user_id: {user_id}")
            return 0
        
        logger.info(f"Found {len(trades)} trades with user_id: {user_id}")
        
        # Show summary
        symbols = [trade.symbol for trade in trades]
        unique_symbols = list(set(symbols))
        logger.info(f"Trades involve {len(unique_symbols)} unique symbols")
        
        # Show current date range
        current_dates = [trade.buy_date for trade in trades if trade.buy_date]
        if current_dates:
            min_date = min(current_dates)
            max_date = max(current_dates)
            logger.info(f"Current buy_date range: {min_date} to {max_date}")
        
        # Confirm update
        print(f"\n⚠️  WARNING: This will update buy_date to {buy_date} for {len(trades)} trades with user_id: {user_id}")
        confirm = input("\nType 'UPDATE' to confirm: ")
        
        if confirm != 'UPDATE':
            logger.info("Update cancelled by user")
            return 0
        
        # Update each trade
        updated_count = 0
        for trade in trades:
            old_date = trade.buy_date
            trade.buy_date = buy_date
            updated_count += 1
            logger.info(f"Updated trade {trade.id}: {trade.symbol} (buy_date: {old_date} -> {buy_date})")
        
        # Commit changes
        db.commit()
        logger.info(f"✅ Successfully updated buy_date for {updated_count} trades with user_id {user_id}")
        
        return updated_count
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating trades: {e}", exc_info=True)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 update_buy_date_by_user_id.py <user_id> <buy_date>")
        print("Example: python3 update_buy_date_by_user_id.py UU6974 2021-12-01")
        sys.exit(1)
    
    user_id = sys.argv[1]
    buy_date = sys.argv[2]
    
    updated = update_buy_date_by_user_id(user_id, buy_date)
    print(f"\nUpdated {updated} trades for user_id: {user_id}")


