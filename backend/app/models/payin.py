"""
Payin Model - Represents fund deposits into trading account
"""

from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Text, Index
from sqlalchemy.sql import func
from app.db.database import Base


class Payin(Base):
    """Payin model - represents a fund deposit"""
    
    __tablename__ = "payins"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Payin details
    payin_date = Column(Date, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    paid_by = Column(String(100), nullable=True)
    nav = Column(Float, nullable=True)  # NAV on the payin date
    number_of_shares = Column(Float, nullable=True)  # Calculated as amount/NAV
    description = Column(Text, nullable=True)  # Comments/Notes
    zerodha_user_id = Column(String(50), nullable=True, index=True)  # Zerodha account user ID
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Composite index for filtering by zerodha_user_id and ordering by payin_date
    __table_args__ = (
        Index('idx_zerodha_user_payin_date', 'zerodha_user_id', 'payin_date'),
    )
    
    def to_dict(self):
        """Convert payin to dictionary"""
        return {
            "id": self.id,
            "payin_date": self.payin_date.isoformat() if self.payin_date else None,
            "amount": self.amount,
            "paid_by": self.paid_by,
            "nav": self.nav,
            "number_of_shares": self.number_of_shares,
            "description": self.description,
            "zerodha_user_id": self.zerodha_user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

