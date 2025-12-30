"""
Migration script to import portfolio snapshots from Excel for VN6451 account
Usage: python migrate_snapshots_vn6451.py <excel_file_path>
"""

import sys
import pandas as pd
from datetime import datetime, date
from pathlib import Path
import os

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.db.database import SessionLocal, init_db
from app.models.portfolio_snapshot import PortfolioSnapshot
from app.services.snapshot_service import create_snapshot

def parse_snapshot_excel(file_path: str) -> list:
    """
    Parse Excel file containing snapshot data
    Expected columns:
    - Date (or snapshot_date)
    - NAV (optional)
    - Portfolio Value (or portfolio_value, total_portfolio)
    - Payin (or total_payin)
    - Booked P/L (or booked_pl)
    - Float P/L (or float_pl)
    - Open Positions (optional)
    - Balance (optional)
    - Utilisation % (optional)
    - XIRR (optional)
    - Absolute Profit % (optional)
    """
    try:
        df = pd.read_excel(file_path, engine='openpyxl')
        
        # Normalize column names
        df.columns = df.columns.str.strip().str.replace(' ', '_').str.replace('-', '_').str.lower()
        
        # Column mapping
        column_mapping = {
            'date': ['date', 'snapshot_date', 'snapshotdate', 'snap_date'],
            'nav': ['nav', 'net_asset_value'],
            'portfolio_value': ['portfolio_value', 'total_portfolio', 'portfolio', 'total_value'],
            'total_payin': ['payin', 'total_payin', 'invested', 'total_invested'],
            'booked_pl': ['booked_pl', 'booked_p/l', 'booked_profit', 'realized_p/l'],
            'float_pl': ['float_pl', 'float_p/l', 'float_profit', 'unrealized_p/l'],
            'open_positions': ['open_positions', 'invested_amount', 'positions'],
            'balance': ['balance', 'available_balance'],
            'utilisation_percent': ['utilisation', 'utilisation_%', 'utilization', 'utilization_%'],
            'xirr': ['xirr', 'xirr_%'],
            'absolute_profit_percent': ['absolute_profit', 'absolute_profit_%', 'profit_%']
        }
        
        snapshots = []
        for idx, row in df.iterrows():
            snapshot_dict = {}
            
            # Find and map columns
            for target_field, possible_names in column_mapping.items():
                value = None
                for name in possible_names:
                    if name in df.columns:
                        value = row[name]
                        break
                
                if value is not None and pd.notna(value):
                    # Handle string values with commas or parentheses
                    if isinstance(value, str):
                        value = value.replace(',', '').replace('(', '-').replace(')', '').strip()
                    try:
                        if target_field in ['date', 'snapshot_date']:
                            # Parse date
                            if isinstance(value, str):
                                snapshot_dict['snapshot_date'] = pd.to_datetime(value).date()
                            elif isinstance(value, (pd.Timestamp, datetime)):
                                snapshot_dict['snapshot_date'] = value.date() if hasattr(value, 'date') else value
                            else:
                                continue
                        else:
                            snapshot_dict[target_field] = float(value)
                    except (ValueError, TypeError) as e:
                        print(f"Warning: Could not parse {target_field} at row {idx + 1}: {value}")
                        if target_field == 'snapshot_date':
                            continue  # Skip row if date is invalid
            
            # Date is required
            if 'snapshot_date' not in snapshot_dict:
                print(f"Warning: Skipping row {idx + 1} - no valid date found")
                continue
            
            # Portfolio value and payin are required
            if 'portfolio_value' not in snapshot_dict and 'total_payin' not in snapshot_dict:
                print(f"Warning: Skipping row {idx + 1} - missing required fields")
                continue
            
            snapshots.append(snapshot_dict)
        
        return snapshots
    
    except Exception as e:
        print(f"Error parsing Excel file: {e}")
        raise


def import_snapshots(excel_file: str, zerodha_user_id: str = "VN6451"):
    """
    Import snapshots from Excel file
    """
    print(f"Reading snapshots from: {excel_file}")
    snapshots_data = parse_snapshot_excel(excel_file)
    
    if not snapshots_data:
        print("No snapshot data found in file")
        return
    
    print(f"Found {len(snapshots_data)} snapshots to import")
    
    # Initialize database
    init_db()
    db = SessionLocal()
    
    imported = 0
    skipped = 0
    errors = []
    
    try:
        for idx, snapshot_dict in enumerate(snapshots_data, 1):
            try:
                snapshot_date = snapshot_dict['snapshot_date']
                
                # Check if snapshot already exists
                existing = db.query(PortfolioSnapshot).filter(
                    PortfolioSnapshot.snapshot_date == snapshot_date,
                    PortfolioSnapshot.zerodha_user_id == zerodha_user_id
                ).first()
                
                if existing:
                    print(f"Snapshot for {snapshot_date} already exists, skipping...")
                    skipped += 1
                    continue
                
                # Create snapshot using service (which calculates metrics)
                # But if we have the data, we can create directly
                snapshot = PortfolioSnapshot(
                    snapshot_date=snapshot_date,
                    nav=snapshot_dict.get('nav'),
                    portfolio_value=snapshot_dict.get('portfolio_value', snapshot_dict.get('total_payin', 0)),
                    total_payin=snapshot_dict.get('total_payin', 0),
                    booked_pl=snapshot_dict.get('booked_pl', 0),
                    float_pl=snapshot_dict.get('float_pl', 0),
                    open_positions=snapshot_dict.get('open_positions', 0),
                    balance=snapshot_dict.get('balance', 0),
                    utilisation_percent=snapshot_dict.get('utilisation_percent'),
                    xirr=snapshot_dict.get('xirr'),
                    absolute_profit_percent=snapshot_dict.get('absolute_profit_percent'),
                    zerodha_user_id=zerodha_user_id,
                    trading_strategy='SWING'  # VN6451 is swing trading
                )
                
                db.add(snapshot)
                imported += 1
                print(f"Imported snapshot for {snapshot_date}")
                
            except Exception as e:
                error_msg = f"Error importing snapshot {idx}: {str(e)}"
                print(error_msg)
                errors.append({
                    "row": idx,
                    "date": snapshot_dict.get('snapshot_date'),
                    "error": str(e)
                })
        
        db.commit()
        print(f"\nImport completed:")
        print(f"  - Imported: {imported}")
        print(f"  - Skipped: {skipped}")
        print(f"  - Errors: {len(errors)}")
        
        if errors:
            print("\nErrors:")
            for error in errors:
                print(f"  Row {error['row']}: {error['error']}")
    
    except Exception as e:
        db.rollback()
        print(f"Error during import: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python migrate_snapshots_vn6451.py <excel_file_path> [zerodha_user_id]")
        print("Example: python migrate_snapshots_vn6451.py snapshots.xlsx VN6451")
        sys.exit(1)
    
    excel_file = sys.argv[1]
    zerodha_user_id = sys.argv[2] if len(sys.argv) > 2 else "VN6451"
    
    if not os.path.exists(excel_file):
        print(f"Error: File not found: {excel_file}")
        sys.exit(1)
    
    import_snapshots(excel_file, zerodha_user_id)

