"""
WebSocket API Endpoints
Handles real-time data streaming via WebSockets
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from typing import Dict, List, Optional
import json
import logging
import asyncio
from sqlalchemy.orm import Session

from app.services.websocket_service import get_or_create_websocket_manager
from app.db.database import SessionLocal

router = APIRouter(prefix="/api/ws", tags=["websocket"])
logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections"""
    
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connection_data: Dict[WebSocket, Dict] = {}
    
    async def connect(self, websocket: WebSocket, user_id: str, access_token: str):
        """Accept WebSocket connection"""
        await websocket.accept()
        self.active_connections.append(websocket)
        self.connection_data[websocket] = {
            "user_id": user_id,
            "access_token": access_token,
            "subscribed_symbols": set()
        }
        logger.info(f"WebSocket connected: {user_id}")
    
    def disconnect(self, websocket: WebSocket):
        """Remove WebSocket connection"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        
        if websocket in self.connection_data:
            data = self.connection_data[websocket]
            user_id = data.get("user_id")
            access_token = data.get("access_token")
            
            # Cleanup Zerodha WebSocket if needed
            if user_id and access_token:
                from app.services.websocket_service import cleanup_websocket_manager
                cleanup_websocket_manager(user_id, access_token)
            
            del self.connection_data[websocket]
            logger.info(f"WebSocket disconnected: {user_id}")
    
    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Send message to specific WebSocket connection"""
        try:
            await websocket.send_json(message)
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            self.disconnect(websocket)
    
    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting: {e}")
                disconnected.append(connection)
        
        # Clean up disconnected connections
        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()


def get_instrument_tokens(symbols: List[str], exchange: str = "NSE", access_token: str = None) -> List[int]:
    """Get instrument tokens for symbols from Zerodha"""
    if not symbols or not access_token:
        return []
    
    try:
        from app.services.zerodha_service import get_kite_instance, _instruments_cache, _instruments_cache_timestamp, _instruments_cache_ttl
        from datetime import datetime
        
        # Get Kite instance
        kite = get_kite_instance(access_token)
        
        # Search both NSE and BSE to find all symbols
        exchanges_to_search = ["NSE", "BSE"] if exchange == "NSE" else [exchange]
        tokens = []
        symbols_upper = [s.upper() for s in symbols]
        found_symbols = set()
        
        for exch in exchanges_to_search:
            cache_key = exch
            now = datetime.now()
            instruments = None
            
            # Get instruments for the exchange (use cached if available)
            if cache_key in _instruments_cache:
                cache_time = _instruments_cache_timestamp.get(cache_key)
                if cache_time and (now - cache_time) < _instruments_cache_ttl:
                    instruments = _instruments_cache[cache_key]
            
            if instruments is None:
                logger.info(f"Fetching instruments for {exch}...")
                try:
                    instruments = kite.instruments(exch)
                    _instruments_cache[cache_key] = instruments
                    _instruments_cache_timestamp[cache_key] = now
                    logger.info(f"Cached {len(instruments)} instruments for {exch}")
                except Exception as e:
                    logger.warning(f"Error fetching instruments for {exch}: {e}")
                    continue
            
            # Map symbols to instrument tokens
            for instrument in instruments:
                tradingsymbol = instrument.get("tradingsymbol", "").upper()
                if tradingsymbol in symbols_upper and tradingsymbol not in found_symbols:
                    token = instrument.get("instrument_token")
                    if token:
                        tokens.append(token)
                        found_symbols.add(tradingsymbol)
                        logger.debug(f"Found token {token} for {tradingsymbol} on {exch}")
        
        missing_symbols = set(symbols_upper) - found_symbols
        if missing_symbols:
            logger.warning(f"Could not find instrument tokens for {len(missing_symbols)} symbols: {list(missing_symbols)}")
        
        logger.info(f"Found {len(tokens)} instrument tokens for {len(found_symbols)}/{len(symbols)} symbols")
        return tokens
        
    except Exception as e:
        logger.error(f"Error getting instrument tokens: {e}")
        return []


