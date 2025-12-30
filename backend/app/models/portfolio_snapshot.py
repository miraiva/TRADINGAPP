"""
Portfolio Snapshot Model - Represents end-of-day portfolio snapshots
"""

from sqlalchemy import Column, Integer, String, Float, Date, DateTime
from sqlalchemy.sql import func
from app.db.database import Base


class PortfolioSnapshot(Base):
    """Portfolio snapshot model - represents an end-of-day portfolio snapshot"""
    
    __tablename__ = "portfolio_snapshots"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Snapshot details
    snapshot_date = Column(Date, nullable=False, index=True)
    nav = Column(Float, nullable=True)  # Net Asset Value
    portfolio_value = Column(Float, nullable=False)  # Total Portfolio Value
    total_payin = Column(Float, nullable=False)  # Total invested amount
    booked_pl = Column(Float, nullable=False, default=0.0)  # Booked Profit/Loss
    float_pl = Column(Float, nullable=False, default=0.0)  # Float Profit/Loss
    open_positions = Column(Float, nullable=False, default=0.0)  # Invested in open positions
    balance = Column(Float, nullable=False, default=0.0)  # Available balance
    utilisation_percent = Column(Float, nullable=True)  # Utilisation percentage
    xirr = Column(Float, nullable=True)  # XIRR percentage
    absolute_profit_percent = Column(Float, nullable=True)  # Absolute profit percentage
    
    # Account and strategy
    zerodha_user_id = Column(String(50), nullable=True, index=True)  # Zerodha account user ID
    trading_strategy = Column(String(20), nullable=True, index=True)  # 'SWING' or 'LONG_TERM' or 'OVERALL'
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        """Convert snapshot to dictionary"""
        return {
            "id": self.id,
            "snapshot_date": self.snapshot_date.isoformat() if self.snapshot_date else None,
            "nav": self.nav,
            "portfolio_value": self.portfolio_value,
            "total_payin": self.total_payin,
            "booked_pl": self.booked_pl,
            "float_pl": self.float_pl,
            "open_positions": self.open_positions,
            "balance": self.balance,
            "utilisation_percent": self.utilisation_percent,
            "xirr": self.xirr,
            "absolute_profit_percent": self.absolute_profit_percent,
            "zerodha_user_id": self.zerodha_user_id,
            "trading_strategy": self.trading_strategy,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

