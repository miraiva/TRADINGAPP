"""
Snapshot Symbol Price Model - Stores LTP for each symbol at snapshot time
This table gets overridden every time a snapshot is taken (auto or manual)
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.database import Base


class SnapshotSymbolPrice(Base):
    """Snapshot symbol price model - stores LTP for each symbol at snapshot time"""
    
    __tablename__ = "snapshot_symbol_prices"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Symbol and price
    symbol = Column(String(50), nullable=False, index=True)
    ltp = Column(Float, nullable=False)  # Last Traded Price at snapshot time
    
    # Timestamp
    snapshot_taken_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            "id": self.id,
            "symbol": self.symbol,
            "ltp": self.ltp,
            "snapshot_taken_at": self.snapshot_taken_at.isoformat() if self.snapshot_taken_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

