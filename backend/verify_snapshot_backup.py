"""
Verify that snapshot backup is working correctly
Shows which symbols have snapshot LTPs and which trades have zero day_change
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app.db.database import SessionLocal
from app.models.trade import Trade, TradeStatus
from app.models.snapshot_symbol_price import SnapshotSymbolPrice

def verify_snapshot_backup():
    """Verify snapshot backup setup"""
    db = SessionLocal()
    try:
        # Check snapshot data
        snapshot_count = db.query(SnapshotSymbolPrice).count()
        print(f"📊 Snapshot symbol prices in DB: {snapshot_count}")
        
        if snapshot_count == 0:
            print("❌ No snapshot data found! Please run populate_test_snapshot_ltps.py first.")
            return
        
        # Get sample snapshot symbols
        sample_symbols = db.query(SnapshotSymbolPrice.symbol, SnapshotSymbolPrice.ltp).limit(5).all()
        print("\nSample snapshot LTPs:")
        for symbol, ltp in sample_symbols:
            print(f"  {symbol}: {ltp:.2f}")
        
        # Check open trades with zero day_change
        open_trades = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
        print(f"\n📈 Total open trades: {len(open_trades)}")
        
        zero_day_change = []
        for trade in open_trades:
            if trade.symbol and (trade.day_change is None or trade.day_change == 0):
                snapshot_ltp = db.query(SnapshotSymbolPrice).filter(
                    SnapshotSymbolPrice.symbol == trade.symbol.upper()
                ).first()
                has_snapshot = "✅" if snapshot_ltp else "❌"
                zero_day_change.append({
                    'symbol': trade.symbol,
                    'current_price': trade.current_price,
                    'day_change': trade.day_change,
                    'has_snapshot': has_snapshot,
                    'snapshot_ltp': snapshot_ltp.ltp if snapshot_ltp else None
                })
        
        print(f"\n🔍 Trades with zero/null day_change: {len(zero_day_change)}")
        if zero_day_change:
            print("\nFirst 10 trades that need backup:")
            for i, trade_info in enumerate(zero_day_change[:10], 1):
                print(f"  {i}. {trade_info['symbol']}: current_price={trade_info['current_price']}, "
                      f"day_change={trade_info['day_change']}, {trade_info['has_snapshot']} snapshot={trade_info['snapshot_ltp']}")
        
        print("\n💡 To apply backup values, sync with Zerodha again.")
        print("   The backup will automatically calculate day_change using snapshot LTPs.")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    verify_snapshot_backup()

