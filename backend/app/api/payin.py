"""
Payin API endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from datetime import date, datetime
import logging
import json
import pandas as pd
from io import BytesIO

from app.db.database import get_db
from app.models.payin import Payin
from app.models.trade import Trade, TradeStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payins", tags=["payin"])


class PayinRequest(BaseModel):
    payin_date: date
    amount: float
    paid_by: str = None
    nav: float = None
    number_of_shares: float = None
    description: str = None
    zerodha_user_id: str = None


class PayinResponse(BaseModel):
    id: int
    payin_date: date
    amount: float
    paid_by: Optional[str] = None
    nav: Optional[float] = None
    number_of_shares: Optional[float] = None
    description: Optional[str] = None
    zerodha_user_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class ImportResult(BaseModel):
    total_rows: int
    imported: int
    failed: int
    skipped: int
    errors: List[Dict[str, Any]]
    duplicates: List[Dict[str, Any]]


@router.post("/", response_model=PayinResponse)
async def create_payin(payin_data: PayinRequest, db: Session = Depends(get_db)):
    """Create a new payin record"""
    try:
        payin = Payin(
            payin_date=payin_data.payin_date,
            amount=payin_data.amount,
            paid_by=payin_data.paid_by,
            nav=payin_data.nav,
            number_of_shares=payin_data.number_of_shares,
            description=payin_data.description,
            zerodha_user_id=payin_data.zerodha_user_id
        )
        
        db.add(payin)
        db.commit()
        db.refresh(payin)
        
        logger.info(f"Created payin: {payin.id} - {payin.amount} on {payin.payin_date}")
        
        return payin.to_dict()
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating payin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create payin: {str(e)}")


@router.get("/", response_model=List[PayinResponse])
async def get_all_payins(
    zerodha_user_id: Optional[str] = Query(None, description="Filter by Zerodha user ID"),
    db: Session = Depends(get_db)
):
    """Get all payin records"""
    try:
        query = db.query(Payin)
        
        if zerodha_user_id:
            query = query.filter(Payin.zerodha_user_id == zerodha_user_id)
        
        # Optimize query: use composite index idx_zerodha_user_payin_date when filtering by user_id
        # Otherwise use the payin_date index for ordering
        payins = query.order_by(Payin.payin_date.desc()).all()
        
        return [payin.to_dict() for payin in payins]
    except Exception as e:
        logger.error(f"Error fetching payins: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch payins: {str(e)}")


@router.get("/id/{payin_id}", response_model=PayinResponse)
async def get_payin(payin_id: int, db: Session = Depends(get_db)):
    """Get a specific payin by ID"""
    try:
        payin = db.query(Payin).filter(Payin.id == payin_id).first()
        
        if not payin:
            raise HTTPException(status_code=404, detail="Payin not found")
        
        return payin.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching payin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch payin: {str(e)}")


@router.delete("/id/{payin_id}")
async def delete_payin(payin_id: int, db: Session = Depends(get_db)):
    """Delete a payin record"""
    try:
        payin = db.query(Payin).filter(Payin.id == payin_id).first()
        
        if not payin:
            raise HTTPException(status_code=404, detail="Payin not found")
        
        db.delete(payin)
        db.commit()
        
        logger.info(f"Deleted payin: {payin_id}")
        
        return {"message": "Payin deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting payin: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete payin: {str(e)}")


@router.get("/calculate-nav")
async def calculate_nav(
    nav_date: date = Query(..., description="Date for which to calculate NAV"),
    zerodha_user_id: Optional[str] = Query(None, description="Filter by user ID"),
    current_payin_amount: Optional[float] = Query(None, description="Current payin amount to include in calculation"),
    db: Session = Depends(get_db)
):
    """Calculate NAV (Net Asset Value) for a specific date"""
    try:
        # Get all payins up to and including the nav_date
        payin_query = db.query(Payin).filter(Payin.payin_date <= nav_date)
        if zerodha_user_id:
            payin_query = payin_query.filter(Payin.zerodha_user_id == zerodha_user_id)
        
        payins = payin_query.all()
        total_payin = sum(p.amount for p in payins) if payins else 0
        
        # Add current payin amount if provided (for new payin being added)
        if current_payin_amount and current_payin_amount > 0:
            total_payin += current_payin_amount
        
        # Get all trades up to and including the nav_date
        trade_query = db.query(Trade).filter(Trade.buy_date <= nav_date)
        if zerodha_user_id:
            trade_query = trade_query.filter(Trade.zerodha_user_id == zerodha_user_id)
        
        trades = trade_query.all()
        
        # Calculate booked P/L from closed trades
        booked_pl = 0
        for trade in trades:
            if trade.status == TradeStatus.CLOSED and trade.sell_date and trade.sell_date <= nav_date:
                pl = trade.calculate_profit_loss()
                if pl is not None:
                    booked_pl += pl
        
        # Calculate float P/L from open trades (using current prices as approximation)
        # Note: For accurate historical NAV, we'd need historical prices
        float_pl = 0
        for trade in trades:
            if trade.status == TradeStatus.OPEN:
                pl = trade.calculate_profit_loss()
                if pl is not None:
                    float_pl += pl
        
        # NAV = Total Payin + Booked P/L + Float P/L
        nav = total_payin + booked_pl + float_pl
        
        return {
            "nav_date": nav_date.isoformat(),
            "nav": nav,
            "total_payin": total_payin,
            "booked_pl": booked_pl,
            "float_pl": float_pl
        }
    except Exception as e:
        logger.error(f"Error calculating NAV: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to calculate NAV: {str(e)}")


def parse_payin_excel_file(file_content: bytes) -> List[Dict[str, Any]]:
    """Parse Excel file and convert to list of dictionaries for payins"""
    try:
        df = pd.read_excel(BytesIO(file_content), engine='openpyxl')
        
        # Common column name mappings
        column_mapping = {
            'payin_date': ['Date', 'DATE', 'Payin Date', 'Payin_Date', 'PayinDate', 'Transaction Date'],
            'amount': ['Payin', 'PAYIN', 'Amount', 'AMOUNT', 'Payin Amount', 'Payin_Amount', 'PayinAmount'],
            'paid_by': ['Paid By', 'Paid_By', 'PaidBy', 'Paid By', 'Name', 'NAME', 'Person', 'PERSON'],
            'nav': ['NAV', 'nav', 'Nav', 'Net Asset Value', 'Net_Asset_Value'],
            'number_of_shares': ['Number of Shares', 'Number_of_Shares', 'NumberOfShares', 'Shares', 'SHARES', 'No of Shares'],
            'description': ['Description', 'DESCRIPTION', 'Comments', 'COMMENTS', 'Notes', 'NOTES', 'Remarks', 'REMARKS'],
            'month': ['Month', 'MONTH']  # For reference, not stored
        }
        
        # Normalize column names
        df.columns = df.columns.str.strip().str.replace(' ', '_').str.replace('-', '_')
        
        result = []
        for _, row in df.iterrows():
            payin_dict = {}
            
            for target_field, possible_names in column_mapping.items():
                if target_field == 'month':  # Skip month, it's just for reference
                    continue
                    
                value = None
                for name in possible_names:
                    normalized_name = name.lower().replace(' ', '_').replace('-', '_')
                    if normalized_name in df.columns:
                        value = row[normalized_name]
                        break
                    elif name in df.columns:
                        value = row[name]
                        break
                
                if value is not None and pd.notna(value):
                    # Handle negative values in parentheses (accounting format)
                    if isinstance(value, str) and value.startswith('(') and value.endswith(')'):
                        value = -float(value.strip('()').replace(',', ''))
                    elif isinstance(value, str):
                        value = value.replace(',', '').strip()
                    payin_dict[target_field] = value
            
            # Parse date if it's a string
            if 'payin_date' in payin_dict:
                date_val = payin_dict['payin_date']
                if isinstance(date_val, str):
                    try:
                        # Try parsing DD-Mon format (e.g., "9-Sep")
                        if '-' in date_val and len(date_val.split('-')) == 2:
                            day, month_abbr = date_val.split('-')
                            month_map = {
                                'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                                'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
                            }
                            if month_abbr in month_map:
                                # Use current year or infer from context
                                payin_dict['payin_date'] = f"{datetime.now().year}-{month_map[month_abbr]:02d}-{int(day):02d}"
                            else:
                                payin_dict['payin_date'] = pd.to_datetime(date_val).strftime('%Y-%m-%d')
                        else:
                            payin_dict['payin_date'] = pd.to_datetime(date_val).strftime('%Y-%m-%d')
                    except:
                        logger.warning(f"Could not parse date: {date_val}")
                        continue
                elif isinstance(date_val, (pd.Timestamp, datetime)):
                    payin_dict['payin_date'] = date_val.strftime('%Y-%m-%d')
            
            # Convert amount to float
            if 'amount' in payin_dict:
                try:
                    if isinstance(payin_dict['amount'], str):
                        payin_dict['amount'] = float(payin_dict['amount'].replace(',', '').replace('(', '-').replace(')', ''))
                    else:
                        payin_dict['amount'] = float(payin_dict['amount'])
                except:
                    logger.warning(f"Could not parse amount: {payin_dict.get('amount')}")
                    continue
            
            # Convert NAV and shares to float if present
            for field in ['nav', 'number_of_shares']:
                if field in payin_dict:
                    try:
                        if isinstance(payin_dict[field], str):
                            payin_dict[field] = float(payin_dict[field].replace(',', ''))
                        else:
                            payin_dict[field] = float(payin_dict[field])
                    except:
                        payin_dict[field] = None
            
            if 'payin_date' in payin_dict and 'amount' in payin_dict:
                result.append(payin_dict)
        
        return result
    except Exception as e:
        logger.error(f"Failed to parse Excel file: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {str(e)}")


def parse_payin_json_file(file_content: bytes) -> List[Dict[str, Any]]:
    """Parse JSON file and return list of dictionaries for payins"""
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


def validate_payin_data(payin_dict: Dict[str, Any], row_num: int) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate payin data and return (validated_dict, error_message)"""
    try:
        # Required fields
        if 'payin_date' not in payin_dict:
            return None, "Missing required field: payin_date"
        
        if 'amount' not in payin_dict:
            return None, "Missing required field: amount"
        
        # Parse date
        try:
            if isinstance(payin_dict['payin_date'], str):
                payin_date = datetime.strptime(payin_dict['payin_date'], '%Y-%m-%d').date()
            elif isinstance(payin_dict['payin_date'], date):
                payin_date = payin_dict['payin_date']
            else:
                return None, f"Invalid date format: {payin_dict['payin_date']}"
        except Exception as e:
            return None, f"Invalid date format: {str(e)}"
        
        # Parse amount
        try:
            amount = float(payin_dict['amount'])
            if amount == 0:
                return None, "Amount cannot be zero"
        except (ValueError, TypeError):
            return None, f"Invalid amount: {payin_dict['amount']}"
        
        # Parse optional fields
        nav = None
        if 'nav' in payin_dict and payin_dict['nav'] is not None:
            try:
                nav = float(payin_dict['nav'])
            except (ValueError, TypeError):
                nav = None
        
        number_of_shares = None
        if 'number_of_shares' in payin_dict and payin_dict['number_of_shares'] is not None:
            try:
                number_of_shares = float(payin_dict['number_of_shares'])
            except (ValueError, TypeError):
                number_of_shares = None
        
        validated = {
            'payin_date': payin_date,
            'amount': amount,
            'paid_by': payin_dict.get('paid_by'),
            'nav': nav,
            'number_of_shares': number_of_shares,
            'description': payin_dict.get('description') or payin_dict.get('comments') or payin_dict.get('notes'),
            'zerodha_user_id': payin_dict.get('zerodha_user_id')
        }
        
        return validated, None
    except Exception as e:
        return None, f"Validation error: {str(e)}"


