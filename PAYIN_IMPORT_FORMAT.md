# Payin Import Format Guide

## JSON Format

The JSON file should be an array of payin objects. Each payin object should have the following structure:

### Required Fields:
- `payin_date` (string, format: "YYYY-MM-DD") - Date of the payin
- `amount` (number) - Payin amount (can be negative for payouts)

### Optional Fields:
- `paid_by` (string) - Name of the person who made the payment (e.g., "Ivan M", "Shilpa")
- `nav` (number) - NAV (Net Asset Value) on the payin date
- `number_of_shares` (number) - Number of shares (calculated as amount/NAV)
- `description` (string) - Comments or notes about the payin
- `zerodha_user_id` (string) - Zerodha user ID (e.g., "UU6974", "VN6451"). If not provided, will use the User ID entered in the import form.

## Sample JSON File

```json
[
  {
    "payin_date": "2022-09-09",
    "amount": 69149.93,
    "paid_by": "Ivan M",
    "nav": 10.0,
    "number_of_shares": 6914.99,
    "description": "Initial investment"
  },
  {
    "payin_date": "2022-10-15",
    "amount": 50000.0,
    "paid_by": "Shilpa",
    "nav": 9.0303364,
    "number_of_shares": 5539.81,
    "description": "Additional investment"
  },
  {
    "payin_date": "2022-11-20",
    "amount": -4665.0,
    "paid_by": "Ivan M",
    "nav": 8.8568531,
    "number_of_shares": -534.81,
    "description": "Payout"
  },
  {
    "payin_date": "2023-01-10",
    "amount": 25000.0,
    "paid_by": "Ivan M",
    "nav": 9.5,
    "number_of_shares": 2631.58
  },
  {
    "payin_date": "2023-03-15",
    "amount": 30000.0,
    "paid_by": "Shilpa",
    "nav": 10.2,
    "number_of_shares": 2941.18,
    "description": "Monthly contribution"
  }
]
```

## Excel Format

For Excel files (.xlsx, .xls), the following column names are supported:

### Column Name Variations:
- **Date**: `Date`, `Payin Date`, `Payin_Date`, `PayinDate`, `Transaction Date`
- **Amount**: `Payin`, `Amount`, `Payin Amount`, `Payin_Amount`, `PayinAmount`
- **Paid By**: `Paid By`, `Paid_By`, `PaidBy`, `Name`, `Person`
- **NAV**: `NAV`, `nav`, `Nav`, `Net Asset Value`, `Net_Asset_Value`
- **Number of Shares**: `Number of Shares`, `Number_of_Shares`, `NumberOfShares`, `Shares`, `No of Shares`
- **Description**: `Description`, `Comments`, `Notes`, `Remarks`

### Sample Excel Structure:

| Date       | Payin      | Paid By | NAV        | Number of Shares | Comments           |
|------------|------------|---------|------------|------------------|--------------------|
| 2022-09-09 | 69149.93   | Ivan M  | 10         | 6914.99          | Initial investment |
| 2022-10-15 | 50000.0    | Shilpa  | 9.0303364  | 5539.81          | Additional investment |
| 2022-11-20 | (4,665.00) | Ivan M  | 8.8568531  | (534.81)        | Payout             |
| 2023-01-10 | 25000.0    | Ivan M  | 9.5        | 2631.58          |                    |
| 2023-03-15 | 30000.0    | Shilpa  | 10.2       | 2941.18          | Monthly contribution |

### Notes:
- **Date Format**: Excel dates can be in various formats (DD-MM-YYYY, MM/DD/YYYY, etc.) or as Excel date values
- **Negative Amounts**: Can be represented as negative numbers (-4665.0) or in accounting format with parentheses: (4,665.00)
- **Month Column**: If your Excel has a "Month" column (e.g., "Sep-22"), it will be ignored as it's just for reference
- **Comma Separators**: Amounts with commas (e.g., "69,149.93") are automatically handled

## Import Process

1. Go to **Settings** → **Import Payins**
2. Select your JSON or Excel file
3. Enter your **User ID** (e.g., UU6974, VN6451)
4. Choose whether to **skip duplicates** (recommended: Yes)
5. Click **Import Payins**

## Validation Rules

- **Date**: Must be a valid date in YYYY-MM-DD format (for JSON) or any standard date format (for Excel)
- **Amount**: Must be a number (can be zero or negative)
- **NAV**: Optional, but if provided must be a positive number
- **Number of Shares**: Optional, but if provided must be a number
- **Duplicates**: Two payins are considered duplicates if they have the same date, amount, and user ID

## Error Handling

If any record fails validation:
- The entire import will be rolled back (no partial imports)
- You'll see a detailed list of errors with row numbers and specific error messages
- Fix the errors in your file and upload again


