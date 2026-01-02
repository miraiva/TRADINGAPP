"""
Portfolio Snapshot Service - Calculate and create portfolio snapshots
"""

from sqlalchemy.orm import Session
from datetime import date, datetime, timezone
from typing import List, Optional, Dict, Any
from app.models.trade import Trade, TradeStatus
from app.models.payin import Payin
from app.models.portfolio_snapshot import PortfolioSnapshot
from app.models.snapshot_symbol_price import SnapshotSymbolPrice
import logging

logger = logging.getLogger(__name__)


def calculate_portfolio_metrics(
    db: Session,
    snapshot_date: date,
    zerodha_user_id: Optional[str] = None,
    account_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Calculate portfolio metrics for a given date and account(s)
    
    Args:
        db: Database session
        snapshot_date: Date for which to calculate metrics
        zerodha_user_id: Single account ID (for backward compatibility)
        account_ids: List of account IDs (for OVERALL view or multiple accounts)
    
    Returns:
        Dictionary with calculated metrics
    """
    # Determine which account IDs to use
    if account_ids:
        target_account_ids = account_ids
        logger.info(f"Snapshot calculation using account_ids: {target_account_ids}")
    elif zerodha_user_id:
        target_account_ids = [zerodha_user_id]
        logger.info(f"Snapshot calculation using zerodha_user_id: {zerodha_user_id}")
    else:
        target_account_ids = []
        logger.warning("Snapshot calculation: No account IDs provided!")
    
    # Get all payins up to and including snapshot_date
    payin_query = db.query(Payin).filter(Payin.payin_date <= snapshot_date)
    if target_account_ids:
        payin_query = payin_query.filter(Payin.zerodha_user_id.in_(target_account_ids))
    
    payins = payin_query.all()
    total_payin = sum(p.amount for p in payins) if payins else 0
    total_shares = sum(p.number_of_shares or 0 for p in payins)
    logger.info(f"Snapshot calculation: Found {len(payins)} payins, total_payin: {total_payin}")
    
    # Get all trades up to and including snapshot_date
    trade_query = db.query(Trade).filter(Trade.buy_date <= snapshot_date)
    if target_account_ids:
        trade_query = trade_query.filter(Trade.zerodha_user_id.in_(target_account_ids))
    
    trades = trade_query.all()
    logger.info(f"Snapshot calculation: Found {len(trades)} trades for date {snapshot_date}")
    
    # Calculate booked P/L from closed trades (sold before or on snapshot_date)
    booked_pl = 0
    closed_trade_count = 0
    for trade in trades:
        if trade.status == TradeStatus.CLOSED and trade.sell_date and trade.sell_date <= snapshot_date:
            pl = trade.calculate_profit_loss()
            if pl is not None:
                booked_pl += pl
                closed_trade_count += 1
    logger.info(f"Snapshot calculation: Booked P/L from {closed_trade_count} closed trades: {booked_pl}")
    
    # Calculate float P/L from open trades
    # Use the trade's calculate_profit_loss() method to match dashboard logic
    float_pl = 0
    open_positions = 0
    open_trade_count = 0
    for trade in trades:
        if trade.status == TradeStatus.OPEN:
            # Calculate invested amount (buy_price * quantity) to match dashboard
            # Dashboard uses: (t.buy_price || 0) * (t.quantity || 0)
            invested_amount = (trade.buy_price or 0) * (trade.quantity or 0)
            open_positions += invested_amount
            open_trade_count += 1
            
            # Calculate float P/L using trade's calculate_profit_loss() method
            # This matches the dashboard calculation exactly
            pl = trade.calculate_profit_loss()
            if pl is not None:
                float_pl += pl
    logger.info(f"Snapshot calculation: Float P/L from {open_trade_count} open trades: {float_pl}, Open positions: {open_positions}")
    
    # Total Portfolio = Payin + Booked P/L + Float P/L
    total_portfolio = total_payin + booked_pl + float_pl
    
    # NAV = Total Portfolio / Total Shares (if shares exist, otherwise use Total Portfolio)
    nav = total_portfolio / total_shares if total_shares > 0 else total_portfolio
    
    # Balance = Payin + Booked P/L - Open Positions
    balance = total_payin + booked_pl - open_positions
    
    # Utilisation % = (Open Positions / (Payin + Booked Profit)) * 100
    # Only positive booked profit counts as available capital
    available_capital = total_payin + max(0, booked_pl)
    utilisation_percent = (open_positions / available_capital * 100) if available_capital > 0 else 0
    
    # XIRR calculation - use proper XIRR with cash flow dates
    # Import XIRR calculation function
    try:
        from app.utils.xirr import calculate_portfolio_xirr
        
        xirr = None
        if payins and total_portfolio > 0:
            # Calculate XIRR using payin dates and current portfolio value
            # Convert payins to list of dicts with date and amount
            payin_list = []
            for payin in payins:
                if payin.payin_date and payin.amount:
                    payin_list.append({
                        'payin_date': payin.payin_date,
                        'amount': payin.amount
                    })
            
            if payin_list:
                try:
                    xirr = calculate_portfolio_xirr(payin_list, total_portfolio, snapshot_date)
                    if xirr is None:
                        # Fallback to simple return percentage
                        xirr = ((booked_pl + float_pl) / total_payin * 100) if total_payin > 0 else 0
                except Exception as e:
                    logger.warning(f"Error calculating XIRR: {e}")
                    # Fallback to simple return percentage
                    xirr = ((booked_pl + float_pl) / total_payin * 100) if total_payin > 0 else 0
            else:
                # Fallback: if no payins with dates, use simple return calculation
                xirr = ((booked_pl + float_pl) / total_payin * 100) if total_payin > 0 else 0
        elif total_payin > 0:
            # Fallback: simple return percentage
            xirr = ((booked_pl + float_pl) / total_payin) * 100
        else:
            xirr = 0
    except ImportError:
        # If XIRR module not available, use simple return percentage
        logger.warning("XIRR module not available, using simple return calculation")
        xirr = ((booked_pl + float_pl) / total_payin * 100) if total_payin > 0 else 0
    
    # Absolute Profit % = ((Total Portfolio - Payin) / Payin) × 100
    absolute_profit_percent = ((total_portfolio - total_payin) / total_payin * 100) if total_payin > 0 else 0
    
    return {
        "nav": nav,
        "portfolio_value": total_portfolio,
        "total_payin": total_payin,
        "booked_pl": booked_pl,
        "float_pl": float_pl,
        "open_positions": open_positions,
        "balance": balance,
        "utilisation_percent": utilisation_percent,
        "xirr": xirr,
        "absolute_profit_percent": absolute_profit_percent,
    }


def _store_symbol_ltps(db: Session, snapshot_taken_at: datetime):
    """
    Store LTP for all unique symbols from open trades (overall, swing, long term)
    This table gets overridden every time a snapshot is taken
    
    Optimized to use bulk operations instead of individual inserts
    
    Args:
        db: Database session
        snapshot_taken_at: Timestamp when snapshot was taken
    """
    try:
        # Optimized: Use SQL aggregation to get unique symbols with latest price
        # This avoids loading all trades into memory
        from sqlalchemy import func, distinct
        
        # Get unique symbols with their current_price (LTP) using SQL aggregation
        # Use MAX to get the latest price if multiple trades exist for same symbol
        symbol_price_results = db.query(
            Trade.symbol,
            func.max(Trade.current_price).label('max_price')
        ).filter(
            Trade.status == TradeStatus.OPEN,
            Trade.symbol.isnot(None),
            Trade.current_price.isnot(None),
            Trade.current_price > 0
        ).group_by(Trade.symbol).all()
        
        # Build symbol_ltp_map from results
        symbol_ltp_map = {}
        for symbol, max_price in symbol_price_results:
            symbol_upper = symbol.upper() if symbol else None
            if symbol_upper and max_price:
                symbol_ltp_map[symbol_upper] = max_price
        
        logger.info(f"Storing LTPs for {len(symbol_ltp_map)} unique symbols at snapshot time {snapshot_taken_at}")
        
        # Delete all existing entries (override the table) - single operation
        db.query(SnapshotSymbolPrice).delete()
        logger.info("Cleared existing snapshot symbol prices")
        
        # Bulk insert new entries - batch insert (compatible with all SQLAlchemy versions)
        if symbol_ltp_map:
            symbol_prices = [
                SnapshotSymbolPrice(
                    symbol=symbol,
                    ltp=ltp,
                    snapshot_taken_at=snapshot_taken_at
                )
                for symbol, ltp in symbol_ltp_map.items()
            ]
            # Add all objects at once (more efficient than individual adds)
            db.add_all(symbol_prices)
        
        db.commit()
        logger.info(f"Stored {len(symbol_ltp_map)} symbol LTPs in snapshot_symbol_prices table")
        
    except Exception as e:
        logger.error(f"Error storing symbol LTPs: {e}", exc_info=True)
        db.rollback()
        raise


def create_snapshot(
    db: Session,
    snapshot_date: date,
    zerodha_user_id: Optional[str] = None,
    trading_strategy: Optional[str] = None,
    account_ids: Optional[List[str]] = None
) -> PortfolioSnapshot:
    """
    Create a portfolio snapshot for a given date
    
    Args:
        db: Database session
        snapshot_date: Date for the snapshot
        zerodha_user_id: Single account ID (optional)
        trading_strategy: 'SWING', 'LONG_TERM', or 'OVERALL' (optional)
        account_ids: List of account IDs (for OVERALL view)
    
    Returns:
        Created PortfolioSnapshot object
    """
    # Calculate metrics
    metrics = calculate_portfolio_metrics(
        db=db,
        snapshot_date=snapshot_date,
        zerodha_user_id=zerodha_user_id,
        account_ids=account_ids
    )
    
    # Check if snapshot already exists for this date and account/strategy
    existing_query = db.query(PortfolioSnapshot).filter(
        PortfolioSnapshot.snapshot_date == snapshot_date
    )
    
    if zerodha_user_id:
        # For individual account snapshots, match by user_id and strategy
        existing_query = existing_query.filter(PortfolioSnapshot.zerodha_user_id == zerodha_user_id)
        if trading_strategy:
            existing_query = existing_query.filter(PortfolioSnapshot.trading_strategy == trading_strategy)
    elif trading_strategy:
        # For strategy-level snapshots (SWING/LONG_TERM/OVERALL), match by strategy only
        # and ensure zerodha_user_id is NULL (aggregated snapshot)
        existing_query = existing_query.filter(
            PortfolioSnapshot.trading_strategy == trading_strategy,
            PortfolioSnapshot.zerodha_user_id.is_(None)
        )
    
    existing = existing_query.first()
    
    # Store symbol LTPs - this happens for every snapshot (overrides previous data)
    snapshot_taken_at = datetime.now(timezone.utc)
    _store_symbol_ltps(db, snapshot_taken_at)
    
    if existing:
        # Update existing snapshot
        existing.nav = metrics["nav"]
        existing.portfolio_value = metrics["portfolio_value"]
        existing.total_payin = metrics["total_payin"]
        existing.booked_pl = metrics["booked_pl"]
        existing.float_pl = metrics["float_pl"]
        existing.open_positions = metrics["open_positions"]
        existing.balance = metrics["balance"]
        existing.utilisation_percent = metrics["utilisation_percent"]
        existing.xirr = metrics["xirr"]
        existing.absolute_profit_percent = metrics["absolute_profit_percent"]
        db.commit()
        db.refresh(existing)
        logger.info(f"Updated snapshot for {snapshot_date} - {zerodha_user_id or trading_strategy}")
        return existing
    else:
        # Create new snapshot
        snapshot = PortfolioSnapshot(
            snapshot_date=snapshot_date,
            nav=metrics["nav"],
            portfolio_value=metrics["portfolio_value"],
            total_payin=metrics["total_payin"],
            booked_pl=metrics["booked_pl"],
            float_pl=metrics["float_pl"],
            open_positions=metrics["open_positions"],
            balance=metrics["balance"],
            utilisation_percent=metrics["utilisation_percent"],
            xirr=metrics["xirr"],
            absolute_profit_percent=metrics["absolute_profit_percent"],
            zerodha_user_id=zerodha_user_id,
            trading_strategy=trading_strategy
        )
        db.add(snapshot)
        db.commit()
        db.refresh(snapshot)
        logger.info(f"Created snapshot for {snapshot_date} - {zerodha_user_id or trading_strategy}")
        return snapshot

