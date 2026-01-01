#!/usr/bin/env python3
"""
Migration Script: Remove Zerodha API Keys from Database

Per R-SM-3: Secrets shall not be stored in the application database.
This script removes all API keys from the database.

After running this script:
1. Configure secrets via environment variables:
   export ZERODHA_API_KEY='your_api_key'
   export ZERODHA_API_SECRET='your_api_secret'
2. Restart the application

Run: python remove_api_keys_from_db.py
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.database import SessionLocal, init_db
from app.models.zerodha_api_key import ZerodhaApiKey
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def remove_api_keys_from_database():
    """Remove all Zerodha API keys from the database"""
    db = SessionLocal()
    
    try:
        # Count existing records
        count = db.query(ZerodhaApiKey).count()
        logger.info(f"Found {count} API key records in database")
        
        if count == 0:
            logger.info("No API keys to remove. Database is already clean.")
            return
        
        # Confirm deletion
        print(f"\n⚠️  WARNING: This will permanently delete {count} API key record(s) from the database.")
        print("After deletion, you must configure secrets via environment variables.")
        response = input("Type 'DELETE' to confirm: ")
        
        if response != "DELETE":
            logger.info("Operation cancelled.")
            return
        
        # Delete all records
        db.query(ZerodhaApiKey).delete()
        db.commit()
        
        logger.info(f"✓ Successfully removed {count} API key record(s) from database")
        logger.info("\nNext steps:")
        logger.info("1. Configure secrets via environment variables:")
        logger.info("   export ZERODHA_API_KEY='your_api_key'")
        logger.info("   export ZERODHA_API_SECRET='your_api_secret'")
        logger.info("2. Restart the application")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Error removing API keys: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    logger.info("Removing Zerodha API keys from database...")
    logger.info("Per R-SM-3: Secrets shall not be stored in the database")
    remove_api_keys_from_database()

