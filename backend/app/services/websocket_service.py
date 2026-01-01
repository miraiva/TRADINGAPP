"""
WebSocket Service
Manages WebSocket connections and real-time data streaming
"""

import asyncio
import json
import logging
from typing import Dict, Set, List, Optional
from datetime import datetime
from kiteconnect import KiteTicker
import os

logger = logging.getLogger(__name__)

# Store active WebSocket connections
active_connections: Set = set()

# Store subscribed symbols per connection
connection_subscriptions: Dict[str, Set[str]] = {}

# Store latest prices
latest_prices: Dict[str, Dict] = {}


class ZerodhaWebSocketManager:
    """Manages Zerodha WebSocket connection for real-time market data"""
    
    def __init__(self, access_token: str, user_id: str, db=None):
        self.access_token = access_token
        self.user_id = user_id
        self.kws = None
        self.subscribed_tokens: Set[int] = set()
        self.is_connected = False
        self.callbacks = []
        
        # R-SM-2, R-SM-3: API key comes from environment variables only, never database
        # The db and user_id parameters are kept for API compatibility but not used for key lookup
        api_key = os.getenv("ZERODHA_API_KEY")
        
        if not api_key:
            raise ValueError(
                "ZERODHA_API_KEY environment variable not configured. "
                "Please set ZERODHA_API_KEY in your environment before starting the application."
            )
        
        # Initialize KiteTicker
        self.kws = KiteTicker(api_key, access_token)
        
        # Set up event handlers
        self.kws.on_ticks = self._on_ticks
        self.kws.on_connect = self._on_connect
        self.kws.on_close = self._on_close
        self.kws.on_error = self._on_error
    
    def _on_ticks(self, ws, ticks):
        """Handle incoming tick data"""
        try:
            for tick in ticks:
                instrument_token = tick.get("instrument_token")
                last_price = tick.get("last_price")
                
                if instrument_token and last_price:
                    # Store latest price
                    latest_prices[str(instrument_token)] = {
                        "price": last_price,
                        "timestamp": datetime.utcnow().isoformat(),
                        "tick": tick
                    }
                    
                    # Notify all callbacks (they should handle async if needed)
                    for callback in self.callbacks:
                        try:
                            # Callback can be sync or async
                            result = callback(instrument_token, tick)
                            # If it's a coroutine, schedule it
                            if asyncio.iscoroutine(result):
                                asyncio.create_task(result)
                        except Exception as e:
                            logger.error(f"Error in callback: {e}")
        except Exception as e:
            logger.error(f"Error processing ticks: {e}")
    
    def _on_connect(self, ws, response):
        """Handle WebSocket connection"""
        self.is_connected = True
        logger.info("Zerodha WebSocket connected")
        
        # Resubscribe to tokens if any
        if self.subscribed_tokens:
            ws.subscribe(list(self.subscribed_tokens))
            ws.set_mode(ws.MODE_FULL, list(self.subscribed_tokens))
    
    def _on_close(self, ws, code, reason):
        """Handle WebSocket close"""
        self.is_connected = False
        logger.info(f"Zerodha WebSocket closed: {code} - {reason}")
    
    def _on_error(self, ws, code, reason):
        """Handle WebSocket error"""
        logger.error(f"Zerodha WebSocket error: {code} - {reason}")
        self.is_connected = False
    
    def subscribe(self, tokens: List[int]):
        """Subscribe to instrument tokens"""
        if not self.kws:
            raise ValueError("WebSocket not initialized")
        
        new_tokens = set(tokens) - self.subscribed_tokens
        if new_tokens:
            self.subscribed_tokens.update(new_tokens)
            
            if self.is_connected:
                self.kws.subscribe(list(new_tokens))
                self.kws.set_mode(self.kws.MODE_FULL, list(new_tokens))
    
    def unsubscribe(self, tokens: List[int]):
        """Unsubscribe from instrument tokens"""
        if not self.kws:
            return
        
        tokens_to_remove = set(tokens) & self.subscribed_tokens
        if tokens_to_remove:
            self.subscribed_tokens -= tokens_to_remove
            
            if self.is_connected:
                self.kws.unsubscribe(list(tokens_to_remove))
    
    def connect(self):
        """Connect to Zerodha WebSocket"""
        if not self.kws:
            raise ValueError("WebSocket not initialized")
        
        try:
            self.kws.connect(threaded=True)
            logger.info("Zerodha WebSocket connection initiated")
        except Exception as e:
            logger.error(f"Error connecting WebSocket: {e}")
            raise
    
    def disconnect(self):
        """Disconnect from Zerodha WebSocket"""
        if self.kws:
            try:
                self.kws.close()
                self.is_connected = False
                logger.info("Zerodha WebSocket disconnected")
            except Exception as e:
                logger.error(f"Error disconnecting WebSocket: {e}")
    
    def add_callback(self, callback):
        """Add callback for price updates"""
        if callback not in self.callbacks:
            self.callbacks.append(callback)
    
    def remove_callback(self, callback):
        """Remove callback"""
        if callback in self.callbacks:
            self.callbacks.remove(callback)


# Global WebSocket managers (one per user)
websocket_managers: Dict[str, ZerodhaWebSocketManager] = {}


def get_or_create_websocket_manager(access_token: str, user_id: str, db=None) -> ZerodhaWebSocketManager:
    """Get or create WebSocket manager for a user"""
    key = f"{user_id}_{access_token[:10]}"
    
    if key not in websocket_managers:
        manager = ZerodhaWebSocketManager(access_token, user_id, db=db)
        websocket_managers[key] = manager
        manager.connect()
    
    return websocket_managers[key]


def get_latest_price(instrument_token: str) -> Optional[Dict]:
    """Get latest price for an instrument token"""
    return latest_prices.get(str(instrument_token))


def cleanup_websocket_manager(user_id: str, access_token: str):
    """Clean up WebSocket manager"""
    key = f"{user_id}_{access_token[:10]}"
    
    if key in websocket_managers:
        manager = websocket_managers[key]
        manager.disconnect()
        del websocket_managers[key]
        logger.info(f"Cleaned up WebSocket manager for user {user_id}")

