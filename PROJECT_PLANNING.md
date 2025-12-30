# Personal Trading App - Project Planning

## Project Status Summary
**Last Updated**: December 2024  
**Legend**: ✅ Completed | ⚠️ Partially Completed | ❌ Not Started

### Recent Achievements (Latest Session)
- ✅ **Portfolio Dashboard**: Complete implementation with Total Portfolio, NAV, XIRR, Absolute Profit %, Balance/Utilization calculations
- ✅ **View-Based Filtering**: Swing, Long Term, and Overall views with proper account filtering
- ✅ **Portfolio Snapshots**: End-of-day auto-scheduler, manual creation, historical data migration, view/delete functionality
- ✅ **Charts Module**: NAV over time, Portfolio value over time, and Profit/Loss position charts with view-based filtering
- ✅ **Payin History**: Enhanced with Zerodha available funds display, view filtering, delete functionality
- ✅ **Industry Analytics**: Interactive pie chart with clickable filtering for positions table
- ✅ **UI Improvements**: Action buttons with icons, slider panels, responsive layouts

## Project Overview
A comprehensive personal trading application that serves as a one-stop solution for managing all investment accounts. The app focuses on swing trading with independent deal tracking (no cost averaging) and AI-powered decision validation.

## Tech Stack
- **Backend**: Python (FastAPI)
- **Frontend**: ReactJS
- **AI**: Multiple AI models (Groq, OpenAI, Deepseek)
- **Database**: PostgreSQL (recommended) or SQLite (for development)

---

## FEATURES

### F1: Portfolio Management
Centralized view and management of all investment accounts and positions.

### F2: Trade Execution & Tracking
Execute trades via broker APIs and manually track trades when APIs are unavailable.

### F3: Decision Assistant
AI-powered tool to compare stocks and validate trading decisions, especially for sell decisions.

### F4: Analytics & Reporting
Comprehensive charts, metrics, and reports for portfolio performance analysis.

### F5: Transaction Management
Track all payin/payout transactions with NAV and share calculations.

### F6: Multi-Account Support
Manage multiple investment accounts/brokers in a single interface.

---

## EPICS

### E1: Core Portfolio Dashboard
**Feature**: F1, F4  
**Description**: Build the main portfolio dashboard showing summary metrics, charts, and position details.

**User Stories**:
- US1.1: ✅ **COMPLETED** - As a trader, I want to see my total portfolio value, booked profit/loss, float profit/loss, and open positions so I can quickly assess my portfolio status. *Note: Total Portfolio = Payin + Booked P/L + Float P/L, displayed with view-based filtering (Swing, Long Term, Overall).*
- US1.2: ✅ **COMPLETED** - As a trader, I want to see NAV and XIRR calculations so I can track my portfolio performance. *Note: NAV displayed with 2 decimal places, XIRR calculated using proper cash flow dates from payin history, Absolute Profit % also displayed.*
- US1.3: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to view a monthly profit chart so I can see profit trends over time. *Note: Portfolio value over time chart available, but not specifically monthly profit chart.*
- US1.4: ✅ **COMPLETED** - As a trader, I want to see a NAV line chart so I can track NAV progression. *Note: NAV over time chart implemented with historical data from snapshots.*
- US1.5: ✅ **COMPLETED** - As a trader, I want to see profit/loss for each position in a chart so I can identify winners and losers. *Note: Profit/Loss Position chart showing unrealised P/L per symbol implemented.*
- US1.6: ✅ **COMPLETED** - As a trader, I want to see industry allocation in a pie chart so I can understand my portfolio diversification. *Note: Industry pie chart implemented with clickable filtering to filter positions table by industry.*
- US1.7: ✅ **COMPLETED** - As a trader, I want to view a detailed positions table with all relevant columns (Symbol, Buy Date, Quantity, Buy Price, Buy Amount, LTP/Sell Price, Aging, Status, Sell Date, Profit/Loss, P/L %, Day Change, Day Change %, Trader) so I can analyze individual positions.
- US1.8: ✅ **COMPLETED** - As a trader, I want to see balance/utilization percentage so I can monitor my capital usage. *Note: Balance/Utilization % calculated and displayed, with view-based filtering support.*

### E2: Trade Entry & Management
**Feature**: F2  
**Description**: Enable users to enter trades (buy/sell) either via broker API or manually.

