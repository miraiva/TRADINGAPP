"""
Zerodha Charges Calculation
Calculates brokerage and charges for Zerodha trades based on product type (MIS or CNC)
"""

from typing import Tuple


def zerodha_intraday_charges(buy_price: float, sell_price: float, qty: int) -> float:
    """
    Calculate Zerodha charges for MIS (intraday) trades
    
    Args:
        buy_price: Buy price per share
        sell_price: Sell price per share
        qty: Quantity of shares
        
    Returns:
        Total charges rounded to 2 decimal places
    """
    buy_turnover = buy_price * qty
    sell_turnover = sell_price * qty
    turnover = buy_turnover + sell_turnover

    brokerage = min(0.0003 * turnover, 20)
    stt = 0.00025 * sell_turnover
    exchange = 0.0000345 * turnover
    sebi = 0.000001 * turnover
    stamp = 0.00003 * buy_turnover
    gst = 0.18 * (brokerage + exchange + sebi)

    total = brokerage + stt + exchange + sebi + stamp + gst
    return round(total, 2)


def zerodha_delivery_charges(buy_price: float, sell_price: float, qty: int) -> float:
    """
    Calculate Zerodha charges for CNC (delivery) trades
    
    Args:
        buy_price: Buy price per share
        sell_price: Sell price per share
        qty: Quantity of shares
        
    Returns:
        Total charges rounded to 2 decimal places
    """
    buy_turnover = buy_price * qty
    sell_turnover = sell_price * qty
    turnover = buy_turnover + sell_turnover

    stt = 0.001 * turnover
    exchange = 0.0000345 * turnover
    sebi = 0.000001 * turnover
    stamp = 0.00015 * buy_turnover
    gst = 0.18 * (exchange + sebi)

    total = stt + exchange + sebi + stamp + gst
    return round(total, 2)


def calculate_buy_charges(buy_price: float, qty: int, product: str = "CNC") -> float:
    """
    Calculate buy charges for a trade (approximate, since sell price is unknown)
    
    Args:
        buy_price: Buy price per share
        qty: Quantity of shares
        product: Product type ("MIS" or "CNC"), defaults to "CNC"
        
    Returns:
        Buy charges rounded to 2 decimal places
        
    Note:
        Since we don't know the sell price at buy time, we approximate by using
        buy_price for both buy and sell, then take approximately half the total charges.
        This is an approximation and will be more accurate when the trade is sold.
    """
    # Use buy_price for both buy and sell to approximate total charges
    # Then split approximately 50/50 (this is an approximation)
    if product.upper() == "MIS":
        total_charges = zerodha_intraday_charges(buy_price, buy_price, qty)
    else:  # CNC
        total_charges = zerodha_delivery_charges(buy_price, buy_price, qty)
    
    # Split charges approximately 50/50 between buy and sell
    # Note: This is an approximation. Actual split depends on sell price
    return round(total_charges / 2, 2)


def calculate_sell_charges(buy_price: float, sell_price: float, qty: int, product: str = "CNC", buy_charges: float = 0.0) -> float:
    """
    Calculate sell charges for a trade
    
    Args:
        buy_price: Buy price per share
        sell_price: Sell price per share
        qty: Quantity of shares
        product: Product type ("MIS" or "CNC"), defaults to "CNC"
        buy_charges: Previously calculated buy charges (optional, for more accurate split)
        
    Returns:
        Sell charges rounded to 2 decimal places
        
    Note:
        Calculates total round-trip charges and subtracts buy_charges to get sell_charges.
        If buy_charges is 0 or not provided, splits total charges approximately 50/50.
    """
    # Calculate total round-trip charges
    if product.upper() == "MIS":
        total_charges = zerodha_intraday_charges(buy_price, sell_price, qty)
    else:  # CNC
        total_charges = zerodha_delivery_charges(buy_price, sell_price, qty)
    
    # If we have buy_charges, subtract them to get sell_charges
    # Otherwise, split approximately 50/50
    if buy_charges > 0:
        sell_charges = total_charges - buy_charges
        # Ensure sell_charges is not negative (shouldn't happen, but safety check)
        if sell_charges < 0:
            sell_charges = round(total_charges / 2, 2)
    else:
        sell_charges = round(total_charges / 2, 2)
    
    return round(sell_charges, 2)


def calculate_total_charges(buy_price: float, sell_price: float, qty: int, product: str = "CNC") -> Tuple[float, float]:
    """
    Calculate both buy and sell charges for a complete trade
    
    Args:
        buy_price: Buy price per share
        sell_price: Sell price per share
        qty: Quantity of shares
        product: Product type ("MIS" or "CNC"), defaults to "CNC"
        
    Returns:
        Tuple of (buy_charges, sell_charges)
    """
    buy_charges = calculate_buy_charges(buy_price, qty, product)
    sell_charges = calculate_sell_charges(buy_price, sell_price, qty, product)
    
    return buy_charges, sell_charges

