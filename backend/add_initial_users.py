"""
Migration script to add initial authorized users to the database
Run this script after creating the users table to add the initial whitelisted users
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.db.database import SessionLocal, init_db
from app.models.user import User
from datetime import datetime

# Initial users to add
INITIAL_USERS = [
    {
        "email": "ivan.e.miranda@gmail.com",
        "name": "Ivan Miranda",
        "google_id": "ivan_miranda_placeholder"  # Will be updated when they log in via Google OAuth
    },
    {
        "email": "shilpa.r.mayekar@gmail.com",
        "name": "Shilpa Miranda",
        "google_id": "shilpa_miranda_placeholder"  # Will be updated when they log in via Google OAuth
    }
]


def add_initial_users():
    """Add initial users to the database"""
    db = SessionLocal()
    
    try:
        # Initialize database (creates tables if they don't exist)
        init_db()
        print("Database initialized")
        
        added_count = 0
        updated_count = 0
        
        for user_data in INITIAL_USERS:
            email = user_data["email"]
            name = user_data["name"]
            google_id = user_data["google_id"]
            
            # Check if user already exists by email
            existing_user = db.query(User).filter(User.email == email).first()
            
            if existing_user:
                # Update existing user if needed
                if existing_user.google_id == "ivan_miranda_placeholder" or existing_user.google_id == "shilpa_miranda_placeholder":
                    existing_user.name = name
                    existing_user.google_id = google_id
                    updated_count += 1
                    print(f"Updated user: {email}")
                else:
                    print(f"User already exists (has real Google ID): {email}")
            else:
                # Create new user
                user = User(
                    email=email,
                    name=name,
                    google_id=google_id
                )
                db.add(user)
                added_count += 1
                print(f"Added user: {email} ({name})")
        
        db.commit()
        print(f"\nMigration complete: {added_count} users added, {updated_count} users updated")
        
    except Exception as e:
        db.rollback()
        print(f"Error adding users: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("Adding initial users to database...")
    add_initial_users()
    print("Done!")