**User Stories**:
- US2.1: ✅ **COMPLETED** - As a trader, I want to enter a buy order with symbol, quantity, price, industry, and amount so I can record new positions.
- US2.2: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to see technical details (52-week high/low, change %, previous close, volume, current price, PE) when entering a buy order so I can make informed decisions. *Note: Basic market data available via Zerodha, but not all technical details displayed in buy form.*
- US2.3: ✅ **COMPLETED** - As a trader, I want to connect my broker API (Zerodha, etc.) so trades can be automatically synced. *Note: Zerodha OAuth integration, sync service, and migration service implemented.*
- US2.4: ✅ **COMPLETED** - As a trader, I want to manually enter trades when broker API is unavailable so I don't miss tracking any positions.
- US2.5: ✅ **COMPLETED** - As a trader, I want each trade to be treated as an independent asset (no cost averaging) so I can make clear sell decisions.
- US2.6: ✅ **COMPLETED** - As a trader, I want to update trade details (sell price, sell date, charges) so I can track closed positions. *Note: Sell modal with optional price for MARKET orders, order execution via Zerodha API.*
- US2.7: ✅ **COMPLETED** - As a trader, I want to see the status of each position (OPEN/CLOSED) so I can track active vs closed trades.

### E3: Decision Assistant
**Feature**: F3  
**Description**: AI-powered tool to compare stocks and provide sell/buy recommendations.

**User Stories**:
- US3.1: As a trader, I want to select a stock to sell and compare it against up to 3 alternative stocks so I can make informed sell decisions.
- US3.2: As a trader, I want to see comparison metrics (Quantity, Current Price, Target Price, Target Probability, Amount, Potential Profit, Indexed Profit) for each stock so I can evaluate alternatives.
- US3.3: As a trader, I want the AI to recommend which stock to sell and which to buy based on potential profit so I can optimize my decisions.
- US3.4: As a trader, I want the AI to validate my trading decisions by analyzing market conditions, technical indicators, and portfolio context so I can reduce risk.
- US3.5: As a trader, I want to set a target probability for each stock so I can factor in risk when comparing options.
- US3.6: As a trader, I want to see indexed profit calculations so I can compare profits on a normalized basis.

### E4: Transaction & Cash Flow Management
**Feature**: F5  
**Description**: Track all payin/payout transactions with NAV and share calculations.

**User Stories**:
- US4.1: ✅ **COMPLETED** - As a trader, I want to record payin transactions (date, amount, month, paid by) so I can track capital injections. *Note: Payin modal with date, amount, paid by, description, NAV, shares fields. Import from Excel/CSV also supported.*
- US4.2: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to record payout/withdrawal transactions so I can track capital withdrawals. *Note: Payin model supports withdrawals (negative amounts), but no dedicated payout UI yet.*
- US4.3: ✅ **COMPLETED** - As a trader, I want the system to automatically calculate NAV based on transactions and portfolio value so I can track fund performance. *Note: NAV = Total Portfolio / Total Number of Shares (if shares exist, else Total Portfolio).*
- US4.4: ✅ **COMPLETED** - As a trader, I want the system to calculate number of shares based on NAV and transaction amount so I can track ownership. *Note: Shares field in payin entries, calculated based on NAV and amount.*
- US4.5: ✅ **COMPLETED** - As a trader, I want to see XIRR calculation for my portfolio so I can measure annualized returns. *Note: XIRR calculated using cash flow dates from payin history and current portfolio value, displayed with 2 decimal places.*
- US4.6: ✅ **COMPLETED** - As a trader, I want to view a transaction history table with all payin/payout details so I can audit my cash flows. *Note: Payin History table with sorting, filtering by view (Swing, Long Term, Overall), delete functionality, and Zerodha available funds display.*

### E5: Multi-Account & Broker Integration
**Feature**: F6  
**Description**: Support multiple investment accounts and broker integrations.

**User Stories**:
- US5.1: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to add multiple broker accounts (Zerodha, etc.) so I can manage all investments in one place. *Note: Single Zerodha account supported, multi-account UI not implemented.*
- US5.2: ✅ **COMPLETED** - As a trader, I want to configure broker API credentials so trades can be automatically synced. *Note: Zerodha OAuth flow implemented with token storage.*
- US5.3: ❌ **NOT STARTED** - As a trader, I want to see which account/broker each position belongs to so I can track positions across accounts.
- US5.4: ✅ **COMPLETED** - As a trader, I want to manually override API-synced data when needed so I can correct any discrepancies. *Note: Manual trade entry available alongside API sync.*
- US5.5: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to see a unified view of all positions across all accounts so I have a complete portfolio picture. *Note: Single account view implemented, multi-account aggregation not done.*

