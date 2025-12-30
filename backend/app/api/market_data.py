"""
Market Data API Endpoints
Handles market data requests (prices, candles, static data)
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional

from app.services import market_data_service

router = APIRouter(prefix="/api/market-data", tags=["market-data"])


class BatchPricesRequest(BaseModel):
    symbols: List[str]
    exchange: str = "NSE"
    source: str = "ZERODHA"
    access_token: Optional[str] = None


@router.get("/price")
async def get_price(
    symbol: str = Query(...),
    exchange: str = Query("NSE"),
    source: str = Query("ZERODHA"),
    access_token: str = Query(None)
):
    """Get real-time price for a symbol"""
    result = market_data_service.get_real_time_price(symbol, exchange, source, access_token)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to get price"))
    return result


@router.post("/prices/batch")
async def get_batch_prices(request: BatchPricesRequest):
    """Get prices for multiple symbols"""
    result = market_data_service.get_batch_prices(request.symbols, request.exchange, request.source)
    return result


@router.get("/candles")
async def get_candles(
    symbol: str = Query(...),
    exchange: str = Query("NSE"),
    interval: str = Query("1d"),
    period: str = Query("1mo"),
    source: str = Query("ZERODHA"),
    access_token: str = Query(None)
):
    """Get historical candle data"""
    result = market_data_service.get_historical_candles(symbol, exchange, interval, period, source, access_token)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to get candles"))
    return result


@router.get("/static")
async def get_static_data(
    symbol: str = Query(...),
    exchange: str = Query("NSE"),
    source: str = Query("ZERODHA"),
    access_token: str = Query(None)
):
    """Get static data (company name, industry, etc.)"""
    result = market_data_service.get_static_data(symbol, exchange, source, access_token)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to get static data"))
    return result


@router.get("/stocks/list")
async def get_stocks_list(
    exchange: str = Query("NSE"),
    source: str = Query("ZERODHA")
):
    """Get list of available stocks"""
    result = market_data_service.get_stocks_list(exchange, source)
    return result

