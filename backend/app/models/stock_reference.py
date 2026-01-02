"""
Stock Reference Model - Caches static stock data (company name, industry, etc.)
"""

from sqlalchemy import Column, Integer, String, DateTime, Index
from sqlalchemy.sql import func
from app.db.database import Base


class StockReference(Base):
    """Stock reference data - caches static information about stocks"""
    
    __tablename__ = "stock_references"
    
    # Primary key
    id = Column(Integer, primary_key=True, index=True)
    
    # Stock identification
    symbol = Column(String(50), nullable=False, unique=True, index=True)
    exchange = Column(String(10), nullable=False, default="NSE")  # NSE, BSE, etc.
    
    # Company information
    company_name = Column(String(200), nullable=True)
    industry = Column(String(100), nullable=True)
    
    # Additional metadata
    sector = Column(String(100), nullable=True)
    market_cap = Column(String(50), nullable=True)  # Store as string to handle large numbers
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    
    # Composite index for faster lookups
    __table_args__ = (
        Index('idx_symbol_exchange', 'symbol', 'exchange'),
        # Index for company_name search (helps with LIKE queries)
        Index('idx_company_name', 'company_name'),
        # Index for exchange + company_name (common search pattern)
        Index('idx_exchange_company_name', 'exchange', 'company_name'),
    )
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            "id": self.id,
            "symbol": self.symbol,
            "exchange": self.exchange,
            "company_name": self.company_name,
            "industry": self.industry,
            "sector": self.sector,
            "market_cap": self.market_cap,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_synced_at": self.last_synced_at.isoformat() if self.last_synced_at else None,
        }