### E6: Sell Decision Automation
**Feature**: F2, F3  
**Description**: Automate sell decision tracking based on 4% return target.

**User Stories**:
- US6.1: ❌ **NOT STARTED** - As a trader, I want the system to flag positions that have achieved 4% return so I can consider selling.
- US6.2: ❌ **NOT STARTED** - As a trader, I want to see a list of positions ready for sell decision so I can prioritize my actions.
- US6.3: ❌ **NOT STARTED** - As a trader, I want the AI to analyze whether I should sell a position at 4% or hold for more gains so I can optimize returns.
- US6.4: ✅ **COMPLETED** - As a trader, I want to see profit percentage for each position so I can quickly identify which positions have met my target. *Note: P/L % column implemented showing profit percentage for each trade.*

### E7: Analytics & Reporting
**Feature**: F4  
**Description**: Advanced analytics, charts, and reporting capabilities.

**User Stories**:
- US7.1: ✅ **COMPLETED** - As a trader, I want to see profit/loss by industry so I can identify which sectors are performing well. *Note: Industry pie chart shows allocation, and clicking filters positions table by industry. P/L Position chart shows unrealised P/L per symbol.*
- US7.2: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to see profit/loss by trader (if multiple traders) so I can track individual performance. *Note: Trader column available in positions table, but no dedicated trader-based analytics yet.*
- US7.3: ✅ **COMPLETED** - As a trader, I want to see age of positions so I can identify long-held vs recent positions. *Note: Aging column implemented showing days since buy date.*
- US7.4: ✅ **COMPLETED** - As a trader, I want to see day change for each position so I can track daily performance. *Note: Day Change and Day Change % columns implemented with real-time updates via WebSocket.*
- US7.5: ❌ **NOT STARTED** - As a trader, I want to export portfolio data to Excel/CSV so I can do additional analysis.
- US7.6: ✅ **COMPLETED** - As a trader, I want to see historical portfolio value trends so I can track growth over time. *Note: Portfolio Value Over Time chart implemented with historical data from snapshots, view-based filtering support.*

### E8: AI Model Configuration
**Feature**: F3  
**Description**: Support for multiple AI models for decision validation.

**User Stories**:
- US8.1: As a trader, I want to select which AI model to use (Groq, OpenAI, Deepseek) for decision validation so I can choose based on cost/performance.
- US8.2: As a trader, I want to configure AI model settings (temperature, model version) so I can customize AI behavior.
- US8.3: As a trader, I want the AI to provide reasoning for its recommendations so I can understand the logic.
- US8.4: As a trader, I want to see confidence scores for AI recommendations so I can assess reliability.

### E9: Archive & Historical Data
**Feature**: F1, F4  
**Description**: Store and view historical portfolio snapshots and archived data.

**User Stories**:
- US9.1: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to archive completed positions so I can maintain a clean active portfolio view. *Note: Positions with CLOSED status are filtered out from active view, but no dedicated archive feature.*
- US9.2: ✅ **COMPLETED** - As a trader, I want to view historical portfolio snapshots so I can compare performance over time. *Note: Portfolio snapshots system implemented with end-of-day auto-scheduler, manual creation, view/delete functionality, and migration support for historical data.*
- US9.3: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to see archived positions with all historical data so I can analyze past trades. *Note: Closed positions visible in trades table, but no dedicated archive view.*
- US9.4: ❌ **NOT STARTED** - As a trader, I want to restore archived positions if needed so I can correct any mistakes.

### E10: User Preferences & Settings
**Feature**: All  
**Description**: User configuration and preferences management.

