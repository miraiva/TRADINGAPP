# Quick Start: Migrate Data to Supabase

## Quick Steps

1. **Set your Supabase DATABASE_URL in `.env` file**:
   ```bash
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
   ```

2. **Activate virtual environment** (if using one):
   ```bash
   cd backend
   source venv/bin/activate  # On Mac/Linux
   # or
   venv\Scripts\activate  # On Windows
   ```

3. **Test with dry run**:
   ```bash
   cd backend
   python3 migrate_to_supabase.py --dry-run
   ```

4. **Run actual migration**:
   ```bash
   python3 migrate_to_supabase.py
   ```

That's it! The script will:
- ✅ Connect to your local SQLite database
- ✅ Connect to Supabase PostgreSQL
- ✅ Migrate all tables in the correct order
- ✅ Verify migration was successful
- ✅ Show you a summary report

## What Gets Migrated?

- ✅ **Trades** - All your buy/sell trades
- ✅ **Payins** - Fund deposits
- ✅ **Portfolio Snapshots** - Historical portfolio snapshots
- ✅ **Stock References** - Stock metadata (company names, industries, etc.)
- ✅ **Zerodha API Keys** - Your API keys (stored securely)
- ✅ **Snapshot Symbol Prices** - Historical price data

## Important Notes

- Record IDs will be **regenerated** (new IDs in Supabase)
- If Supabase already has data, you'll be asked if you want to replace it
- The migration is **idempotent** - you can run it multiple times safely

## Need Help?

See `MIGRATION_GUIDE.md` for detailed documentation and troubleshooting.

