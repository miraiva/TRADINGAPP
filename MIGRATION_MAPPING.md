# Migration Mapping: Zerodha Holdings → Trade Model

This document outlines the mapping between Zerodha Holdings JSON fields and our Trade model fields.

## Current Mapping (as implemented)

| Zerodha Field | Trade Model Field | Notes |
|--------------|-------------------|-------|
| `tradingsymbol` | `symbol` | Uppercased |
| `quantity` | `quantity` | Direct mapping |
| `average_price` | `buy_price` | Average purchase price |
| `average_price * quantity` | `buy_amount` | Calculated |
| `last_price` | `current_price` | Latest market price |
| `quantity` | `current_quantity` | Current holding quantity |
| `exchange` | `name` | ⚠️ **ISSUE**: Should be company name, not exchange |
| `last_price - average_price` | `day_change` | Calculated |
| `((last_price - average_price) / average_price) * 100` | `day_change_percentage` | Calculated |
| `datetime.utcnow()` | `last_synced_at` | Sync timestamp |
| `"ZERODHA"` | `executed_via_api` | Marked as Zerodha trade |
| `datetime.now().date()` | `buy_date` | ⚠️ **ISSUE**: Uses current date, not actual buy date |
| `0.0` | `buy_charges` | Default (not available from Zerodha) |
| `None` | `industry` | ⚠️ **MISSING**: Not mapped from Zerodha |
| `None` | `trader` | Not available from Zerodha |
| `TradeStatus.OPEN` | `status` | All migrated trades are OPEN |

## Issues Identified

1. **`name` field**: Currently mapped to `exchange` (e.g., "NSE"), but should be company name
   - **Fix needed**: Fetch company name from market data API or Zerodha quote API

2. **`buy_date` field**: Uses current date as placeholder
   - **Fix needed**: Zerodha doesn't provide buy date in holdings, but we could use a reasonable default or fetch from order history

3. **`industry` field**: Not mapped
   - **Fix needed**: Fetch from market data API (RapidAPI or Zerodha)

4. **Missing Zerodha fields**: Some Zerodha fields are not mapped:
   - `pnl` (profit/loss) - could be useful
   - `product` - already filtered for "CNC"
   - `collateral_quantity` - not needed for our use case

## Recommended Improvements

1. **Fetch company name**: After migration, call market data API to get company name
2. **Fetch industry**: After migration, call market data API to get industry
3. **Better buy_date**: Could use a default date or fetch from order history if available
4. **Post-migration enrichment**: Run a background job to enrich trades with missing data

## Migration Status

- ✅ Migration has been run (28 trades in database)
- ✅ Core fields mapped correctly
- ⚠️ Some fields need enrichment (name, industry, buy_date)