**User Stories**:
- US10.1: ❌ **NOT STARTED** - As a trader, I want to set my default sell target percentage (4%) so the system can flag positions automatically.
- US10.2: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to configure default industry categories so I can categorize stocks consistently. *Note: Industry field available in trades, but no default categories configuration UI.*
- US10.3: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to set up trader profiles if multiple people are trading so I can track individual performance. *Note: Trader field available in trades, but no trader profile management.*
- US10.4: ⚠️ **PARTIALLY COMPLETED** - As a trader, I want to configure chart preferences (date ranges, metrics) so I can customize my dashboard. *Note: Charts support view-based filtering (Swing, Long Term, Overall), but no date range or metric selection UI yet.*
- US10.5: ✅ **COMPLETED** - As a trader, I want to set my default trading account so trades are executed on the correct account by default. *Note: Default trading account setting available in Settings, stored in localStorage.*
- US10.6: ✅ **COMPLETED** - As a trader, I want to configure which account to use for market data (paid account) so I can leverage paid API access for all accounts. *Note: Market data account setting available in Settings, stored in localStorage.*

### E11: Portfolio Reconciliation
**Feature**: F1, F6  
**Description**: Reconcile local portfolio data with broker account data to identify discrepancies.

**User Stories**:
- US11.1: ❌ **NOT STARTED** - As a trader, I want to run a reconciliation check between my local portfolio and broker account so I can identify missing or incorrect trades.
- US11.2: ❌ **NOT STARTED** - As a trader, I want to see a report of discrepancies (missing trades, price differences, quantity mismatches) so I can correct my portfolio.
- US11.3: ❌ **NOT STARTED** - As a trader, I want to automatically sync missing trades from broker account so my portfolio stays up to date.
- US11.4: ❌ **NOT STARTED** - As a trader, I want to mark trades as reconciled so I can track which positions have been verified.

---

## PRIORITY MATRIX

### Phase 1 (MVP - Core Functionality) - **Progress: 83%** (10/12 completed)
- E1: Core Portfolio Dashboard (US1.1, US1.2, US1.7, US1.8) - **100%** (4/4: All ✅)
- E2: Trade Entry & Management (US2.1, US2.4, US2.5, US2.7) - **100%** (4/4: All ✅)
- E4: Transaction & Cash Flow Management (US4.1, US4.3, US4.4, US4.5, US4.6) - **100%** (5/5: All ✅)
- E6: Sell Decision Automation (US6.1, US6.4) - **50%** (1/2: US6.4 ✅)

### Phase 2 (Enhanced Features) - **Progress: 56%** (9/16 completed)
- E1: Complete Dashboard (US1.3, US1.4, US1.5, US1.6) - **100%** (4/4: All ✅)
- E3: Decision Assistant (US3.1, US3.2, US3.3, US3.4) - **0%** (0/4: All ❌)
- E7: Analytics & Reporting (US7.1, US7.2, US7.3, US7.4, US7.6) - **80%** (4/5: US7.1 ✅, US7.3 ✅, US7.4 ✅, US7.6 ✅)
- E8: AI Model Configuration (US8.1, US8.2, US8.3) - **0%** (0/3: All ❌)

### Phase 3 (Advanced Features) - **Progress: 37.5%** (6/16 completed, partials not counted)
- E2: Broker API Integration (US2.3) - **100%** (1/1: US2.3 ✅)
- E5: Multi-Account & Broker Integration (All) - **40%** (2/5: US5.2 ✅, US5.4 ✅; US5.1 ⚠️, US5.5 ⚠️ partial)
- E9: Archive & Historical Data (All) - **25%** (1/4: US9.2 ✅; US9.1 ⚠️, US9.3 ⚠️ partial)
- E10: User Preferences & Settings (All) - **33%** (2/6: US10.5 ✅, US10.6 ✅; US10.2 ⚠️, US10.3 ⚠️, US10.4 ⚠️ partial)
- E7: Advanced Analytics (US7.5, US7.6) - **50%** (1/2: US7.6 ✅)

---

## TECHNICAL CONSIDERATIONS

### Database Schema (Key Tables)
1. **accounts** - Broker accounts (not yet implemented as separate table)
2. **trades** - Individual trades (no averaging) ✅
3. **payins** - Payin/payout records ✅
4. **portfolio_snapshots** - Historical portfolio states ✅
5. **stock_references** - Stock metadata cache (symbol, exchange, company name, industry, sector) ✅
6. **ai_recommendations** - AI decision logs (not yet implemented)
7. **user_preferences** - User settings (stored in localStorage, not database table)

### Key Business Rules
- Each trade is an independent asset (no cost averaging)
- Sell target: 4% return
- NAV calculated from transactions and portfolio value
- XIRR calculated using transaction dates and amounts
- Positions tracked with OPEN/CLOSED status

