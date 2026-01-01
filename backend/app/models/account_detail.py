"""
Account Detail Model
Stores account metadata like user_name, account_type, trading_strategy per user
"""

from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.db.database import Base


class AccountDetail(Base):
    """Account detail model - stores account metadata per user"""
    
    __tablename__ = "account_details"
    
    id = Column(Integer, primary_key=True, index=True)
    zerodha_user_id = Column(String(50), nullable=False, unique=True, index=True)
    user_name = Column(String(200), nullable=True)
    account_type = Column(String(50), nullable=True, default='TRADING_ONLY')  # MAIN, TRADING_ONLY
    trading_strategy = Column(String(20), nullable=True, default='SWING')  # SWING, LONG_TERM
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        """Convert account detail to dictionary"""
        return {
            "id": self.id,
            "zerodha_user_id": self.zerodha_user_id,
            "user_name": self.user_name,
            "account_type": self.account_type,
            "trading_strategy": self.trading_strategy,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