@router.post("/import", response_model=ImportResult)
async def import_payins(
    file: UploadFile = File(...),
    zerodha_user_id: str = Form(...),
    skip_duplicates: bool = Form(True),
    db: Session = Depends(get_db)
):
    """
    Import payins from JSON or Excel file
    
    - **file**: JSON or Excel file (.json, .xlsx, .xls)
    - **zerodha_user_id**: User ID for the account (e.g., "UU6974", "UUXXXX")
    - **skip_duplicates**: If True, skip duplicate payins; if False, fail on duplicates
    """
    try:
        file_content = await file.read()
        file_extension = file.filename.split('.')[-1].lower()
        
        if file_extension in ['xlsx', 'xls']:
            raw_data = parse_payin_excel_file(file_content)
        elif file_extension == 'json':
            raw_data = parse_payin_json_file(file_content)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file format: {file_extension}. Supported: .json, .xlsx, .xls")
        
        if not raw_data:
            raise HTTPException(status_code=400, detail="No data found in file")
        
        # Validate all records first before importing any
        validated_payins = []
        errors = []
        duplicates = []
        
        logger.info(f"Validating {len(raw_data)} payins before import...")
        
        for idx, payin_dict in enumerate(raw_data, start=1):
            # Add zerodha_user_id if not present
            if 'zerodha_user_id' not in payin_dict or not payin_dict['zerodha_user_id']:
                payin_dict['zerodha_user_id'] = zerodha_user_id
            
            validated_data, error_msg = validate_payin_data(payin_dict, idx)
            
            if error_msg:
                errors.append({
                    "row": idx,
                    "error": error_msg,
                    "data": payin_dict
                })
                continue
            
            # Check for duplicates (same date and amount)
            existing = db.query(Payin).filter(
                Payin.payin_date == validated_data['payin_date'],
                Payin.amount == validated_data['amount'],
                Payin.zerodha_user_id == validated_data['zerodha_user_id']
            ).first()
            
            if existing:
                duplicates.append({
                    "row": idx,
                    "payin_date": validated_data['payin_date'].isoformat(),
                    "amount": validated_data['amount'],
                    "reason": "Duplicate payin (same date and amount)"
                })
                if not skip_duplicates:
                    errors.append({
                        "row": idx,
                        "error": "Duplicate payin found",
                        "data": payin_dict
                    })
                continue
            
            validated_payins.append((idx, validated_data))
        
        # If there are errors and we're not skipping duplicates, fail
        if errors and not skip_duplicates:
            error_summary = f"Import failed: {len(errors)} record(s) have errors."
            logger.error(error_summary)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": error_summary,
                    "total_rows": len(raw_data),
                    "errors": errors,
                    "duplicates": duplicates
                }
            )
        
        # If there are duplicates and skip_duplicates is False, fail
        if duplicates and not skip_duplicates:
            error_summary = f"Import failed: {len(duplicates)} duplicate record(s) found. Set skip_duplicates=true to skip them."
            logger.error(error_summary)
            raise HTTPException(
                status_code=400,
                detail={
                    "message": error_summary,
                    "total_rows": len(raw_data),
                    "duplicates": duplicates
                }
            )
        
        # All validations passed - now import all payins in a single transaction
        imported_count = 0
        try:
            for idx, validated_data in validated_payins:
                payin = Payin(**validated_data)
                db.add(payin)
                imported_count += 1
            
            db.commit()
            logger.info(f"Successfully imported {imported_count} payins")
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error importing payins: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to import payins: {str(e)}")
        
        return ImportResult(
            total_rows=len(raw_data),
            imported=imported_count,
            failed=len(errors),
            skipped=len(duplicates),
            errors=errors,
            duplicates=duplicates
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing payins: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to import payins: {str(e)}")

