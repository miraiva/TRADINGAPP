"""
XIRR (Extended Internal Rate of Return) calculation for Python
Matches the JavaScript implementation in frontend/src/utils/xirr.js
"""

from datetime import date, datetime
from typing import List, Dict, Optional
from math import isnan, isfinite
import logging

logger = logging.getLogger(__name__)


def calculate_xirr(cash_flows: List[float], dates: List[date], guess: float = 0.1) -> Optional[float]:
    """
    Calculate XIRR (Extended Internal Rate of Return)
    
    Args:
        cash_flows: List of cash flow amounts (negative for investments, positive for returns)
        dates: List of dates corresponding to each cash flow
        guess: Initial guess for the rate (default: 0.1 = 10%)
    
    Returns:
        Annualized return rate as a decimal (e.g., 0.15 = 15%), or None if calculation fails
    """
    if not cash_flows or not dates or len(cash_flows) != len(dates):
        return None
    
    if len(cash_flows) < 2:
        return None  # Need at least 2 cash flows
    
    # Convert dates to date objects if they're datetime objects
    date_objects = []
    for d in dates:
        if isinstance(d, datetime):
            date_objects.append(d.date())
        elif isinstance(d, date):
            date_objects.append(d)
        elif isinstance(d, str):
            try:
                date_objects.append(datetime.fromisoformat(d.replace('Z', '+00:00')).date())
            except:
                return None
        else:
            return None
    
    # Get the first date (reference date)
    first_date = min(date_objects)
    
    # Helper function to calculate days between two dates
    def days_between(d1: date, d2: date) -> float:
        return (d2 - d1).days
    
    # Calculate the present value of cash flows for a given rate
    def present_value(rate: float) -> float:
        pv = 0.0
        for i, cf in enumerate(cash_flows):
            days = days_between(first_date, date_objects[i])
            years = days / 365.0
            pv += cf / ((1 + rate) ** years)
        return pv
    
    # Calculate the derivative of present value (for Newton-Raphson)
    def present_value_derivative(rate: float) -> float:
        pvd = 0.0
        for i, cf in enumerate(cash_flows):
            days = days_between(first_date, date_objects[i])
            years = days / 365.0
            pvd -= (years * cf) / ((1 + rate) ** (years + 1))
        return pvd
    
    # Newton-Raphson method to find the root
    rate = guess
    max_iterations = 100
    tolerance = 1e-6
    
    for i in range(max_iterations):
        pv = present_value(rate)
        pvd = present_value_derivative(rate)
        
        if abs(pv) < tolerance:
            return rate  # Found the solution
        
        if abs(pvd) < tolerance:
            # Derivative is too small, try a different approach
            break
        
        new_rate = rate - pv / pvd
        
        # Prevent negative rates or rates that are too large
        if new_rate < -0.99 or new_rate > 10:
            break
        
        # Check for convergence
        if abs(new_rate - rate) < tolerance:
            return new_rate
        
        rate = new_rate
    
    # If Newton-Raphson didn't converge, try bisection method
    low = -0.99
    high = 10.0
    mid = None
    
    for i in range(max_iterations):
        mid = (low + high) / 2
        pv = present_value(mid)
        
        if abs(pv) < tolerance:
            return mid
        
        if pv > 0:
            low = mid
        else:
            high = mid
        
        if high - low < tolerance:
            return mid
    
    return None  # Could not find a solution


def calculate_portfolio_xirr(
    payins: List[Dict],
    current_value: float,
    current_date: Optional[date] = None
) -> Optional[float]:
    """
    Calculate XIRR for a portfolio given payins and current portfolio value
    
    Args:
        payins: List of payin dictionaries with 'payin_date' and 'amount' keys
        current_value: Current portfolio value (total portfolio)
        current_date: Current date (defaults to today)
    
    Returns:
        XIRR as a percentage (e.g., 15.5 for 15.5%), or None if calculation fails
    """
    if not payins or len(payins) == 0:
        return None
    
    if current_date is None:
        current_date = date.today()
    
    # Create cash flows array
    # Payins are negative (money going out)
    cash_flows = []
    dates = []
    
    for payin in payins:
        amount = payin.get('amount') if isinstance(payin, dict) else (payin.amount if hasattr(payin, 'amount') else None)
        payin_date = payin.get('payin_date') if isinstance(payin, dict) else (payin.payin_date if hasattr(payin, 'payin_date') else None)
        
        if amount and payin_date:
            # Convert date if needed
            if isinstance(payin_date, str):
                try:
                    payin_date = datetime.fromisoformat(payin_date.replace('Z', '+00:00')).date()
                except:
                    continue
            elif isinstance(payin_date, datetime):
                payin_date = payin_date.date()
            elif not isinstance(payin_date, date):
                continue
            
            cash_flows.append(-float(amount))  # Negative for investments
            dates.append(payin_date)
    
    # Current portfolio value is positive (money coming in)
    cash_flows.append(float(current_value))
    dates.append(current_date)
    
    # Filter out any invalid cash flows or dates
    valid_cash_flows = []
    valid_dates = []
    for i, cf in enumerate(cash_flows):
        if i < len(dates) and dates[i] and not (isinstance(cf, float) and (isnan(cf) or not isfinite(cf))):
            valid_cash_flows.append(cf)
            valid_dates.append(dates[i])
    
    if len(valid_cash_flows) < 2:
        return None  # Need at least 2 valid cash flows
    
    # Calculate XIRR
    xirr_rate = calculate_xirr(valid_cash_flows, valid_dates)
    
    if xirr_rate is None:
        return None
    
    if isnan(xirr_rate) or not isfinite(xirr_rate):
        return None
    
    # Convert to percentage
    return xirr_rate * 100

