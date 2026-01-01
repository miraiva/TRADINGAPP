# Database Migration Guide: Localhost SQLite → Supabase PostgreSQL

This guide explains how to migrate your data from the local SQLite database to the production Supabase PostgreSQL database.

## Prerequisites

1. **Local SQLite database exists**: Your `backend/data/tradingapp.db` file should contain your data
2. **Supabase connection string**: You should have your Supabase PostgreSQL connection string
3. **Python environment**: Activate your virtual environment with all dependencies installed

## Step 1: Prepare Environment Variables

The migration script needs access to your Supabase database. You can provide the connection string in two ways:

### Option A: Use existing .env file (Recommended)

Make sure your `.env` file contains the Supabase `DATABASE_URL`:

```bash
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### Option B: Set environment variable directly

```bash
export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
```

> **Note**: Replace `[YOUR-PASSWORD]` and `[PROJECT-REF]` with your actual Supabase credentials.

## Step 2: Run Dry Run First (Recommended)

Before migrating, do a dry run to see what will be migrated:

```bash
cd backend
python migrate_to_supabase.py --dry-run
```

This will:
- Show how many records will be migrated from each table
- Display sample data
- **NOT** write anything to the target database

## Step 3: Perform the Migration

Once you're satisfied with the dry run, run the actual migration:

```bash
python migrate_to_supabase.py
```

The script will:
1. Connect to both databases
2. Migrate data in this order (to respect dependencies):
   - `stock_references`
   - `zerodha_api_keys`
   - `trades`
   - `payins`
   - `portfolio_snapshots`
   - `snapshot_symbol_prices`
3. Verify the migration by comparing record counts
4. Show a summary report

## Step 4: Verify the Migration

After migration, the script automatically verifies by comparing record counts. You should see:

```
✓ stock_references: Source=X, Target=X
✓ zerodha_api_keys: Source=X, Target=X
✓ trades: Source=X, Target=X
...
```

## Important Notes

### ID Preservation

- **Record IDs will be regenerated** - The script removes IDs during migration and lets PostgreSQL auto-generate new ones
- This prevents ID conflicts and ensures clean migration
- Foreign key relationships are preserved through natural keys (like `zerodha_user_id`, `symbol`, etc.)

### Existing Data in Target

- If the target database already has data, the script will ask if you want to delete it
- Answer `y` to replace with source data, or `n` to keep existing and append new records

### Computed Fields

The following computed fields are **not** migrated (they're recalculated on the fly):
- `profit_loss`
- `profit_percentage`
- `aging_days`

These are calculated dynamically by the application and don't need to be stored.

### Error Handling

- If a record fails to migrate, it will be logged and skipped
- The script continues with remaining records
- Check the logs for any errors

## Troubleshooting

### Connection Issues

**Error: "Error connecting to target database"**
- Verify your `DATABASE_URL` is correct
- Check if your Supabase database is accessible
- Ensure you're using the correct port (5432 for direct connection, 6543 for connection pooler)

### Table Doesn't Exist

**Error: "relation 'table_name' does not exist"**
- The script automatically creates tables if they don't exist
- If this still fails, manually run: `python -c "from app.db.database import init_db; init_db()"`

### Permission Issues

**Error: "permission denied"**
- Ensure your Supabase user has CREATE and INSERT permissions
- Check if the database is read-only

### Data Type Issues

**Error: "invalid input syntax"**
- Some data types might differ between SQLite and PostgreSQL
- Check the error message for the specific field causing issues
- You may need to manually fix data before migration

## Rollback

If something goes wrong:

1. **Database reset**: In Supabase dashboard, you can drop and recreate tables
2. **Re-run migration**: Simply run the script again (it will ask to delete existing data)

## Next Steps

After successful migration:

1. **Verify in production UI**: Check your deployed application to ensure data appears correctly
2. **Test functionality**: Make sure all features work with the migrated data
3. **Backup**: Consider creating a backup of your Supabase database

## Support

If you encounter issues:
1. Check the logs for detailed error messages
2. Verify database connections are working
3. Ensure all models are imported correctly
4. Check for any custom fields or data that might need special handling

