"""
Trading App - FastAPI Backend
Main application entry point
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
from pathlib import Path
import logging
import sys

# Configure logging to show INFO and above in console
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)  # This ensures logs go to stdout/terminal
    ]
)

# Try to import scheduler, but make it optional
logger = logging.getLogger(__name__)
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    import atexit
    SCHEDULER_AVAILABLE = True
except ImportError:
    SCHEDULER_AVAILABLE = False
    logger.warning("APScheduler not available - daily snapshots will not be scheduled automatically")

# Load environment variables
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Initialize FastAPI app
app = FastAPI(
    title="Personal Trading App API",
    description="Backend API for personal trading portfolio management",
    version="1.0.0"
)

# CORS Configuration
# In production, replace "*" with your frontend URL
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
# Check if we're in production (you can set PRODUCTION=true in .env)
is_production = os.getenv("PRODUCTION", "false").lower() == "true"

if is_production:
    # Production mode - specific origins only
    allow_origins = os.getenv("ALLOW_ORIGINS", frontend_url).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
else:
    # Development mode - allow all origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins in development
        allow_credentials=False,  # Cannot use credentials with wildcard origin
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],  # Explicitly allow all methods
        allow_headers=["*"],
        expose_headers=["*"],
    )

# Import and register API routes
from app.api import trades, zerodha, sync, market_data, migration, debug, websocket, reference_data, payin, snapshots, ai_assistant
app.include_router(trades.router)
app.include_router(zerodha.router)
app.include_router(sync.router)
app.include_router(market_data.router)
app.include_router(migration.router)
app.include_router(debug.router)
app.include_router(websocket.router)
app.include_router(reference_data.router)
app.include_router(payin.router)
app.include_router(snapshots.router)
app.include_router(ai_assistant.router)

# Initialize scheduler for daily snapshots (if available)
scheduler = None
if SCHEDULER_AVAILABLE:
    scheduler = BackgroundScheduler()

def create_daily_snapshots_job():
    """Background job to create daily snapshots"""
    try:
        from app.db.database import SessionLocal
        from app.api.snapshots import create_daily_snapshots_endpoint
        
        db = SessionLocal()
        try:
            # Call the endpoint logic directly
            from app.services.snapshot_service import create_snapshot
            from app.models.payin import Payin
            from datetime import date
            
            today = date.today()
            created_count = 0
            
            # Get all unique account IDs from payins
            account_ids = db.query(Payin.zerodha_user_id).distinct().all()
            account_ids = [acc[0] for acc in account_ids if acc[0]]
            
            # Create snapshot for each account
            for account_id in account_ids:
                try:
                    create_snapshot(
                        db=db,
                        snapshot_date=today,
                        zerodha_user_id=account_id,
                        trading_strategy=None
                    )
                    created_count += 1
                except Exception as e:
                    logger.warning(f"Failed to create snapshot for {account_id}: {e}")
            
            # Also create snapshots for OVERALL view (combine all accounts)
            if account_ids:
                create_snapshot(
                    db=db,
                    snapshot_date=today,
                    trading_strategy="OVERALL",
                    account_ids=account_ids
                )
                created_count += 1
            
            logger.info(f"Created {created_count} daily snapshots for {today}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error in daily snapshot job: {e}", exc_info=True)

# Schedule daily snapshots at 11:30 PM (23:30) every day (if scheduler is available)
if SCHEDULER_AVAILABLE and scheduler:
    scheduler.add_job(
        create_daily_snapshots_job,
        trigger=CronTrigger(hour=23, minute=30),
        id='daily_snapshots',
        name='Create daily portfolio snapshots',
        replace_existing=True
    )
    
    # Shut down scheduler on exit
    def shutdown_scheduler():
        if scheduler and scheduler.running:
            scheduler.shutdown()
    atexit.register(shutdown_scheduler)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    from app.db.database import init_db, SessionLocal
    from app.services import populate_reference_data
    
    # R-SM-4: Warn if required secrets are not present (allow startup to continue)
    # Secrets can be configured via Settings UI after deployment
    import os
    required_secrets = {
        "ZERODHA_API_KEY": os.getenv("ZERODHA_API_KEY"),
        "ZERODHA_API_SECRET": os.getenv("ZERODHA_API_SECRET")
    }
    
    missing_secrets = [key for key, value in required_secrets.items() if not value]
    if missing_secrets:
        logger.warning(
            f"⚠️  Zerodha API secrets not configured: {', '.join(missing_secrets)}\n"
            f"   Configure via Settings UI after deployment or set environment variables.\n"
            f"   App will start but Zerodha features will not work until configured."
        )
    else:
        logger.info("✓ Required secrets validated at startup")
    
    init_db()
    
    # Start scheduler (if available)
    if SCHEDULER_AVAILABLE and scheduler:
        try:
            scheduler.start()
            logger.info("Scheduler started - daily snapshots will be created at 11:30 PM")
        except Exception as e:
            logger.warning(f"Failed to start scheduler: {e}")
    
    # Populate reference data with popular stocks in background
    try:
        db = SessionLocal()
        # Only populate if we have less than 10 stocks (to avoid re-populating on every restart)
        from app.models.stock_reference import StockReference
        existing_count = db.query(StockReference).count()
        if existing_count < 10:
            logger.info("Populating reference data with popular stocks...")
            result = populate_reference_data.populate_popular_stocks(db, force_refresh=False)
            logger.info(f"Populated {result['success_count']} stocks")
        else:
            logger.info(f"Reference data already populated ({existing_count} stocks)")
        db.close()
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Error populating reference data: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown scheduler on app shutdown"""
    if SCHEDULER_AVAILABLE and scheduler:
        try:
            scheduler.shutdown()
            logger.info("Scheduler stopped")
        except Exception as e:
            logger.warning(f"Error shutting down scheduler: {e}")


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "Trading App API is running",
        "version": "1.0.0"
    }


@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "database": "connected",  # TODO: Add actual DB check
        "environment": os.getenv("ENVIRONMENT", "development")
    }





