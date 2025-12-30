"""
Trade Model - Represents individual buy/sell trades
Each trade is an independent asset (no cost averaging)
"""

from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Index
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.sql import func
from app.db.database import Base
import enum
from datetime import date


class TradeStatus(str, enum.Enum):
    """Trade status enumeration"""
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class Trade(Base):
    """Trade model - represents a single buy/sell position"""
    
    __tablename__ = "trades"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Trade identification
    symbol = Column(String(50), nullable=False, index=True)
    
    # Buy details
    buy_date = Column(Date, nullable=False, index=True)
    buy_price = Column(Float, nullable=False)
    quantity = Column(Integer, nullable=False)
    buy_amount = Column(Float, nullable=False)  # Total amount spent
    buy_charges = Column(Float, default=0.0)  # Brokerage, taxes, etc.
    
    # Sell details (nullable for open positions)
    sell_date = Column(Date, nullable=True)
    sell_price = Column(Float, nullable=True)
    sell_amount = Column(Float, nullable=True)  # Total amount received
    sell_charges = Column(Float, default=0.0)
    
    # Additional information
    industry = Column(String(100), nullable=True)
    trader = Column(String(100), nullable=True)
    
    # Status
    status = Column(SQLEnum(TradeStatus), default=TradeStatus.OPEN, nullable=False, index=True)
    
    # Zerodha API execution tracking
    executed_via_api = Column(String(20), nullable=True)  # 'ZERODHA' or None
    buy_order_id = Column(String(100), nullable=True)
    sell_order_id = Column(String(100), nullable=True)
    zerodha_user_id = Column(String(50), nullable=True, index=True)  # Zerodha account user ID
    
    # Sync data from Zerodha
    current_price = Column(Float, nullable=True)
    current_quantity = Column(Integer, nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    
    # Market data
    day_change = Column(Float, nullable=True)
    day_change_percentage = Column(Float, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Composite indexes for common query patterns
    __table_args__ = (
        # Index for filtering by status and ordering by buy_date (most common query)
        Index('idx_status_buy_date', 'status', 'buy_date'),
        # Index for filtering by zerodha_user_id and status
        Index('idx_zerodha_user_status', 'zerodha_user_id', 'status'),
        # Index for ordering by buy_date and created_at (used in get_all_trades)
        Index('idx_buy_date_created_at', 'buy_date', 'created_at'),
    )
    
    def calculate_profit_loss(self):
        """Calculate profit/loss for this trade (realized for CLOSED, unrealized for OPEN)"""
        total_buy = self.buy_amount + self.buy_charges
        
        if self.status == TradeStatus.CLOSED and self.sell_price:
            # Realized P/L for closed trades
            total_sell = (self.sell_price * self.quantity) - self.sell_charges if self.sell_amount is None else self.sell_amount - self.sell_charges
            return total_sell - total_buy
        elif self.status == TradeStatus.OPEN and self.current_price:
            # Unrealized P/L for open trades (based on current market price)
            current_value = self.current_price * self.quantity
            return current_value - total_buy
        
        return None
    
    def calculate_profit_percentage(self):
        """Calculate profit/loss percentage (realized for CLOSED, unrealized for OPEN)"""
        total_buy = self.buy_amount + self.buy_charges
        if total_buy == 0:
            return None
        
        profit_loss = self.calculate_profit_loss()
        if profit_loss is None:
            return None
        
        return (profit_loss / total_buy) * 100
    
    def calculate_aging_days(self):
        """Calculate how many days the trade has been open"""
        if self.status == TradeStatus.CLOSED:
            # For closed trades, calculate days from buy_date to sell_date
            if self.buy_date and self.sell_date:
                return (self.sell_date - self.buy_date).days
            return None
        else:
            # For open trades, calculate days from buy_date to today
            if self.buy_date:
                today = date.today()
                return (today - self.buy_date).days
            return None
    
    def to_dict(self):
        """Convert trade to dictionary - optimized to avoid redundant calculations"""
        # Calculate profit_loss once and reuse for profit_percentage
        profit_loss = self.calculate_profit_loss()
        
        # Calculate profit_percentage using cached profit_loss
        profit_percentage = None
        if profit_loss is not None:
            total_buy = self.buy_amount + self.buy_charges
            if total_buy > 0:
                profit_percentage = (profit_loss / total_buy) * 100
        
        # Calculate aging_days (optimized: calculate today once if needed)
        aging_days = None
        if self.status == TradeStatus.CLOSED:
            if self.buy_date and self.sell_date:
                aging_days = (self.sell_date - self.buy_date).days
        else:
            if self.buy_date:
                aging_days = (date.today() - self.buy_date).days
        
        return {
            "id": self.id,
            "symbol": self.symbol,
            "buy_date": self.buy_date.isoformat() if self.buy_date else None,
            "buy_price": self.buy_price,
            "quantity": self.quantity,
            "buy_amount": self.buy_amount,
            "buy_charges": self.buy_charges,
            "sell_date": self.sell_date.isoformat() if self.sell_date else None,
            "sell_price": self.sell_price,
            "sell_amount": self.sell_amount,
            "sell_charges": self.sell_charges,
            "industry": self.industry,
            "trader": self.trader,
            "status": self.status.value,
            "profit_loss": profit_loss,
            "profit_percentage": profit_percentage,
            "executed_via_api": self.executed_via_api,
            "buy_order_id": self.buy_order_id,
            "sell_order_id": self.sell_order_id,
            "zerodha_user_id": self.zerodha_user_id,
            "current_price": self.current_price,
            "current_quantity": self.current_quantity,
            "last_synced_at": self.last_synced_at.isoformat() if self.last_synced_at else None,
            "day_change": self.day_change,
            "day_change_percentage": self.day_change_percentage,
            "aging_days": aging_days,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

