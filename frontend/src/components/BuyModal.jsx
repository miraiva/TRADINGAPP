import React, { useState, useEffect } from 'react';
import { tradesAPI, marketDataAPI, referenceDataAPI, zerodhaAPI } from '../services/api';
import './BuyModal.css';

// Load symbol-industry mapping
let symbolIndustryMapping = {};
let mappingLoaded = false;
let mappingLoadPromise = null;

const loadSymbolIndustryMapping = async () => {
  if (mappingLoaded) return; // Already loaded
  if (mappingLoadPromise) return mappingLoadPromise; // Already loading, return existing promise
  
  mappingLoadPromise = (async () => {
    try {
      const response = await fetch('/symbol_industry_mapping.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // Create a map for quick lookup
      symbolIndustryMapping = {};
      data.forEach(item => {
        if (item.symbol && item.industry) {
          symbolIndustryMapping[item.symbol.toUpperCase()] = item.industry;
        }
      });
      mappingLoaded = true;
      console.log(`Loaded ${Object.keys(symbolIndustryMapping).length} symbol-industry mappings`);
    } catch (err) {
      console.warn('Failed to load symbol-industry mapping:', err);
      mappingLoaded = false; // Allow retry
    } finally {
      mappingLoadPromise = null;
    }
  })();
  
  return mappingLoadPromise;
};

// Load mapping on module load
loadSymbolIndustryMapping();

const BuyModal = ({ onClose, onBuyComplete, inSlider = false }) => {
  const [formData, setFormData] = useState({
    symbol: '',
    company_name: '',
    buy_date: new Date().toISOString().split('T')[0],
    buy_price: '',
    quantity: '',
    buy_charges: '0',
    industry: '',
    trader: '',
    exchange: 'NSE',
    order_type: 'MARKET',
  });

  const [executeViaAPI, setExecuteViaAPI] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stocksList, setStocksList] = useState([]);
  // Static list of industries (alphabetically arranged)
  const industriesList = [
    'Aerospace & Defense',
    'Automobiles & Auto Parts',
    'Banking Services',
    'Beverages',
    'Chemicals',
    'Coal',
    'Communications & Networking',
    'Computers, Phones & Household Electronics',
    'Construction & Engineering',
    'Construction Materials',
    'Diversified Industrial Goods Wholesale',
    'Diversified Retail',
    'Electrical Utilities & IPPs',
    'ETF',
    'Financial Technology (Fintech) & Infrastructure',
    'Food & Drug Retailing',
    'Food & Tobacco',
    'Freight & Logistics Services',
    'Healthcare Providers & Services',
    'Hotels & Entertainment Services',
    'Insurance',
    'Integrated Hardware & Software',
    'Investment Banking & Investment Services',
    'Machinery, Equipment & Components',
    'Media & Publishing',
    'Metals & Mining',
    'Natural Gas Utilities',
    'Oil & Gas',
    'Passenger Transportation Services',
    'Personal & Household Products & Services',
    'Pharmaceuticals',
    'Professional & Commercial Services',
    'Real Estate Operations',
    'School, College & University',
    'Semiconductors & Semiconductor Equipment',
    'Software & IT Services',
    'Telecommunications Services',
    'Textiles & Apparel',
    'Transport Infrastructure'
  ];
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [symbolSearch, setSymbolSearch] = useState('');
  
  // Auto-populate industry when symbol changes and mapping is available
  // This handles cases where symbol is set programmatically (e.g., from dropdown selection)
  useEffect(() => {
    const updateIndustry = async () => {
      await loadSymbolIndustryMapping(); // Ensure mapping is loaded
      const symbol = formData.symbol.trim().toUpperCase();
      if (symbol && symbolIndustryMapping[symbol]) {
        setFormData(prev => {
          // Always update to use mapping if available
          const mappedIndustry = symbolIndustryMapping[symbol];
          if (prev.industry !== mappedIndustry) {
            return {
              ...prev,
              industry: mappedIndustry
            };
          }
          return prev;
        });
      }
    };
    updateIndustry();
  }, [formData.symbol]);
  const [filteredStocks, setFilteredStocks] = useState([]);
  const [searchTimeout, setSearchTimeout] = useState(null);
  
  // Helper to get all accounts (connected + manually added)
  const getAllAccounts = () => {
    try {
      const tokensJson = localStorage.getItem('zerodha_account_tokens');
      const tokens = tokensJson ? JSON.parse(tokensJson) : {};
      const accountsJson = localStorage.getItem('account_details');
      const accounts = accountsJson ? JSON.parse(accountsJson) : {};
      
      const allAccounts = {};
      
      // Add connected accounts
      Object.keys(tokens).forEach(userId => {
        allAccounts[userId] = {
          user_id: userId,
          user_name: tokens[userId].user_name,
          access_token: tokens[userId].access_token,
          account_type: accounts[userId]?.account_type || 'TRADING_ONLY',
          is_connected: true
        };
      });
      
      // Add manually added accounts
      Object.keys(accounts).forEach(userId => {
        if (!allAccounts[userId]) {
          allAccounts[userId] = {
            user_id: userId,
            user_name: accounts[userId].user_name || '',
            access_token: tokens[userId]?.access_token || null,
            account_type: accounts[userId].account_type || 'TRADING_ONLY',
            is_connected: !!tokens[userId]
          };
        } else {
          // Merge account details
          allAccounts[userId].user_name = allAccounts[userId].user_name || accounts[userId].user_name || '';
          allAccounts[userId].account_type = accounts[userId].account_type || allAccounts[userId].account_type;
        }
      });
      
      return Object.values(allAccounts);
    } catch {
      return [];
    }
  };

  const allAccounts = getAllAccounts();
  const defaultTradingAccount = localStorage.getItem('default_trading_account') || (allAccounts.length > 0 ? allAccounts[0].user_id : null);
  const [selectedTradingAccount, setSelectedTradingAccount] = useState(defaultTradingAccount);
  
  // Get token for selected trading account
  const getTradingAccountToken = (accountId) => {
    if (!accountId) return null;
    const account = allAccounts.find(acc => acc.user_id === accountId);
    return account?.access_token || null;
  };

  const zerodhaAccessToken = getTradingAccountToken(selectedTradingAccount);
  const zerodhaUserId = selectedTradingAccount;
  
  // Get data source from settings
  const dataSource = localStorage.getItem('market_data_source') || 'ZERODHA';
  
  // Check account connection status
  const isAccountConnected = (accountId) => {
    if (!accountId) return false;
    const account = allAccounts.find(acc => acc.user_id === accountId);
    return account?.is_connected || false;
  };
  
  const handleConnectAccount = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await zerodhaAPI.getLoginUrl();
      if (response.login_url) {
        // Store which account we're connecting
        localStorage.setItem('pending_account_connection', selectedTradingAccount || 'new');
        window.location.href = response.login_url;
      }
    } catch (err) {
      const errorDetail = err.response?.data?.detail;
      
      // Handle API not enabled error
      if (err.response?.status === 403 || (errorDetail && errorDetail.error_type === 'API_NOT_ENABLED')) {
        const message = errorDetail?.message || 'This Zerodha account is not enabled for API access.';
        setError(
          <div>
            <strong>{message}</strong>
            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
              <p>To enable API access for this account:</p>
              <ol style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                <li>Log in to your Zerodha Kite account</li>
                <li>Go to <strong>Settings → API</strong></li>
                <li>Enable API access for your app</li>
                <li>Try connecting again</li>
              </ol>
            </div>
          </div>
        );
      } else {
        setError(err.response?.data?.detail?.message || err.message || 'Failed to get login URL. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError(null);
  };

  // Load stocks list on mount (for industries dropdown)
  useEffect(() => {
    loadStocksList();
  }, []);

  // Search stocks from reference data API with debounce
  useEffect(() => {
    // Clear any existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (!symbolSearch || symbolSearch.length < 1) {
      setFilteredStocks([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setLoadingStocks(true);
        const results = await referenceDataAPI.searchStocks(symbolSearch, formData.exchange || 'NSE', 20);
        
        // Transform results to match expected format
        const transformed = results.map(stock => ({
          symbol: stock.symbol,
          name: stock.company_name || stock.symbol,
          industry: stock.industry || ''
        }));
        
        setFilteredStocks(transformed);
      } catch (err) {
        console.error('Error searching stocks:', err);
        // If no results from API, show empty state
        setFilteredStocks([]);
      } finally {
        setLoadingStocks(false);
      }
    }, 300); // 300ms debounce

    setSearchTimeout(timeout);

    return () => {
      clearTimeout(timeout);
    };
  }, [symbolSearch, formData.exchange, stocksList]);

  const loadStocksList = async () => {
    setLoadingStocks(true);
    try {
      const response = await marketDataAPI.getStocksList(formData.exchange || 'NSE', dataSource);
      if (response.success && response.data) {
        const stocks = response.data.stocks || [];
        setStocksList(stocks);
        setFilteredStocks(stocks);
        // Industries are now static - no need to extract from stocks
      }
    } catch (err) {
      console.warn('Failed to load stocks list:', err);
      // Continue with empty list - user can still type manually
    } finally {
      setLoadingStocks(false);
    }
  };

  const handleSymbolSelect = async (selectedSymbol) => {
    setSymbolSearch('');
    
    // Ensure mapping is loaded
    await loadSymbolIndustryMapping();
    
    // First, check the symbol-industry mapping (fastest, no API call)
    const symbolUpper = selectedSymbol.toUpperCase();
    const mappedIndustry = symbolIndustryMapping[symbolUpper];
    
    // Debug logging
    if (mappedIndustry) {
      console.log(`Found industry mapping for ${symbolUpper}: ${mappedIndustry}`);
    } else {
      console.log(`No industry mapping found for ${symbolUpper}. Available mappings: ${Object.keys(symbolIndustryMapping).slice(0, 5).join(', ')}...`);
    }
    
    // Get reference data for selected symbol (from filtered results or fetch)
    const selectedStock = filteredStocks.find(s => s.symbol === selectedSymbol);
    
    if (selectedStock) {
      // Auto-populate from selected stock, ALWAYS prefer mapping if available
      setFormData(prev => {
        // Determine industry: mapping first, then stock industry, then keep existing
        let industryToUse = prev.industry; // Default to existing
        if (mappedIndustry) {
          industryToUse = mappedIndustry; // Mapping takes priority
        } else if (selectedStock.industry && selectedStock.industry.trim()) {
          industryToUse = selectedStock.industry; // Use stock industry if available
        }
        
        return {
          ...prev,
          symbol: selectedSymbol,
          company_name: selectedStock.name || '',
          industry: industryToUse
        };
      });
    } else {
      // Fetch reference data if not in filtered results
      try {
        const refData = await referenceDataAPI.getStockReference(selectedSymbol, formData.exchange || 'NSE');
        setFormData(prev => {
          // Determine industry: mapping first, then refData industry, then keep existing
          let industryToUse = prev.industry; // Default to existing
          if (mappedIndustry) {
            industryToUse = mappedIndustry; // Mapping takes priority
          } else if (refData?.industry && refData.industry.trim()) {
            industryToUse = refData.industry; // Use refData industry if available
          }
          
          return {
            ...prev,
            symbol: selectedSymbol,
            company_name: refData?.company_name || '',
            industry: industryToUse
          };
        });
      } catch (err) {
        console.warn('Failed to fetch reference data:', err);
        setFormData(prev => ({
          ...prev,
          symbol: selectedSymbol,
          // Use mapping if available, otherwise keep existing
          industry: mappedIndustry || prev.industry
        }));
      }
    }
    
    // Try to fetch current price
    try {
      const priceResponse = await marketDataAPI.getPrice(selectedSymbol, formData.exchange || 'NSE', dataSource);
      if (priceResponse.success && priceResponse.data) {
        setFormData(prev => ({
          ...prev,
          buy_price: priceResponse.data.current_price?.toFixed(2) || prev.buy_price
        }));
      }
    } catch (err) {
      console.warn('Failed to fetch price:', err);
    }
  };

  const calculateAmount = () => {
    const price = parseFloat(formData.buy_price) || 0;
    const qty = parseInt(formData.quantity) || 0;
    return (price * qty).toFixed(2);
  };

  const calculateTotalWithCharges = () => {
    const amount = parseFloat(calculateAmount()) || 0;
    const charges = parseFloat(formData.buy_charges) || 0;
    return (amount + charges).toFixed(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const tradeData = {
        ...formData,
        quantity: parseInt(formData.quantity),
        buy_charges: parseFloat(formData.buy_charges) || 0,
        industry: formData.industry || null,
        trader: formData.trader || null,
      };

      // Add API execution fields if enabled
      if (executeViaAPI && zerodhaAccessToken) {
        tradeData.execute_via_api = true;
        tradeData.access_token = zerodhaAccessToken;
        tradeData.zerodha_user_id = zerodhaUserId;
        tradeData.exchange = formData.exchange;
        tradeData.order_type = formData.order_type;
        
        // For MARKET orders, buy_price is optional (will be populated from execution)
        if (formData.order_type === 'MARKET') {
          // Don't send buy_price for MARKET orders - it will be set from execution
          // Only include if user provided it (for reference)
          if (formData.buy_price) {
            tradeData.buy_price = parseFloat(formData.buy_price);
          }
        } else {
          // For LIMIT orders, buy_price is required
          if (!formData.buy_price) {
            setError('Buy price is required for LIMIT orders');
            setLoading(false);
            return;
          }
          tradeData.buy_price = parseFloat(formData.buy_price);
        }
      } else {
        // Manual entry - buy_price is required
        if (!formData.buy_price) {
          setError('Buy price is required for manual entry');
          setLoading(false);
          return;
        }
        tradeData.buy_price = parseFloat(formData.buy_price);
        // Even if not executing via API, store user_id if available
        if (zerodhaUserId) {
          tradeData.zerodha_user_id = zerodhaUserId;
        }
      }

      await tradesAPI.buyTrade(tradeData);
      
      if (onBuyComplete) {
        onBuyComplete();
      }
      onClose();
    } catch (err) {
      console.error('Error creating trade:', err);
      
      // Handle different error formats
      let errorMessage = 'Failed to add trade. Please try again.';
      
      if (err.response?.data) {
        const errorData = err.response.data;
        
        // Handle Pydantic validation errors (array of error objects)
        if (Array.isArray(errorData.detail)) {
          const errorMessages = errorData.detail.map(e => {
            if (typeof e === 'string') return e;
            if (typeof e === 'object' && e.msg) {
              const field = Array.isArray(e.loc) && e.loc.length > 1 ? e.loc[e.loc.length - 1] : 'field';
              return `${field}: ${e.msg}`;
            }
            return JSON.stringify(e);
          });
          errorMessage = errorMessages.join(', ');
        }
        // Handle single detail string
        else if (typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        }
        // Handle error object with message
        else if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.msg) {
          errorMessage = errorData.detail.msg;
        }
        // Handle other error formats
        else if (errorData.message) {
          errorMessage = errorData.message;
        }
        else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      }
      // Handle error message directly
      else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined || value === '') return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(parseFloat(value));
  };

  const content = (
    <div className={`modal-content buy-modal-content ${inSlider ? 'in-slider' : ''}`} onClick={(e) => inSlider ? null : e.stopPropagation()}>
        {!inSlider && (
          <div className="modal-header">
            <h2>Buy Trade</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="buy-modal-form">
          <div className="form-group">
            <label htmlFor="symbol">Symbol *</label>
            <div className="symbol-input-wrapper">
              <input
                type="text"
                id="symbol"
                name="symbol"
                value={formData.symbol}
                onChange={(e) => {
                  const newSymbol = e.target.value;
                  handleChange(e);
                  setSymbolSearch(newSymbol);
                  // Auto-populate industry immediately when symbol changes
                  const symbol = newSymbol.trim().toUpperCase();
                  if (symbol && symbolIndustryMapping[symbol]) {
                    setFormData(prev => ({
                      ...prev,
                      symbol: newSymbol,
                      industry: symbolIndustryMapping[symbol] || prev.industry
                    }));
                  }
                }}
                onBlur={(e) => {
                  // When user finishes typing, check mapping for industry (fallback)
                  const symbol = e.target.value.trim().toUpperCase();
                  if (symbol && symbolIndustryMapping[symbol] && !formData.industry) {
                    setFormData(prev => ({
                      ...prev,
                      industry: symbolIndustryMapping[symbol]
                    }));
                  }
                }}
                onFocus={() => {
                  if (formData.symbol) {
                    setSymbolSearch(formData.symbol);
                  }
                }}
                required
                placeholder="Search or type symbol..."
                className="form-input"
                autoFocus
              />
              {symbolSearch && symbolSearch.length > 0 && (
                <div className="symbol-dropdown">
                  {loadingStocks ? (
                    <div className="symbol-dropdown-loading">Searching...</div>
                  ) : filteredStocks.length > 0 ? (
                    filteredStocks.slice(0, 10).map((stock) => (
                      <div
                        key={stock.symbol}
                        className="symbol-option"
                        onClick={() => handleSymbolSelect(stock.symbol)}
                      >
                        <span className="symbol-option-symbol">{stock.symbol}</span>
                        <span className="symbol-option-name">{stock.name}</span>
                      </div>
                    ))
                  ) : symbolSearch.length >= 1 ? (
                    <div className="symbol-dropdown-empty">No stocks found</div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="company_name">Company Name</label>
            <input
              type="text"
              id="company_name"
              name="company_name"
              value={formData.company_name}
              onChange={handleChange}
              placeholder="Auto-filled from symbol"
              className="form-input"
              readOnly
            />
          </div>

          <div className="form-group">
            <label htmlFor="industry">Industry</label>
            <select
              id="industry"
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              className="form-input form-select"
            >
              <option value="">Select Industry</option>
              {industriesList.map((industry) => (
                <option key={industry} value={industry}>
                  {industry}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="buy_date">Buy Date *</label>
              <input
                type="date"
                id="buy_date"
                name="buy_date"
                value={formData.buy_date}
                onChange={handleChange}
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="quantity">Quantity *</label>
              <input
                type="number"
                id="quantity"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                required
                min="1"
                placeholder="0"
                className="form-input"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="buy_price">
                Buy Price {executeViaAPI && formData.order_type === 'MARKET' ? '' : '*'}
              </label>
              <input
                type="number"
                id="buy_price"
                name="buy_price"
                value={formData.buy_price}
                onChange={handleChange}
                required={!(executeViaAPI && formData.order_type === 'MARKET')}
                disabled={executeViaAPI && formData.order_type === 'MARKET'}
                min="0"
                step="0.01"
                placeholder={executeViaAPI && formData.order_type === 'MARKET' ? 'Will be set from execution' : '0.00'}
                className="form-input"
              />
              {executeViaAPI && formData.order_type === 'MARKET' && (
                <p className="form-hint" style={{ fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.25rem' }}>
                  Price will be populated from order execution
                </p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="buy_charges">Charges</label>
              <input
                type="number"
                id="buy_charges"
                name="buy_charges"
                value={formData.buy_charges}
                onChange={handleChange}
                min="0"
                step="0.01"
                placeholder="0.00"
                className="form-input"
              />
            </div>
          </div>

          {formData.buy_price && formData.quantity && (
            <div className="calculation-preview">
              <div className="calc-row">
                <span>Amount:</span>
                <span className="calc-value">{formatCurrency(calculateAmount())}</span>
              </div>
              {formData.buy_charges && parseFloat(formData.buy_charges) > 0 && (
                <div className="calc-row">
                  <span>Charges:</span>
                  <span className="calc-value">{formatCurrency(formData.buy_charges)}</span>
                </div>
              )}
              <div className="calc-row calc-row-total">
                <span>Total:</span>
                <span className="calc-value calc-value-total">{formatCurrency(calculateTotalWithCharges())}</span>
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="trading-account">Trading Account</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select
                id="trading-account"
                value={selectedTradingAccount || ''}
                onChange={(e) => setSelectedTradingAccount(e.target.value)}
                className="form-input form-select"
                style={{ flex: 1 }}
              >
                <option value="">Select account...</option>
                {allAccounts.map(account => (
                  <option key={account.user_id} value={account.user_id}>
                    {account.user_id} {account.user_name ? `(${account.user_name})` : ''} 
                    {account.account_type === 'MAIN' ? ' [Main]' : ' [Trading]'}
                  </option>
                ))}
              </select>
              {selectedTradingAccount && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {!isAccountConnected(selectedTradingAccount) ? (
                    <>
                      <span className="status-indicator status-red" style={{ width: '12px', height: '12px', borderRadius: '50%', display: 'inline-block', backgroundColor: '#ef4444', boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)' }}></span>
                      <button
                        type="button"
                        className="btn-confirm"
                        onClick={handleConnectAccount}
                        style={{ whiteSpace: 'nowrap', padding: '0.5rem 1rem' }}
                      >
                        Connect
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="status-indicator status-green" style={{ width: '12px', height: '12px', borderRadius: '50%', display: 'inline-block', backgroundColor: '#10b981', boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)' }}></span>
                      <span style={{ color: '#10b981', fontSize: '0.875rem' }}>Connected</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <p className="form-hint">
              Select the account to use for trade execution. Default from preferences.
            </p>
          </div>

          {zerodhaAccessToken && (
            <div className="form-group">
              <div className="api-toggle-container">
                <label className="api-toggle-label">
                  <input
                    type="checkbox"
                    checked={executeViaAPI}
                    onChange={(e) => setExecuteViaAPI(e.target.checked)}
                    className="api-toggle-checkbox"
                  />
                  <span className="api-toggle-text">Execute via Zerodha API</span>
                </label>
                {executeViaAPI && (
                  <div className="api-fields">
                    <div className="form-group">
                      <label htmlFor="exchange">Exchange *</label>
                      <select
                        id="exchange"
                        name="exchange"
                        value={formData.exchange}
                        onChange={handleChange}
                        required={executeViaAPI}
                        className="form-input form-select"
                      >
                        <option value="NSE">NSE</option>
                        <option value="BSE">BSE</option>
                        <option value="NFO">NFO</option>
                        <option value="CDS">CDS</option>
                        <option value="MCX">MCX</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="order_type">Order Type *</label>
                      <select
                        id="order_type"
                        name="order_type"
                        value={formData.order_type}
                        onChange={handleChange}
                        required={executeViaAPI}
                        className="form-input form-select"
                      >
                        <option value="MARKET">Market</option>
                        <option value="LIMIT">Limit</option>
                        <option value="SL">Stop Loss</option>
                        <option value="SL-M">Stop Loss Market</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="form-message form-error">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-confirm btn-confirm-buy"
              disabled={loading}
            >
              {loading ? 'Adding...' : 'Confirm Buy'}
            </button>
          </div>
        </form>
      </div>
  );

  if (inSlider) {
    return content;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      {content}
    </div>
  );
};

export default BuyModal;