### API Integrations
- Zerodha Kite API (primary)
- Other broker APIs (extensible)
- Manual entry fallback

### AI Integration Points
- Decision Assistant for sell/buy recommendations
- Position validation and risk analysis
- Market condition analysis

---

## VALIDATION CHECKLIST

Please review and validate:
- [ ] Are all features correctly identified?
- [ ] Are epics properly scoped?
- [ ] Are user stories complete and accurate?
- [ ] Is the priority matrix aligned with your needs?
- [ ] Are there any missing features from your Excel workflow?
- [ ] Are the technical considerations appropriate?
- [ ] Should any epics be split or merged?



Review comments/ Critical issues to be fixed

# Trading App – Production Readiness & Security Review

This document captures a **formal production-readiness review** of the Trading App.
It is intended as a **living reference** while hardening the system for real users.

---

## 🔴 CRITICAL ISSUES (Must Fix Before Production)

### 1. Secrets Committed to Repository
**Issue**
- Real Zerodha API credentials were found inside `backend/.env`.
- This is a severe security risk (credential leakage, account compromise).

**Actions**
- Immediately rotate all exposed Zerodha credentials.
- Remove `.env` from source control and git history.
- Keep only `.env.example` with placeholder values.
- Inject secrets at runtime via:
  - Environment variables
  - Docker secrets / cloud secret manager

**Rule**
> No real secrets should ever exist in git, ZIP artifacts, or deployment bundles.

---

### 2. No Authentication or Authorization
**Issue**
- API endpoints are callable without authentication.
- `zerodha_user_id` is accepted directly from the client.
- Any caller could read, modify, or import trades.

**Actions**
- Introduce authentication (JWT or session-based).
- Derive user identity server-side from auth context.
- Never trust `user_id` or `zerodha_user_id` from request payloads.
- Enforce ownership checks on every data-access route.

---

### 3. Debug Endpoints Exposed in Production
**Issue**
- `/api/debug/*` routes are mounted unconditionally.
- Sensitive tokens are accepted via query parameters.

**Actions**
- Remove debug routes entirely in production.
- Never pass tokens via query params.
- If debugging is required:
  - Enable only on localhost
  - Protect behind admin-only authentication

---

## 🔥 HIGH-RISK ISSUES

### 4. WebSocket Authentication Is Unsafe
**Issue**
- WebSocket connections accept access tokens and user IDs in messages.
- Tokens can be replayed or spoofed.
- No subscription or rate limits.

**Actions**
- Authenticate WebSocket during the handshake.
- Bind each socket connection to a server-side user identity.
- Enforce:
  - Max symbols per connection
  - Message rate limits
  - Subscription validation

---

### 5. Secrets Stored in Database in Plaintext
**Issue**
- `api_secret` is stored as plaintext in the database.
- Masking responses does not protect data at rest.

**Actions**
- Prefer not storing secrets at all if possible.
- If unavoidable:
  - Encrypt secrets at rest (KMS / Vault / libsodium).
  - Restrict DB access.
  - Never log decrypted secrets.

---

### 6. Background Scheduler Runs Inside API Process
**Issue**
- APScheduler runs inside the FastAPI app.
- Multiple workers or restarts can cause duplicate jobs.

**Actions**
- Move scheduled tasks to:
  - Dedicated worker process (Celery / RQ)
  - External cron or Kubernetes CronJob
- Ensure jobs are idempotent.

---

## ⚠️ MEDIUM-RISK ISSUES

### 7. Repository Hygiene Problems
**Issue**
The following should never be committed or shipped:
- `backend/venv/`
- `frontend/node_modules/`
- `backend/trading_app.db`
- `.git/` directory inside artifacts

**Actions**
- Add strict `.gitignore`.
- Build dependencies during CI/CD.
- Use migrations instead of committing databases.

---

### 8. File Upload Endpoint Needs Hardening
**Issue**
- No strict upload size limits.
- No MIME-type or extension validation.
- Potential memory pressure from large files.

**Actions**
- Enforce maximum upload size at:
  - Uvicorn / reverse proxy
  - Application level
- Validate content type and file extension.
- Limit number of rows processed.

---

### 9. Environment Configuration Is Fragile
**Issue**
- Multiple environment flags (`PRODUCTION`, `ENVIRONMENT`) may conflict.

**Actions**
- Standardize on a single variable:

