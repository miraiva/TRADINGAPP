# Trading App - Data Model Documentation

## 📊 LOGICAL DATA MODEL (Conceptual)

The logical data model shows **what** data we store and **how** entities relate to each other, without worrying about database specifics.

### Entities and Relationships

```
┌─────────────────┐
│     TRADE       │
│                 │
│ - Symbol        │
│ - Buy/Sell Info │
│ - Status        │
│ - P/L           │
└────────┬────────┘
         │
         │ (references)
         │
         ▼
┌─────────────────┐
│ STOCK_REFERENCE │
│                 │
│ - Symbol        │
│ - Company Name  │
│ - Industry      │
└─────────────────┘

┌─────────────────┐
│     PAYIN       │
│                 │
│ - Date          │
│ - Amount        │
│ - NAV           │
│ - Shares        │
└─────────────────┘
```

### Entity Descriptions

#### 1. **TRADE** (Individual Stock Trade)
- **Purpose**: Tracks each buy/sell transaction
- **Key Concept**: Each trade is independent (no cost averaging)
- **Relationships**: 
  - References `STOCK_REFERENCE` by symbol
  - Linked to Zerodha account via `zerodha_user_id`

#### 2. **PAYIN** (Fund Deposits)
- **Purpose**: Tracks money deposited into trading account
- **Key Concept**: Used to calculate NAV and total invested capital
- **Relationships**:
  - Linked to Zerodha account via `zerodha_user_id`

#### 3. **STOCK_REFERENCE** (Stock Master Data)
- **Purpose**: Caches static information about stocks
- **Key Concept**: Avoids repeated API calls for company names, industry, etc.
- **Relationships**:
  - Referenced by `TRADE` via symbol

---

## 🗄️ PHYSICAL DATA MODEL (Database Tables)

The physical data model shows **actual database tables** with columns, data types, constraints, and indexes.

### Table: `trades`

| Column Name | Data Type | Nullable | Default | Index | Description |
|------------|-----------|----------|---------|-------|-------------|
| `id` | INTEGER | NO | AUTO | PRIMARY KEY | Unique identifier |
| `symbol` | VARCHAR(50) | NO | - | INDEX | Stock symbol (e.g., "RELIANCE") |
| `buy_date` | DATE | NO | - | INDEX | Date when stock was bought |
| `buy_price` | FLOAT | NO | - | - | Price per share at buy |
| `quantity` | INTEGER | NO | - | - | Number of shares bought |
| `buy_amount` | FLOAT | NO | - | - | Total amount spent (price × qty) |
| `buy_charges` | FLOAT | YES | 0.0 | - | Brokerage, taxes, etc. |
| `sell_date` | DATE | YES | NULL | - | Date when stock was sold |
| `sell_price` | FLOAT | YES | NULL | - | Price per share at sell |
| `sell_amount` | FLOAT | YES | NULL | - | Total amount received |
| `sell_charges` | FLOAT | YES | 0.0 | - | Brokerage, taxes on sell |
| `industry` | VARCHAR(100) | YES | NULL | - | Industry sector |
| `trader` | VARCHAR(100) | YES | NULL | - | Who made the trade |
| `status` | ENUM | NO | 'OPEN' | INDEX | 'OPEN' or 'CLOSED' |
| `executed_via_api` | VARCHAR(20) | YES | NULL | - | 'ZERODHA' or NULL |
| `buy_order_id` | VARCHAR(100) | YES | NULL | - | Zerodha order ID (buy) |
| `sell_order_id` | VARCHAR(100) | YES | NULL | - | Zerodha order ID (sell) |
| `zerodha_user_id` | VARCHAR(50) | YES | NULL | INDEX | Zerodha account ID |
| `current_price` | FLOAT | YES | NULL | - | Latest market price |
| `current_quantity` | INTEGER | YES | NULL | - | Current holding qty |
| `last_synced_at` | TIMESTAMP | YES | NULL | - | Last sync with Zerodha |
| `day_change` | FLOAT | YES | NULL | - | Price change today |
| `day_change_percentage` | FLOAT | YES | NULL | - | % change today |
| `created_at` | TIMESTAMP | NO | NOW() | - | Record creation time |
| `updated_at` | TIMESTAMP | NO | NOW() | - | Last update time |

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `symbol`
- INDEX: `buy_date`
- INDEX: `status`
- INDEX: `zerodha_user_id`

**Calculated Fields (Not Stored):**
- `profit_loss`: Calculated by `calculate_profit_loss()` method
- `profit_percentage`: Calculated by `calculate_profit_percentage()` method
- `aging_days`: Calculated by `calculate_aging_days()` method

---

### Table: `payins`

