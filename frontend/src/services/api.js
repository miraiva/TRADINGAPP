/**
 * API Service for Trading App
 * Handles all API calls to the backend
 */

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 second timeout
});

// Separate axios instance with longer timeout for dashboard data
const dashboardApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 second timeout for dashboard data (increased for large datasets)
});

// Helper functions for multi-account token management
const getAccountTokens = () => {
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    return tokensJson ? JSON.parse(tokensJson) : {};
  } catch {
    return {};
  }
};

// Export helper functions for use in components
export const getMarketDataToken = () => {
  // Get market data account from preferences
  let marketDataAccount = localStorage.getItem('market_data_account');
  
  // If no preference set, try to find a Main account
  if (!marketDataAccount) {
    try {
      const accountsJson = localStorage.getItem('account_details');
      const accounts = accountsJson ? JSON.parse(accountsJson) : {};
      const mainAccount = Object.keys(accounts).find(userId => accounts[userId].account_type === 'MAIN');
      if (mainAccount) {
        marketDataAccount = mainAccount;
      }
    } catch {
      // Fallback to default
      marketDataAccount = 'UU6974';
    }
  }
  
  const tokens = getAccountTokens();
  return tokens[marketDataAccount]?.access_token || null;
};

const getTradingAccountToken = (accountId = null) => {
  // Get trading account token
  const account = accountId || localStorage.getItem('default_trading_account');
  if (account) {
    const tokens = getAccountTokens();
    return tokens[account]?.access_token || null;
  }
  // Fallback to old storage for backward compatibility
  return localStorage.getItem('zerodha_access_token');
};

// Trades API
export const tradesAPI = {
  // Get all trades
  getAllTrades: async (status = null, useLongTimeout = false) => {
    const params = status ? { status } : {};
    const client = useLongTimeout ? dashboardApi : api;
    const response = await client.get('/api/trades/', { params });
    return response.data;
  },

  // Get a single trade
  getTrade: async (tradeId) => {
    const response = await api.get(`/api/trades/${tradeId}`);
    return response.data;
  },

  // Buy a trade (create new position)
  buyTrade: async (tradeData) => {
    const response = await api.post('/api/trades/buy', tradeData);
    return response.data;
  },

  // Sell a trade (close position)
  sellTrade: async (tradeId, sellData) => {
    const response = await api.post(`/api/trades/sell/${tradeId}`, sellData);
    return response.data;
  },

  // Update a trade
  updateTrade: async (tradeId, tradeData) => {
    const response = await api.put(`/api/trades/${tradeId}`, tradeData);
    return response.data;
  },

  // Delete a trade
  deleteTrade: async (tradeId) => {
    await api.delete(`/api/trades/${tradeId}`);
  },

  // Import trades from file
  importTrades: async (file, zerodhaUserId, skipDuplicates = true) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('zerodha_user_id', zerodhaUserId);
    formData.append('skip_duplicates', skipDuplicates);
    
    const response = await api.post('/api/trades/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  // Update prices for all open trades
  updatePrices: async (source = 'ZERODHA', useLongTimeout = false) => {
    // Always use market data account token (paid account) for price updates
    const accessToken = getMarketDataToken();
    if (!accessToken) {
      throw new Error('Market data account token not available. Please connect your main account (UU6974).');
    }
    // Use dashboardApi for longer timeout (30 seconds) when requested
    const instance = useLongTimeout ? dashboardApi : api;
    const response = await instance.post(`/api/trades/update-prices?source=${source}&access_token=${accessToken}`);
    return response.data;
  },
};

// Zerodha API
export const zerodhaAPI = {
  getLoginUrl: async (zerodhaUserId = null) => {
    const params = zerodhaUserId ? { zerodha_user_id: zerodhaUserId } : {};
    const response = await api.get('/api/zerodha/login-url', { params });
    return response.data;
  },
  getLoginUrlPost: async (zerodhaUserId) => {
    const response = await api.post('/api/zerodha/login-url', { zerodha_user_id: zerodhaUserId });
    return response.data;
  },
  exchangeToken: async (requestToken) => {
    const response = await api.post('/api/zerodha/exchange-token', { request_token: requestToken });
    return response.data;
  },
  exchangeTokenWithUser: async (requestToken, zerodhaUserId) => {
    const response = await api.post('/api/zerodha/exchange-token-with-user', { 
      request_token: requestToken,
      zerodha_user_id: zerodhaUserId
    });
    return response.data;
  },
  // R-SM-2: API keys are saved to .env file (not database) via UI
  saveApiKey: async (zerodhaUserId, apiKey, apiSecret) => {
    const response = await api.post('/api/zerodha/api-keys', {
      zerodha_user_id: zerodhaUserId,
      api_key: apiKey,
      api_secret: apiSecret
    });
    return response.data;
  },
  getApiKey: async (zerodhaUserId) => {
    const response = await api.get(`/api/zerodha/api-keys/${zerodhaUserId}`);
    return response.data;
  },
  getAllApiKeys: async () => {
    const response = await api.get('/api/zerodha/api-keys');
    return response.data;
  },
  deleteApiKey: async (zerodhaUserId) => {
    // Deletion not supported - secrets are managed via .env file
    // User should manually edit .env file or use saveApiKey to update
    throw new Error('API key deletion via UI not supported. Update via Settings or edit .env file directly.');
  },
  placeOrder: async (orderData) => {
    const response = await api.post('/api/zerodha/place-order', orderData);
    return response.data;
  },
  getPositions: async (accessToken) => {
    const response = await api.get('/api/zerodha/positions', {
      params: { access_token: accessToken }
    });
    return response.data;
  },
  getHoldings: async (accessToken) => {
    const response = await api.get('/api/zerodha/holdings', {
      params: { access_token: accessToken }
    });
    return response.data;
  },
  getQuote: async (symbol, exchange, accessToken) => {
    const response = await api.get('/api/zerodha/quote', {
      params: { symbol, exchange, access_token: accessToken }
    });
    return response.data;
  },
  getMargins: async (accessToken) => {
    const response = await api.get('/api/zerodha/margins', {
      params: { access_token: accessToken }
    });
    return response.data;
  },
};

// Reference Data API - Use longer timeout for reference data operations (60 seconds)
const referenceDataApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 second timeout for reference data operations
});

