"""
Script to delete all trades for a specific user_id
Usage: python3 delete_trades_by_user_id.py <user_id>
"""

import sys
from app.db.database import SessionLocal, init_db
from app.models.trade import Trade
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def delete_trades_by_user_id(user_id: str):
    """Delete all trades for a specific user_id"""
    # Initialize database
    init_db()
    
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
        logger.info(f"Trades involve {len(unique_symbols)} unique symbols: {', '.join(unique_symbols[:10])}{'...' if len(unique_symbols) > 10 else ''}")
        
        # Confirm deletion
        print(f"\n⚠️  WARNING: This will delete {len(trades)} trades for user_id: {user_id}")
        print(f"Symbols affected: {', '.join(unique_symbols[:10])}{'...' if len(unique_symbols) > 10 else ''}")
        confirm = input("\nType 'DELETE' to confirm: ")
        
        if confirm != 'DELETE':
            logger.info("Deletion cancelled by user")
            return 0
        
        # Delete each trade
        deleted_count = 0
        for trade in trades:
            db.delete(trade)
            deleted_count += 1
            logger.info(f"Deleted trade {trade.id}: {trade.symbol} (buy_date: {trade.buy_date})")
        
        # Commit changes
        db.commit()
        logger.info(f"✅ Successfully deleted {deleted_count} trades with user_id {user_id}")
        
        return deleted_count
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting trades: {e}", exc_info=True)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 delete_trades_by_user_id.py <user_id>")
        print("Example: python3 delete_trades_by_user_id.py VN6451")
        sys.exit(1)
    
    user_id = sys.argv[1]
    deleted = delete_trades_by_user_id(user_id)
    print(f"\nDeleted {deleted} trades for user_id: {user_id}")