| Column Name | Data Type | Nullable | Default | Index | Description |
|------------|-----------|----------|---------|-------|-------------|
| `id` | INTEGER | NO | AUTO | PRIMARY KEY | Unique identifier |
| `payin_date` | DATE | NO | - | INDEX | Date of deposit |
| `amount` | FLOAT | NO | - | - | Amount deposited |
| `paid_by` | VARCHAR(100) | YES | NULL | - | Who made the payment |
| `nav` | FLOAT | YES | NULL | - | NAV on payin date |
| `number_of_shares` | FLOAT | YES | NULL | - | Calculated: amount/NAV |
| `description` | TEXT | YES | NULL | - | Comments/Notes |
| `zerodha_user_id` | VARCHAR(50) | YES | NULL | INDEX | Zerodha account ID |
| `created_at` | TIMESTAMP | NO | NOW() | - | Record creation time |
| `updated_at` | TIMESTAMP | NO | NOW() | - | Last update time |

**Indexes:**
- PRIMARY KEY: `id`
- INDEX: `payin_date`
- INDEX: `zerodha_user_id`

---

### Table: `stock_references`

| Column Name | Data Type | Nullable | Default | Index | Description |
|------------|-----------|----------|---------|-------|-------------|
| `id` | INTEGER | NO | AUTO | PRIMARY KEY | Unique identifier |
| `symbol` | VARCHAR(50) | NO | - | UNIQUE INDEX | Stock symbol |
| `exchange` | VARCHAR(10) | NO | 'NSE' | - | Exchange (NSE, BSE) |
| `company_name` | VARCHAR(200) | YES | NULL | - | Full company name |
| `industry` | VARCHAR(100) | YES | NULL | - | Industry sector |
| `sector` | VARCHAR(100) | YES | NULL | - | Business sector |
| `market_cap` | VARCHAR(50) | YES | NULL | - | Market capitalization |
| `created_at` | TIMESTAMP | NO | NOW() | - | Record creation time |
| `updated_at` | TIMESTAMP | NO | NOW() | - | Last update time |
| `last_synced_at` | TIMESTAMP | YES | NULL | - | Last data sync time |

**Indexes:**
- PRIMARY KEY: `id`
- UNIQUE INDEX: `symbol`
- COMPOSITE INDEX: `(symbol, exchange)` - for faster lookups

---

## 🔗 Relationships Summary

### Foreign Key Relationships (Logical)

1. **TRADE → STOCK_REFERENCE**
   - Relationship: Many-to-One (Many trades can reference one stock)
   - Link: `trades.symbol` → `stock_references.symbol`
   - Note: Not enforced as foreign key (flexibility for manual entries)

2. **TRADE → Zerodha Account**
   - Relationship: Many-to-One (Many trades belong to one account)
   - Link: `trades.zerodha_user_id` → Zerodha account ID
   - Note: Stored as string, not a database foreign key

3. **PAYIN → Zerodha Account**
   - Relationship: Many-to-One (Many payins belong to one account)
   - Link: `payins.zerodha_user_id` → Zerodha account ID
   - Note: Stored as string, not a database foreign key

---

## 📈 Data Flow Example

### Scenario: User buys 10 shares of RELIANCE

1. **User Action**: Clicks "Buy Trade" in frontend
2. **Frontend**: Sends POST request to `/api/trades/` with trade data
3. **Backend**: Creates new `Trade` record in `trades` table
4. **Backend**: Looks up `stock_references` table for company name/industry
5. **Backend**: Returns created trade to frontend
6. **Frontend**: Updates dashboard with new trade

### Scenario: User deposits ₹10,000

1. **User Action**: Clicks "Payin" in frontend
2. **Frontend**: Sends POST request to `/api/payins/` with payin data
3. **Backend**: Calculates NAV for the payin date
4. **Backend**: Calculates `number_of_shares = amount / NAV`
5. **Backend**: Creates new `Payin` record in `payins` table
6. **Frontend**: Updates dashboard metrics

---

## 🎯 Key Design Decisions

1. **No Foreign Keys**: 
   - `zerodha_user_id` is stored as string (not FK) for flexibility
   - Allows manual entries without strict account validation

2. **Independent Trades**:
   - Each trade is separate (no cost averaging)
   - Multiple trades of same symbol are tracked independently

3. **Calculated Fields**:
   - P/L, percentages, aging are calculated on-the-fly
   - Not stored to avoid data inconsistency

4. **Cached Reference Data**:
   - `stock_references` table caches company info
   - Reduces API calls to external services

5. **Timestamps**:
   - `created_at` and `updated_at` auto-managed by database
   - `last_synced_at` tracks external data syncs

---

## 📝 Notes

- **Database**: SQLite (development) or PostgreSQL (production)
- **ORM**: SQLAlchemy (Python)
- **Migrations**: Tables created via `Base.metadata.create_all()`
- **Indexes**: Added for frequently queried columns (symbol, dates, status, user_id)

