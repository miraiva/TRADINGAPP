"""
Migration script to move API keys from localStorage (frontend) to database
This script reads API keys from account_details in localStorage format
and saves them to the database.

Usage:
    python migrate_api_keys_to_db.py

Note: This script expects account_details JSON format:
{
    "USER_ID": {
        "api_key": "...",
        "secret_key": "...",
        ...
    }
}
"""

import sys
import os
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.database import SessionLocal, init_db
from app.models.zerodha_api_key import ZerodhaApiKey


def migrate_api_keys_from_json(account_details_json: dict):
    """Migrate API keys from account_details JSON to database"""
    db = SessionLocal()
    
    migrated = 0
    skipped = 0
    errors = []
    
    try:
        for user_id, details in account_details_json.items():
            api_key = details.get('api_key', '').strip()
            secret_key = details.get('secret_key', '').strip()
            
            if not api_key or not secret_key:
                print(f"Skipping {user_id}: API key or secret key is empty")
                skipped += 1
                continue
            
            # Check if API key already exists
            existing = db.query(ZerodhaApiKey).filter(
                ZerodhaApiKey.zerodha_user_id == user_id
            ).first()
            
            if existing:
                # Update existing
                existing.api_key = api_key
                existing.api_secret = secret_key
                existing.is_active = True
                print(f"Updated API key for {user_id}")
            else:
                # Create new
                api_key_record = ZerodhaApiKey(
                    zerodha_user_id=user_id,
                    api_key=api_key,
                    api_secret=secret_key,
                    is_active=True
                )
                db.add(api_key_record)
                print(f"Migrated API key for {user_id}")
            
            migrated += 1
        
        db.commit()
        print(f"\nMigration completed:")
        print(f"  - Migrated: {migrated}")
        print(f"  - Skipped: {skipped}")
        print(f"  - Errors: {len(errors)}")
        
        if errors:
            print("\nErrors:")
            for error in errors:
                print(f"  {error}")
        
    except Exception as e:
        db.rollback()
        print(f"Error during migration: {e}")
        raise
    finally:
        db.close()


def migrate_from_stdin():
    """Read account_details JSON from stdin"""
    print("Enter account_details JSON (paste from browser localStorage):")
    print("(Press Ctrl+D or Ctrl+Z when done)")
    
    try:
        content = sys.stdin.read()
        account_details = json.loads(content)
        migrate_api_keys_from_json(account_details)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


def migrate_from_file(file_path: str):
    """Read account_details JSON from file"""
    try:
        with open(file_path, 'r') as f:
            account_details = json.load(f)
        migrate_api_keys_from_json(account_details)
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    print("API Key Migration Script")
    print("=" * 50)
    
    # Initialize database
    init_db()
    
    if len(sys.argv) > 1:
        # Read from file
        file_path = sys.argv[1]
        migrate_from_file(file_path)
    else:
        # Read from stdin
        migrate_from_stdin()



