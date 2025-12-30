"""
Migration script to import portfolio snapshots from JSON file
Usage: python migrate_snapshots_json.py <json_file_path> [zerodha_user_id] [trading_strategy]
"""

import sys
import json
from datetime import datetime, date
from pathlib import Path
import os

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.db.database import SessionLocal, init_db
from app.models.portfolio_snapshot import PortfolioSnapshot


def parse_snapshot_json(file_path: str) -> list:
    """
    Parse JSON file containing snapshot data
    Expected fields:
    - date (required)
    - booked_pnl or booked_pl
    - payin or total_payin
    - float_pnl or float_pl
    - open_positions
    - balance_utilisation or utilisation_percent
    - portfolio or portfolio_value
    - nav
    """
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
        
        if not isinstance(data, list):
            raise ValueError("JSON must be an array of snapshot objects")
        
        snapshots = []
        for idx, item in enumerate(data, 1):
            try:
                # Parse date
                if 'date' not in item:
                    print(f"Warning: Skipping item {idx} - no date field")
                    continue
                
                snapshot_date = item['date']
                if isinstance(snapshot_date, str):
                    snapshot_date = datetime.strptime(snapshot_date, '%Y-%m-%d').date()
                elif isinstance(snapshot_date, (datetime, date)):
                    snapshot_date = snapshot_date.date() if hasattr(snapshot_date, 'date') else snapshot_date
                else:
                    print(f"Warning: Skipping item {idx} - invalid date format")
                    continue
                
                # Map fields (handle different field name variations)
                # Handle balance_utilisation% key (with % symbol)
                balance_utilisation = None
                for key in item.keys():
                    if 'balance_utilisation' in key.lower() or 'utilisation' in key.lower():
                        balance_utilisation = item.get(key)
                        break
                
                snapshot_dict = {
                    'snapshot_date': snapshot_date,
                    'nav': item.get('nav'),
                    'portfolio_value': item.get('porfolio') or item.get('portfolio') or item.get('portfolio_value'),
                    'total_payin': item.get('payin') or item.get('total_payin'),
                    'booked_pl': item.get('booked_profit_loss') or item.get('booked_pnl') or item.get('booked_pl') or item.get('booked_p/l') or 0,
                    'float_pl': item.get('float_profit_loss') or item.get('float_pnl') or item.get('float_pl') or item.get('float_p/l') or 0,
                    'open_positions': item.get('open_positions') or 0,
                    'balance': item.get('balance') or 0,
                    'utilisation_percent': balance_utilisation or item.get('utilisation_percent') or item.get('utilisation') or None,
                    'xirr': item.get('xirr') or None,
                    'absolute_profit_percent': item.get('absolute_profit_percent') or item.get('absolute_profit') or None,
                }
                
                # Validate required fields
                if not snapshot_dict['portfolio_value'] and not snapshot_dict['total_payin']:
                    print(f"Warning: Skipping item {idx} - missing portfolio_value or total_payin")
                    continue
                
                # Set defaults for required fields
                if not snapshot_dict['portfolio_value']:
                    # Calculate from payin + booked_pl + float_pl if not provided
                    snapshot_dict['portfolio_value'] = (
                        (snapshot_dict['total_payin'] or 0) + 
                        (snapshot_dict['booked_pl'] or 0) + 
                        (snapshot_dict['float_pl'] or 0)
                    )
                
                if not snapshot_dict['total_payin']:
                    snapshot_dict['total_payin'] = 0
                
                snapshots.append(snapshot_dict)
                
            except Exception as e:
                print(f"Warning: Error parsing item {idx}: {e}")
                continue
        
        return snapshots
    
    except Exception as e:
        print(f"Error parsing JSON file: {e}")
        raise


