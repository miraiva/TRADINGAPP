/**
 * Utility functions for account management and filtering
 */

// Get account details from localStorage
export const getAccountDetails = () => {
  try {
    const accountsJson = localStorage.getItem('account_details');
    return accountsJson ? JSON.parse(accountsJson) : {};
  } catch {
    return {};
  }
};

// Get all account IDs by trading strategy
export const getAccountIdsByStrategy = (strategy) => {
  const details = getAccountDetails();
  const accountIds = [];
  
  // Also get connected accounts (from tokens)
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    const tokens = tokensJson ? JSON.parse(tokensJson) : {};
    const allAccountIds = new Set([...Object.keys(details), ...Object.keys(tokens)]);
    
    // If we have account_details, use strategy from there
    if (Object.keys(details).length > 0) {
      allAccountIds.forEach(userId => {
        const accountStrategy = details[userId]?.trading_strategy || 'SWING';
        if (accountStrategy === strategy) {
          accountIds.push(userId);
        }
      });
    } else {
      // No account_details found - fallback: if strategy is SWING, return all connected accounts
      // This allows data to show even when account_details haven't been configured yet
      if (strategy === 'SWING') {
        // Return all accounts with tokens (connected accounts)
        accountIds.push(...Object.keys(tokens));
      }
      // For LONG_TERM, return empty array if no account_details (user needs to configure)
    }
  } catch {
    // Fallback to just account_details if tokens parsing fails
    Object.keys(details).forEach(userId => {
      const accountStrategy = details[userId]?.trading_strategy || 'SWING';
      if (accountStrategy === strategy) {
        accountIds.push(userId);
      }
    });
  }
  
  return accountIds;
};

// Get all account IDs (for Overall view)
export const getAllAccountIds = () => {
  const details = getAccountDetails();
  const accountIds = new Set(Object.keys(details));
  
  // Also include connected accounts
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    const tokens = tokensJson ? JSON.parse(tokensJson) : {};
    Object.keys(tokens).forEach(userId => accountIds.add(userId));
  } catch {
    // Ignore errors
  }
  
  return Array.from(accountIds);
};

// Filter trades by view type
export const filterTradesByView = (trades, view) => {
  if (!trades || trades.length === 0) return [];
  
  // Get account IDs based on view
  let accountIds = [];
  
  if (view === 'OVERALL') {
    // For OVERALL, combine account IDs from both Swing and Long Term strategies
    // This ensures we get the exact same accounts used in individual views
    const swingIds = getAccountIdsByStrategy('SWING');
    const longTermIds = getAccountIdsByStrategy('LONG_TERM');
    // Combine and remove duplicates
    accountIds = Array.from(new Set([...swingIds, ...longTermIds]));
  } else {
    // For SWING or LONG_TERM, get accounts for that strategy
    accountIds = getAccountIdsByStrategy(view === 'LONG_TERM' ? 'LONG_TERM' : 'SWING');
  }
  
  if (accountIds.length === 0) {
    // If no accounts are classified for this strategy, fallback logic
    // This ensures data shows even when account_details haven't been configured yet
    try {
      const tokensJson = localStorage.getItem('zerodha_account_tokens');
      const tokens = tokensJson ? JSON.parse(tokensJson) : {};
      const allAccountIds = Object.keys(tokens);
      if (allAccountIds.length > 0) {
        // If we have connected accounts but no strategy classification, show all for SWING
        // For LONG_TERM, only show if explicitly configured (no fallback)
        if (strategy === 'SWING') {
          accountIds = allAccountIds;
        }
        // Note: LONG_TERM requires explicit configuration, no fallback
      }
    } catch {
      // If no fallback available, return empty array
    }
  }
  
  return trades.filter(trade => {
    const tradeAccountId = trade.zerodha_user_id;
    // Exclude trades without account ID - only include trades from classified accounts
    if (!tradeAccountId) {
      return false;
    }
    return accountIds.includes(tradeAccountId);
  });
};

// Get current view from localStorage
export const getCurrentView = () => {
  return localStorage.getItem('portfolio_view') || 'OVERALL';
};

// Set current view in localStorage
export const setCurrentView = (view) => {
  localStorage.setItem('portfolio_view', view);
  // Dispatch custom event for same-tab updates
  window.dispatchEvent(new CustomEvent('viewChanged', { detail: view }));
};

// Get account tokens from localStorage
const getAccountTokens = () => {
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    return tokensJson ? JSON.parse(tokensJson) : {};
  } catch {
    return {};
  }
};

// Save account token to localStorage
export const saveAccountToken = (userId, accessToken, userName) => {
  const tokens = getAccountTokens();
  tokens[userId] = {
    access_token: accessToken,
    user_name: userName,
    connected_at: new Date().toISOString()
  };
  localStorage.setItem('zerodha_account_tokens', JSON.stringify(tokens));
};

