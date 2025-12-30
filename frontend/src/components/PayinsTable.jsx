import React, { useState, useEffect } from 'react';
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

  useEffect(() => {
    fetchPayins();
    fetchAvailableFunds();
  }, [zerodhaUserId]); // Fetch when userId changes

  // Refetch payins when view changes (but not available funds)
  useEffect(() => {
    if (view) { // Only refetch if view is set
      fetchPayins();
    }
  }, [view]);

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
    const handleViewChange = () => {
      const newView = getCurrentView();
      if (process.env.NODE_ENV === 'development') {
        console.log('PayinsTable - View changed to:', newView);
      }
      setView(newView);
    };
    // Listen to storage events (cross-tab)
    window.addEventListener('storage', handleViewChange);
    // Listen to custom event (same-tab)
    window.addEventListener('viewChanged', handleViewChange);
    // Also check periodically for same-tab changes (fallback)
    const interval = setInterval(handleViewChange, 1000);
    return () => {
      window.removeEventListener('storage', handleViewChange);
      window.removeEventListener('viewChanged', handleViewChange);
      clearInterval(interval);
    };
  }, []);

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

  const fetchPayins = async () => {
    try {
      setLoading(true);
      setError(null);
      // Always fetch ALL payins - filtering by view/strategy happens in filteredPayins
      // Don't filter by zerodhaUserId at the API level, let frontend handle filtering
      const data = await payinAPI.getAllPayins(null);
      setPayins(data || []);
      
      // Debug logging
      if (process.env.NODE_ENV === 'development') {
        console.log('PayinsTable - Fetched payins:', data?.length || 0);
        console.log('PayinsTable - Current view:', view);
        console.log('PayinsTable - Fetching ALL payins (no API filter)');
        if (data && data.length > 0) {
          const uu6974Payins = data.filter(p => p.zerodha_user_id === 'UU6974');
          console.log('PayinsTable - UU6974 payins found:', uu6974Payins.length, uu6974Payins);
          const allUserIds = [...new Set(data.map(p => p.zerodha_user_id).filter(Boolean))];
          console.log('PayinsTable - All user IDs in fetched payins:', allUserIds);
        }
      }
    } catch (err) {
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to load payins. Please try again.';
      setError(errorMessage);
      console.error('Error fetching payins:', err);
      console.error('Error response:', err.response);
      setPayins([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Filter payins based on selected view
  const filteredPayins = React.useMemo(() => {
    if (!payins || payins.length === 0) return [];
    
    // Get account IDs based on view
    let accountIds = [];
    
    if (view === 'OVERALL') {
      // For OVERALL, combine account IDs from both Swing and Long Term strategies
      // This matches Dashboard filtering logic
      const swingIds = getAccountIdsByStrategy('SWING');
      const longTermIds = getAccountIdsByStrategy('LONG_TERM');
      accountIds = Array.from(new Set([...swingIds, ...longTermIds])); // Use Set to avoid duplicates
      
      // Debug logging
      if (process.env.NODE_ENV === 'development') {
        console.log('PayinsTable OVERALL - Swing IDs:', swingIds);
        console.log('PayinsTable OVERALL - Long Term IDs:', longTermIds);
        console.log('PayinsTable OVERALL - Combined IDs:', accountIds);
        console.log('PayinsTable OVERALL - Total payins before filter:', payins.length);
        const uu6974Payins = payins.filter(p => p.zerodha_user_id === 'UU6974');
        console.log('PayinsTable OVERALL - UU6974 payins before filter:', uu6974Payins);
        console.log('PayinsTable OVERALL - Is UU6974 in accountIds?', accountIds.includes('UU6974'));
      }
    } else {
      // For SWING or LONG_TERM, get accounts for that strategy
      accountIds = getAccountIdsByStrategy(view === 'LONG_TERM' ? 'LONG_TERM' : 'SWING');
      
      // Debug logging
      if (process.env.NODE_ENV === 'development') {
        console.log(`PayinsTable ${view} - Account IDs:`, accountIds);
        console.log(`PayinsTable ${view} - Total payins before filter:`, payins.length);
        const uu6974Payins = payins.filter(p => p.zerodha_user_id === 'UU6974');
        console.log(`PayinsTable ${view} - UU6974 payins before filter:`, uu6974Payins);
        console.log(`PayinsTable ${view} - Is UU6974 in accountIds?`, accountIds.includes('UU6974'));
      }
    }
    
    if (accountIds.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('PayinsTable - No account IDs found for view:', view);
      }
      return [];
    }
    
    const filtered = payins.filter(payin => {
      const payinAccountId = payin.zerodha_user_id;
      // Exclude payins without account ID - only include payins from classified accounts
      if (!payinAccountId) {
        return false;
      }
      // Normalize account IDs for comparison (trim whitespace, case-insensitive)
      const normalizedPayinId = payinAccountId.trim();
      return accountIds.some(accountId => accountId.trim().toUpperCase() === normalizedPayinId.toUpperCase());
    });
    
    // Debug logging
    if (process.env.NODE_ENV === 'development') {
      console.log(`PayinsTable ${view} - Filtered payins count:`, filtered.length);
      const uu6974Filtered = filtered.filter(p => {
        const id = p.zerodha_user_id?.trim().toUpperCase();
        return id === 'UU6974';
      });
      console.log(`PayinsTable ${view} - UU6974 payins after filter:`, uu6974Filtered);
      
      // Also log all unique user IDs in the fetched payins to help debug
      const allUserIds = [...new Set(payins.map(p => p.zerodha_user_id).filter(Boolean))];
      console.log(`PayinsTable ${view} - All user IDs in fetched payins:`, allUserIds);
      console.log(`PayinsTable ${view} - Account IDs to match:`, accountIds);
    }
    
    return filtered;
  }, [payins, view]);

  const sortedPayins = React.useMemo(() => {
    let sorted = [...filteredPayins];

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
      console.error('Error deleting payin:', err);
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
        <p>{error}</p>
        <button onClick={fetchPayins} className="btn-retry">Retry</button>
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

      {sortedPayins.length === 0 ? (
        <div className="payins-empty">
          <p>No payins found</p>
          {process.env.NODE_ENV === 'development' && (
            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#6b7280' }}>
              <p>Debug Info:</p>
              <p>Current View: {view}</p>
              <p>Total Payins Fetched: {payins.length}</p>
              <p>Filtered Payins: {filteredPayins.length}</p>
              {payins.length > 0 && (
                <p>User IDs in fetched payins: {[...new Set(payins.map(p => p.zerodha_user_id).filter(Boolean))].join(', ')}</p>
              )}
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

