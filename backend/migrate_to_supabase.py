"""
Migration script to export data from localhost SQLite and import to Supabase PostgreSQL

Usage:
    # Set environment variables
    export DATABASE_URL_SOURCE="sqlite:///./data/tradingapp.db"  # Local SQLite
    export DATABASE_URL_TARGET="postgresql://user:pass@host:port/dbname"  # Supabase
    
    # Or use .env file
    python migrate_to_supabase.py
"""

import os
import sys
from pathlib import Path
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
import logging
from datetime import datetime

# Add parent directory to path to import app modules
# The script is in backend/, so we need to add backend/ to path
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Load environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Import models
from app.models.trade import Trade
from app.models.payin import Payin
from app.models.zerodha_api_key import ZerodhaApiKey
from app.models.portfolio_snapshot import PortfolioSnapshot
from app.models.snapshot_symbol_price import SnapshotSymbolPrice
from app.models.stock_reference import StockReference

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Table order matters for foreign keys (if any)
# Import in this order to respect dependencies
TABLES_TO_MIGRATE = [
    ('stock_reference', StockReference),
    ('zerodha_api_keys', ZerodhaApiKey),
    ('trades', Trade),
    ('payins', Payin),
    ('portfolio_snapshots', PortfolioSnapshot),
    ('snapshot_symbol_prices', SnapshotSymbolPrice),
]


def get_connection_strings():
    """Get source and target database connection strings"""
    # Source: SQLite (localhost)
    source_db = os.getenv("DATABASE_URL_SOURCE")
    if not source_db:
        # Default to local SQLite
        data_dir = Path(__file__).parent / "data"
        source_db = f"sqlite:///{data_dir / 'tradingapp.db'}"
        logger.info(f"Using default SQLite path: {source_db}")
    
    # Target: Supabase PostgreSQL (from DATABASE_URL)
    target_db = os.getenv("DATABASE_URL")
    if not target_db:
        raise ValueError(
            "DATABASE_URL environment variable must be set to Supabase connection string.\n"
            "Example: postgresql://user:password@host:port/database"
        )
    
    return source_db, target_db


def create_engines(source_url, target_url):
    """Create SQLAlchemy engines for source and target databases"""
    # Source engine (SQLite)
    if source_url.startswith("sqlite"):
        source_engine = create_engine(
            source_url,
            connect_args={"check_same_thread": False}
        )
    else:
        source_engine = create_engine(source_url)
    
    # Target engine (PostgreSQL)
    if target_url.startswith("postgresql"):
        target_engine = create_engine(
            target_url,
            pool_pre_ping=True,
            pool_recycle=300
        )
    else:
        target_engine = create_engine(target_url)
    
    return source_engine, target_engine


def get_table_columns(table_name, engine):
    """Get column names for a table"""
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)
    return [col['name'] for col in columns]


def migrate_table(table_name, model_class, source_session, target_session, dry_run=False):
    """Migrate data from source to target for a single table"""
    logger.info(f"\n{'='*60}")
    logger.info(f"Migrating table: {table_name}")
    logger.info(f"{'='*60}")
    
    try:
        # Get all records from source
        records = source_session.query(model_class).all()
        total_records = len(records)
        
        if total_records == 0:
            logger.info(f"No records found in {table_name}. Skipping.")
            return 0
        
        logger.info(f"Found {total_records} records in source database")
        
        if dry_run:
            logger.info(f"[DRY RUN] Would migrate {total_records} records to {table_name}")
            # Show sample data
            if records:
                sample = records[0]
                logger.info(f"Sample record: {sample.to_dict() if hasattr(sample, 'to_dict') else str(sample)}")
            return total_records
        
        # Clear existing data in target (optional - comment out if you want to merge)
        existing_count = target_session.query(model_class).count()
        if existing_count > 0:
            logger.warning(f"Target table {table_name} already has {existing_count} records.")
            response = input(f"Delete existing records in {table_name}? (y/n): ").strip().lower()
            if response == 'y':
                target_session.query(model_class).delete()
                target_session.commit()
                logger.info(f"Deleted {existing_count} existing records from {table_name}")
            else:
                logger.info(f"Keeping existing records. New records will be added with new IDs.")
        
        # Migrate records
        migrated_count = 0
        skipped_count = 0
        
        for record in records:
            try:
                # Convert to dict (handles relationships and computed fields)
                if hasattr(record, 'to_dict'):
                    record_dict = record.to_dict()
                else:
                    # Fallback: use __dict__ but remove SQLAlchemy internal attributes
                    record_dict = {
                        k: v for k, v in record.__dict__.items()
                        if not k.startswith('_')
                    }
                
                # Remove 'id' to let database auto-generate new IDs
                # This prevents ID conflicts and ensures clean migration
                original_id = record_dict.pop('id', None)
                
                # Also remove computed fields that shouldn't be stored
                record_dict.pop('profit_loss', None)
                record_dict.pop('profit_percentage', None)
                record_dict.pop('aging_days', None)
                
                # Create new instance for target database
                new_record = model_class(**record_dict)
                target_session.add(new_record)
                migrated_count += 1
                
                # Commit in batches of 100 for better performance
                if migrated_count % 100 == 0:
                    target_session.commit()
                    logger.info(f"Migrated {migrated_count}/{total_records} records...")
                    
            except Exception as e:
                logger.error(f"Error migrating record: {e}")
                logger.error(f"Record data: {record_dict if 'record_dict' in locals() else str(record)}")
                skipped_count += 1
                target_session.rollback()
                continue
        
        # Final commit for remaining records
        if migrated_count % 100 != 0:
            target_session.commit()
        
        logger.info(f"✓ Successfully migrated {migrated_count} records")
        if skipped_count > 0:
            logger.warning(f"⚠ Skipped {skipped_count} records due to errors")
        
        return migrated_count
        
    except Exception as e:
        logger.error(f"Error migrating table {table_name}: {e}", exc_info=True)
        target_session.rollback()
        return 0


