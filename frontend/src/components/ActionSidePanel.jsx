import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { syncAPI } from '../services/api';
import './ActionSidePanel.css';

// Helper to get connection status (prioritizes MAIN, but shows any connected account)
const getMainAccountStatus = () => {
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    const tokens = tokensJson ? JSON.parse(tokensJson) : {};
    const detailsJson = localStorage.getItem('account_details');
    const details = detailsJson ? JSON.parse(detailsJson) : {};
    
    // If no tokens at all, return disconnected (no logging - this is expected before connection)
    if (!tokens || Object.keys(tokens).length === 0) {
      return { isConnected: false, user_id: null, user_name: null, access_token: null };
    }
    
    let accountId = null;
    
    // Priority 1: Check default_trading_account (this is set when connecting)
    const defaultAccount = localStorage.getItem('default_trading_account');
    if (defaultAccount && tokens[defaultAccount] && tokens[defaultAccount].access_token) {
      accountId = defaultAccount;
    }
    
    // Priority 2: Find MAIN account - check account_details
    if (!accountId) {
      accountId = Object.keys(details).find(userId => 
        details[userId]?.account_type === 'MAIN' && tokens[userId] && tokens[userId].access_token
      );
    }
    
    // Priority 3: Check market_data_account preference
    if (!accountId) {
      const marketDataAccount = localStorage.getItem('market_data_account');
      if (marketDataAccount && tokens[marketDataAccount] && tokens[marketDataAccount].access_token) {
        accountId = marketDataAccount;
      }
    }
    
    // Priority 4: Use any connected account (fallback to first available with valid token)
    if (!accountId) {
      accountId = Object.keys(tokens).find(userId => 
        tokens[userId] && tokens[userId].access_token
      );
    }
    
    // Return connection status
    if (accountId && tokens[accountId] && tokens[accountId].access_token) {
      return { 
        isConnected: true, 
        user_id: accountId,
        user_name: tokens[accountId].user_name || accountId,
        access_token: tokens[accountId].access_token
      };
    }
    
    return { isConnected: false, user_id: null, user_name: null, access_token: null };
  } catch (error) {
    console.error('Error getting account status:', error);
    return { isConnected: false, user_id: null, user_name: null, access_token: null };
  }
};

