"""
Trades API Endpoints
Handles buy and sell trade operations

This module provides REST API endpoints for managing trading operations including:
- Creating buy trades (opening positions)
- Executing sell trades (closing positions)
- Updating market prices for open positions
- Querying trade history
"""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any, Tuple
from datetime import date, datetime, timezone
from pydantic import BaseModel, Field
import logging
import time
import json
import pandas as pd
from io import BytesIO
import json
import pandas as pd
from io import BytesIO

from app.db.database import get_db
from app.models.trade import Trade, TradeStatus
from app.services import market_data_service
from app.api.trades_import import parse_excel_file, parse_json_file, validate_trade_data, is_duplicate_trade

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trades", tags=["trades"])

# Constants for order status checking
ORDER_STATUS_MAX_RETRIES = 3
ORDER_STATUS_RETRY_DELAY_SECONDS = 1


# Pydantic models for request/response
class BuyTradeRequest(BaseModel):
    """Request model for creating a new buy trade"""
    symbol: str = Field(..., min_length=1, max_length=50)
    buy_date: date
    buy_price: Optional[float] = Field(None, gt=0)  # Optional when executing via API with MARKET order
    quantity: int = Field(..., gt=0)
    buy_charges: float = Field(default=0.0, ge=0)
    industry: Optional[str] = None
    trader: Optional[str] = None
    # Zerodha API execution
    execute_via_api: Optional[bool] = False
    access_token: Optional[str] = None
    exchange: Optional[str] = "NSE"
    order_type: Optional[str] = "MARKET"
    zerodha_user_id: Optional[str] = None


class SellTradeRequest(BaseModel):
    """Request model for selling an existing trade"""
    sell_date: date
    sell_price: Optional[float] = Field(None, gt=0)  # Optional when executing via API with MARKET order
    sell_charges: float = Field(default=0.0, ge=0)
    sell_amount: Optional[float] = None  # If provided, will override sell_price * quantity
    # Zerodha API execution
    execute_via_api: Optional[bool] = False
    access_token: Optional[str] = None
    exchange: Optional[str] = "NSE"
    order_type: Optional[str] = "MARKET"


class TradeResponse(BaseModel):
    """Response model for trade data"""
    id: int
    symbol: str
    buy_date: str
    buy_price: float
    quantity: int
    buy_amount: float
    buy_charges: float
    sell_date: Optional[str]
    sell_price: Optional[float]
    sell_amount: Optional[float]
    sell_charges: float
    industry: Optional[str]
    trader: Optional[str]
    status: str
    profit_loss: Optional[float]
    profit_percentage: Optional[float]
    executed_via_api: Optional[str]
    buy_order_id: Optional[str]
    sell_order_id: Optional[str]
    zerodha_user_id: Optional[str]
    current_price: Optional[float]
    current_quantity: Optional[int]
    last_synced_at: Optional[str]
    day_change: Optional[float]
    day_change_percentage: Optional[float]
    aging_days: Optional[int]
    created_at: Optional[str]
    updated_at: Optional[str]

    class Config:
        from_attributes = True


