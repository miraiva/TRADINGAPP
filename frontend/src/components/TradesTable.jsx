import React, { useState, useEffect, useRef, useMemo } from 'react';
import { tradesAPI, marketDataAPI, referenceDataAPI, getMarketDataToken } from '../services/api';
import { websocketService } from '../services/websocket';
import SellModal from './SellModal';
import EditTradeModal from './EditTradeModal';
import './TradesTable.css';

const TradesTable = ({ trades: propTrades = null, loading: propLoading = null, filter: propFilter = null, searchTerm: propSearchTerm = null, industryFilter = null, profitFilter: propProfitFilter = null, onTradesUpdate = null }) => {
  const [trades, setTrades] = useState(propTrades || []);
  const [loading, setLoading] = useState(propLoading !== null ? propLoading : true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(propFilter !== null ? propFilter : 'all'); // 'all', 'OPEN', 'CLOSED'
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [actionsTrade, setActionsTrade] = useState(null);
  const [showActionsPopup, setShowActionsPopup] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTrade, setDeletingTrade] = useState(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [companyName, setCompanyName] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [searchTerm, setSearchTerm] = useState(propSearchTerm !== null ? propSearchTerm : '');
  const [profitFilter, setProfitFilter] = useState(propProfitFilter !== null ? propProfitFilter : null);
  const [websocketUpdateTracker, setWebsocketUpdateTracker] = useState(new Map()); // Track which symbols got WebSocket updates
  const tradesUpdateRef = useRef(null); // Track trades updates to notify parent after render

  // Update local state when props change, but preserve WebSocket price updates
  useEffect(() => {
    if (propTrades !== null) {
      setTrades(prevTrades => {
        // If we have local state with price updates, merge them intelligently
        if (prevTrades && prevTrades.length > 0) {
          // Create a map of current prices from local state (WebSocket updates)
          const priceMap = new Map();
          prevTrades.forEach(trade => {
            if (trade.status === 'OPEN' && trade.current_price) {
              priceMap.set(trade.id, trade.current_price);
            }
          });
          
          // Merge props with preserved prices
          return propTrades.map(trade => {
            const preservedPrice = priceMap.get(trade.id);
            if (preservedPrice && trade.status === 'OPEN') {
              // Preserve WebSocket-updated price
              // Note: day_change should come from API/WebSocket, not calculated here
              return {
                ...trade,
                current_price: preservedPrice
                // Keep existing day_change and day_change_percentage from API
              };
            }
            return trade;
          });
        }
        // First load or no local state
        return propTrades;
      });
    }
  }, [propTrades]);

  useEffect(() => {
    if (propLoading !== null) {
      setLoading(propLoading);
    }
  }, [propLoading]);

  useEffect(() => {
    if (propFilter !== null) {
      setFilter(propFilter);
    }
  }, [propFilter]);

  useEffect(() => {
    if (propSearchTerm !== null) {
      setSearchTerm(propSearchTerm);
    }
  }, [propSearchTerm]);

  useEffect(() => {
    setProfitFilter(propProfitFilter);
  }, [propProfitFilter]);

  const fetchTrades = async () => {
    // Don't fetch if trades are provided as props
    if (propTrades !== null) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const status = filter === 'all' ? null : filter;
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 15000)
      );
      
      const data = await Promise.race([
        tradesAPI.getAllTrades(status),
        timeoutPromise
      ]);
      
      // Set trades immediately from database (fast load)
      setTrades(data || []);
      setLoading(false);
      
      // Update prices in background (non-blocking) if any open trades are missing LTP
      // Check if any open trades have null/undefined current_price
      const hasOpenTradesWithoutPrice = data && data.some(trade => 
        trade.status === 'OPEN' && (!trade.current_price || trade.current_price === null)
      );
      
      if (hasOpenTradesWithoutPrice) {
        // Use market data account token (paid account) for price updates
        const { getMarketDataToken } = await import('../services/api');
        const marketDataToken = getMarketDataToken();
        if (marketDataToken) {
          // Don't await - let it run in background
          updatePricesForOpenTrades().catch(err => {
            console.warn('Background price update failed:', err);
          });
        }
      }
    } catch (err) {
      setError('Failed to load trades. Please try again.');
      console.error('Error fetching trades:', err);
      setLoading(false);
      setTrades([]); // Set empty array on error
    }
  };

  const updatePricesForOpenTrades = async () => {
    try {
      setUpdatingPrices(true);
      const dataSource = localStorage.getItem('market_data_source') || 'ZERODHA';
      console.log('TradesTable: Updating prices for all open trades via REST API (fallback)');
      
      // Use longer timeout (30 seconds) for price updates
      const updatedTrades = await tradesAPI.updatePrices(dataSource, true);
      
      console.log(`TradesTable: Received ${updatedTrades.length} updated trades from API`);
      
      // Update only open trades in the current list
      setTrades(prevTrades => {
        const updated = prevTrades.map(trade => {
          const updatedTrade = updatedTrades.find(t => t.id === trade.id);
          if (updatedTrade && trade.status === 'OPEN') {
            console.log(`TradesTable: Updated ${trade.symbol} price from ${trade.current_price} to ${updatedTrade.current_price}`);
            return updatedTrade;
          }
          return trade;
        });
        
        // Store updated trades to notify parent after render
        if (onTradesUpdate) {
          tradesUpdateRef.current = updated;
        }
        
        return updated;
      });
    } catch (err) {
      console.warn('TradesTable: Failed to update prices via REST API:', err);
      // Don't show error to user, just log it
    } finally {
      setUpdatingPrices(false);
    }
  };

  // Track if populate has been called to prevent duplicate calls
  const populateCalledRef = useRef(false);

  useEffect(() => {
    // Only fetch if trades are not provided as props
    if (propTrades === null) {
      fetchTrades();
    }
    
    // Populate reference data on component mount if needed (non-blocking)
    // Only populate once per session to prevent duplicate requests
    if (!populateCalledRef.current) {
      populateCalledRef.current = true;
      // Don't await this - let it run in background
      (async () => {
        try {
          const { referenceDataAPI } = await import('../services/api');
          // The referenceDataAPI.populate now uses a 60-second timeout
          // This is a background operation, so we don't need Promise.race anymore
          await referenceDataAPI.populate(false);
        } catch (err) {
          // Silently fail - this is a background operation
          // Only log if it's not a timeout (to reduce console noise)
          if (err.code !== 'ECONNABORTED' && err.message !== 'Timeout') {
            console.warn('Failed to populate reference data:', err);
          }
          // Reset flag on error so it can be retried
          populateCalledRef.current = false;
        }
      })();
    }
  }, [filter, propTrades]);

  // Notify parent component of trades updates after render (not during render)
  useEffect(() => {
    if (tradesUpdateRef.current && onTradesUpdate) {
      const updatedTrades = tradesUpdateRef.current;
      tradesUpdateRef.current = null; // Clear the ref
      console.log('TradesTable: Notifying Dashboard of trades update');
      onTradesUpdate(updatedTrades);
    }
  }, [trades, onTradesUpdate]);

  // Memoize open trade symbols for WebSocket dependency
  const openTradeSymbols = useMemo(() => {
    if (!Array.isArray(trades)) return [];
    const openTrades = Array.isArray(trades) ? trades.filter(t => t.status === 'OPEN') : [];
    const symbols = [...new Set(openTrades.map(t => t.symbol).filter(s => s && s.trim()))];
    return symbols.sort();
  }, [trades]);

  // WebSocket connection for real-time price updates
  useEffect(() => {
    // Get market data account token (paid account) for fetching prices for ALL trades
    // This allows LTP updates for trades from any account, not just the connected trading account
    const getMarketDataAccount = () => {
      try {
        // Use market data account token (paid account) for price updates
        const marketDataToken = getMarketDataToken();
        
        if (!marketDataToken) {
          // Fallback to default trading account if no market data account configured
          const tokensJson = localStorage.getItem('zerodha_account_tokens');
          const tokens = tokensJson ? JSON.parse(tokensJson) : {};
          const defaultAccount = localStorage.getItem('default_trading_account');
          
          if (defaultAccount && tokens[defaultAccount]) {
            console.log('TradesTable: Using default trading account token:', defaultAccount);
            return { accessToken: tokens[defaultAccount].access_token, userId: defaultAccount };
          }
          
          // Fallback to first available account
          const accountIds = Object.keys(tokens);
          if (accountIds.length > 0) {
            console.log('TradesTable: Using first available account token:', accountIds[0]);
            return { accessToken: tokens[accountIds[0]].access_token, userId: accountIds[0] };
          }
          
          // Fallback to old storage
          const oldToken = localStorage.getItem('zerodha_access_token');
          const oldUserId = localStorage.getItem('zerodha_user_id');
          if (oldToken) {
            console.log('TradesTable: Using old storage format token');
            return { accessToken: oldToken, userId: oldUserId };
          }
          
          // No token found at all
          console.warn('TradesTable: No access token found in any storage location');
          console.warn('TradesTable: Available tokens:', Object.keys(tokens));
          console.warn('TradesTable: Default account:', defaultAccount);
          return { accessToken: null, userId: null };
        }
        
        // Get market data account ID from preferences
        let marketDataAccount = localStorage.getItem('market_data_account');
        if (!marketDataAccount) {
          // Try to find a Main account
          try {
            const accountsJson = localStorage.getItem('account_details');
            const accounts = accountsJson ? JSON.parse(accountsJson) : {};
            marketDataAccount = Object.keys(accounts).find(userId => accounts[userId].account_type === 'MAIN');
          } catch {
            // Ignore parse errors
          }
          if (!marketDataAccount) {
            // Try to find the account that has the token we just got
            const tokens = getAccountTokens();
            marketDataAccount = Object.keys(tokens).find(userId => tokens[userId].access_token === marketDataToken);
            if (!marketDataAccount) {
              marketDataAccount = 'UU6974'; // Default fallback
            }
          }
        }
        
        console.log('TradesTable: Using market data account token:', marketDataAccount);
        return {
          accessToken: marketDataToken,
          userId: marketDataAccount
        };
      } catch (error) {
        console.error('Error getting market data account:', error);
        // Fallback to old storage
        const oldToken = localStorage.getItem('zerodha_access_token');
        const oldUserId = localStorage.getItem('zerodha_user_id');
        return {
          accessToken: oldToken,
          userId: oldUserId
        };
      }
    };
    
    // Helper to get account tokens (same as in api.js)
    const getAccountTokens = () => {
      try {
        const tokensJson = localStorage.getItem('zerodha_account_tokens');
        return tokensJson ? JSON.parse(tokensJson) : {};
      } catch {
        return {};
      }
    };
    
    // Try to get token with retry logic (in case login just happened)
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 500; // 500ms
    
    const tryConnect = () => {
      const { accessToken, userId } = getMarketDataAccount();
      
      // Only connect if we have a token
      if (!accessToken) {
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`TradesTable: No access token available, retrying in ${retryDelay}ms (attempt ${retryCount}/${maxRetries})`);
          setTimeout(tryConnect, retryDelay);
          return;
        } else {
          console.warn('TradesTable: No access token available for WebSocket connection after retries');
          return;
        }
      }
      
      // Use memoized symbols - get ALL open trade symbols regardless of account
      const symbols = openTradeSymbols;
      
      console.log(`TradesTable: Found ${symbols.length} unique open trade symbols:`, symbols);
      console.log(`TradesTable: All open trades:`, trades.filter(t => t.status === 'OPEN').map(t => ({ 
        symbol: t.symbol, 
        account: t.zerodha_user_id,
        current_price: t.current_price 
      })));

      if (symbols.length === 0) {
        console.warn('TradesTable: No open trades found, skipping WebSocket connection');
        return;
      }

      // Set up WebSocket callbacks
      const handlePriceUpdate = (data) => {
        // Update trade price in real-time
      const newPrice = data.price;
      const symbol = data.symbol;
      
      if (!newPrice) {
        console.warn('TradesTable: Price update received without price:', data);
        return;
      }
      
      if (!symbol) {
        console.warn('TradesTable: Price update received without symbol:', data);
        return;
      }
      
      console.log('TradesTable: Price update received:', { symbol, price: newPrice, day_change: data.day_change, day_change_percentage: data.day_change_percentage, instrument_token: data.instrument_token });
      
      // Track that this symbol received a WebSocket update
      setWebsocketUpdateTracker(prev => {
        const newMap = new Map(prev);
        newMap.set(symbol.toUpperCase(), Date.now());
        return newMap;
      });
      
      setTrades(prevTrades => {
        if (!Array.isArray(prevTrades) || prevTrades.length === 0) {
          console.warn('TradesTable: No trades to update');
          return prevTrades;
        }
        
        let updated = false;
        const updatedTrades = prevTrades.map(trade => {
          if (trade.status === 'OPEN' && symbol && trade.symbol) {
            const tradeSymbolUpper = trade.symbol.toUpperCase().trim();
            const updateSymbolUpper = symbol.toUpperCase().trim();
            
            if (tradeSymbolUpper === updateSymbolUpper) {
              // Match by symbol (case-insensitive)
              // Use day change from Zerodha API (from WebSocket), not calculated from buy_price
              updated = true;
              
              console.log(`TradesTable: Updating ${trade.symbol} price from ${trade.current_price} to ${newPrice}, day_change: ${data.day_change}, day_change_percentage: ${data.day_change_percentage}`);
              
              return {
                ...trade,
                current_price: newPrice,
                day_change: data.day_change !== undefined ? data.day_change : trade.day_change,  // From Zerodha API
                day_change_percentage: data.day_change_percentage !== undefined ? data.day_change_percentage : trade.day_change_percentage  // From Zerodha API
              };
            }
          }
          return trade;
        });
        
        if (!updated) {
          console.warn(`TradesTable: No matching trade found for symbol: ${symbol}. Available symbols:`, 
            prevTrades.filter(t => t.status === 'OPEN').map(t => t.symbol));
        }
        
        // Store updated trades to notify parent after render
        if (updated && onTradesUpdate) {
          tradesUpdateRef.current = updatedTrades;
        }
        
        return updatedTrades;
      });
    };

      // Register price update callback
      websocketService.onPriceUpdate(handlePriceUpdate);

      // Connect WebSocket using market data account (paid account)
      // This allows LTP updates for ALL trades regardless of which account they belong to
      console.log(`TradesTable: Connecting WebSocket for market data account ${userId} with ${symbols.length} symbols:`, symbols);
      console.log(`TradesTable: This will update LTP for all open trades, regardless of account:`, symbols);
      websocketService.connect(accessToken, userId, symbols);
      
      // Add connection status logging
      websocketService.onConnected(() => {
        console.log('TradesTable: WebSocket connected successfully');
      });
      
      websocketService.onError((error) => {
        console.error('TradesTable: WebSocket error:', error);
      });

      // Cleanup on unmount or when dependencies change
      return () => {
        // Remove this specific callback
        const index = websocketService.callbacks.priceUpdate.indexOf(handlePriceUpdate);
        if (index > -1) {
          websocketService.callbacks.priceUpdate.splice(index, 1);
        }
        // Only disconnect if no other callbacks are registered
        if (websocketService.callbacks.priceUpdate.length === 0) {
          websocketService.disconnect();
        }
      };
    };
    
    // Start trying to connect
    tryConnect();
  }, [openTradeSymbols, trades]);

  // Fallback: Periodic price updates for symbols that might not get WebSocket updates
  // This ensures all symbols get price updates even if WebSocket fails for some
  useEffect(() => {
    // Only run if we have open trades
    const openTrades = Array.isArray(trades) ? trades.filter(t => t.status === 'OPEN') : [];
    if (openTrades.length === 0) {
      return;
    }

    // Use market data account token for price updates
    const marketDataToken = getMarketDataToken();
    if (!marketDataToken) {
      console.warn('TradesTable: No market data token available for periodic price updates');
      return;
    }

    // Check which symbols haven't received WebSocket updates in the last 3 minutes
    const checkAndUpdateMissingSymbols = () => {
      const now = Date.now();
      const threeMinutesAgo = now - (3 * 60 * 1000);
      const openSymbols = [...new Set(openTrades.map(t => t.symbol.toUpperCase()))];
      const missingSymbols = openSymbols.filter(symbol => {
        const lastUpdate = websocketUpdateTracker.get(symbol);
        return !lastUpdate || lastUpdate < threeMinutesAgo;
      });

      if (missingSymbols.length > 0) {
        console.log(`TradesTable: Symbols without recent WebSocket updates (${missingSymbols.length}):`, missingSymbols);
        console.log('TradesTable: Running REST API fallback update for all open trades');
        // Update all prices via REST API as fallback
        updatePricesForOpenTrades().catch(err => {
          console.warn('TradesTable: Periodic price update failed:', err);
        });
      }
    };

    // Check immediately and then every 2 minutes
    checkAndUpdateMissingSymbols();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkAndUpdateMissingSymbols();
      }
    }, 2 * 60 * 1000); // 2 minutes

    return () => clearInterval(interval);
  }, [trades.length, websocketUpdateTracker]);

  const handleRowClick = async (trade) => {
    setActionsTrade(trade);
    setShowActionsPopup(true);
    setCompanyName(null); // Reset company name
    
    // Fetch company name from reference data (cached) - do this in background
    // Show popup immediately, then update company name when available
    (async () => {
      try {
        const accessToken = localStorage.getItem('zerodha_access_token');
        
        // First, try to get from database cache (fast - no API call)
        const response = await referenceDataAPI.getStockReference(trade.symbol, 'NSE', false, accessToken);
        
        // If we have a valid company name, use it immediately
        if (response && response.company_name && response.company_name !== trade.symbol) {
          setCompanyName(response.company_name);
          return; // Done, no need to fetch from API
        }
        
        // If company_name is missing or same as symbol, show symbol for now
        // Don't auto-refresh on popup open (too slow) - user can refresh manually if needed
        // The refresh script can be run to populate all company names in bulk
        if (response && response.company_name === trade.symbol) {
          // Show symbol as company name (better than "Loading...")
          setCompanyName(trade.symbol);
        }
        
        // Optional: Only refresh if explicitly requested (not on popup open)
        // This prevents slow API calls when just viewing the popup
      } catch (err) {
        console.warn('Failed to fetch company name:', err);
        // Continue without company name - user can still see the popup
      }
    })();
  };

  const handleSellClick = (trade) => {
    setSelectedTrade(trade);
    setSellModalOpen(true);
    setShowActionsPopup(false);
  };

  const handleSellComplete = () => {
    setSellModalOpen(false);
    setSelectedTrade(null);
    setShowActionsPopup(false);
    setActionsTrade(null);
    fetchTrades();
  };

  const handleEditClick = (trade) => {
    setSelectedTrade(trade);
    setEditModalOpen(true);
    setShowActionsPopup(false);
  };

  const handleEditComplete = () => {
    setEditModalOpen(false);
    setSelectedTrade(null);
    setShowActionsPopup(false);
    setActionsTrade(null);
    fetchTrades();
  };

  const handleDeleteClick = (trade) => {
    setDeletingTrade(trade);
    setShowDeleteConfirm(true);
    setShowActionsPopup(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTrade) return;
    
    try {
      await tradesAPI.deleteTrade(deletingTrade.id);
      setShowDeleteConfirm(false);
      setDeletingTrade(null);
      setActionsTrade(null);
      fetchTrades();
      
      // Dispatch event to notify Dashboard
      window.dispatchEvent(new CustomEvent('tradeDeleted'));
    } catch (err) {
      console.error('Error deleting trade:', err);
      alert(err.response?.data?.detail || 'Failed to delete trade. Please try again.');
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setDeletingTrade(null);
  };

  const handleCloseActionsPopup = () => {
    setShowActionsPopup(false);
    setActionsTrade(null);
    setCompanyName(null);
  };

  const getCurrentOrSellPrice = (trade) => {
    if (trade.status === 'CLOSED' && trade.sell_price) {
      return trade.sell_price;
    }
    return trade.current_price;
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatPercentage = (value) => {
    if (value === null || value === undefined) return '-';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatAging = (days) => {
    if (days === null || days === undefined) return '-';
    return new Intl.NumberFormat('en-IN').format(days);
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-IN').format(value);
  };

  const getProfitLossClass = (value) => {
    if (value === null || value === undefined) return '';
    return value >= 0 ? 'profit' : 'loss';
  };

  const calculateCharge = (trade) => {
    const buyCharges = trade.buy_charges || 0;
    const sellCharges = trade.sell_charges || 0;
    const totalCharges = buyCharges + sellCharges;
    
    if (totalCharges > 0) {
      return totalCharges;
    }
    
    // If charges not available, use 0.15% of amount
    const amount = trade.status === 'CLOSED' 
      ? (trade.buy_amount || 0) + (trade.sell_amount || 0)
      : (trade.buy_amount || 0);
    return amount * 0.0015;
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) {
      return '';
    }
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  const sortedAndFilteredTrades = useMemo(() => {
    if (!Array.isArray(trades)) {
      return [];
    }
    
    let result = trades;

    // Apply industry filter (from pie chart click)
    if (industryFilter) {
      result = result.filter(trade => {
        const tradeIndustry = trade.industry || 'Unknown';
        return tradeIndustry === industryFilter;
      });
    }

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(trade => 
        trade.symbol && trade.symbol.toLowerCase().includes(term) ||
        (trade.trader && trade.trader.toLowerCase().includes(term)) ||
        (trade.industry && trade.industry.toLowerCase().includes(term))
      );
    }

    // Apply status filter (already handled by filter state, but keep it)
    if (filter !== 'all') {
      result = result.filter(trade => trade.status === filter);
    }

    // Apply profit filter - optimized for performance
    if (profitFilter) {
      result = result.filter(trade => {
        const profitPercent = trade.profit_percentage;
        // Skip trades without profit percentage
        if (profitPercent === null || profitPercent === undefined) return false;
        
        // Use direct comparisons instead of switch for better performance
        if (profitFilter === 'green') return profitPercent > 4;
        if (profitFilter === 'amber') return profitPercent >= 0 && profitPercent <= 4;
        if (profitFilter === 'red') return profitPercent < 0 && profitPercent >= -10;
        if (profitFilter === 'dark-red') return profitPercent < -10;
        return true;
      });
    }

    // Apply sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // Handle date strings
        if (sortConfig.key === 'buy_date' || sortConfig.key === 'sell_date') {
          if (!aVal) aVal = sortConfig.direction === 'asc' ? '9999-12-31' : '0000-01-01';
          if (!bVal) bVal = sortConfig.direction === 'asc' ? '9999-12-31' : '0000-01-01';
          return sortConfig.direction === 'asc' 
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        // Handle null/undefined values
        if (aVal === null || aVal === undefined) aVal = sortConfig.direction === 'asc' ? Infinity : -Infinity;
        if (bVal === null || bVal === undefined) bVal = sortConfig.direction === 'asc' ? Infinity : -Infinity;

        // Handle string comparisons
        if (typeof aVal === 'string') {
          return sortConfig.direction === 'asc' 
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        // Handle numeric comparisons
        if (sortConfig.direction === 'asc') {
          return aVal - bVal;
        } else {
          return bVal - aVal;
        }
      });
    }

    return result;
  }, [trades, industryFilter, searchTerm, filter, sortConfig, profitFilter]);

  // If trades are provided as props (from Dashboard), hide the title and controls
  const showTitle = propTrades === null;
  const showControls = propTrades === null && propFilter === null; // Controls are now in Dashboard header

  if (loading && trades.length === 0 && propTrades === null) {
    return (
      <div className="trades-table-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading trades...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="trades-table-container">
      {showTitle && (
        <div className="trades-header">
          <div className="trades-title-section">
            <h2>My Trades</h2>
            <p className="trades-subtitle">
              View and manage all your positions
              {updatingPrices && <span className="price-update-indicator"> • Updating prices...</span>}
            </p>
          </div>
          {showControls && (
            <div className="trades-controls">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by symbol, trader, or industry..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="filter-buttons">
            <button
              className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              className={`filter-btn ${filter === 'OPEN' ? 'active' : ''}`}
              onClick={() => setFilter('OPEN')}
            >
              Open
            </button>
            <button
              className={`filter-btn ${filter === 'CLOSED' ? 'active' : ''}`}
              onClick={() => setFilter('CLOSED')}
            >
              Closed
            </button>
          </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {sortedAndFilteredTrades.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h3>No trades found</h3>
          <p>{trades.length === 0 
            ? 'Start by adding your first trade using the Buy form above.'
            : 'No trades match your search or filter criteria.'}
          </p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="trades-table">
            <thead>
              <tr>
                <th 
                  className="sortable" 
                  onClick={() => handleSort('symbol')}
                  data-sort-direction={sortConfig.key === 'symbol' ? sortConfig.direction : null}
                >
                  Symbol <span className="sort-icon">{getSortIcon('symbol')}</span>
                </th>
                <th 
                  className="sortable" 
                  onClick={() => handleSort('buy_date')}
                  data-sort-direction={sortConfig.key === 'buy_date' ? sortConfig.direction : null}
                >
                  Buy Date <span className="sort-icon">{getSortIcon('buy_date')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('quantity')}
                  data-sort-direction={sortConfig.key === 'quantity' ? sortConfig.direction : null}
                >
                  Quantity <span className="sort-icon">{getSortIcon('quantity')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('buy_price')}
                  data-sort-direction={sortConfig.key === 'buy_price' ? sortConfig.direction : null}
                >
                  Buy Price <span className="sort-icon">{getSortIcon('buy_price')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('buy_amount')}
                  data-sort-direction={sortConfig.key === 'buy_amount' ? sortConfig.direction : null}
                >
                  Buy Amount <span className="sort-icon">{getSortIcon('buy_amount')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('current_price')}
                  data-sort-direction={sortConfig.key === 'current_price' ? sortConfig.direction : null}
                >
                  LTP/Sell Price <span className="sort-icon">{getSortIcon('current_price')}</span>
                </th>
                <th 
                  className="numeric-header sortable aging-header" 
                  onClick={() => handleSort('aging_days')}
                  data-sort-direction={sortConfig.key === 'aging_days' ? sortConfig.direction : null}
                >
                  Aging <span className="sort-icon">{getSortIcon('aging_days')}</span>
                </th>
                <th 
                  className="sortable" 
                  onClick={() => handleSort('status')}
                  data-sort-direction={sortConfig.key === 'status' ? sortConfig.direction : null}
                >
                  Status <span className="sort-icon">{getSortIcon('status')}</span>
                </th>
                <th 
                  className="sortable" 
                  onClick={() => handleSort('sell_date')}
                  data-sort-direction={sortConfig.key === 'sell_date' ? sortConfig.direction : null}
                >
                  Sell Date <span className="sort-icon">{getSortIcon('sell_date')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('profit_loss')}
                  data-sort-direction={sortConfig.key === 'profit_loss' ? sortConfig.direction : null}
                >
                  P/L <span className="sort-icon">{getSortIcon('profit_loss')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('profit_percentage')}
                  data-sort-direction={sortConfig.key === 'profit_percentage' ? sortConfig.direction : null}
                >
                  P/L % <span className="sort-icon">{getSortIcon('profit_percentage')}</span>
                </th>
                <th className="numeric-header">
                  Charge
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('day_change')}
                  data-sort-direction={sortConfig.key === 'day_change' ? sortConfig.direction : null}
                >
                  Day Change <span className="sort-icon">{getSortIcon('day_change')}</span>
                </th>
                <th 
                  className="numeric-header sortable" 
                  onClick={() => handleSort('day_change_percentage')}
                  data-sort-direction={sortConfig.key === 'day_change_percentage' ? sortConfig.direction : null}
                >
                  Day Change % <span className="sort-icon">{getSortIcon('day_change_percentage')}</span>
                </th>
                <th 
                  className="sortable" 
                  onClick={() => handleSort('trader')}
                  data-sort-direction={sortConfig.key === 'trader' ? sortConfig.direction : null}
                >
                  Trader <span className="sort-icon">{getSortIcon('trader')}</span>
                </th>
                <th 
                  className="sortable" 
                  onClick={() => handleSort('zerodha_user_id')}
                  data-sort-direction={sortConfig.key === 'zerodha_user_id' ? sortConfig.direction : null}
                >
                  User ID <span className="sort-icon">{getSortIcon('zerodha_user_id')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredTrades.map((trade) => (
                <tr 
                  key={trade.id} 
                  className={`trade-row ${trade.status === 'CLOSED' ? 'closed-row' : ''}`}
                  onClick={() => handleRowClick(trade)}
                >
                  <td className="symbol-cell">
                    <span className="symbol-badge">{trade.symbol}</span>
                  </td>
                  <td>{formatDate(trade.buy_date)}</td>
                  <td className="quantity-cell numeric-cell">{formatNumber(trade.quantity)}</td>
                  <td className="numeric-cell">{formatCurrency(trade.buy_price)}</td>
                  <td className="numeric-cell">{formatCurrency(trade.buy_amount)}</td>
                  <td className="numeric-cell">{formatCurrency(getCurrentOrSellPrice(trade))}</td>
                  <td className="numeric-cell aging-cell">{formatAging(trade.aging_days)}</td>
                  <td>
                    <span className={`status-badge ${trade.status.toLowerCase()}`}>
                      {trade.status}
                    </span>
                  </td>
                  <td>{formatDate(trade.sell_date)}</td>
                  <td className={`profit-loss-cell numeric-cell ${getProfitLossClass(trade.profit_loss)}`}>
                    {formatCurrency(trade.profit_loss)}
                  </td>
                  <td className={`profit-loss-cell numeric-cell ${getProfitLossClass(trade.profit_percentage)}`}>
                    {formatPercentage(trade.profit_percentage)}
                  </td>
                  <td className="numeric-cell">
                    {formatCurrency(calculateCharge(trade))}
                  </td>
                  <td className={`profit-loss-cell numeric-cell ${getProfitLossClass(trade.day_change)}`}>
                    {formatCurrency(trade.day_change)}
                  </td>
                  <td className={`profit-loss-cell numeric-cell ${getProfitLossClass(trade.day_change_percentage)}`}>
                    {formatPercentage(trade.day_change_percentage)}
                  </td>
                  <td>{trade.trader || '-'}</td>
                  <td>{trade.zerodha_user_id || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sellModalOpen && selectedTrade && (
        <SellModal
          trade={selectedTrade}
          onClose={() => {
            setSellModalOpen(false);
            setSelectedTrade(null);
          }}
          onSellComplete={handleSellComplete}
        />
      )}

      {editModalOpen && selectedTrade && (
        <EditTradeModal
          trade={selectedTrade}
          onClose={() => {
            setEditModalOpen(false);
            setSelectedTrade(null);
          }}
          onUpdateComplete={handleEditComplete}
        />
      )}

      {showDeleteConfirm && deletingTrade && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete Trade</h2>
              <button className="modal-close" onClick={handleDeleteCancel}>×</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this trade?</p>
              <div style={{ marginTop: '1rem', padding: '1rem', background: '#f3f4f6', borderRadius: '8px' }}>
                <p><strong>Symbol:</strong> {deletingTrade.symbol}</p>
                <p><strong>Buy Date:</strong> {new Date(deletingTrade.buy_date).toLocaleDateString()}</p>
                <p><strong>Quantity:</strong> {deletingTrade.quantity}</p>
                <p><strong>Buy Price:</strong> ₹{deletingTrade.buy_price}</p>
              </div>
              <p style={{ marginTop: '1rem', color: '#ef4444', fontWeight: 'bold' }}>
                This action cannot be undone.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={handleDeleteCancel}
                className="btn-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="btn-confirm"
                style={{ background: '#ef4444' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actions Popup */}
      {showActionsPopup && actionsTrade && (
        <div className="actions-popup-overlay" onClick={handleCloseActionsPopup}>
          <div className="actions-popup" onClick={(e) => e.stopPropagation()}>
            <div className="actions-popup-header">
              <div className="actions-header-info">
                <h3>{actionsTrade.symbol}</h3>
                <p className="actions-subtitle">
                  {companyName 
                    ? companyName
                    : 'Loading company name...'}
                </p>
              </div>
              <button className="btn-close-popup" onClick={handleCloseActionsPopup}>×</button>
            </div>
            <div className="actions-popup-content">
              <div className="actions-cards-grid">
                <div 
                  className="action-card action-card-edit"
                  onClick={() => handleEditClick(actionsTrade)}
                >
                  <div className="action-card-icon">✏️</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">Edit</h4>
                    <p className="action-card-description">Edit trade details</p>
                  </div>
                  <div className="action-card-arrow">→</div>
                </div>
                {actionsTrade.status === 'OPEN' && (
                  <div 
                    className="action-card action-card-sell"
                    onClick={() => handleSellClick(actionsTrade)}
                  >
                    <div className="action-card-icon">💰</div>
                    <div className="action-card-content">
                      <h4 className="action-card-title">Sell</h4>
                      <p className="action-card-description">Sell this position</p>
                    </div>
                    <div className="action-card-arrow">→</div>
                  </div>
                )}
                <div 
                  className="action-card action-card-delete"
                  onClick={() => handleDeleteClick(actionsTrade)}
                >
                  <div className="action-card-icon">🗑️</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">Delete</h4>
                    <p className="action-card-description">Delete this trade</p>
                  </div>
                  <div className="action-card-arrow">→</div>
                </div>
                <div className="action-card action-card-hold" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                  <div className="action-card-icon">📊</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">Hold</h4>
                    <p className="action-card-description">Maintain current position</p>
                  </div>
                  <div className="action-card-badge">Soon</div>
                </div>
                <div className="action-card action-card-buy" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                  <div className="action-card-icon">📈</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">Buy More</h4>
                    <p className="action-card-description">Increase position size</p>
                  </div>
                  <div className="action-card-badge">Soon</div>
                </div>
                <div className="action-card action-card-ai" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                  <div className="action-card-icon">🤖</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">AI Decision</h4>
                    <p className="action-card-description">Get AI recommendation</p>
                  </div>
                  <div className="action-card-badge">Soon</div>
                </div>
                <div className="action-card action-card-indicators" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                  <div className="action-card-icon">📉</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">Key Indicators</h4>
                    <p className="action-card-description">Volume, RSI, MACD & more</p>
                  </div>
                  <div className="action-card-badge">Soon</div>
                </div>
                <div className="action-card action-card-chart" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                  <div className="action-card-icon">📈</div>
                  <div className="action-card-content">
                    <h4 className="action-card-title">Chart</h4>
                    <p className="action-card-description">View price chart & analysis</p>
                  </div>
                  <div className="action-card-badge">Soon</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradesTable;