// Sync API - Use longer timeout for sync operations (60 seconds)
const syncApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 second timeout for sync operations
});

export const syncAPI = {
  syncAll: async (accessToken) => {
    const response = await syncApi.post('/api/sync/all', { access_token: accessToken });
    return response.data;
  },
  syncPositions: async (accessToken) => {
    const response = await syncApi.post('/api/sync/positions', { access_token: accessToken });
    return response.data;
  },
  syncHoldings: async (accessToken) => {
    const response = await syncApi.post('/api/sync/holdings', { access_token: accessToken });
    return response.data;
  },
  getLastSyncData: async () => {
    const response = await syncApi.get('/api/sync/last-sync-data');
    return response.data;
  },
};

// Debug API
export const debugAPI = {
  getDebugPositions: async (accessToken) => {
    const response = await api.get('/api/debug/positions', {
      params: { access_token: accessToken }
    });
    return response.data;
  },
  getDebugHoldings: async (accessToken) => {
    const response = await api.get('/api/debug/holdings', {
      params: { access_token: accessToken }
    });
    return response.data;
  },
};

// Migration API
export const migrationAPI = {
  migrateHoldings: async (accessToken) => {
    const response = await api.post('/api/migration/holdings', { access_token: accessToken });
    return response.data;
  },
};

