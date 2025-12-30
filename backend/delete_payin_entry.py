#!/usr/bin/env python3
"""
Script to delete a specific payin entry
Deletes payin with:
- payin_date: 2020-12-02
- amount: 1952713
- zerodha_user_id: UU6974
"""

import sys
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent))

from app.db.database import SessionLocal
from app.models.payin import Payin
from datetime import date

def delete_payin_entry():
    """Delete the payin entry created from the JSON file"""
    db = SessionLocal()
    
    try:
        # Find the payin entry
        payin = db.query(Payin).filter(
            Payin.payin_date == date(2020, 12, 2),
            Payin.amount == 1952713,
            Payin.zerodha_user_id == 'UU6974'
        ).first()
        
        if not payin:
            print("❌ Payin entry not found with the specified criteria:")
            print("   Date: 2020-12-02")
            print("   Amount: 1952713")
            print("   User ID: UU6974")
            
            # List all payins for UU6974 to help debug
            all_uu6974_payins = db.query(Payin).filter(
                Payin.zerodha_user_id == 'UU6974'
            ).all()
            
            if all_uu6974_payins:
                print(f"\n📋 Found {len(all_uu6974_payins)} payin(s) for UU6974:")
                for p in all_uu6974_payins:
                    print(f"   ID: {p.id}, Date: {p.payin_date}, Amount: {p.amount}")
            else:
                print("\n📋 No payins found for UU6974")
            
            return False
        
        # Delete the payin
        payin_id = payin.id
        db.delete(payin)
        db.commit()
        
        print(f"✅ Successfully deleted payin entry (ID: {payin_id})")
        print(f"   Date: {payin.payin_date}")
        print(f"   Amount: {payin.amount}")
        print(f"   User ID: {payin.zerodha_user_id}")
        
        return True
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error deleting payin: {e}")
        return False
    finally:
        db.close()

if __name__ == "__main__":
    print("🔍 Searching for payin entry to delete...")
    success = delete_payin_entry()
    sys.exit(0 if success else 1)

