"""
Reference Data API Endpoints
Handles stock reference data (company names, industries, etc.)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel

from app.db.database import get_db
from app.models.stock_reference import StockReference
from app.services import reference_data_service, populate_reference_data

router = APIRouter(prefix="/api/reference-data", tags=["reference-data"])


class StockReferenceResponse(BaseModel):
    id: int
    symbol: str
    exchange: str
    company_name: Optional[str]
    industry: Optional[str]
    sector: Optional[str]
    market_cap: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]
    last_synced_at: Optional[str]

    class Config:
        from_attributes = True


@router.get("/search", response_model=List[StockReferenceResponse])
def search_stocks(
    q: str = Query(..., min_length=1, description="Search query (symbol or company name)"),
    exchange: str = Query("NSE", description="Exchange (NSE, BSE)"),
    limit: int = Query(50, ge=1, le=100, description="Maximum results"),
    access_token: str = Query(None, description="Zerodha access token for fetching missing symbols"),
    db: Session = Depends(get_db)
):
    """Search stocks by symbol or company name. If exact symbol match not found, will try to fetch from API."""
    try:
        results = reference_data_service.search_stocks(db, q, exchange, limit, access_token)
        return [ref.to_dict() for ref in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error searching stocks: {str(e)}")


@router.post("/bulk-load-instruments")
def bulk_load_instruments(
    access_token: str = Query(..., description="Zerodha access token"),
    exchange: str = Query("NSE", description="Exchange to load (NSE, BSE)"),
    db: Session = Depends(get_db)
):
    """One-time bulk load of all instruments from Zerodha into database"""
    try:
        if not access_token:
            raise HTTPException(status_code=400, detail="Zerodha access token required")
        
        from app.services import zerodha_service
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info(f"Starting bulk load of instruments for {exchange}...")
        
        # Get all instruments from Zerodha (this uses the cached list)
        kite = zerodha_service.get_kite_instance(access_token)
        instruments = kite.instruments(exchange)
        
        logger.info(f"Downloaded {len(instruments)} instruments from Zerodha")
        
        updated_count = 0
        created_count = 0
        skipped_count = 0
        
        # Process each instrument
        for i, instrument in enumerate(instruments, 1):
            try:
                symbol = instrument.get("tradingsymbol", "").upper()
                company_name = instrument.get("name", "")
                
                if not symbol:
                    skipped_count += 1
                    continue
                
                # Check if exists
                existing = db.query(StockReference).filter(
                    StockReference.symbol == symbol,
                    StockReference.exchange == exchange
                ).first()
                
                if existing:
                    # Update if company name is missing or equals symbol
                    if not existing.company_name or existing.company_name == symbol:
                        existing.company_name = company_name or symbol
                        from datetime import datetime
                        existing.last_synced_at = datetime.utcnow()
                        updated_count += 1
                    else:
                        skipped_count += 1
                else:
                    # Create new
                    new_ref = StockReference(
                        symbol=symbol,
                        exchange=exchange,
                        company_name=company_name or symbol
                    )
                    db.add(new_ref)
                    created_count += 1
                
                # Commit in batches for performance
                if i % 100 == 0:
                    db.commit()
                    logger.info(f"Processed {i}/{len(instruments)} instruments...")
                    
            except Exception as e:
                logger.error(f"Error processing instrument {instrument.get('tradingsymbol', 'unknown')}: {e}")
                continue
        
        # Final commit
        db.commit()
        
        logger.info(f"Bulk load complete for {exchange}")
        
        return {
            "success": True,
            "message": f"Bulk loaded instruments for {exchange}",
            "total_instruments": len(instruments),
            "created": created_count,
            "updated": updated_count,
            "skipped": skipped_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk loading instruments: {str(e)}")


@router.post("/refresh-company-names")
def refresh_all_company_names(
    access_token: str = Query(None, description="Zerodha access token"),
    db: Session = Depends(get_db)
):
    """Refresh company names for all stock references that need updating"""
    try:
        if not access_token:
            raise HTTPException(status_code=400, detail="Zerodha access token required")
        
        # Get all stock references
        all_refs = db.query(StockReference).all()
        
        # Filter references that need updating
        # (company_name is None, empty, or equals symbol)
        needs_update = [
            ref for ref in all_refs
            if not ref.company_name or ref.company_name.strip() == "" or ref.company_name.upper() == ref.symbol.upper()
        ]
        
        if not needs_update:
            return {
                "success": True,
                "message": "All stock references already have proper company names",
                "updated": 0,
                "failed": 0,
                "total": len(all_refs)
            }
        
        updated_count = 0
        failed_count = 0
        
        # Refresh each reference
        for ref in needs_update:
            try:
                # Force refresh from API
                updated_ref = reference_data_service.get_or_create_stock_reference(
                    db=db,
                    symbol=ref.symbol,
                    exchange=ref.exchange,
                    force_refresh=True,
                    access_token=access_token
                )
                
                if updated_ref and updated_ref.company_name:
                    # Check if we got a proper company name (not just the symbol)
                    if updated_ref.company_name.upper() != updated_ref.symbol.upper():
                        updated_count += 1
                    else:
                        failed_count += 1
                else:
                    failed_count += 1
                
            except Exception as e:
                failed_count += 1
                import logging
                logging.getLogger(__name__).error(f"Error refreshing {ref.symbol}: {e}")
        
        return {
            "success": True,
            "message": f"Refreshed {updated_count} company names",
            "updated": updated_count,
            "failed": failed_count,
            "total": len(needs_update),
            "total_references": len(all_refs)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error refreshing company names: {str(e)}")


@router.get("/{symbol}", response_model=StockReferenceResponse)
def get_stock_reference(
    symbol: str,
    exchange: str = Query("NSE", description="Exchange (NSE, BSE)"),
    refresh: bool = Query(False, description="Force refresh from API"),
    access_token: str = Query(None, description="Zerodha access token for fetching data"),
    db: Session = Depends(get_db)
):
    """Get stock reference data, optionally refreshing from API"""
    try:
        ref = reference_data_service.get_or_create_stock_reference(
            db, symbol, exchange, force_refresh=refresh, access_token=access_token
        )
        if not ref:
            raise HTTPException(status_code=404, detail=f"Stock reference not found for {symbol}")
        return ref.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching stock reference: {str(e)}")


@router.post("/bulk-update")
def bulk_update_references(
    symbols: List[str],
    exchange: str = Query("NSE", description="Exchange (NSE, BSE)"),
    db: Session = Depends(get_db)
):
    """Bulk update reference data for multiple symbols"""
    try:
        results = reference_data_service.bulk_update_references(db, symbols, exchange)
        return {
            "success": True,
            "results": results,
            "total": len(symbols),
            "successful": sum(1 for v in results.values() if v)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk updating references: {str(e)}")


@router.post("/populate")
def populate_references(
    force_refresh: bool = Query(False, description="Force refresh existing data"),
    db: Session = Depends(get_db)
):
    """Populate reference data with popular stocks"""
    try:
        result = populate_reference_data.populate_popular_stocks(db, force_refresh=force_refresh)
        return {
            "success": True,
            **result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error populating references: {str(e)}")


@router.get("/", response_model=List[StockReferenceResponse])
def list_all_references(
    exchange: str = Query("NSE", description="Exchange (NSE, BSE)"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum results"),
    db: Session = Depends(get_db)
):
    """List all stock references"""
    try:
        results = db.query(StockReference).filter(
            StockReference.exchange == exchange
        ).limit(limit).all()
        return [ref.to_dict() for ref in results]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing references: {str(e)}")


@router.post("/refresh-company-names")
def refresh_all_company_names(
    access_token: str = Query(None, description="Zerodha access token"),
    db: Session = Depends(get_db)
):
    """Refresh company names for all stock references that need updating"""
    try:
        if not access_token:
            raise HTTPException(status_code=400, detail="Zerodha access token required")
        
        # Get all stock references
        all_refs = db.query(StockReference).all()
        
        # Filter references that need updating
        # (company_name is None, empty, or equals symbol)
        needs_update = [
            ref for ref in all_refs
            if not ref.company_name or ref.company_name.strip() == "" or ref.company_name.upper() == ref.symbol.upper()
        ]
        
        if not needs_update:
            return {
                "success": True,
                "message": "All stock references already have proper company names",
                "updated": 0,
                "failed": 0,
                "total": len(all_refs)
            }
        
        updated_count = 0
        failed_count = 0
        
        # Refresh each reference
        for ref in needs_update:
            try:
                # Force refresh from API
                updated_ref = reference_data_service.get_or_create_stock_reference(
                    db=db,
                    symbol=ref.symbol,
                    exchange=ref.exchange,
                    force_refresh=True,
                    access_token=access_token
                )
                
                if updated_ref and updated_ref.company_name:
                    # Check if we got a proper company name (not just the symbol)
                    if updated_ref.company_name.upper() != updated_ref.symbol.upper():
                        updated_count += 1
                    else:
                        failed_count += 1
                else:
                    failed_count += 1
                
            except Exception as e:
                failed_count += 1
                import logging
                logging.getLogger(__name__).error(f"Error refreshing {ref.symbol}: {e}")
        
        return {
            "success": True,
            "message": f"Refreshed {updated_count} company names",
            "updated": updated_count,
            "failed": failed_count,
            "total": len(needs_update),
            "total_references": len(all_refs)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error refreshing company names: {str(e)}")