const ActionSidePanel = ({ onActionClick }) => {
  const [hoveredAction, setHoveredAction] = useState(null);
  const [zerodhaStatus, setZerodhaStatus] = useState({ isConnected: false });
  const [showZerodhaMenu, setShowZerodhaMenu] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showLastSyncData, setShowLastSyncData] = useState(false);
  const [lastSyncData, setLastSyncData] = useState(null);
  const zerodhaMenuRef = useRef(null);

  // Helper to get access token
  const getAccessToken = () => {
    try {
      const tokensJson = localStorage.getItem('zerodha_account_tokens');
      const tokens = tokensJson ? JSON.parse(tokensJson) : {};
      if (zerodhaStatus.user_id && tokens[zerodhaStatus.user_id]) {
        return tokens[zerodhaStatus.user_id].access_token;
      }
      // Fallback to old storage
      return localStorage.getItem('zerodha_access_token');
    } catch {
      return null;
    }
  };

  const handleZerodhaSync = async () => {
    const accessToken = getAccessToken();
    if (!accessToken) {
      alert('Please connect to Zerodha first.');
      setShowZerodhaMenu(false);
      return;
    }

    try {
      setSyncing(true);
      const response = await syncAPI.syncAll(accessToken);
      if (response.success) {
        alert(`Sync completed: ${response.updated || 0} trades updated`);
        // Trigger refresh
        window.dispatchEvent(new CustomEvent('zerodhaSyncComplete'));
      } else {
        alert(`Sync failed: ${response.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to sync: ${err.message || 'Unknown error'}`);
      console.error('Error syncing:', err);
    } finally {
      setSyncing(false);
      setShowZerodhaMenu(false);
    }
  };

  const handleShowLastSyncData = async () => {
    try {
      console.log('Fetching last sync data...');
      const data = await syncAPI.getLastSyncData();
      console.log('Last sync data received:', data);
      setLastSyncData(data);
      setShowLastSyncData(true);
      setShowZerodhaMenu(false);
      console.log('Modal should be visible now');
    } catch (err) {
      alert(`Failed to fetch last sync data: ${err.message || 'Unknown error'}`);
      console.error('Error fetching last sync data:', err);
    }
  };

  const handleZerodhaConnect = () => {
    setShowZerodhaMenu(false);
    onActionClick('zerodha-sync');
  };

  const handleZerodhaDisconnect = () => {
    if (window.confirm('Are you sure you want to disconnect from Zerodha?')) {
      // Get all tokens
      try {
        const tokensJson = localStorage.getItem('zerodha_account_tokens');
        const tokens = tokensJson ? JSON.parse(tokensJson) : {};
        
        // Remove the main account token
        if (zerodhaStatus.user_id && tokens[zerodhaStatus.user_id]) {
          delete tokens[zerodhaStatus.user_id];
          localStorage.setItem('zerodha_account_tokens', JSON.stringify(tokens));
        }
        
        // Also clear old storage for backward compatibility
        localStorage.removeItem('zerodha_access_token');
        localStorage.removeItem('zerodha_user_id');
        localStorage.removeItem('zerodha_user_name');
        
        // Update status
        setZerodhaStatus({ isConnected: false, user_id: null });
        
        // Dispatch event to notify other components
        window.dispatchEvent(new CustomEvent('zerodhaStatusChanged'));
        window.dispatchEvent(new StorageEvent('storage', { key: 'zerodha_account_tokens' }));
        
        alert('Disconnected from Zerodha');
      } catch (err) {
        console.error('Error disconnecting:', err);
        alert('Failed to disconnect');
      }
    }
    setShowZerodhaMenu(false);
  };

  useEffect(() => {
    let lastLoggedStatus = null;
    
    const updateStatus = () => {
      const newStatus = getMainAccountStatus();
      // Only update if status actually changed to avoid unnecessary re-renders
      setZerodhaStatus(prevStatus => {
        const statusChanged = prevStatus.isConnected !== newStatus.isConnected || 
            prevStatus.user_id !== newStatus.user_id ||
            prevStatus.access_token !== newStatus.access_token;
        
        if (statusChanged) {
          // Only log when status actually changes (not on every check)
          const statusKey = `${newStatus.isConnected}-${newStatus.user_id}`;
          if (lastLoggedStatus !== statusKey) {
            console.log('ActionSidePanel: Status changed', {
              prev: prevStatus,
              new: newStatus
            });
            lastLoggedStatus = statusKey;
          }
          return newStatus;
        }
        return prevStatus;
      });
    };
    
    // Update immediately
    updateStatus();
    
    // Update every 2 seconds to catch changes (reduced frequency to minimize checks)
    const interval = setInterval(updateStatus, 2000);
    
    // Listen for storage changes (cross-tab and same-tab)
    const handleStorageChange = (e) => {
      if (e.key === 'zerodha_account_tokens' || 
          e.key === 'default_trading_account' || 
          e.key === 'account_details' ||
          e.key === 'market_data_account') {
        // Small delay to ensure localStorage is updated
        setTimeout(updateStatus, 100);
      }
    };
    
    // Listen for custom status change events
    const handleStatusChange = () => {
      setTimeout(updateStatus, 100);
    };
    
    // Also listen for custom storage events (for same-tab updates)
    const handleCustomStorage = () => {
      setTimeout(updateStatus, 100);
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('zerodhaStatusChanged', handleStatusChange);
    // Listen for custom storage event that ZerodhaAuth dispatches
    window.addEventListener('zerodhaAccountUpdated', handleCustomStorage);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('zerodhaStatusChanged', handleStatusChange);
      window.removeEventListener('zerodhaAccountUpdated', handleCustomStorage);
    };
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (zerodhaMenuRef.current && !zerodhaMenuRef.current.contains(event.target)) {
        setShowZerodhaMenu(false);
      }
    };

    if (showZerodhaMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showZerodhaMenu]);

  const actions = useMemo(() => [
    {
      id: 'payin',
      icon: '+',
      label: 'Payin',
      tooltip: 'Add Payin Transaction'
    },
    {
      id: 'buy',
      icon: '$',
      label: 'Buy Trade',
      tooltip: 'Buy New Trade'
    },
    {
      id: 'decision-assistant',
      icon: '⚖️',
      label: 'Decision Assistant',
      tooltip: 'Compare stocks and get recommendations'
    },
    {
      id: 'payin-history',
      icon: '📋',
      label: 'Payin History',
      tooltip: 'View Payin History'
    },
    {
      id: 'snapshots',
      icon: '📊',
      label: 'Snapshots',
      tooltip: 'View Portfolio Snapshots'
    },
    {
      id: 'charts',
      icon: '📈',
      label: 'Charts',
      tooltip: 'View Portfolio Charts'
    },
    {
      id: 'settings',
      icon: '⚙',
      label: 'Settings',
      tooltip: 'Settings & Preferences'
    },
    {
      id: 'zerodha-sync',
      icon: '↻',
      label: 'Zerodha Sync',
      tooltip: zerodhaStatus.isConnected 
        ? `Connected: ${zerodhaStatus.user_id || zerodhaStatus.user_name || 'Zerodha'}` 
        : 'Connect to Zerodha',
      hasStatus: true,
      isConnected: zerodhaStatus.isConnected
    }
  ], [zerodhaStatus.isConnected, zerodhaStatus.user_id, zerodhaStatus.user_name]);

  return (
    <div className="action-side-panel">
      {actions.map((action) => {
        // Special handling for zerodha-sync to show menu
        if (action.id === 'zerodha-sync') {
          return (
            <div
              key={action.id}
              className="action-icon-wrapper"
              ref={zerodhaMenuRef}
              onMouseEnter={() => setHoveredAction(action.id)}
              onMouseLeave={() => {
                setHoveredAction(null);
                // Don't close menu on mouse leave, only on click outside
              }}
            >
              <button 
                className={`action-icon-btn ${action.disabled ? 'disabled' : ''}`}
                title={action.tooltip}
                disabled={action.disabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowZerodhaMenu(!showZerodhaMenu);
                }}
              >
                <span className={`action-icon ${action.id === 'settings' ? 'icon-settings' : ''}`}>{action.icon}</span>
                {action.hasStatus && (
                  <span className={`status-dot ${action.isConnected ? 'status-green' : 'status-red'}`}></span>
                )}
              </button>
              {showZerodhaMenu && (
                <div className="zerodha-menu">
                  {/* Connection Status Header */}
                  <div className="zerodha-menu-status">
                    <div className="zerodha-menu-status-indicator">
                      <span className={`zerodha-status-dot ${zerodhaStatus.isConnected ? 'status-green' : 'status-red'}`}></span>
                      <span className="zerodha-status-text">
                        {zerodhaStatus.isConnected 
                          ? `Connected: ${zerodhaStatus.user_id || zerodhaStatus.user_name || 'Zerodha'}` 
                          : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {zerodhaStatus.isConnected ? (
                    <>
                      <button
                        className="zerodha-menu-item"
                        onClick={handleZerodhaSync}
                        disabled={syncing}
                      >
                        {syncing ? 'Syncing...' : '🔄 Sync with Zerodha'}
                      </button>
                      <button
                        className="zerodha-menu-item"
                        onClick={handleShowLastSyncData}
                      >
                        📋 Last Sync Data
                      </button>
                      <button
                        className="zerodha-menu-item"
                        onClick={handleZerodhaConnect}
                      >
                        ⚙️ Manage Connection
                      </button>
                      <button
                        className="zerodha-menu-item zerodha-menu-item-danger"
                        onClick={handleZerodhaDisconnect}
                      >
                        🔌 Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      className="zerodha-menu-item"
                      onClick={handleZerodhaConnect}
                    >
                      🔗 Connect to Zerodha
                    </button>
                  )}
                </div>
              )}
              {hoveredAction === action.id && !showZerodhaMenu && (
                <div className="action-tooltip">
                  {action.tooltip}
                </div>
              )}
            </div>
          );
        }

        // Regular actions
        return (
          <div
            key={action.id}
            className="action-icon-wrapper"
            onMouseEnter={() => setHoveredAction(action.id)}
            onMouseLeave={() => setHoveredAction(null)}
          >
            <button 
              className={`action-icon-btn ${action.disabled ? 'disabled' : ''}`}
              title={action.tooltip}
              disabled={action.disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (action.isCustom && action.onClick) {
                  action.onClick(e);
                } else {
                  onActionClick(action.id);
                }
              }}
            >
              <span className={`action-icon ${action.id === 'settings' ? 'icon-settings' : ''}`}>{action.icon}</span>
              {action.hasStatus && (
                <span className={`status-dot ${action.isConnected ? 'status-green' : 'status-red'}`}></span>
              )}
            </button>
            {hoveredAction === action.id && (
              <div className="action-tooltip">
                {action.tooltip}
              </div>
            )}
          </div>
        );
      }      )}

      {showLastSyncData && createPortal(
        <div 
          className="debug-overlay" 
          onClick={() => setShowLastSyncData(false)} 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            padding: '1rem' 
          }}
        >
          <div 
            className="debug-panel" 
            onClick={(e) => e.stopPropagation()} 
            style={{ 
              backgroundColor: 'white', 
              borderRadius: '12px', 
              maxWidth: '90vw', 
              maxHeight: '90vh', 
              overflow: 'hidden', 
              display: 'flex', 
              flexDirection: 'column', 
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)' 
            }}
          >
            <div 
              className="debug-header" 
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '1.5rem', 
                borderBottom: '1px solid #e5e7eb', 
                background: '#f9fafb' 
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#1a1a1a' }}>Last Sync Data from Zerodha</h3>
                {lastSyncData && lastSyncData.timestamp && (
                  <p style={{ fontSize: '0.9em', color: '#666', margin: '0.5em 0 0 0' }}>
                    Synced at: {new Date(lastSyncData.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
              <button 
                className="btn-close" 
                onClick={() => setShowLastSyncData(false)} 
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  fontSize: '24px', 
                  cursor: 'pointer', 
                  width: '32px', 
                  height: '32px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  borderRadius: '6px', 
                  color: '#6b7280' 
                }}
              >
                ×
              </button>
            </div>
            <div 
              className="debug-content" 
              style={{ 
                padding: '1.5rem', 
                overflowY: 'auto', 
                flex: 1 
              }}
            >
              {lastSyncData && lastSyncData.positions && Array.isArray(lastSyncData.positions) && lastSyncData.positions.length > 0 && (
                <div className="debug-section" style={{ marginBottom: '2rem' }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: '#374151' }}>Positions ({lastSyncData.positions.length})</h4>
                  <pre style={{ background: '#1a1a1a', color: '#e5e7eb', padding: '1rem', borderRadius: '8px', overflowX: 'auto', fontSize: '0.875rem', lineHeight: 1.5, margin: 0 }}>{JSON.stringify(lastSyncData.positions, null, 2)}</pre>
                </div>
              )}
              {lastSyncData && lastSyncData.holdings && Array.isArray(lastSyncData.holdings) && lastSyncData.holdings.length > 0 && (
                <div className="debug-section" style={{ marginBottom: '2rem' }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: '#374151' }}>Holdings ({lastSyncData.holdings.length})</h4>
                  <pre style={{ background: '#1a1a1a', color: '#e5e7eb', padding: '1rem', borderRadius: '8px', overflowX: 'auto', fontSize: '0.875rem', lineHeight: 1.5, margin: 0 }}>{JSON.stringify(lastSyncData.holdings, null, 2)}</pre>
                </div>
              )}
              {lastSyncData && lastSyncData.quotes && typeof lastSyncData.quotes === 'object' && Object.keys(lastSyncData.quotes).length > 0 && (
                <div className="debug-section" style={{ marginBottom: '2rem' }}>
                  <h4 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: 600, color: '#374151' }}>Quotes ({Object.keys(lastSyncData.quotes).length} symbols)</h4>
                  <pre style={{ background: '#1a1a1a', color: '#e5e7eb', padding: '1rem', borderRadius: '8px', overflowX: 'auto', fontSize: '0.875rem', lineHeight: 1.5, margin: 0 }}>{JSON.stringify(lastSyncData.quotes, null, 2)}</pre>
                </div>
              )}
              {(!lastSyncData || 
                (!lastSyncData.positions || !Array.isArray(lastSyncData.positions) || lastSyncData.positions.length === 0) && 
                (!lastSyncData.holdings || !Array.isArray(lastSyncData.holdings) || lastSyncData.holdings.length === 0) && 
                (!lastSyncData.quotes || typeof lastSyncData.quotes !== 'object' || Object.keys(lastSyncData.quotes).length === 0)) && (
                <div className="debug-section">
                  <p>No sync data available. Please sync first.</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ActionSidePanel;