@router.websocket("/prices")
async def websocket_prices(websocket: WebSocket):
    """
    WebSocket endpoint for real-time price updates
    Client sends: {"action": "subscribe", "symbols": ["RELIANCE", "TCS"], "access_token": "...", "user_id": "..."}
    Server sends: {"type": "price_update", "symbol": "RELIANCE", "price": 2500.50, "timestamp": "..."}
    """
    await manager.connect(websocket, "", "")
    
    try:
        # Get initial connection data
        data = await websocket.receive_json()
        access_token = data.get("access_token")
        user_id = data.get("user_id")
        symbols = data.get("symbols", [])
        
        if not access_token or not user_id:
            await websocket.send_json({
                "type": "error",
                "message": "access_token and user_id required"
            })
            await websocket.close()
            return
        
        # Update connection data
        manager.connection_data[websocket]["user_id"] = user_id
        manager.connection_data[websocket]["access_token"] = access_token
        manager.connection_data[websocket]["subscribed_symbols"] = set(symbols)
        
        # Get or create Zerodha WebSocket manager
        try:
            # Get database session for API key lookup
            db = SessionLocal()
            try:
                ws_manager = get_or_create_websocket_manager(access_token, user_id, db=db)
            finally:
                # Don't close db here - WebSocket manager might need it
                # db.close()
                pass
            
            # Create a mapping from instrument_token to symbol for this connection
            token_to_symbol = {}
            if symbols:
                # Get instrument tokens and build mapping (searches both NSE and BSE)
                instrument_tokens = get_instrument_tokens(symbols, exchange="NSE", access_token=access_token)
                
                # Build reverse mapping: instrument_token -> symbol
                try:
                    from app.services.zerodha_service import get_kite_instance, _instruments_cache, _instruments_cache_timestamp, _instruments_cache_ttl
                    from datetime import datetime
                    
                    kite = get_kite_instance(access_token)
                    symbols_upper = [s.upper() for s in symbols]
                    
                    # Search both NSE and BSE for mapping
                    for exch in ["NSE", "BSE"]:
                        cache_key = exch
                        instruments = _instruments_cache.get(cache_key, [])
                        
                        if not instruments:
                            now = datetime.now()
                            cache_time = _instruments_cache_timestamp.get(cache_key) if cache_key in _instruments_cache_timestamp else None
                            if not cache_time or (now - cache_time) >= _instruments_cache_ttl:
                                logger.info(f"Fetching instruments for {exch} for token mapping...")
                                try:
                                    instruments = kite.instruments(exch)
                                    _instruments_cache[cache_key] = instruments
                                    _instruments_cache_timestamp[cache_key] = now
                                except Exception as e:
                                    logger.warning(f"Error fetching instruments for {exch}: {e}")
                                    continue
                        
                        # Build mapping: instrument_token -> symbol
                        for instrument in instruments:
                            token = instrument.get("instrument_token")
                            symbol = instrument.get("tradingsymbol", "").upper()
                            if token and symbol in symbols_upper and str(token) not in token_to_symbol:
                                token_to_symbol[str(token)] = symbol
                    
                    logger.info(f"Built token mapping: {len(token_to_symbol)} tokens mapped to {len(set(token_to_symbol.values()))} symbols")
                except Exception as e:
                    logger.error(f"Error building token to symbol mapping: {e}")
                    import traceback
                    logger.error(traceback.format_exc())
            
            # Cache for quotes (to avoid too many API calls)
            quote_cache = {}
            quote_cache_timestamps = {}
            QUOTE_CACHE_TTL = 60  # Cache quotes for 60 seconds
            
            def fetch_quote_with_day_change(symbol, exchange="NSE", db_session=None):
                """Fetch quote with day change, ALWAYS using snapshot LTP (ignoring Zerodha values)"""
                import time
                cache_key = f"{exchange}:{symbol}"
                now = time.time()
                
                # Check cache first
                if cache_key in quote_cache:
                    cache_time = quote_cache_timestamps.get(cache_key, 0)
                    if (now - cache_time) < QUOTE_CACHE_TTL:
                        return quote_cache[cache_key]
                
                # Fetch from API (only for last_price)
                try:
                    from app.services import zerodha_service
                    from app.services.sync_service import _get_snapshot_ltp
                    quote = zerodha_service.get_quote(access_token, exchange, symbol)
                    if quote:
                        last_price = quote.get("last_price")
                        if not last_price or last_price <= 0:
                            return None
                        
                        # Always use snapshot LTP for day change calculation (ignore Zerodha values)
                        net_change = None
                        net_change_percentage = None
                        
                        if db_session and symbol:
                            snapshot_ltp = _get_snapshot_ltp(db_session, symbol)
                            if snapshot_ltp and snapshot_ltp > 0:
                                net_change = last_price - snapshot_ltp
                                net_change_percentage = ((last_price - snapshot_ltp) / snapshot_ltp) * 100
                                logger.debug(f"WebSocket: Calculated day change for {symbol} using snapshot: current={last_price:.2f}, snapshot={snapshot_ltp:.2f}, change={net_change:.2f} ({net_change_percentage:.2f}%)")
                        
                        day_change_data = {
                            "day_change": net_change,
                            "day_change_percentage": net_change_percentage
                        }
                        # Update cache
                        quote_cache[cache_key] = day_change_data
                        quote_cache_timestamps[cache_key] = now
                        return day_change_data
                except Exception as e:
                    logger.warning(f"Error fetching quote for {symbol}: {e}")
                
                return None
            
            # Define callback for price updates (sync function that creates async task)
            async def on_price_update_async(instrument_token, tick):
                # Get symbol from mapping
                symbol = token_to_symbol.get(str(instrument_token))
                last_price = tick.get("last_price")
                
                # Fetch day change from quote API (with caching) - run in executor to avoid blocking
                day_change_data = None
                if symbol:
                    # Get db session for snapshot LTP lookup
                    db = SessionLocal()
                    try:
                        # Run sync function in thread pool to avoid blocking
                        loop = asyncio.get_event_loop()
                        # Try NSE first, then BSE (pass db session for snapshot lookup)
                        day_change_data = await loop.run_in_executor(None, fetch_quote_with_day_change, symbol, "NSE", db)
                        if not day_change_data:
                            day_change_data = await loop.run_in_executor(None, fetch_quote_with_day_change, symbol, "BSE", db)
                    finally:
                        db.close()
                
                # Create message with day change
                message = {
                    "type": "price_update",
                    "instrument_token": instrument_token,
                    "symbol": symbol,  # Include symbol for easier frontend matching
                    "price": last_price,
                    "tick": tick,
                    "timestamp": tick.get("timestamp")
                }
                
                # Add day change if available
                if day_change_data:
                    message["day_change"] = day_change_data.get("day_change")
                    message["day_change_percentage"] = day_change_data.get("day_change_percentage")
                
                # Send message
                await manager.send_personal_message(message, websocket)
            
            def on_price_update(instrument_token, tick):
                # Create async task to send message
                asyncio.create_task(on_price_update_async(instrument_token, tick))
            
            # Add callback
            ws_manager.add_callback(on_price_update)
            
            # Convert symbols to instrument tokens and subscribe
            if symbols:
                logger.info(f"Converting {len(symbols)} symbols to instrument tokens for user {user_id}")
                instrument_tokens = get_instrument_tokens(symbols, exchange="NSE", access_token=access_token)
                if instrument_tokens:
                    logger.info(f"Found {len(instrument_tokens)} instrument tokens. Subscribing...")
                    ws_manager.subscribe(instrument_tokens)
                    logger.info(f"Successfully subscribed to {len(instrument_tokens)} tokens")
                else:
                    logger.warning(f"Could not find instrument tokens for symbols: {symbols}. WebSocket will connect but won't receive price updates.")
            
            # Send connection confirmation
            await manager.send_personal_message({
                "type": "connected",
                "message": "WebSocket connected successfully",
                "subscribed_symbols": symbols,
                "subscribed_tokens": len(ws_manager.subscribed_tokens)
            }, websocket)
            
            # Keep connection alive and handle messages
            while True:
                try:
                    data = await websocket.receive_json()
                    action = data.get("action")
                    
                    if action == "subscribe":
                        new_symbols = data.get("symbols", [])
                        # Remove duplicates and empty values
                        new_symbols = list(set([s for s in new_symbols if s and s.strip()]))
                        manager.connection_data[websocket]["subscribed_symbols"].update(new_symbols)
                        
                        # Convert symbols to instrument tokens and subscribe
                        instrument_tokens = []
                        if new_symbols:
                            logger.info(f"Subscribing to {len(new_symbols)} new symbols: {new_symbols}")
                            instrument_tokens = get_instrument_tokens(new_symbols, exchange="NSE", access_token=access_token)
                            if instrument_tokens:
                                logger.info(f"Subscribing to {len(instrument_tokens)} instrument tokens")
                                ws_manager.subscribe(instrument_tokens)
                            else:
                                logger.warning(f"No instrument tokens found for symbols: {new_symbols}")
                        
                        await manager.send_personal_message({
                            "type": "subscribed",
                            "symbols": new_symbols,
                            "tokens_count": len(instrument_tokens)
                        }, websocket)
                    
                    elif action == "unsubscribe":
                        symbols_to_remove = data.get("symbols", [])
                        manager.connection_data[websocket]["subscribed_symbols"] -= set(symbols_to_remove)
                        # Unsubscribe from Zerodha WebSocket
                        
                        await manager.send_personal_message({
                            "type": "unsubscribed",
                            "symbols": symbols_to_remove
                        }, websocket)
                    
                    elif action == "ping":
                        await manager.send_personal_message({
                            "type": "pong"
                        }, websocket)
                
                except WebSocketDisconnect:
                    break
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
                    await manager.send_personal_message({
                        "type": "error",
                        "message": str(e)
                    }, websocket)
        
        except Exception as e:
            logger.error(f"Error setting up Zerodha WebSocket: {e}")
            await manager.send_personal_message({
                "type": "error",
                "message": f"Failed to connect to Zerodha WebSocket: {str(e)}"
            }, websocket)
    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        manager.disconnect(websocket)


@router.websocket("/trades")
async def websocket_trades(websocket: WebSocket):
    """
    WebSocket endpoint for real-time trade updates
    Streams updates when trades are created, updated, or sold
    """
    await manager.connect(websocket, "", "")
    
    try:
        while True:
            # This would be triggered by database changes
            # For now, just keep connection alive
            try:
                data = await websocket.receive_json()
                if data.get("action") == "ping":
                    await manager.send_personal_message({
                        "type": "pong"
                    }, websocket)
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"WebSocket trades error: {e}")
    finally:
        manager.disconnect(websocket)