@router.post("/buy", response_model=TradeResponse, status_code=201)
async def buy_trade(
    trade_data: BuyTradeRequest,
    db: Session = Depends(get_db)
) -> TradeResponse:
    """
    Create a new buy trade (open position)
    
    Args:
        trade_data: Buy trade request data
        db: Database session
        
    Returns:
        TradeResponse: Created trade data
        
    Raises:
        HTTPException: If trade creation fails
    """
    buy_order_id: Optional[str] = None
    
    # Execute via Zerodha API if requested
    if trade_data.execute_via_api and trade_data.access_token:
        try:
            from app.services.zerodha_service import place_order, get_order_status
            
            order_result: Dict[str, Any] = place_order(
                access_token=trade_data.access_token,
                exchange=trade_data.exchange or "NSE",
                tradingsymbol=trade_data.symbol.upper(),
                transaction_type="BUY",
                quantity=trade_data.quantity,
                order_type=trade_data.order_type or "MARKET",
                product="CNC"
            )
            
            if order_result and order_result.get("order_id"):
                buy_order_id = order_result["order_id"]
                logger.info(f"Buy order placed successfully: order_id={buy_order_id}, symbol={trade_data.symbol}")
                
                # For MARKET orders, fetch the executed price from order status
                if trade_data.order_type == "MARKET":
                    executed_price = _fetch_executed_price_from_order(
                        access_token=trade_data.access_token,
                        order_id=buy_order_id,
                        symbol=trade_data.symbol,
                        exchange=trade_data.exchange or "NSE"
                    )
                    
                    if executed_price:
                        original_price = trade_data.buy_price
                        trade_data.buy_price = executed_price
                        logger.info(f"Executed price fetched from order status: {original_price} -> {trade_data.buy_price}")
                    else:
                        # Fallback: use current market price if order status unavailable
                        logger.warning(f"Could not get executed price from order status for order {buy_order_id}, using market price")
                        _fetch_fallback_market_price_buy(trade_data, trade_data.symbol, trade_data.exchange or "NSE")
                elif order_result.get("average_price"):
                    # For LIMIT orders, use the limit price or average price from order result
                    original_price = trade_data.buy_price
                    trade_data.buy_price = order_result["average_price"]
                    logger.info(f"Using average price from LIMIT order: {original_price} -> {trade_data.buy_price}")
        except Exception as e:
            # Log error but continue with manual entry (graceful degradation)
            logger.error(f"Zerodha order execution failed for symbol {trade_data.symbol}: {e}", exc_info=True)
            # Note: We continue with manual entry to allow trades even if API fails
    
    # Validate buy_price is provided (either from user or from API execution)
    if not trade_data.buy_price:
        raise HTTPException(
            status_code=400,
            detail="buy_price is required when not executing via API with MARKET order"
        )
    
    # Calculate total buy amount
    buy_amount = trade_data.buy_price * trade_data.quantity
    
    # Create new trade record
    trade = Trade(
        symbol=trade_data.symbol.upper(),
        buy_date=trade_data.buy_date,
        buy_price=trade_data.buy_price,
        quantity=trade_data.quantity,
        buy_amount=buy_amount,
        buy_charges=trade_data.buy_charges,
        industry=trade_data.industry,
        trader=trade_data.trader,
        status=TradeStatus.OPEN,
        executed_via_api="ZERODHA" if trade_data.execute_via_api else None,
        buy_order_id=buy_order_id,
        zerodha_user_id=trade_data.zerodha_user_id
    )
    
    try:
        db.add(trade)
        db.commit()
        db.refresh(trade)
        logger.info(f"Trade created successfully: id={trade.id}, symbol={trade.symbol}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create trade: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create trade in database")
    
    return trade.to_dict()