// Payin API
export const payinAPI = {
  // Create a new payin
  createPayin: async (payinData) => {
    const response = await api.post('/api/payins/', payinData);
    return response.data;
  },

  // Get all payins
  getAllPayins: async (zerodhaUserId = null, useLongTimeout = false) => {
    const params = zerodhaUserId ? { zerodha_user_id: zerodhaUserId } : {};
    const client = useLongTimeout ? dashboardApi : api;
    const response = await client.get('/api/payins/', { params });
    return response.data;
  },

  // Get a specific payin
  getPayin: async (payinId) => {
    const response = await api.get(`/api/payins/id/${payinId}`);
    return response.data;
  },

  // Delete a payin
  deletePayin: async (payinId) => {
    await api.delete(`/api/payins/id/${payinId}`);
  },

  // Calculate NAV for a specific date
  calculateNav: async (navDate, zerodhaUserId = null, currentPayinAmount = null) => {
    const params = { nav_date: navDate };
    if (zerodhaUserId) {
      params.zerodha_user_id = zerodhaUserId;
    }
    if (currentPayinAmount && currentPayinAmount > 0) {
      params.current_payin_amount = currentPayinAmount;
    }
    const response = await api.get('/api/payins/calculate-nav', { params });
    return response.data;
  },

  // Get latest swing NAV from snapshots
  getLatestSwingNav: async (zerodhaUserId = null) => {
    const params = { trading_strategy: 'SWING' };
    if (zerodhaUserId) {
      params.zerodha_user_id = zerodhaUserId;
    }
    const response = await api.get('/api/snapshots/latest-nav', { params });
    return response.data;
  },

  // Get latest NAV from snapshots for a specific user ID and strategy
  getLatestNavForStrategy: async (zerodhaUserId, tradingStrategy = 'SWING') => {
    const params = { 
      trading_strategy: tradingStrategy,
      zerodha_user_id: zerodhaUserId
    };
    const response = await api.get('/api/snapshots/latest-nav', { params });
    return response.data;
  },

  // Import payins from file
  importPayins: async (file, zerodhaUserId, skipDuplicates = true) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('zerodha_user_id', zerodhaUserId);
    formData.append('skip_duplicates', skipDuplicates);
    const response = await api.post('/api/payins/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
};

// Market Data API - Always uses market data account token (paid account)
export const marketDataAPI = {
  getPrice: async (symbol, exchange = 'NSE', source = 'ZERODHA') => {
    const accessToken = getMarketDataToken(); // Use market data account (paid)
    const response = await api.get('/api/market-data/price', {
      params: { symbol, exchange, source, access_token: accessToken }
    });
    return response.data;
  },
  getBatchPrices: async (symbols, exchange = 'NSE', source = 'ZERODHA') => {
    const accessToken = getMarketDataToken(); // Use market data account (paid)
    const response = await api.post('/api/market-data/prices/batch', {
      symbols,
      exchange,
      source,
      access_token: accessToken
    });
    return response.data;
  },
  getCandles: async (symbol, exchange = 'NSE', interval = '1d', period = '1mo', source = 'ZERODHA') => {
    const accessToken = getMarketDataToken(); // Use market data account (paid)
    const response = await api.get('/api/market-data/candles', {
      params: { symbol, exchange, interval, period, source, access_token: accessToken }
    });
    return response.data;
  },
  getStaticData: async (symbol, exchange = 'NSE', source = 'ZERODHA') => {
    const accessToken = getMarketDataToken(); // Use market data account (paid)
    const response = await api.get('/api/market-data/static', {
      params: { symbol, exchange, source, access_token: accessToken }
    });
    return response.data;
  },
  getStocksList: async (exchange = 'NSE', source = 'ZERODHA') => {
    const response = await api.get('/api/market-data/stocks/list', {
      params: { exchange, source }
    });
    return response.data;
  },
};

// Reference Data API - Uses market data account token (paid account)
export const referenceDataAPI = {
  searchStocks: async (query, exchange = 'NSE', limit = 50) => {
    const accessToken = getMarketDataToken(); // Use market data account (paid)
    const params = { q: query, exchange, limit };
    if (accessToken) {
      params.access_token = accessToken;
    }
    const response = await api.get('/api/reference-data/search', { params });
    return response.data;
  },
  getStockReference: async (symbol, exchange = 'NSE', refresh = false, accessToken = null) => {
    // Use provided token or fallback to market data account token
    const token = accessToken || getMarketDataToken();
    const params = { exchange, refresh };
    if (token) {
      params.access_token = token;
    }
    const response = await api.get(`/api/reference-data/${symbol}`, {
      params
    });
    return response.data;
  },
  bulkUpdate: async (symbols, exchange = 'NSE') => {
    const response = await api.post('/api/reference-data/bulk-update', symbols, {
      params: { exchange }
    });
    return response.data;
  },
  populate: async (forceRefresh = false) => {
    // Use POST with query params in URL to avoid CORS preflight issues
    // Use referenceDataApi with longer timeout for this potentially long-running operation
    const response = await referenceDataApi.post(`/api/reference-data/populate?force_refresh=${forceRefresh}`, null);
    return response.data;
  },
  refreshCompanyNames: async (accessToken = null) => {
    const token = accessToken || getMarketDataToken(); // Use market data account (paid)
    const response = await api.post('/api/reference-data/refresh-company-names', null, {
      params: { access_token: token }
    });
    return response.data;
  },
  bulkLoadInstruments: async (accessToken = null, exchange = 'NSE') => {
    const token = accessToken || getMarketDataToken(); // Use market data account (paid)
    const response = await api.post('/api/reference-data/bulk-load-instruments', null, {
      params: { access_token: token, exchange }
    });
    return response.data;
  },
};

// Snapshot API
export const snapshotAPI = {
  // Get all snapshots
  getSnapshots: async (params = {}) => {
    const response = await api.get('/api/snapshots/', { params });
    return response.data;
  },

  // Get a specific snapshot
  getSnapshot: async (snapshotId) => {
    const response = await api.get(`/api/snapshots/id/${snapshotId}`);
    return response.data;
  },

  // Delete a snapshot
  deleteSnapshot: async (snapshotId) => {
    await api.delete(`/api/snapshots/id/${snapshotId}`);
  },

  // Manually create snapshot for current view
  createManualSnapshot: async (tradingStrategy, accountIds, snapshotDate = null) => {
    const response = await api.post('/api/snapshots/create-manual', {
      trading_strategy: tradingStrategy,
      account_ids: accountIds,
      snapshot_date: snapshotDate
    });
    return response.data;
  },

  // Create daily snapshots (for all accounts)
  createDailySnapshots: async () => {
    const response = await api.post('/api/snapshots/create-daily');
    return response.data;
  },
};

// AI Assistant API
export const aiAssistantAPI = {
  getComparison: async (symbolToSell, currentPrice, model = 'chatgpt-mini', indicators = []) => {
    const response = await api.post('/api/ai-assistant/compare', {
      symbol_to_sell: symbolToSell,
      current_price: currentPrice,
      model: model,
      indicators: indicators
    });
    return response.data;
  },
};

export default api;

