"""
Force update day_change for all open trades using snapshot LTP backup
This is useful for testing when Zerodha data is missing or zero
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.database import SessionLocal
from app.models.trade import Trade, TradeStatus
from app.models.snapshot_symbol_price import SnapshotSymbolPrice
from datetime import datetime, timezone

def force_update_day_change_from_snapshot():
    """Force update day_change for all open trades using snapshot LTP"""
    db = SessionLocal()
    try:
        # Get all open trades
        open_trades = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
        
        if not open_trades:
            print("No open trades found.")
            return
        
        print(f"Found {len(open_trades)} open trades")
        
        updated_count = 0
        skipped_count = 0
        
        for trade in open_trades:
            symbol = trade.symbol.upper() if trade.symbol else None
            if not symbol:
                skipped_count += 1
                continue
            
            # Get snapshot LTP
            snapshot = db.query(SnapshotSymbolPrice).filter(
                SnapshotSymbolPrice.symbol == symbol
            ).first()
            
            if not snapshot or not snapshot.ltp:
                skipped_count += 1
                continue
            
            # Get current price
            current_price = trade.current_price
            if not current_price or current_price <= 0:
                skipped_count += 1
                continue
            
            # Calculate day change from snapshot
            day_change = current_price - snapshot.ltp
            day_change_percentage = ((current_price - snapshot.ltp) / snapshot.ltp) * 100 if snapshot.ltp > 0 else None
            
            # Update trade
            trade.day_change = day_change
            trade.day_change_percentage = day_change_percentage
            trade.last_synced_at = datetime.now(timezone.utc)
            
            updated_count += 1
            print(f"  {symbol}: current={current_price:.2f}, snapshot={snapshot.ltp:.2f}, "
                  f"change={day_change:.2f} ({day_change_percentage:.2f}%)")
        
        db.commit()
        print(f"\n✅ Updated {updated_count} trades")
        print(f"⏭️  Skipped {skipped_count} trades (no snapshot or current_price)")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        db.rollback()
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    force_update_day_change_from_snapshot()