@router.post("/sell/{trade_id}", response_model=TradeResponse)
async def sell_trade(
    trade_id: int,
    sell_data: SellTradeRequest,
    db: Session = Depends(get_db)
) -> TradeResponse:
    """
    Sell an existing trade (close position)
    
    Args:
        trade_id: ID of the trade to sell
        sell_data: Sell trade request data
        db: Database session
        
    Returns:
        TradeResponse: Updated trade data with sell information
        
    Raises:
        HTTPException: If trade not found, already closed, or sell fails
    """
    # Get the trade
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    
    if not trade:
        logger.warning(f"Trade not found: id={trade_id}")
        raise HTTPException(status_code=404, detail="Trade not found")
    
    if trade.status == TradeStatus.CLOSED:
        logger.warning(f"Attempt to sell already closed trade: id={trade_id}")
        raise HTTPException(status_code=400, detail="Trade is already closed")
    
    sell_order_id: Optional[str] = None
    
    # Execute via Zerodha API if requested
    if sell_data.execute_via_api and sell_data.access_token:
        try:
            from app.services.zerodha_service import place_order, get_order_status
            
            order_result: Dict[str, Any] = place_order(
                access_token=sell_data.access_token,
                exchange=sell_data.exchange or "NSE",
                tradingsymbol=trade.symbol,
                transaction_type="SELL",
                quantity=trade.quantity,
                order_type=sell_data.order_type or "MARKET",
                product="CNC"
            )
            
            if order_result and order_result.get("order_id"):
                sell_order_id = order_result["order_id"]
                logger.info(f"Sell order placed successfully: order_id={sell_order_id}, trade_id={trade_id}")
                
                # For MARKET orders, fetch the executed price from order status
                # Note: MARKET orders execute immediately but we need to poll for the actual executed price
                if sell_data.order_type == "MARKET":
                    executed_price = _fetch_executed_price_from_order(
                        access_token=sell_data.access_token,
                        order_id=sell_order_id,
                        symbol=trade.symbol,
                        exchange=sell_data.exchange or "NSE"
                    )
                    
                    if executed_price:
                        sell_data.sell_price = executed_price
                        logger.info(f"Executed price fetched from order status: {sell_data.sell_price}")
                    else:
                        # Fallback: use current market price if order status unavailable
                        logger.warning(f"Could not get executed price from order status for order {sell_order_id}, using market price")
                        _fetch_fallback_market_price(sell_data, trade.symbol, sell_data.exchange or "NSE")
                elif order_result.get("average_price"):
                    # For LIMIT orders, use the limit price or average price from order result
                    sell_data.sell_price = order_result["average_price"]
                    logger.info(f"Using average price from LIMIT order: {sell_data.sell_price}")
        except Exception as e:
            # Log error and handle gracefully
            logger.error(f"Zerodha order execution failed for trade {trade_id}: {e}", exc_info=True)
            if not sell_data.sell_price:
                # If API execution fails and no price provided, we cannot proceed
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to execute order and no sell_price provided: {str(e)}"
                )
    
    # Validate sell_price is provided (either from user or from API execution)
    if not sell_data.sell_price:
        raise HTTPException(
            status_code=400,
            detail="sell_price is required when not executing via API with MARKET order"
        )
    
    # Calculate sell amount if not provided
    if sell_data.sell_amount is None:
        sell_amount = sell_data.sell_price * trade.quantity
    else:
        sell_amount = sell_data.sell_amount
    
    # Update trade with sell information
    trade.sell_date = sell_data.sell_date
    trade.sell_price = sell_data.sell_price
    trade.sell_amount = sell_amount
    trade.sell_charges = sell_data.sell_charges
    trade.status = TradeStatus.CLOSED
    
    if sell_order_id:
        trade.sell_order_id = sell_order_id
        if not trade.executed_via_api:
            trade.executed_via_api = "ZERODHA"
    
    try:
        db.commit()
        db.refresh(trade)
        logger.info(f"Trade sold successfully: id={trade.id}, sell_price={trade.sell_price}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update trade with sell information: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update trade in database")
    
    return trade.to_dict()


def _fetch_executed_price_from_order(
    access_token: str,
    order_id: str,
    symbol: str,
    exchange: str
) -> Optional[float]:
    """
    Fetch executed price from order status by polling.
    
    This function attempts to retrieve the executed price from the order status API.
    It retries up to ORDER_STATUS_MAX_RETRIES times with delays.
    
    Args:
        access_token: Zerodha access token
        order_id: Order ID to check
        symbol: Stock symbol (for logging)
        exchange: Exchange name (for logging)
        
    Returns:
        Optional[float]: Executed price if found, None otherwise
        
    Note:
        TODO: Consider using async sleep instead of blocking time.sleep() in async context.
    """
    from app.services.zerodha_service import get_order_status
    
    try:
        for attempt in range(ORDER_STATUS_MAX_RETRIES):
            # Wait briefly for order to execute (MARKET orders typically execute within seconds)
            # Note: Using blocking sleep in async context - consider asyncio.sleep() for better performance
            time.sleep(ORDER_STATUS_RETRY_DELAY_SECONDS)
            
            order_status: Dict[str, Any] = get_order_status(access_token, order_id)
            
            if order_status and not order_status.get("error"):
                # Check for executed price in various response fields (API may return in different formats)
                average_price = order_status.get("average_price")
                if average_price and average_price > 0:
                    return float(average_price)
                
                price = order_status.get("price")
                if price and price > 0:
                    return float(price)
                
                # Check if order is complete - if so, average_price should be available
                if order_status.get("status") == "COMPLETE":
                    if average_price and average_price > 0:
                        return float(average_price)
        
        return None
    except Exception as status_err:
        logger.warning(f"Error fetching order status for order {order_id}: {status_err}")
        return None