def import_snapshots(json_file: str, zerodha_user_id: str = None, trading_strategy: str = "SWING"):
    """
    Import snapshots from JSON file
    """
    print(f"Reading snapshots from: {json_file}")
    snapshots_data = parse_snapshot_json(json_file)
    
    if not snapshots_data:
        print("No snapshot data found in file")
        return
    
    print(f"Found {len(snapshots_data)} snapshots to import")
    
    # Group by date to ensure only one row per day (keep the last one for each date)
    date_map = {}
    for snapshot_dict in snapshots_data:
        date_key = snapshot_dict['snapshot_date']
        # If multiple entries for same date, keep the last one (or you could keep first, or merge)
        date_map[date_key] = snapshot_dict
    
    unique_snapshots = list(date_map.values())
    print(f"After deduplication: {len(unique_snapshots)} unique dates")
    
    # Sort by date to process chronologically
    unique_snapshots.sort(key=lambda x: x['snapshot_date'])
    
    # Initialize database
    init_db()
    db = SessionLocal()
    
    imported = 0
    skipped = 0
    updated = 0
    errors = []
    
    try:
        for idx, snapshot_dict in enumerate(unique_snapshots, 1):
            try:
                snapshot_date = snapshot_dict['snapshot_date']
                
                # Check if snapshot already exists
                existing_query = db.query(PortfolioSnapshot).filter(
                    PortfolioSnapshot.snapshot_date == snapshot_date
                )
                
                if zerodha_user_id:
                    existing_query = existing_query.filter(
                        PortfolioSnapshot.zerodha_user_id == zerodha_user_id
                    )
                else:
                    existing_query = existing_query.filter(
                        PortfolioSnapshot.trading_strategy == trading_strategy
                    )
                
                existing = existing_query.first()
                
                if existing:
                    # Update existing snapshot
                    existing.nav = snapshot_dict.get('nav')
                    existing.portfolio_value = snapshot_dict.get('portfolio_value', 0)
                    existing.total_payin = snapshot_dict.get('total_payin', 0)
                    existing.booked_pl = snapshot_dict.get('booked_pl', 0)
                    existing.float_pl = snapshot_dict.get('float_pl', 0)
                    existing.open_positions = snapshot_dict.get('open_positions', 0)
                    existing.balance = snapshot_dict.get('balance', 0)
                    existing.utilisation_percent = snapshot_dict.get('utilisation_percent')
                    existing.xirr = snapshot_dict.get('xirr')
                    existing.absolute_profit_percent = snapshot_dict.get('absolute_profit_percent')
                    existing.trading_strategy = trading_strategy  # Ensure strategy is set
                    updated += 1
                    if idx % 50 == 0:  # Print progress every 50 records
                        print(f"Processed {idx}/{len(unique_snapshots)} snapshots...")
                else:
                    # Create new snapshot
                    snapshot = PortfolioSnapshot(
                        snapshot_date=snapshot_date,
                        nav=snapshot_dict.get('nav'),
                        portfolio_value=snapshot_dict.get('portfolio_value', 0),
                        total_payin=snapshot_dict.get('total_payin', 0),
                        booked_pl=snapshot_dict.get('booked_pl', 0),
                        float_pl=snapshot_dict.get('float_pl', 0),
                        open_positions=snapshot_dict.get('open_positions', 0),
                        balance=snapshot_dict.get('balance', 0),
                        utilisation_percent=snapshot_dict.get('utilisation_percent'),
                        xirr=snapshot_dict.get('xirr'),
                        absolute_profit_percent=snapshot_dict.get('absolute_profit_percent'),
                        zerodha_user_id=zerodha_user_id,
                        trading_strategy=trading_strategy  # Always set the strategy
                    )
                    
                    db.add(snapshot)
                    imported += 1
                    if idx % 50 == 0:  # Print progress every 50 records
                        print(f"Processed {idx}/{len(unique_snapshots)} snapshots...")
                
            except Exception as e:
                error_msg = f"Error processing snapshot {idx}: {str(e)}"
                print(error_msg)
                errors.append({
                    "row": idx,
                    "date": snapshot_dict.get('snapshot_date'),
                    "error": str(e)
                })
                # Don't rollback here - we'll commit all successful ones at the end
        
        # Final commit for all successful operations
        db.commit()
        print(f"\nImport completed:")
        print(f"  - Imported: {imported}")
        print(f"  - Updated: {updated}")
        print(f"  - Skipped: {skipped}")
        print(f"  - Errors: {len(errors)}")
        
        if errors:
            print("\nErrors:")
            for error in errors:
                print(f"  Row {error['row']} ({error.get('date', 'N/A')}): {error['error']}")
    
    except Exception as e:
        db.rollback()
        print(f"Error during import: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python migrate_snapshots_json.py <json_file_path> [zerodha_user_id] [trading_strategy]")
        print("Example: python migrate_snapshots_json.py snapshots.json VN6451 SWING")
        print("Example: python migrate_snapshots_json.py snapshots.json None OVERALL")
        sys.exit(1)
    
    json_file = sys.argv[1]
    zerodha_user_id = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].lower() != 'none' else None
    trading_strategy = sys.argv[3] if len(sys.argv) > 3 else "SWING"
    
    if not os.path.exists(json_file):
        print(f"Error: File not found: {json_file}")
        sys.exit(1)
    
    import_snapshots(json_file, zerodha_user_id, trading_strategy)

