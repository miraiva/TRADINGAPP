import React, { useState, useEffect } from 'react';
import { snapshotAPI } from '../services/api';
import { getCurrentView, getAccountIdsByStrategy, getAllAccountIds } from '../utils/accountUtils';
import { formatCurrencyWithMode, formatNumberWithMode } from '../utils/displayUtils';
import './SnapshotsTable.css';

const SnapshotsTable = ({ showHeader = false, onClose = null }) => {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'snapshot_date', direction: 'desc' });
  const [view, setView] = useState(getCurrentView());
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [showStrategyDropdown, setShowStrategyDropdown] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState('SWING');

  useEffect(() => {
    fetchSnapshots();
  }, [view]);

  // Listen for view changes from Dashboard
  useEffect(() => {
    const handleViewChange = () => {
      const newView = getCurrentView();
      setView(newView);
    };
    window.addEventListener('storage', handleViewChange);
    window.addEventListener('viewChanged', handleViewChange);
    const interval = setInterval(handleViewChange, 1000);
    return () => {
      window.removeEventListener('storage', handleViewChange);
      window.removeEventListener('viewChanged', handleViewChange);
      clearInterval(interval);
    };
  }, []);

  // Listen for snapshot creation
  useEffect(() => {
    const handleSnapshotCreated = () => {
      fetchSnapshots();
    };
    window.addEventListener('snapshotCreated', handleSnapshotCreated);
    return () => {
      window.removeEventListener('snapshotCreated', handleSnapshotCreated);
    };
  }, []);

  const fetchSnapshots = async () => {
    try {
      setLoading(true);
      setError(null);

      // Build query params based on current view
      const params = {};
      
      if (view === 'OVERALL') {
        params.trading_strategy = 'OVERALL';
      } else if (view === 'SWING') {
        params.trading_strategy = 'SWING';
        // Also get account IDs for SWING to include account-specific snapshots
        const accountIds = getAccountIdsByStrategy('SWING');
        if (accountIds.length > 0) {
          // Fetch all snapshots and filter in frontend since API doesn't support multiple account IDs
          // We'll fetch by strategy first, then also fetch by account IDs
        }
      } else if (view === 'LONG_TERM') {
        params.trading_strategy = 'LONG_TERM';
      }

      // Fetch snapshots with higher limit to get all records
      params.limit = 1000; // Increase limit to ensure we get all snapshots
      
      // If we have account IDs for the view, fetch snapshots for all accounts in a single API call
      // (in case they don't have trading_strategy set)
      if (view !== 'OVERALL') {
        const accountIds = getAccountIdsByStrategy(view === 'LONG_TERM' ? 'LONG_TERM' : 'SWING');
        console.log(`SnapshotsTable: Account IDs for ${view}:`, accountIds);
        if (accountIds.length > 0) {
          // Optimize: Use single API call with multiple account IDs instead of multiple calls
          params.zerodha_user_ids = accountIds.join(',');
        }
      }
      
      let data = await snapshotAPI.getSnapshots(params);
      
      console.log(`SnapshotsTable: Fetched ${data?.length || 0} snapshots for view=${view} with params:`, params);
      
      console.log(`SnapshotsTable: Setting ${data?.length || 0} snapshots`);
      setSnapshots(data || []);
    } catch (err) {
      console.error('Error fetching snapshots:', err);
      setError(err.message || 'Failed to fetch snapshots');
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key) => {
    setSortConfig(prevConfig => {
      if (prevConfig.key === key) {
        return { key, direction: prevConfig.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleDelete = async (snapshotId, snapshotDate) => {
    if (!window.confirm(`Are you sure you want to delete the snapshot for ${snapshotDate}?`)) {
      return;
    }

    try {
      setDeletingId(snapshotId);
      await snapshotAPI.deleteSnapshot(snapshotId);
      // Refresh the list
      await fetchSnapshots();
      // Dispatch event for other components
      window.dispatchEvent(new CustomEvent('snapshotDeleted'));
    } catch (err) {
      console.error('Error deleting snapshot:', err);
      alert(`Failed to delete snapshot: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateSnapshot = async (strategy = selectedStrategy) => {
    if (isCreatingSnapshot) return;
    
    setShowStrategyDropdown(false);
    
    try {
      setIsCreatingSnapshot(true);
      
      let accountIds = [];
      let tradingStrategy = strategy;
      
      if (strategy === 'OVERALL') {
        // Get all account IDs for OVERALL
        accountIds = getAllAccountIds();
        tradingStrategy = 'OVERALL';
      } else {
        // Get account IDs for the selected strategy
        accountIds = getAccountIdsByStrategy(strategy === 'LONG_TERM' ? 'LONG_TERM' : 'SWING');
        tradingStrategy = strategy === 'LONG_TERM' ? 'LONG_TERM' : 'SWING';
      }
      
      if (accountIds.length === 0) {
        alert(`No accounts found for ${strategy} view. Please configure accounts in Settings.`);
        return;
      }
      
      // Debug logging
      console.log(`Creating snapshot for ${tradingStrategy}:`, {
        strategy,
        tradingStrategy,
        accountIds,
        accountCount: accountIds.length
      });
      
      // Create snapshot
      const result = await snapshotAPI.createManualSnapshot(tradingStrategy, accountIds);
      
      console.log('Snapshot creation result:', result);
      
      // Show success message
      alert(`Snapshot created/updated successfully for ${result.date}!\n${result.message}`);
      
      // Refresh snapshots
      await fetchSnapshots();
      
      // Dispatch event to refresh dashboard if needed
      window.dispatchEvent(new CustomEvent('snapshotCreated'));
      
    } catch (error) {
      console.error('Error creating snapshot:', error);
      alert(`Failed to create snapshot: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleCreateButtonClick = () => {
    if (isCreatingSnapshot) return;
    setShowStrategyDropdown(!showStrategyDropdown);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showStrategyDropdown && !event.target.closest('.snapshots-create-wrapper')) {
        setShowStrategyDropdown(false);
      }
    };
    
    if (showStrategyDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showStrategyDropdown]);

  const sortedAndFilteredSnapshots = React.useMemo(() => {
    let filtered = [...snapshots];

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(snapshot => {
        const dateStr = snapshot.snapshot_date || '';
        const accountId = snapshot.zerodha_user_id || '';
        const strategy = snapshot.trading_strategy || '';
        return (
          dateStr.toLowerCase().includes(term) ||
          accountId.toLowerCase().includes(term) ||
          strategy.toLowerCase().includes(term)
        );
      });
    }

    // Sort
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // Handle null/undefined values - put them at the end
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Handle dates - convert to Date objects and compare numerically
        if (sortConfig.key === 'snapshot_date') {
          const aDate = new Date(aVal);
          const bDate = new Date(bVal);
          // Check if dates are valid
          if (isNaN(aDate.getTime()) && isNaN(bDate.getTime())) return 0;
          if (isNaN(aDate.getTime())) return 1;
          if (isNaN(bDate.getTime())) return -1;
          // Compare dates numerically
          const diff = aDate.getTime() - bDate.getTime();
          return sortConfig.direction === 'asc' ? diff : -diff;
        }

        // Handle numbers
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }

        // Handle strings
        const aStr = String(aVal).toLowerCase();
        const bStr = String(bVal).toLowerCase();
        
        if (sortConfig.direction === 'asc') {
          return aStr.localeCompare(bStr);
        } else {
          return bStr.localeCompare(aStr);
        }
      });
    }

    return filtered;
  }, [snapshots, searchTerm, sortConfig]);

  const formatCurrency = (value) => {
    if (value == null) return '-';
    return formatCurrencyWithMode(value);
  };

  const formatNumber = (value, decimals = 2) => {
    if (value == null) return '-';
    return formatNumberWithMode(value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-IN', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    } catch {
      return dateStr;
    }
  };

  if (loading && snapshots.length === 0) {
    return (
      <div className="snapshots-table-container">
        <div className="snapshots-loading">
          <div className="spinner"></div>
          <p>Loading snapshots...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="snapshots-table-container">
        <div className="snapshots-error">
          <p>Error: {error}</p>
          <button className="btn-retry" onClick={fetchSnapshots}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="snapshots-table-container">
      {showHeader && (
        <div className="snapshots-header">
          <h3>Portfolio Snapshots</h3>
        </div>
      )}

      <div className="snapshots-header-bar">
        <h3 className="snapshots-title">Portfolio Snapshots</h3>
        <div className="snapshots-header-info">
          <div className="snapshots-search">
            <input
              type="text"
              className="search-input"
              placeholder="Search by date, account, strategy..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="snapshots-create-wrapper">
            <button
              className="snapshots-create-btn"
              onClick={handleCreateButtonClick}
              disabled={isCreatingSnapshot}
              title="Create Snapshot"
            >
              {isCreatingSnapshot ? 'Creating...' : '📸 Create Snapshot'}
            </button>
            {showStrategyDropdown && !isCreatingSnapshot && (
              <div className="snapshots-strategy-dropdown">
                <div 
                  className={`snapshots-strategy-option ${selectedStrategy === 'SWING' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedStrategy('SWING');
                    handleCreateSnapshot('SWING');
                  }}
                >
                  Swing
                </div>
                <div 
                  className={`snapshots-strategy-option ${selectedStrategy === 'LONG_TERM' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedStrategy('LONG_TERM');
                    handleCreateSnapshot('LONG_TERM');
                  }}
                >
                  Long Term
                </div>
                <div 
                  className={`snapshots-strategy-option ${selectedStrategy === 'OVERALL' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedStrategy('OVERALL');
                    handleCreateSnapshot('OVERALL');
                  }}
                >
                  Overall
                </div>
              </div>
            )}
          </div>
          {onClose && (
            <button className="snapshots-close-btn" onClick={onClose} title="Close">
              ×
            </button>
          )}
        </div>
      </div>

      {sortedAndFilteredSnapshots.length === 0 ? (
        <div className="snapshots-empty">
          <p>No snapshots found</p>
        </div>
      ) : (
        <div className="snapshots-table-wrapper">
          <table className="snapshots-table">
            <thead>
              <tr>
                <th 
                  className={`sortable ${sortConfig.key === 'snapshot_date' ? `numeric-header` : ''}`}
                  data-sort-direction={sortConfig.key === 'snapshot_date' ? sortConfig.direction : null}
                  onClick={() => handleSort('snapshot_date')}
                >
                  Date
                  {sortConfig.key === 'snapshot_date' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  className={`sortable numeric-header`}
                  data-sort-direction={sortConfig.key === 'portfolio_value' ? sortConfig.direction : null}
                  onClick={() => handleSort('portfolio_value')}
                >
                  Portfolio Value
                  {sortConfig.key === 'portfolio_value' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  className={`sortable numeric-header`}
                  data-sort-direction={sortConfig.key === 'nav' ? sortConfig.direction : null}
                  onClick={() => handleSort('nav')}
                >
                  NAV
                  {sortConfig.key === 'nav' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  className={`sortable numeric-header`}
                  data-sort-direction={sortConfig.key === 'total_payin' ? sortConfig.direction : null}
                  onClick={() => handleSort('total_payin')}
                >
                  Payin
                  {sortConfig.key === 'total_payin' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  className={`sortable numeric-header`}
                  data-sort-direction={sortConfig.key === 'booked_pl' ? sortConfig.direction : null}
                  onClick={() => handleSort('booked_pl')}
                >
                  Booked P/L
                  {sortConfig.key === 'booked_pl' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  className={`sortable numeric-header`}
                  data-sort-direction={sortConfig.key === 'float_pl' ? sortConfig.direction : null}
                  onClick={() => handleSort('float_pl')}
                >
                  Float P/L
                  {sortConfig.key === 'float_pl' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  className={`sortable numeric-header`}
                  data-sort-direction={sortConfig.key === 'xirr' ? sortConfig.direction : null}
                  onClick={() => handleSort('xirr')}
                >
                  XIRR %
                  {sortConfig.key === 'xirr' && (
                    <span className="sort-icon">
                      {sortConfig.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th className="numeric-header">Account</th>
                <th className="numeric-header">Strategy</th>
                <th className="numeric-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredSnapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>{formatDate(snapshot.snapshot_date)}</td>
                  <td className={snapshot.portfolio_value >= 0 ? '' : 'negative'}>
                    {formatCurrency(snapshot.portfolio_value)}
                  </td>
                  <td>{formatNumber(snapshot.nav, 2)}</td>
                  <td>{formatCurrency(snapshot.total_payin)}</td>
                  <td className={snapshot.booked_pl >= 0 ? '' : 'negative'}>
                    {formatCurrency(snapshot.booked_pl)}
                  </td>
                  <td className={snapshot.float_pl >= 0 ? '' : 'negative'}>
                    {formatCurrency(snapshot.float_pl)}
                  </td>
                  <td className={snapshot.xirr >= 0 ? '' : 'negative'}>
                    {snapshot.xirr != null ? `${formatNumber(snapshot.xirr, 2)}%` : '-'}
                  </td>
                  <td>{snapshot.zerodha_user_id || '-'}</td>
                  <td>{snapshot.trading_strategy || '-'}</td>
                  <td>
                    <button
                      className="snapshot-delete-btn"
                      onClick={() => handleDelete(snapshot.id, formatDate(snapshot.snapshot_date))}
                      disabled={deletingId === snapshot.id}
                      title="Delete snapshot"
                    >
                      {deletingId === snapshot.id ? '...' : '🗑️'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {sortedAndFilteredSnapshots.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan="9" style={{ textAlign: 'right', fontWeight: 600 }}>
                    Total Snapshots: {sortedAndFilteredSnapshots.length}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
};

export default SnapshotsTable;

