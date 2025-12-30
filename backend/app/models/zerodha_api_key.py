"""
Zerodha API Key Model
Stores API keys and secrets per user for Zerodha authentication
"""

from sqlalchemy import Column, Integer, String, DateTime, Boolean
from sqlalchemy.sql import func
from app.db.database import Base


class ZerodhaApiKey(Base):
    __tablename__ = "zerodha_api_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    zerodha_user_id = Column(String(50), nullable=False, unique=True, index=True)
    api_key = Column(String(200), nullable=False)
    api_secret = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        return {
            "id": self.id,
            "zerodha_user_id": self.zerodha_user_id,
            "api_key": self.api_key,
            "api_secret": "***" if self.api_secret else None,  # Don't expose secret in responses
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

