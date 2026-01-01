import React, { useState, useEffect, useCallback } from 'react';
import { payinAPI, zerodhaAPI } from '../services/api';
import { filterTradesByView, getCurrentView, getAccountIdsByStrategy, getAllAccountIds, getAccountDetails } from '../utils/accountUtils';
import './PayinsTable.css';

// Helper to get account token
const getAccountToken = (userId) => {
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    const tokens = tokensJson ? JSON.parse(tokensJson) : {};
    return tokens[userId]?.access_token || null;
  } catch {
    return null;
  }
};

const PayinsTable = ({ zerodhaUserId = null, searchTerm: externalSearchTerm = '', showHeader = false, onClose = null }) => {
  const [payins, setPayins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [availableFunds, setAvailableFunds] = useState(null);
  const [loadingFunds, setLoadingFunds] = useState(false);
  const [view, setView] = useState(getCurrentView()); // Get current view from Dashboard
  const [searchTerm, setSearchTerm] = useState(externalSearchTerm);
  const abortControllerRef = React.useRef(null);
  const fetchInProgressRef = React.useRef(false);

  // Cancel any pending requests when component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Initial fetch on mount - always fetch regardless of userId
  useEffect(() => {
    // Reduced logging - component mount is routine
    // console.log('PayinsTable - Component mounted, initializing...');
    
    // Always fetch on mount, even if userId is null (we want all payins)
    const initFetch = async () => {
      // Small delay to ensure component is fully mounted and refs are ready
      await new Promise(resolve => setTimeout(resolve, 50));
      
      if (!fetchInProgressRef.current) {
        fetchPayins();
      }
    };
    
    initFetch();
    fetchAvailableFunds();
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount - fetchPayins is stable

  // Refetch when userId changes (optional - mainly for when userId is provided as prop)
  useEffect(() => {
    // Only refetch if userId is explicitly provided and changed
    // Don't refetch if userId is null (we show all payins)
    if (zerodhaUserId && !fetchInProgressRef.current) {
      // Reduced logging - userId changes are routine
      // console.log('PayinsTable - zerodhaUserId prop changed, refetching...', zerodhaUserId);
      fetchPayins();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zerodhaUserId]);

  // Refetch payins when view changes (but not available funds)
  // Debounce view changes to prevent rapid refetches
  // NOTE: We don't need to refetch on view change since filtering happens client-side
  // useEffect(() => {
  //   if (view && !fetchInProgressRef.current) { // Only refetch if view is set and no fetch in progress
  //     const timeoutId = setTimeout(() => {
  //       fetchPayins();
  //     }, 300); // Debounce by 300ms
  //     return () => clearTimeout(timeoutId);
  //   }
  // }, [view]);

  // Listen for payin updates (when new payins are added)
  useEffect(() => {
    const handlePayinUpdate = () => {
      fetchPayins();
    };
    
    // Listen for custom events when payins are added/updated
    window.addEventListener('payinAdded', handlePayinUpdate);
    window.addEventListener('payinUpdated', handlePayinUpdate);
    
    // Also listen to storage events (cross-tab updates)
    const handleStorageChange = (e) => {
      if (e.key === 'payin_refresh') {
        fetchPayins();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('payinAdded', handlePayinUpdate);
      window.removeEventListener('payinUpdated', handlePayinUpdate);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Listen for view changes from Dashboard
  useEffect(() => {
    let viewChangeTimeout = null;
    const handleViewChange = () => {
      const newView = getCurrentView();
      // Only update if view actually changed
      if (newView !== view) {
        if (process.env.NODE_ENV === 'development') {
          // Reduced logging - view changes are routine
        // console.log('PayinsTable - View changed to:', newView);
        }
        // Debounce view changes
        if (viewChangeTimeout) {
          clearTimeout(viewChangeTimeout);
        }
        viewChangeTimeout = setTimeout(() => {
          setView(newView);
        }, 200); // Debounce view changes
      }
    };
    // Listen to storage events (cross-tab)
    window.addEventListener('storage', handleViewChange);
    // Listen to custom event (same-tab)
    window.addEventListener('viewChanged', handleViewChange);
    // Also check periodically for same-tab changes (fallback) - but less frequently
    const interval = setInterval(handleViewChange, 2000); // Changed from 1000ms to 2000ms
    return () => {
      window.removeEventListener('storage', handleViewChange);
      window.removeEventListener('viewChanged', handleViewChange);
      clearInterval(interval);
      if (viewChangeTimeout) {
        clearTimeout(viewChangeTimeout);
      }
    };
  }, [view]);

  const fetchAvailableFunds = async () => {
    // Try to get account ID - use provided zerodhaUserId or default trading account
    let accountId = zerodhaUserId;
    if (!accountId) {
      accountId = localStorage.getItem('default_trading_account');
    }
    
    if (!accountId) {
      setAvailableFunds(null);
      return;
    }

    try {
      setLoadingFunds(true);
      const accessToken = getAccountToken(accountId);
      if (!accessToken) {
        setAvailableFunds(null);
        return;
      }

      const response = await zerodhaAPI.getMargins(accessToken);
      const margins = response.margins || {};
      
      // Extract available funds - Zerodha margins API returns:
      // { equity: { available: ..., net: ... }, commodity: { available: ..., net: ... } }
      // Available funds is typically in equity.available
      const equityAvailable = margins.equity?.available || margins.equity?.net || null;
      setAvailableFunds(equityAvailable);
    } catch (err) {
      console.warn('Failed to fetch available funds from Zerodha:', err);
      setAvailableFunds(null);
    } finally {
      setLoadingFunds(false);
    }
  };

  const fetchPayins = useCallback(async () => {
    // Prevent duplicate concurrent requests
    if (fetchInProgressRef.current) {
      // Reduced logging - concurrent requests are handled silently
      // console.log('PayinsTable - Fetch already in progress, skipping...');
      return;
    }

    // Reduced logging - fetch calls are routine
    // console.log('PayinsTable - fetchPayins called, starting request...');

    // Cancel any previous request (but don't create new one if we're already fetching)
    if (abortControllerRef.current && !fetchInProgressRef.current) {
      // Reduced logging - request cancellation is routine
      // console.log('PayinsTable - Aborting previous request');
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this request
    const currentAbortController = new AbortController();
    abortControllerRef.current = currentAbortController;
    fetchInProgressRef.current = true;

    try {
      setLoading(true);
      setError(null);
      
      // Reduced logging - data fetching is routine
      // console.log('PayinsTable - Starting to fetch payins...');
      
      // Always fetch ALL payins - filtering by view/strategy happens in filteredPayins
      // Don't filter by zerodhaUserId at the API level, let frontend handle filtering
      // Use longer timeout for payins fetch
      const data = await payinAPI.getAllPayins(null, true); // Use long timeout
      
      // Check if request was aborted (only if it's still the current request)
      if (currentAbortController?.signal.aborted || abortControllerRef.current !== currentAbortController) {
        // Reduced logging - request cancellations are routine
        // console.log('PayinsTable - Request was aborted');
        return;
      }
      
      // Reduced logging - only log in development mode for debugging
      // Security: Never log full data which might contain sensitive information
      if (process.env.NODE_ENV === 'development') {
        // Only log counts, not full data objects
        const payinsArray = Array.isArray(data) ? data : (data ? [data] : []);
        // console.log('PayinsTable - Fetched payins count:', payinsArray.length);
      }
      
      // Ensure data is an array
      const payinsArray = Array.isArray(data) ? data : (data ? [data] : []);
      setPayins(payinsArray);
    } catch (err) {
      // Don't show error if request was aborted
      if (err.name === 'AbortError' || currentAbortController?.signal.aborted || abortControllerRef.current !== currentAbortController) {
        console.log('PayinsTable - Request was aborted:', err);
        return;
      }
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to load payins. Please try again.';
      setError(errorMessage);
      // Security: Don't log full error objects which might contain sensitive data
      // Only log error type and safe error message
      console.error('PayinsTable - Error fetching payins:', err.name, err.message);
      setPayins([]);
    } finally {
      // Only update state if this is still the current request
      if (abortControllerRef.current === currentAbortController) {
        setLoading(false);
        fetchInProgressRef.current = false;
      }
    }
  }, []); // Empty deps - fetchPayins doesn't depend on any props/state that change

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Filter payins based on selected view
  const filteredPayins = React.useMemo(() => {
    // Safety check: ensure payins is always an array
    if (!Array.isArray(payins) || payins.length === 0) return [];
    
    // Get account IDs based on view
    let accountIds = [];
    
    if (view === 'OVERALL') {
      // For OVERALL, combine account IDs from both Swing and Long Term strategies
      // This matches Dashboard filtering logic
      const swingIds = getAccountIdsByStrategy('SWING');
      const longTermIds = getAccountIdsByStrategy('LONG_TERM');
      accountIds = Array.from(new Set([...swingIds, ...longTermIds])); // Use Set to avoid duplicates
      
      // Reduced logging - debug statements removed for production cleanliness
      // Filtering logic is working correctly, no need to log every filter operation
    } else {
      // For SWING or LONG_TERM, get accounts for that strategy
      accountIds = getAccountIdsByStrategy(view === 'LONG_TERM' ? 'LONG_TERM' : 'SWING');
      
      // Reduced logging - debug statements removed for production cleanliness
    }
    
    // If no account IDs found for the view, fallback to all accounts with tokens
    // This ensures payins show even if accounts aren't classified in account_details yet
    if (accountIds.length === 0) {
      // Reduced logging - fallback operations are routine
      // Get all accounts that have tokens (connected accounts)
      try {
        const tokensJson = localStorage.getItem('zerodha_account_tokens');
        const tokens = tokensJson ? JSON.parse(tokensJson) : {};
        accountIds = Object.keys(tokens);
      } catch {
        // If still no accounts from tokens, try to get all unique user IDs from payins
        // This is a last resort fallback - show all payins that have a user_id
        if (Array.isArray(payins)) {
          const allPayinUserIds = [...new Set(payins.map(p => p.zerodha_user_id).filter(Boolean))];
          if (allPayinUserIds.length > 0) {
            accountIds = allPayinUserIds;
          } else {
            // If still no accounts, return empty to show "no payins" state
            return [];
          }
        } else {
          return [];
        }
      }
    }
    
    const filtered = payins.filter(payin => {
      const payinAccountId = payin.zerodha_user_id;
      // Exclude payins without account ID
      if (!payinAccountId) {
        return false;
      }
      // Normalize account IDs for comparison (trim whitespace, case-insensitive)
      const normalizedPayinId = payinAccountId.trim();
      return accountIds.some(accountId => accountId.trim().toUpperCase() === normalizedPayinId.toUpperCase());
    });
    
    // Final fallback: if filtering resulted in 0 payins but we have payins, show all payins
    // This can happen if account configuration doesn't match the actual payin user IDs
    if (filtered.length === 0 && payins.length > 0) {
      // Reduced logging - fallback operations are routine
      // Return all payins that have a user_id (exclude null/undefined)
      return payins.filter(p => p.zerodha_user_id);
    }
    
    // Reduced logging - filtering operations are routine and don't need logging
    
    return filtered;
  }, [payins, view]);

  const sortedPayins = React.useMemo(() => {
    let sorted = [...filteredPayins];

    // Reduced logging - sorting/searching operations are routine

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      sorted = sorted.filter(payin => {
        return (
          (payin.paid_by && payin.paid_by.toLowerCase().includes(searchLower)) ||
          (payin.description && payin.description.toLowerCase().includes(searchLower)) ||
          (payin.zerodha_user_id && payin.zerodha_user_id.toLowerCase().includes(searchLower))
        );
      });
      // Reduced logging - search filtering is routine
    }

    // Apply sorting
    if (sortConfig.key) {
      sorted.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // Handle date sorting
        if (sortConfig.key === 'payin_date') {
          aVal = new Date(aVal);
          bVal = new Date(bVal);
        }

        // Handle null/undefined values
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Compare values
        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    if (process.env.NODE_ENV === 'development') {
      // Reduced logging - sorting result is not critical
      // console.log(`PayinsTable - sortedPayins result: ${sorted.length} payins`);
    }

    return sorted;
  }, [filteredPayins, sortConfig, searchTerm]);

  const formatCurrency = (value) => {
    if (value == null) return '-';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value) => {
    if (value == null) return '-';
    return new Intl.NumberFormat('en-IN', {
      maximumFractionDigits: 4,
    }).format(value);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const getSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) {
      return '';
    }
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  const handleDelete = async (payinId, payinDate, amount) => {
    // Confirm deletion
    const confirmMessage = `Are you sure you want to delete this payin?\n\nDate: ${formatDate(payinDate)}\nAmount: ${formatCurrency(amount)}`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      await payinAPI.deletePayin(payinId);
      
      // Dispatch event to notify other components (like Dashboard) to refresh
      window.dispatchEvent(new CustomEvent('payinDeleted'));
      // Also trigger storage event for cross-tab updates
      localStorage.setItem('payin_refresh', Date.now().toString());
      
      // Refresh the payins list
      fetchPayins();
    } catch (err) {
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to delete payin';
      alert(`Error deleting payin: ${errorMessage}`);
      // Security: Don't log full error objects which might contain sensitive data
      console.error('Error deleting payin:', err.name, err.message);
    }
  };

  if (loading) {
    return (
      <div className="payins-loading">
        <div className="spinner"></div>
        <p>Loading payins...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="payins-error">
        <p style={{ color: 'red', fontWeight: 'bold' }}>Error loading payins: {error}</p>
        <button onClick={fetchPayins} className="btn-retry">Retry</button>
        {process.env.NODE_ENV === 'development' && (
          <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#6b7280' }}>
            <p>Debug Info:</p>
            <p>Payins state: {payins.length}</p>
            <p>Loading state: {loading ? 'true' : 'false'}</p>
            <p>Fetch in progress: {fetchInProgressRef.current ? 'true' : 'false'}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="payins-table-container">
      {/* Header bar with title, available funds, search, and close button all in one line */}
      <div className="payins-header-bar">
        <h3 className="payins-title">Payin History</h3>
        <div className="payins-header-info">
          {zerodhaUserId && (
            <div className="available-funds-display">
              <span className="funds-label">Funds available in Zerodha ({zerodhaUserId}):</span>
              <span className={`funds-value ${loadingFunds ? 'loading' : ''}`}>
                {loadingFunds ? 'Loading...' : (availableFunds !== null ? formatCurrency(availableFunds) : 'N/A')}
              </span>
            </div>
          )}
          <div className="payins-search">
            <input
              type="text"
              placeholder="Search by paid by, description, or user ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          {onClose && (
            <button className="payins-close-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
      </div>

      {sortedPayins.length === 0 && filteredPayins.length === 0 ? (
        <div className="payins-empty">
          <p>No payins found</p>
          <button 
            onClick={fetchPayins} 
            className="btn-retry"
            style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
          >
            Refresh Payins
          </button>
          {process.env.NODE_ENV === 'development' && (
            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#6b7280' }}>
              <p>Debug Info:</p>
              <p>Current View: {view}</p>
              <p>Total Payins Fetched: {payins.length}</p>
              <p>Filtered Payins: {filteredPayins.length}</p>
              <p>Sorted Payins: {sortedPayins.length}</p>
              <p>Search Term: "{searchTerm}"</p>
              <p>Loading: {loading ? 'true' : 'false'}</p>
              <p>Error: {error || 'none'}</p>
              <p>Fetch In Progress: {fetchInProgressRef.current ? 'true' : 'false'}</p>
              {payins.length > 0 && (
                <p>User IDs in fetched payins: {[...new Set(payins.map(p => p.zerodha_user_id).filter(Boolean))].join(', ')}</p>
              )}
              {filteredPayins.length > 0 && sortedPayins.length === 0 && (
                <p style={{ color: 'orange' }}>⚠️ Filtered payins exist ({filteredPayins.length}) but sorted payins is empty. Check search term or sorting.</p>
              )}
              {payins.length === 0 && !loading && !error && (
                <p style={{ color: 'orange' }}>⚠️ No payins fetched from API. Check console for errors.</p>
              )}
            </div>
          )}
        </div>
      ) : sortedPayins.length === 0 && filteredPayins.length > 0 ? (
        <div className="payins-empty">
          <p>No payins match your search "{searchTerm}"</p>
          <button 
            onClick={() => setSearchTerm('')} 
            className="btn-retry"
            style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}
          >
            Clear Search
          </button>
          {process.env.NODE_ENV === 'development' && (
            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#6b7280' }}>
              <p>Debug: {filteredPayins.length} payins match view filter but were filtered out by search term.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="payins-table-wrapper">
          <table className="payins-table">
            <thead>
              <tr>
                <th 
                  className="sortable"
                  onClick={() => handleSort('payin_date')}
                  data-sort-direction={sortConfig.key === 'payin_date' ? sortConfig.direction : null}
                >
                  Date <span className="sort-icon">{getSortIcon('payin_date')}</span>
                </th>
                <th 
                  className="sortable numeric-header"
                  onClick={() => handleSort('amount')}
                  data-sort-direction={sortConfig.key === 'amount' ? sortConfig.direction : null}
                >
                  Payin Amount <span className="sort-icon">{getSortIcon('amount')}</span>
                </th>
                <th 
                  className="sortable"
                  onClick={() => handleSort('paid_by')}
                  data-sort-direction={sortConfig.key === 'paid_by' ? sortConfig.direction : null}
                >
                  Paid By <span className="sort-icon">{getSortIcon('paid_by')}</span>
                </th>
                <th 
                  className="sortable numeric-header"
                  onClick={() => handleSort('nav')}
                  data-sort-direction={sortConfig.key === 'nav' ? sortConfig.direction : null}
                >
                  NAV <span className="sort-icon">{getSortIcon('nav')}</span>
                </th>
                <th 
                  className="sortable numeric-header"
                  onClick={() => handleSort('number_of_shares')}
                  data-sort-direction={sortConfig.key === 'number_of_shares' ? sortConfig.direction : null}
                >
                  Number of Shares <span className="sort-icon">{getSortIcon('number_of_shares')}</span>
                </th>
                <th style={{ textAlign: 'left' }}>Comments</th>
                <th style={{ textAlign: 'left' }}>User ID</th>
                <th style={{ textAlign: 'center', width: '60px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedPayins.map((payin) => (
                <tr key={payin.id}>
                  <td style={{ textAlign: 'left' }}>{formatDate(payin.payin_date)}</td>
                  <td style={{ textAlign: 'right' }} className={payin.amount < 0 ? 'negative' : ''}>
                    {formatCurrency(payin.amount)}
                  </td>
                  <td style={{ textAlign: 'left' }}>{payin.paid_by || '-'}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(payin.nav)}</td>
                  <td style={{ textAlign: 'right' }}>{formatNumber(payin.number_of_shares)}</td>
                  <td style={{ textAlign: 'left' }} className="comments-cell">
                    {payin.description || '-'}
                  </td>
                  <td style={{ textAlign: 'left' }}>{payin.zerodha_user_id || '-'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="payin-delete-btn"
                      onClick={() => handleDelete(payin.id, payin.payin_date, payin.amount)}
                      title="Delete payin"
                      aria-label="Delete payin"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="payins-total">
                <td style={{ textAlign: 'left', fontWeight: 'bold' }}>Total</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                  {formatCurrency(sortedPayins.reduce((sum, p) => sum + (p.amount || 0), 0))}
                </td>
                <td colSpan="6"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default PayinsTable;