def _fetch_fallback_market_price(sell_data: SellTradeRequest, symbol: str, exchange: str) -> None:
    """
    Fetch current market price as fallback when order status is unavailable.
    
    Args:
        sell_data: Sell trade request (modified in place)
        symbol: Stock symbol
        exchange: Exchange name
    """
    try:
        price_result: Dict[str, Any] = market_data_service.get_real_time_price(
            symbol=symbol,
            exchange=exchange,
            source="ZERODHA",
            access_token=sell_data.access_token
        )
        
        if price_result.get("success") and price_result.get("data"):
            current_price = price_result["data"].get("current_price")
            if current_price:
                sell_data.sell_price = current_price
                logger.info(f"Using fallback market price: {current_price}")
    except Exception as e:
        logger.warning(f"Failed to fetch fallback market price for {symbol}: {e}")


def _fetch_fallback_market_price_buy(trade_data: BuyTradeRequest, symbol: str, exchange: str) -> None:
    """
    Fetch current market price as fallback when order status is unavailable for buy orders.
    
    Args:
        trade_data: Buy trade request (modified in place)
        symbol: Stock symbol
        exchange: Exchange name
    """
    try:
        price_result: Dict[str, Any] = market_data_service.get_real_time_price(
            symbol=symbol,
            exchange=exchange,
            source="ZERODHA",
            access_token=trade_data.access_token
        )
        
        if price_result.get("success") and price_result.get("data"):
            current_price = price_result["data"].get("current_price")
            if current_price:
                trade_data.buy_price = current_price
                logger.info(f"Using fallback market price for buy: {current_price}")
    except Exception as e:
        logger.warning(f"Failed to fetch fallback market price for {symbol}: {e}")


