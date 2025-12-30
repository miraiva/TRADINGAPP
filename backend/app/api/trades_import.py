"""
Trade Import Functions
Helper functions for importing trades from JSON/Excel files
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime
import json
import pandas as pd
from io import BytesIO
import logging

from app.models.trade import Trade, TradeStatus

logger = logging.getLogger(__name__)


def parse_excel_file(file_content: bytes) -> List[Dict[str, Any]]:
    """Parse Excel file and convert to list of dictionaries"""
    try:
        df = pd.read_excel(BytesIO(file_content), engine='openpyxl')
        
        # Common column name mappings
        column_mapping = {
            'symbol': ['Symbol', 'Ticker', 'SYMBOL', 'TICKER', 'Stock', 'STOCK'],
            'exchange': ['Exchange', 'EXCHANGE', 'Market', 'MARKET'],
            'buy_date': ['Buy Date', 'Purchase Date', 'Buy_Date', 'Purchase_Date', 'Date', 'DATE', 'BuyDate', 'PurchaseDate'],
            'buy_price': ['Buy Price', 'Purchase Price', 'Buy_Price', 'Purchase_Price', 'Price', 'PRICE', 'BuyPrice', 'PurchasePrice'],
            'quantity': ['Quantity', 'Qty', 'QTY', 'Shares', 'SHARES', 'Quantity Bought'],
            'buy_charges': ['Buy Charges', 'Buy_Charges', 'Charges', 'CHARGES', 'Brokerage', 'BROKERAGE'],
            'buy_amount': ['Buy Amount', 'Buy_Amount', 'Total Buy', 'Total_Buy', 'Amount', 'AMOUNT'],
            'buy_order_id': ['Buy Order ID', 'Buy_Order_ID', 'Order ID', 'Order_ID', 'BuyOrderID'],
            'sell_date': ['Sell Date', 'Sale Date', 'Sell_Date', 'Sale_Date', 'SellDate', 'SaleDate'],
            'sell_price': ['Sell Price', 'Sale Price', 'Sell_Price', 'Sale_Price', 'SellPrice', 'SalePrice'],
            'quantity_sold': ['Quantity Sold', 'Quantity_Sold', 'Qty Sold', 'Qty_Sold', 'Shares Sold'],
            'sell_charges': ['Sell Charges', 'Sell_Charges', 'Sell Charges', 'SellCharges'],
            'sell_amount': ['Sell Amount', 'Sell_Amount', 'Total Sell', 'Total_Sell'],
            'sell_order_id': ['Sell Order ID', 'Sell_Order_ID', 'SellOrderID'],
            'status': ['Status', 'STATUS', 'Trade Status', 'Trade_Status'],
            'industry': ['Industry', 'INDUSTRY', 'Sector', 'SECTOR'],
            'trader': ['Trader', 'TRADER', 'Name', 'NAME'],
            'notes': ['Notes', 'NOTES', 'Remarks', 'REMARKS', 'Comments', 'COMMENTS']
        }
        
        # Normalize column names
        df.columns = df.columns.str.strip().str.replace(' ', '_').str.replace('-', '_')
        
        result = []
        for _, row in df.iterrows():
            trade_dict = {}
            
            for target_field, possible_names in column_mapping.items():
                value = None
                for name in possible_names:
                    if name in df.columns:
                        value = row[name]
                        break
                    normalized_name = name.lower().replace(' ', '_').replace('-', '_')
                    if normalized_name in df.columns:
                        value = row[normalized_name]
                        break
                
                if value is not None and pd.notna(value):
                    trade_dict[target_field] = value
            
            if 'symbol' in trade_dict and 'buy_date' in trade_dict and 'buy_price' in trade_dict and 'quantity' in trade_dict:
                result.append(trade_dict)
        
        return result
    except Exception as e:
        logger.error(f"Error parsing Excel file: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {str(e)}")


def parse_json_file(file_content: bytes) -> List[Dict[str, Any]]:
    """Parse JSON file and return list of dictionaries"""
    try:
        content = file_content.decode('utf-8')
        data = json.loads(content)
        
        if isinstance(data, dict):
            data = [data]
        elif not isinstance(data, list):
            raise ValueError("JSON must be an array or object")
        
        return data
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON format: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse JSON file: {str(e)}")


def validate_trade_data(trade_dict: Dict[str, Any], row_num: int) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate and normalize trade data"""
    try:
        if 'symbol' not in trade_dict or not trade_dict['symbol']:
            return None, "Missing required field: symbol"
        
        if 'buy_date' not in trade_dict:
            return None, "Missing required field: buy_date"
        
        if 'buy_price' not in trade_dict:
            return None, "Missing required field: buy_price"
        
        if 'quantity' not in trade_dict:
            return None, "Missing required field: quantity"
        
        if 'status' not in trade_dict:
            return None, "Missing required field: status"
        
        normalized = {
            'symbol': str(trade_dict['symbol']).upper().strip(),
            'exchange': str(trade_dict.get('exchange', 'NSE')).upper().strip(),
            'buy_date': trade_dict['buy_date'],
            'buy_price': float(trade_dict['buy_price']),
            'quantity': int(trade_dict['quantity']),
            'buy_charges': float(trade_dict.get('buy_charges', 0.0)),
            'buy_order_id': trade_dict.get('buy_order_id'),
            'status': str(trade_dict['status']).upper().strip(),
            'industry': trade_dict.get('industry'),
            'trader': trade_dict.get('trader'),
            'zerodha_user_id': trade_dict.get('zerodha_user_id'),
            'executed_via_api': trade_dict.get('executed_via_api'),
            'notes': trade_dict.get('notes')
        }
        
        if normalized['status'] not in ['OPEN', 'CLOSED']:
            return None, f"Invalid status: {normalized['status']}. Must be OPEN or CLOSED"
        
        try:
            if isinstance(normalized['buy_date'], str):
                normalized['buy_date'] = datetime.strptime(normalized['buy_date'], '%Y-%m-%d').date()
            elif isinstance(normalized['buy_date'], datetime):
                normalized['buy_date'] = normalized['buy_date'].date()
        except Exception as e:
            return None, f"Invalid buy_date format: {str(e)}"
        
        if 'buy_amount' not in trade_dict or not trade_dict.get('buy_amount'):
            normalized['buy_amount'] = normalized['buy_price'] * normalized['quantity']
        else:
            normalized['buy_amount'] = float(trade_dict['buy_amount'])
        
        if normalized['status'] == 'CLOSED':
            if 'sell_date' not in trade_dict or not trade_dict.get('sell_date'):
                return None, "Missing required field: sell_date for CLOSED trade"
            
            if 'sell_price' not in trade_dict or not trade_dict.get('sell_price'):
                return None, "Missing required field: sell_price for CLOSED trade"
            
            try:
                if isinstance(trade_dict['sell_date'], str):
                    normalized['sell_date'] = datetime.strptime(trade_dict['sell_date'], '%Y-%m-%d').date()
                elif isinstance(trade_dict['sell_date'], datetime):
                    normalized['sell_date'] = trade_dict['sell_date'].date()
            except Exception as e:
                return None, f"Invalid sell_date format: {str(e)}"
            
            normalized['sell_price'] = float(trade_dict['sell_price'])
            normalized['quantity_sold'] = int(trade_dict.get('quantity_sold', normalized['quantity']))
            normalized['sell_charges'] = float(trade_dict.get('sell_charges', 0.0))
            normalized['sell_order_id'] = trade_dict.get('sell_order_id')
            
            if 'sell_amount' not in trade_dict or not trade_dict.get('sell_amount'):
                normalized['sell_amount'] = normalized['sell_price'] * normalized['quantity_sold']
            else:
                normalized['sell_amount'] = float(trade_dict['sell_amount'])
        else:
            normalized['sell_date'] = None
            normalized['sell_price'] = None
            normalized['quantity_sold'] = None
            normalized['sell_charges'] = 0.0
            normalized['sell_amount'] = None
            normalized['sell_order_id'] = None
            normalized['current_price'] = trade_dict.get('current_price')
        
        if normalized['buy_price'] <= 0:
            return None, "buy_price must be greater than 0"
        
        if normalized['quantity'] <= 0:
            return None, "quantity must be greater than 0"
        
        if normalized['status'] == 'CLOSED' and normalized['sell_price'] <= 0:
            return None, "sell_price must be greater than 0"
        
        return normalized, None
        
    except ValueError as e:
        return None, f"Invalid data type: {str(e)}"
    except Exception as e:
        return None, f"Validation error: {str(e)}"


def is_duplicate_trade(db: Session, trade_data: Dict[str, Any]) -> bool:
    """
    Check if a trade already exists based on order_id
    Only considers trades as duplicates if they have the same buy_order_id
    """
    # If no order_id provided, don't consider it a duplicate (allow manual entries)
    if not trade_data.get('buy_order_id'):
        return False
    
    # Check if a trade with the same order_id already exists
    existing = db.query(Trade).filter(
        Trade.buy_order_id == trade_data['buy_order_id'],
        Trade.buy_order_id.isnot(None)
    ).first()
    
    return existing is not None

