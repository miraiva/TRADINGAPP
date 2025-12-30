"""
Test script to populate snapshot_symbol_prices table with random LTPs
This is for testing the backup day change calculation functionality
"""

import sys
import random
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.database import SessionLocal
from app.models.trade import Trade, TradeStatus
from app.models.snapshot_symbol_price import SnapshotSymbolPrice
from datetime import datetime, timezone

def populate_test_snapshot_ltps():
    """Populate snapshot_symbol_prices with test data"""
    db = SessionLocal()
    try:
        # Get all unique symbols from open trades
        open_trades = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
        
        if not open_trades:
            print("No open trades found. Please add some trades first.")
            return
        
        # Get unique symbols with their current_price (if available)
        symbol_ltp_map = {}
        for trade in open_trades:
            symbol = trade.symbol.upper() if trade.symbol else None
            if symbol:
                # Use current_price if available, otherwise generate a random price
                if trade.current_price and trade.current_price > 0:
                    # Use current_price as base, add some random variation (±10%)
                    base_price = trade.current_price
                    variation = random.uniform(-0.1, 0.1)  # ±10% variation
                    test_ltp = base_price * (1 + variation)
                    symbol_ltp_map[symbol] = test_ltp
                else:
                    # Generate a random price between 50 and 5000
                    test_ltp = random.uniform(50, 5000)
                    symbol_ltp_map[symbol] = test_ltp
        
        if not symbol_ltp_map:
            print("No valid symbols found in open trades.")
            return
        
        print(f"Found {len(symbol_ltp_map)} unique symbols from open trades")
        
        # Delete all existing entries
        db.query(SnapshotSymbolPrice).delete()
        print("Cleared existing snapshot symbol prices")
        
        # Insert new entries with test LTPs
        snapshot_taken_at = datetime.now(timezone.utc)
        inserted_count = 0
        
        for symbol, ltp in symbol_ltp_map.items():
            symbol_price = SnapshotSymbolPrice(
                symbol=symbol,
                ltp=round(ltp, 2),  # Round to 2 decimal places
                snapshot_taken_at=snapshot_taken_at
            )
            db.add(symbol_price)
            inserted_count += 1
            print(f"  {symbol}: {ltp:.2f}")
        
        db.commit()
        print(f"\n✅ Successfully populated {inserted_count} symbol LTPs in snapshot_symbol_prices table")
        print(f"Snapshot timestamp: {snapshot_taken_at.isoformat()}")
        print("\nYou can now test the day change calculation backup functionality.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    populate_test_snapshot_ltps()