def verify_migration(source_session, target_session):
    """Verify that migration was successful by comparing record counts"""
    logger.info(f"\n{'='*60}")
    logger.info("Verifying migration...")
    logger.info(f"{'='*60}")
    
    verification_passed = True
    
    for table_name, model_class in TABLES_TO_MIGRATE:
        try:
            source_count = source_session.query(model_class).count()
            target_count = target_session.query(model_class).count()
            
            status = "✓" if source_count == target_count else "✗"
            logger.info(f"{status} {table_name}: Source={source_count}, Target={target_count}")
            
            if source_count != target_count:
                verification_passed = False
        except Exception as e:
            logger.error(f"Error verifying {table_name}: {e}")
            verification_passed = False
    
    return verification_passed


def main():
    """Main migration function"""
    logger.info("="*60)
    logger.info("Database Migration: SQLite (localhost) → Supabase PostgreSQL")
    logger.info("="*60)
    
    # Check for dry run flag
    dry_run = '--dry-run' in sys.argv or '-n' in sys.argv
    
    if dry_run:
        logger.info("\n⚠ DRY RUN MODE - No data will be written to target database\n")
    
    # Get connection strings
    try:
        source_url, target_url = get_connection_strings()
        logger.info(f"Source (SQLite): {source_url}")
        logger.info(f"Target (Supabase): {target_url.split('@')[0]}@***")  # Hide password in logs
    except ValueError as e:
        logger.error(str(e))
        sys.exit(1)
    
    # Create engines
    try:
        source_engine, target_engine = create_engines(source_url, target_url)
        logger.info("✓ Database engines created successfully")
    except Exception as e:
        logger.error(f"Error creating database engines: {e}")
        sys.exit(1)
    
    # Test connections
    try:
        with source_engine.connect() as conn:
            conn.execute("SELECT 1")
        logger.info("✓ Source database connection successful")
    except Exception as e:
        logger.error(f"Error connecting to source database: {e}")
        sys.exit(1)
    
    try:
        with target_engine.connect() as conn:
            conn.execute("SELECT 1")
        logger.info("✓ Target database connection successful")
    except Exception as e:
        logger.error(f"Error connecting to target database: {e}")
        logger.error("Make sure DATABASE_URL is set correctly and the database is accessible")
        sys.exit(1)
    
    # Ensure target database has tables
    try:
        from app.db.database import Base
        Base.metadata.create_all(bind=target_engine)
        logger.info("✓ Target database tables verified/created")
    except Exception as e:
        logger.error(f"Error creating tables in target database: {e}")
        sys.exit(1)
    
    # Create sessions
    SourceSession = sessionmaker(bind=source_engine)
    TargetSession = sessionmaker(bind=target_engine)
    
    source_session = SourceSession()
    target_session = TargetSession()
    
    try:
        # Migrate each table
        total_migrated = 0
        for table_name, model_class in TABLES_TO_MIGRATE:
            try:
                count = migrate_table(
                    table_name, 
                    model_class, 
                    source_session, 
                    target_session,
                    dry_run=dry_run
                )
                total_migrated += count
            except Exception as e:
                logger.error(f"Failed to migrate {table_name}: {e}", exc_info=True)
                continue
        
        if not dry_run:
            # Verify migration
            verification_passed = verify_migration(source_session, target_session)
            
            if verification_passed:
                logger.info("\n" + "="*60)
                logger.info("✓ Migration completed successfully!")
                logger.info(f"Total records migrated: {total_migrated}")
                logger.info("="*60)
            else:
                logger.warning("\n" + "="*60)
                logger.warning("⚠ Migration completed with warnings")
                logger.warning("Some record counts don't match. Please review the logs above.")
                logger.warning("="*60)
        else:
            logger.info("\n" + "="*60)
            logger.info(f"[DRY RUN] Would migrate {total_migrated} total records")
            logger.info("Run without --dry-run to perform actual migration")
            logger.info("="*60)
            
    except KeyboardInterrupt:
        logger.warning("\nMigration interrupted by user. Rolling back...")
        target_session.rollback()
    except Exception as e:
        logger.error(f"Migration failed: {e}", exc_info=True)
        target_session.rollback()
        sys.exit(1)
    finally:
        source_session.close()
        target_session.close()
        logger.info("Database connections closed")


if __name__ == "__main__":
    main()

