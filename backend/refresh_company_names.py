"""
Script to refresh company names for all stock references in the database
This will update entries where company_name is missing or equals the symbol
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

# Load environment variables
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

from app.db.database import SessionLocal, init_db
from app.models.stock_reference import StockReference
from app.services import reference_data_service
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def refresh_all_company_names(access_token: str = None):
    """
    Refresh company names for all stock references that need updating
    """
    # Initialize database
    init_db()
    
    db = SessionLocal()
    
    try:
        # Get all stock references
        all_refs = db.query(StockReference).all()
        
        logger.info(f"Found {len(all_refs)} stock references in database")
        
        # Filter references that need updating
        # (company_name is None, empty, or equals symbol)
        needs_update = [
            ref for ref in all_refs
            if not ref.company_name or ref.company_name.strip() == "" or ref.company_name.upper() == ref.symbol.upper()
        ]
        
        logger.info(f"Found {len(needs_update)} references that need company name updates")
        
        if not needs_update:
            logger.info("All stock references already have proper company names!")
            return
        
        # Get access token from environment if not provided
        if not access_token:
            access_token = os.getenv("ZERODHA_ACCESS_TOKEN")
        
        if not access_token:
            logger.warning("No Zerodha access token found. Company names may not be fetched properly.")
            logger.warning("Set ZERODHA_ACCESS_TOKEN in .env file or pass as argument")
        
        updated_count = 0
        failed_count = 0
        
        # Refresh each reference
        for i, ref in enumerate(needs_update, 1):
            try:
                logger.info(f"[{i}/{len(needs_update)}] Refreshing {ref.symbol} ({ref.exchange})...")
                
                # Force refresh from API
                updated_ref = reference_data_service.get_or_create_stock_reference(
                    db=db,
                    symbol=ref.symbol,
                    exchange=ref.exchange,
                    force_refresh=True,
                    access_token=access_token
                )
                
                if updated_ref and updated_ref.company_name:
                    # Check if we got a proper company name (not just the symbol)
                    if updated_ref.company_name.upper() != updated_ref.symbol.upper():
                        updated_count += 1
                        logger.info(f"  ✓ Updated: {updated_ref.company_name}")
                    else:
                        failed_count += 1
                        logger.warning(f"  ✗ Still showing symbol as name: {updated_ref.symbol}")
                else:
                    failed_count += 1
                    logger.warning(f"  ✗ Failed to get company name for {ref.symbol}")
                
            except Exception as e:
                failed_count += 1
                logger.error(f"  ✗ Error refreshing {ref.symbol}: {e}")
        
        logger.info("\n" + "="*50)
        logger.info(f"Refresh complete!")
        logger.info(f"  Updated: {updated_count}")
        logger.info(f"  Failed: {failed_count}")
        logger.info(f"  Total: {len(needs_update)}")
        logger.info("="*50)
        
    except Exception as e:
        logger.error(f"Error during refresh: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Refresh company names for all stock references")
    parser.add_argument(
        "--access-token",
        type=str,
        help="Zerodha access token (optional, will use ZERODHA_ACCESS_TOKEN from .env if not provided)"
    )
    
    args = parser.parse_args()
    
    refresh_all_company_names(access_token=args.access_token)