@router.post("/update-prices")
async def update_prices(
    source: Optional[str] = Query("ZERODHA", description="Data source for price updates"),
    access_token: Optional[str] = Query(None, description="Zerodha access token (required if source is ZERODHA). If not provided, will try to use market data account from preferences."),
    db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Update prices for all open trades
    
    Fetches current market prices for all open positions and updates the database.
    This is useful for refreshing P/L calculations and current position values.
    
    Args:
        source: Data source name (default: "ZERODHA")
        access_token: Zerodha access token if using ZERODHA source
        db: Database session
        
    Returns:
        List of updated trade dictionaries
        
    Raises:
        HTTPException: If price fetching fails
    """
    # Get source from query param or default to ZERODHA
    data_source = source if source else "ZERODHA"
    
    # Get all open trades
    open_trades: List[Trade] = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
    
    if not open_trades:
        logger.info("No open trades to update")
        return []
    
    # Get unique symbols to minimize API calls
    symbols = list(set([trade.symbol for trade in open_trades]))
    logger.info(f"Updating prices for {len(symbols)} unique symbols, {len(open_trades)} total trades")
    
    # Fetch prices in batch
    price_result: Dict[str, Any] = market_data_service.get_batch_prices(
        symbols=symbols,
        exchange="NSE",
        source=data_source,
        access_token=access_token
    )
    
    if not price_result.get("success"):
        error_msg = price_result.get("error", "Unknown error")
        logger.error(f"Failed to fetch prices: {error_msg}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch prices: {error_msg}")
    
    price_data: Dict[str, Dict[str, Any]] = price_result.get("data", {})
    updated_count = 0
    
    # Import sync service for day change calculation using snapshot LTP
    from app.services.sync_service import _calculate_day_change_from_quote
    
    # Update each trade with current price
    for trade in open_trades:
        if trade.symbol in price_data:
            price_info = price_data[trade.symbol]
            new_price = price_info.get("current_price")
            
            if new_price and new_price > 0:  # Validate price is positive
                trade.current_price = new_price
                trade.last_synced_at = datetime.now(timezone.utc)
                
                # Calculate day change using snapshot LTP (ignore Zerodha values)
                # Create a mock quote dict with last_price for the calculation function
                mock_quote = {"last_price": new_price}
                day_change, day_change_percentage = _calculate_day_change_from_quote(mock_quote, db, trade.symbol)
                trade.day_change = day_change
                trade.day_change_percentage = day_change_percentage
                
                updated_count += 1
            else:
                logger.warning(f"Invalid price data for symbol {trade.symbol}: {new_price}")
    
    try:
        db.commit()
        logger.info(f"Successfully updated prices for {updated_count}/{len(open_trades)} trades")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to commit price updates: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to update prices in database")
    
    # Return updated trades
    updated_trades: List[Trade] = db.query(Trade).filter(Trade.status == TradeStatus.OPEN).all()
    return [trade.to_dict() for trade in updated_trades]


@router.get("/", response_model=List[TradeResponse])
async def get_all_trades(
    status: Optional[str] = Query(None, description="Filter by status: 'OPEN' or 'CLOSED'"),
    db: Session = Depends(get_db)
) -> List[TradeResponse]:
    """
    Get all trades, optionally filtered by status
    
    Args:
        status: Optional status filter ("OPEN" or "CLOSED")
        db: Database session
        
    Returns:
        List of trade responses, ordered by buy_date descending
        
    Raises:
        HTTPException: If invalid status is provided
    """
    query = db.query(Trade)
    
    if status:
        try:
            status_enum = TradeStatus(status.upper())
            query = query.filter(Trade.status == status_enum)
            logger.debug(f"Filtering trades by status: {status_enum}")
        except ValueError:
            logger.warning(f"Invalid status provided: {status}")
            raise HTTPException(status_code=400, detail="Invalid status. Use 'OPEN' or 'CLOSED'")
    
    # Optimize query: use index-friendly ordering and limit unnecessary work
    # The composite index idx_status_buy_date will help when status filter is used
    # The composite index idx_buy_date_created_at will help with ordering
    trades: List[Trade] = query.order_by(Trade.buy_date.desc(), Trade.created_at.desc()).all()
    logger.debug(f"Retrieved {len(trades)} trades")
    
    # Convert to dict - calculations are done here but we can optimize later if needed
    return [trade.to_dict() for trade in trades]


class ImportResult(BaseModel):
    """Result of import operation"""
    success: bool
    total_rows: int
    imported: int
    failed: int
    skipped: int
    errors: List[Dict[str, Any]]
    duplicates: List[Dict[str, Any]]


@router.post("/import", response_model=ImportResult)
async def import_trades(
    file: UploadFile = File(...),
    zerodha_user_id: str = Form(...),
    skip_duplicates: bool = Form(True),
    db: Session = Depends(get_db)
):
    """
    Import trades from JSON or Excel file
    
    - **file**: JSON or Excel file (.json, .xlsx, .xls)
    - **zerodha_user_id**: User ID for the account (e.g., "UU6974", "UUXXXX")
    - **skip_duplicates**: If True, skip duplicate trades; if False, fail on duplicates
    """
    try:
        file_content = await file.read()
        file_extension = file.filename.split('.')[-1].lower()
        
        if file_extension in ['xlsx', 'xls']:
            raw_data = parse_excel_file(file_content)
        elif file_extension == 'json':
            raw_data = parse_json_file(file_content)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file format: {file_extension}. Supported: .json, .xlsx, .xls")
        
        if not raw_data:
            raise HTTPException(status_code=400, detail="No data found in file")
        
        # Validate all records first before importing any
        validated_trades = []
        errors = []
        duplicates = []
        
        logger.info(f"Validating {len(raw_data)} trades before import...")
        
        for idx, trade_dict in enumerate(raw_data, start=1):
            if 'zerodha_user_id' not in trade_dict or not trade_dict.get('zerodha_user_id'):
                trade_dict['zerodha_user_id'] = zerodha_user_id
            
            validated_data, error_msg = validate_trade_data(trade_dict, idx)
            
            if error_msg:
                errors.append({
                    "row": idx,
                    "symbol": trade_dict.get('symbol', 'N/A'),
                    "error": error_msg
                })
                continue
            
            # Check for duplicates
            if is_duplicate_trade(db, validated_data):
                if skip_duplicates:
                    duplicates.append({
                        "row": idx,
                        "symbol": validated_data['symbol'],
                        "buy_date": str(validated_data['buy_date']),
                        "reason": "Trade with same order_id already exists"
                    })
                    continue
                else:
                    errors.append({
                        "row": idx,
                        "symbol": validated_data['symbol'],
                        "error": f"Duplicate trade found: order_id {validated_data.get('buy_order_id', 'N/A')} already exists"
                    })
                    continue
            
            validated_trades.append((idx, validated_data))
        
        # If there are any errors, fail the entire import
        if errors:
            error_summary = f"Import failed: {len(errors)} record(s) have errors. All records must be valid to import."
            logger.error(error_summary)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": error_summary,
                    "total_rows": len(raw_data),
                    "errors": errors,
                    "duplicates": duplicates
                }
            )
        
        # If there are duplicates and skip_duplicates is False, fail
        if duplicates and not skip_duplicates:
            error_summary = f"Import failed: {len(duplicates)} duplicate record(s) found. Set skip_duplicates=true to skip them."
            logger.error(error_summary)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": error_summary,
                    "total_rows": len(raw_data),
                    "duplicates": duplicates
                }
            )
        
        # All validations passed - now import all trades in a single transaction
        imported_count = 0
        try:
            for idx, validated_data in validated_trades:
                trade = Trade(
                    symbol=validated_data['symbol'],
                    buy_date=validated_data['buy_date'],
                    buy_price=validated_data['buy_price'],
                    quantity=validated_data['quantity'],
                    buy_amount=validated_data['buy_amount'],
                    buy_charges=validated_data['buy_charges'],
                    buy_order_id=validated_data.get('buy_order_id'),
                    industry=validated_data.get('industry'),
                    trader=validated_data.get('trader'),
                    status=TradeStatus.OPEN if validated_data['status'] == 'OPEN' else TradeStatus.CLOSED,
                    executed_via_api=validated_data.get('executed_via_api'),
                    zerodha_user_id=validated_data['zerodha_user_id'],
                    current_price=validated_data.get('current_price')
                )
                
                if validated_data['status'] == 'CLOSED':
                    trade.sell_date = validated_data['sell_date']
                    trade.sell_price = validated_data['sell_price']
                    trade.sell_amount = validated_data['sell_amount']
                    trade.sell_charges = validated_data['sell_charges']
                    trade.sell_order_id = validated_data.get('sell_order_id')
                
                db.add(trade)
                imported_count += 1
                logger.info(f"Prepared trade {idx}: {validated_data['symbol']}")
            
            # Commit all trades in a single transaction
            db.commit()
            logger.info(f"✅ Successfully imported {imported_count} trades in a single transaction")
            
        except Exception as e:
            # Rollback entire transaction if any trade fails
            db.rollback()
            error_msg = f"Database error during import: {str(e)}"
            logger.error(f"Import failed, rolled back all {imported_count} trades: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail={
                    "message": error_msg,
                    "total_rows": len(raw_data),
                    "imported_before_failure": imported_count
                }
            )
        
        result = ImportResult(
            success=True,
            total_rows=len(raw_data),
            imported=imported_count,
            failed=0,
            skipped=len(duplicates),
            errors=[],
            duplicates=duplicates
        )
        
        logger.info(f"Import completed successfully: {imported_count} imported, {len(duplicates)} skipped (duplicates)")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Import failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@router.get("/{trade_id}", response_model=TradeResponse)
async def get_trade(
    trade_id: int,
    db: Session = Depends(get_db)
) -> TradeResponse:
    """
    Get a specific trade by ID
    
    Args:
        trade_id: Trade ID to retrieve
        db: Database session
        
    Returns:
        TradeResponse: Trade data
        
    Raises:
        HTTPException: If trade not found
    """
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    
    if not trade:
        logger.warning(f"Trade not found: id={trade_id}")
        raise HTTPException(status_code=404, detail="Trade not found")
    
    return trade.to_dict()


@router.delete("/{trade_id}", status_code=204)
async def delete_trade(
    trade_id: int,
    db: Session = Depends(get_db)
) -> None:
    """
    Delete a trade
    
    Args:
        trade_id: Trade ID to delete
        db: Database session
        
    Raises:
        HTTPException: If trade not found or deletion fails
    """
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    
    if not trade:
        logger.warning(f"Attempt to delete non-existent trade: id={trade_id}")
        raise HTTPException(status_code=404, detail="Trade not found")
    
    try:
        db.delete(trade)
        db.commit()
        logger.info(f"Trade deleted successfully: id={trade_id}")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete trade {trade_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to delete trade")
    
    return None


class ImportResult(BaseModel):
    """Result of import operation"""
    success: bool
    total_rows: int
    imported: int
    failed: int
    skipped: int
    errors: List[Dict[str, Any]]
    duplicates: List[Dict[str, Any]]
