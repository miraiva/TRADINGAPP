"""
One-time script to add zerodha_user_id column and update all existing trades with user_id UU6974
This script:
1. Adds the zerodha_user_id column to the trades table (if it doesn't exist)
2. Updates all existing trades with default user_id UU6974
"""

from app.db.database import SessionLocal, engine
from app.models.trade import Trade
import logging
import sqlite3

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_USER_ID = "UU6974"


def add_column_if_not_exists():
    """Add zerodha_user_id column to trades table if it doesn't exist"""
    try:
        # Get database path from engine
        db_path = str(engine.url).replace('sqlite:///', '')
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if column exists
        cursor.execute("PRAGMA table_info(trades)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'zerodha_user_id' not in columns:
            logger.info("Adding zerodha_user_id column to trades table...")
            cursor.execute("ALTER TABLE trades ADD COLUMN zerodha_user_id VARCHAR(50)")
            conn.commit()
            logger.info("Column added successfully")
        else:
            logger.info("Column zerodha_user_id already exists")
        
        conn.close()
    except Exception as e:
        logger.error(f"Error adding column: {e}", exc_info=True)
        raise


def update_existing_trades():
    """Update all existing trades with default user_id"""
    db = SessionLocal()
    try:
        # Get all trades (we'll update all of them)
        trades = db.query(Trade).all()
        
        if not trades:
            logger.info("No trades found to update")
            return
        
        logger.info(f"Found {len(trades)} trades to update")
        
        # Update each trade
        updated_count = 0
        for trade in trades:
            if not trade.zerodha_user_id:
                trade.zerodha_user_id = DEFAULT_USER_ID
                updated_count += 1
                logger.info(f"Updated trade {trade.id} ({trade.symbol}) with user_id {DEFAULT_USER_ID}")
        
        # Commit changes
        db.commit()
        logger.info(f"Successfully updated {updated_count} trades with user_id {DEFAULT_USER_ID}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating trades: {e}", exc_info=True)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Starting migration: Adding zerodha_user_id column and updating existing trades...")
    add_column_if_not_exists()
    update_existing_trades()
    logger.info("Migration completed successfully!")

