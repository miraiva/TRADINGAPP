import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { zerodhaAPI, syncAPI, debugAPI, migrationAPI } from '../services/api';
import { websocketService } from '../services/websocket';
import './ZerodhaAuth.css';

// Helper functions for multi-account token storage
const getAccountTokens = () => {
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    return tokensJson ? JSON.parse(tokensJson) : {};
  } catch {
    return {};
  }
};

const saveAccountToken = (userId, accessToken, userName) => {
  const tokens = getAccountTokens();
  tokens[userId] = {
    access_token: accessToken,
    user_name: userName,
    connected_at: new Date().toISOString()
  };
  localStorage.setItem('zerodha_account_tokens', JSON.stringify(tokens));
};

const getAccountToken = (userId) => {
  const tokens = getAccountTokens();
  return tokens[userId]?.access_token || null;
};

const getAllConnectedAccounts = () => {
  const tokens = getAccountTokens();
  return Object.keys(tokens).map(userId => ({
    user_id: userId,
    user_name: tokens[userId].user_name,
    access_token: tokens[userId].access_token
  }));
};

// Helper to get account details (for account type)
const getAccountDetails = () => {
  try {
    const accountsJson = localStorage.getItem('account_details');
    return accountsJson ? JSON.parse(accountsJson) : {};
  } catch {
    return {};
  }
};

// Helper to get MAIN account connection status
const getMainAccountStatus = () => {
  const tokens = getAccountTokens();
  const details = getAccountDetails();
  
  // Find MAIN account - check account_details first
  let mainAccountId = Object.keys(details).find(userId => details[userId].account_type === 'MAIN');
  
  // If not found in details, check tokens (might be connected but not configured yet)
  if (!mainAccountId) {
    mainAccountId = Object.keys(tokens).find(userId => {
      const accountDetails = getAccountDetails();
      return accountDetails[userId]?.account_type === 'MAIN';
    });
  }
  
  // If still not found, check market_data_account preference as fallback
  if (!mainAccountId) {
    const marketDataAccount = localStorage.getItem('market_data_account');
    if (marketDataAccount && tokens[marketDataAccount]) {
      mainAccountId = marketDataAccount;
    }
  }
  
  // If still not found, check default_trading_account
  if (!mainAccountId) {
    const defaultAccount = localStorage.getItem('default_trading_account');
    if (defaultAccount && tokens[defaultAccount]) {
      mainAccountId = defaultAccount;
    }
  }
  
  // If still not found, use any connected account (fallback to first available)
  if (!mainAccountId && Object.keys(tokens).length > 0) {
    mainAccountId = Object.keys(tokens)[0];
  }
  
  if (mainAccountId && tokens[mainAccountId]) {
    return {
      isConnected: true,
      user_id: mainAccountId,
      user_name: tokens[mainAccountId].user_name,
      access_token: tokens[mainAccountId].access_token
    };
  }
  
  return { isConnected: false, user_id: null, user_name: null, access_token: null };
};

const ZerodhaAuth = ({ onAuthSuccess, onSyncComplete, compact = false, targetUserId = null }) => {
  // Get all connected accounts
  const connectedAccounts = getAllConnectedAccounts();
  
  // Get current account from preferences or first connected account
  const defaultAccount = localStorage.getItem('default_trading_account') || (connectedAccounts.length > 0 ? connectedAccounts[0].user_id : null);
  const currentToken = defaultAccount ? getAccountToken(defaultAccount) : null;
  const currentAccount = connectedAccounts.find(acc => acc.user_id === defaultAccount);
  
  const [accessToken, setAccessToken] = useState(currentToken);
  const [userId, setUserId] = useState(defaultAccount);
  const [userName, setUserName] = useState(currentAccount?.user_name || null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugData, setDebugData] = useState(null);
  const [migrationAttempted, setMigrationAttempted] = useState(false);
  const [showLastSyncData, setShowLastSyncData] = useState(false);
  const [lastSyncData, setLastSyncData] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [availableUserIds, setAvailableUserIds] = useState([]);
  const [loadingUserIds, setLoadingUserIds] = useState(false);
  const [websocketError, setWebsocketError] = useState(false);

  // Check for OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const requestToken = urlParams.get('request_token');
    const status = urlParams.get('status');

    if (requestToken && status === 'success') {
      handleTokenExchange(requestToken);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Listen to websocket errors and connection state
  useEffect(() => {
    const handleWebsocketError = (error) => {
      console.error('ZerodhaAuth: WebSocket error detected:', error);
      const mainStatus = getMainAccountStatus();
      if (mainStatus.isConnected) {
        console.log('ZerodhaAuth: Setting websocket error state to true');
        setWebsocketError(true);
      }
    };

    const handleWebsocketConnected = () => {
      console.log('ZerodhaAuth: WebSocket connected successfully');
      // Clear error when websocket connects successfully
      setWebsocketError(false);
    };

    const handleWebsocketDisconnected = () => {
      console.log('ZerodhaAuth: WebSocket disconnected');
      // Set error if disconnected (but only if auth is successful)
      const mainStatus = getMainAccountStatus();
      if (mainStatus.isConnected) {
        // When websocket disconnects and auth is successful, set error state
        // The periodic check will clear it if websocket reconnects
        console.log('ZerodhaAuth: Auth successful but WebSocket disconnected, setting error state');
        setWebsocketError(true);
      }
    };

    // Check websocket connection state
    const checkWebsocketState = () => {
      const mainStatus = getMainAccountStatus();
      
      if (mainStatus.isConnected) {
        // If auth is successful, check if websocket is connected
        const ws = websocketService.ws;
        const isWsConnected = websocketService.isConnected();
        
        // Check if websocket exists and its state
        if (ws) {
          const readyState = ws.readyState;
          // WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3
          if (readyState === WebSocket.CLOSED) {
            // WebSocket is closed - this indicates an error if auth is successful
            if (!websocketError) {
              console.log('ZerodhaAuth: Auth successful but WebSocket is CLOSED, setting error state');
            }
            setWebsocketError(true);
          } else if (readyState === WebSocket.OPEN) {
            // WebSocket is open, clear error
            if (websocketError) {
              console.log('ZerodhaAuth: WebSocket is now OPEN, clearing error state');
            }
            setWebsocketError(false);
          }
          // CONNECTING and CLOSING states are transient, don't change error state
        } else if (!isWsConnected) {
          // No websocket instance exists and not connected - if auth is successful, set error
          // This handles the case where websocket was never created or was cleaned up
          if (!websocketError) {
            console.log('ZerodhaAuth: Auth successful but no WebSocket instance, setting error state');
          }
          setWebsocketError(true);
        }
      } else {
        // Auth not successful, clear websocket error state
        if (websocketError) {
          setWebsocketError(false);
        }
      }
    };

    // Check immediately
    checkWebsocketState();

    // Register callbacks
    websocketService.onError(handleWebsocketError);
    websocketService.onConnected(handleWebsocketConnected);
    websocketService.onDisconnected(handleWebsocketDisconnected);

    // Periodically check websocket state (in case callbacks miss something)
    const interval = setInterval(checkWebsocketState, 2000);

    // Cleanup
    return () => {
      clearInterval(interval);
    };
  }, [websocketError]); // Include websocketError in dependencies to avoid stale closure

  // Refresh connection status when account tokens change
  useEffect(() => {
    const refreshConnectionStatus = () => {
      const accounts = getAllConnectedAccounts();
      // Check if there are any connected accounts at all
      if (accounts.length > 0) {
        const defaultAcc = localStorage.getItem('default_trading_account') || accounts[0].user_id;
        const token = getAccountToken(defaultAcc);
        const account = accounts.find(acc => acc.user_id === defaultAcc) || accounts[0];
        
        // Update state if it's different
        if (token && (token !== accessToken || defaultAcc !== userId)) {
          setAccessToken(token);
          setUserId(defaultAcc);
          setUserName(account?.user_name || null);
        }
      } else {
        // No accounts connected
        if (accessToken) {
          setAccessToken(null);
          setUserId(null);
          setUserName(null);
        }
      }
    };
    
    // Refresh immediately
    refreshConnectionStatus();
    
    // Also refresh when storage changes (e.g., after connecting)
    const handleStorageChange = (e) => {
      if (e.key === 'zerodha_account_tokens' || e.key === 'default_trading_account' || e.key === 'account_details') {
        refreshConnectionStatus();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically (in case of same-tab updates)
    const interval = setInterval(refreshConnectionStatus, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [accessToken, userId]); // Include dependencies to avoid stale closures

  // Auto-migration on mount if connected
  useEffect(() => {
    if (accessToken && !migrationAttempted) {
      setMigrationAttempted(true);
      handleAutoMigration();
    }
  }, [accessToken]);

  // Fetch available user IDs with API keys on mount
  useEffect(() => {
    const fetchAvailableUserIds = async () => {
      try {
        setLoadingUserIds(true);
        const response = await zerodhaAPI.getAllApiKeys();
        if (response.api_keys && response.api_keys.length > 0) {
          const userIds = response.api_keys.map(key => key.zerodha_user_id);
          setAvailableUserIds(userIds);
          // Set default selection to first user ID if none selected
          if (!selectedUserId && userIds.length > 0) {
            setSelectedUserId(userIds[0]);
          }
        } else {
          setAvailableUserIds([]);
        }
      } catch (err) {
        console.error('Error fetching available user IDs:', err);
        setAvailableUserIds([]);
      } finally {
        setLoadingUserIds(false);
      }
    };

    // Only fetch if not connected (when showing connect button)
    if (!accessToken) {
      fetchAvailableUserIds();
    }
  }, [accessToken]);

  const handleConnect = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Use selectedUserId from dropdown, or targetUserId prop, or try to get from account_details
      let userIdToUse = selectedUserId || targetUserId;
      if (!userIdToUse) {
        // Try to get from account_details (if user is connecting from Settings)
        const accountDetails = getAccountDetails();
        const accountIds = Object.keys(accountDetails);
        if (accountIds.length === 1) {
          userIdToUse = accountIds[0];
        }
      }
      
      // Validate that a user ID is selected
      if (!userIdToUse) {
        setError('Please select a User ID from the dropdown');
        setLoading(false);
        return;
      }
      
      // Use POST method with user_id (this will use the API key from database for that user)
      const response = await zerodhaAPI.getLoginUrlPost(userIdToUse);
      
      if (response.login_url) {
        // Store selectedUserId in sessionStorage so we can use it after OAuth redirect
        sessionStorage.setItem('zerodha_connecting_user_id', userIdToUse);
        window.location.href = response.login_url;
      }
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to get login URL';
      setError(errorMsg);
      console.error('Error getting login URL:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTokenExchange = async (requestToken, targetAccountId = null) => {
    try {
      setLoading(true);
      setError(null);
      
      // Get expected user_id from sessionStorage (set during connect)
      const expectedUserId = targetAccountId || sessionStorage.getItem('zerodha_connecting_user_id');
      sessionStorage.removeItem('zerodha_connecting_user_id');
      
      let response;
      if (expectedUserId) {
        // Use user-specific token exchange
        response = await zerodhaAPI.exchangeTokenWithUser(requestToken, expectedUserId);
      } else {
        // Fallback to legacy method (backward compatibility)
        response = await zerodhaAPI.exchangeToken(requestToken);
      }
      
      if (response.access_token) {
        const newUserId = response.user_id;
        const newUserName = response.user_name || '';
        
        // Verify user_id matches expected (if we had one)
        if (expectedUserId && newUserId !== expectedUserId) {
          throw new Error(
            `User ID mismatch: Expected ${expectedUserId} but got ${newUserId}. ` +
            `Please ensure the API key in Settings matches the account you're connecting.`
          );
        }
        
        // Save token for this account
        saveAccountToken(newUserId, response.access_token, newUserName);
        
        // Always update state to reflect the newly connected account
        setAccessToken(response.access_token);
        setUserId(newUserId);
        setUserName(newUserName);
        
        // Check if this is a MAIN account and set as market_data_account
        const accountDetails = getAccountDetails();
        const isMainAccount = accountDetails[newUserId]?.account_type === 'MAIN';
        
        // Set as market_data_account if it's a MAIN account, or if no market_data_account is set
        if (isMainAccount) {
          localStorage.setItem('market_data_account', newUserId);
          console.log(`Set ${newUserId} as market_data_account (MAIN account)`);
        } else if (!localStorage.getItem('market_data_account')) {
          // If no market_data_account is set, use this one as fallback
          localStorage.setItem('market_data_account', newUserId);
          console.log(`Set ${newUserId} as market_data_account (fallback)`);
        }
        
        // Set as default if no default is set, or if this is the target account
        if (targetAccountId && targetAccountId === newUserId) {
          localStorage.setItem('default_trading_account', newUserId);
        } else if (!localStorage.getItem('default_trading_account')) {
          localStorage.setItem('default_trading_account', newUserId);
        }
        
        // Dispatch events to notify other components immediately
        window.dispatchEvent(new CustomEvent('zerodhaStatusChanged'));
        window.dispatchEvent(new CustomEvent('zerodhaAccountUpdated', {
          detail: { user_id: newUserId, access_token: response.access_token }
        }));
        
        // Backward compatibility: also save to old keys for first account
        const allAccounts = getAllConnectedAccounts();
        if (allAccounts.length === 1) {
          localStorage.setItem('zerodha_access_token', response.access_token);
          localStorage.setItem('zerodha_user_id', newUserId);
          localStorage.setItem('zerodha_user_name', newUserName);
        }
        
        if (onAuthSuccess) {
          onAuthSuccess(response.access_token, newUserId);
        }

        // Trigger status change event to update all components
        window.dispatchEvent(new CustomEvent('zerodhaStatusChanged'));
        // Also trigger storage event for cross-tab updates
        const storageEvent = new StorageEvent('storage', {
          key: 'zerodha_account_tokens',
          newValue: localStorage.getItem('zerodha_account_tokens'),
          oldValue: null
        });
        window.dispatchEvent(storageEvent);

        // Trigger migration after successful connection (only if not already migrated for this account)
        handleAutoMigration();
      }
    } catch (err) {
      const errorDetail = err.response?.data?.detail;
      
      // Handle API not enabled error
      if (err.response?.status === 403 || (errorDetail && errorDetail.error_type === 'API_NOT_ENABLED')) {
        const message = errorDetail?.message || 'This Zerodha account is not enabled for API access.';
        setError(
          <div>
            <strong>{message}</strong>
            <br />
            <br />
            <strong>To fix this:</strong>
            <ol style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', textAlign: 'left' }}>
              <li>Log in to Kite (kite.zerodha.com)</li>
              <li>Go to <strong>Settings → API</strong></li>
              <li>Click <strong>Enable API access</strong></li>
              <li>Make sure the API key is whitelisted for this account</li>
              <li>Try connecting again</li>
            </ol>
            <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
              Note: Each Zerodha account needs to enable API access separately.
            </p>
          </div>
        );
      } else {
        setError(errorDetail?.message || 'Failed to connect. Please try again.');
      }
      console.error('Error exchanging token:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoMigration = async () => {
    if (!accessToken || !userId) return;
    
    try {
      // Migration is per-account, so use current account's token
      const response = await migrationAPI.migrateHoldings(accessToken);
      if (response.success) {
        console.log(`Auto-migration completed for ${userId}:`, response.message);
        
        // Trigger price update after migration to populate LTP for migrated trades
        // Use market data account token (paid account) for price updates
        try {
          // Import dynamically to avoid circular dependencies
          const { tradesAPI } = await import('../services/api');
          const { getMarketDataToken } = await import('../services/api');
          const marketDataToken = getMarketDataToken();
          if (marketDataToken) {
            await tradesAPI.updatePrices('ZERODHA');
            console.log('Price update completed after migration');
          } else {
            console.warn('Market data token not available, skipping price update');
          }
        } catch (priceErr) {
          console.warn('Failed to update prices after migration:', priceErr);
          // Don't fail migration if price update fails
        }
        
        if (onSyncComplete) {
          onSyncComplete();
        }
      }
    } catch (err) {
      console.warn(`Auto-migration failed or already done for ${userId}:`, err);
    }
  };

  const handleSync = async () => {
    if (!accessToken) {
      setError('Please connect to Zerodha first.');
      return;
    }

    try {
      setSyncing(true);
      setError(null);
      setSyncStatus('Syncing...');
      
      const response = await syncAPI.syncAll(accessToken);
      
      if (response.success) {
        setSyncStatus(`Synced: ${response.updated || 0} trades updated`);
        setTimeout(() => setSyncStatus(null), 3000);
        
        if (onSyncComplete) {
          onSyncComplete();
        }
      } else {
        setError(response.message || 'Sync failed');
      }
    } catch (err) {
      setError('Failed to sync. Please try again.');
      console.error('Error syncing:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleShowLastSyncData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await syncAPI.getLastSyncData();
      console.log('Last sync data received:', data);
      setLastSyncData(data);
      setShowLastSyncData(true);
      console.log('Modal should be visible now');
    } catch (err) {
      setError('Failed to fetch last sync data.');
      console.error('Error fetching last sync data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDebug = async () => {
    if (!accessToken) {
      setError('Please connect to Zerodha first.');
      return;
    }

    try {
      setLoading(true);
      const [positionsData, holdingsData] = await Promise.all([
        debugAPI.getDebugPositions(accessToken),
        debugAPI.getDebugHoldings(accessToken)
      ]);
      
      setDebugData({
        positions: positionsData,
        holdings: holdingsData
      });
      setShowDebug(true);
    } catch (err) {
      setError('Failed to fetch debug data.');
      console.error('Error fetching debug data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    console.log('Disconnect clicked, userId:', userId);
    
    const tokens = getAccountTokens();
    console.log('Current tokens before disconnect:', Object.keys(tokens));
    
    if (userId && tokens[userId]) {
      // Disconnect current account
      delete tokens[userId];
      localStorage.setItem('zerodha_account_tokens', JSON.stringify(tokens));
      console.log('Removed token for:', userId);
      
      // Switch to another account if available
      const remainingAccounts = Object.keys(tokens);
      if (remainingAccounts.length > 0) {
        const newAccount = remainingAccounts[0];
        const newToken = tokens[newAccount].access_token;
        setAccessToken(newToken);
        setUserId(newAccount);
        setUserName(tokens[newAccount].user_name);
        localStorage.setItem('default_trading_account', newAccount);
        console.log('Switched to account:', newAccount);
      } else {
        // No accounts left, clear everything
        localStorage.removeItem('zerodha_account_tokens');
        localStorage.removeItem('zerodha_access_token');
        localStorage.removeItem('zerodha_user_id');
        localStorage.removeItem('zerodha_user_name');
        localStorage.removeItem('default_trading_account');
        setAccessToken(null);
        setUserId(null);
        setUserName(null);
        console.log('All accounts disconnected');
      }
    } else {
      // No current account, disconnect all
      localStorage.removeItem('zerodha_account_tokens');
      localStorage.removeItem('zerodha_access_token');
      localStorage.removeItem('zerodha_user_id');
      localStorage.removeItem('zerodha_user_name');
      localStorage.removeItem('default_trading_account');
      setAccessToken(null);
      setUserId(null);
      setUserName(null);
      console.log('All accounts disconnected (no current account)');
    }
    
    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent('zerodhaStatusChanged'));
    // Also trigger storage event for cross-tab updates
    const storageEvent = new StorageEvent('storage', {
      key: 'zerodha_account_tokens',
      newValue: localStorage.getItem('zerodha_account_tokens'),
      oldValue: null
    });
    window.dispatchEvent(storageEvent);
    
    setShowDebug(false);
    setDebugData(null);
    setError(null);
    setSyncStatus(null);
  };

  // Compact header version
  if (compact) {
    // Check MAIN account connection status (for header indicator)
    const mainAccountStatus = getMainAccountStatus();
    const isMainConnected = mainAccountStatus.isConnected;
    const mainAccountName = mainAccountStatus.user_name || mainAccountStatus.user_id || 'Main Account';
    
    return (
      <div className="zerodha-auth-compact">
        {!isMainConnected ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            {availableUserIds.length > 0 ? (
              <select
                className="form-select"
                value={selectedUserId || ''}
                onChange={(e) => setSelectedUserId(e.target.value)}
                disabled={loading || loadingUserIds}
                style={{ marginRight: '0.5rem', minWidth: '120px' }}
              >
                {!selectedUserId && <option value="">Select User</option>}
                {availableUserIds.map(userId => (
                  <option key={userId} value={userId}>
                    {userId}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              className="btn-zerodha-compact btn-zerodha-disconnected"
              onClick={handleConnect}
              disabled={loading || (availableUserIds.length > 0 && !selectedUserId)}
              title={availableUserIds.length > 0 ? `Connect ${selectedUserId || 'User'}` : "Connect Main Account"}
            >
              <span className="status-indicator status-red"></span>
              <span className="btn-text">Zerodha Sync</span>
            </button>
          </div>
        ) : (
          <div className="zerodha-compact-connected">
            <button
              className="btn-zerodha-compact btn-zerodha-connected"
              title={websocketError ? `Main Account Connected: ${mainAccountName} (WebSocket Error)` : `Main Account Connected: ${mainAccountName}`}
            >
              <span className={`status-indicator ${websocketError ? 'status-amber' : 'status-green'}`}></span>
              <span className="btn-text">Zerodha Sync</span>
            </button>
            <div className="zerodha-compact-menu">
              <button
                className="menu-item"
                onClick={handleSync}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : '🔄 Sync'}
              </button>
              <button
                className="menu-item"
                onClick={handleDebug}
                disabled={loading}
              >
                🔍 Debug
              </button>
              <button
                className="menu-item menu-item-danger"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDisconnect(e);
                }}
                type="button"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full version (original)
  return (
    <div className="zerodha-auth-container">
      {!accessToken ? (
        <div className="zerodha-auth-box">
          <div className="auth-content">
            <div className="auth-icon">🔗</div>
            <div className="auth-text">
              <h3>Connect to Zerodha</h3>
              <p>Sync your portfolio and execute trades directly</p>
            </div>
          </div>
          {availableUserIds.length > 0 ? (
            <div className="connect-form">
              <div className="form-group">
                <label htmlFor="userId-select">Select User ID:</label>
                <select
                  id="userId-select"
                  className="form-select"
                  value={selectedUserId || ''}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={loading || loadingUserIds}
                >
                  {!selectedUserId && <option value="">-- Select User ID --</option>}
                  {availableUserIds.map(userId => (
                    <option key={userId} value={userId}>
                      {userId}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn-connect"
                onClick={handleConnect}
                disabled={loading || !selectedUserId}
              >
                {loading ? 'Connecting...' : 'Connect to Zerodha'}
              </button>
            </div>
          ) : (
            <div className="connect-form">
              {loadingUserIds ? (
                <p className="loading-text">Loading available accounts...</p>
              ) : (
                <>
                  <p className="error-text" style={{ color: '#ef4444', marginBottom: '1rem' }}>
                    No API keys configured. Please add API keys in Settings first.
                  </p>
                  <button
                    className="btn-connect"
                    onClick={handleConnect}
                    disabled={true}
                  >
                    Connect to Zerodha
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="zerodha-auth-box connected">
          <div className="auth-content">
            <div className="auth-icon">✅</div>
            <div className="auth-text">
              <h3>Connected to Zerodha</h3>
              {userName && <p className="user-name">{userName}</p>}
              {userId && <p className="user-id">ID: {userId}</p>}
            </div>
          </div>
          <div className="auth-actions">
            <button
              className="btn-sync"
              onClick={handleSync}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : '🔄 Sync with Zerodha'}
            </button>
            <button
              className="btn-debug"
              onClick={handleDebug}
              disabled={loading}
              title="View raw Zerodha data"
            >
              🔍 Debug
            </button>
            <button
              className="btn-debug"
              onClick={handleShowLastSyncData}
              disabled={loading}
              title="View last sync JSON data"
            >
              📋 Last Sync Data
            </button>
            <button
              className="btn-disconnect"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDisconnect(e);
              }}
              type="button"
            >
              Disconnect
            </button>
          </div>
          {syncStatus && (
            <div className="sync-status success">{syncStatus}</div>
          )}
        </div>
      )}

      {error && (
        <div className="error-message">{error}</div>
      )}

      {showDebug && debugData && (
        <div className="debug-overlay" onClick={() => setShowDebug(false)}>
          <div className="debug-panel" onClick={(e) => e.stopPropagation()}>
            <div className="debug-header">
              <h3>Debug: Zerodha Data</h3>
              <button className="btn-close" onClick={() => setShowDebug(false)}>×</button>
            </div>
            <div className="debug-content">
              <div className="debug-section">
                <h4>Positions</h4>
                <pre>{JSON.stringify(debugData.positions, null, 2)}</pre>
              </div>
              <div className="debug-section">
                <h4>Holdings</h4>
                <pre>{JSON.stringify(debugData.holdings, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLastSyncData && createPortal(
        <div 
          className="debug-overlay" 
          onClick={() => {
            console.log('Closing modal');
            setShowLastSyncData(false);
          }}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            backgroundColor: 'rgba(0, 0, 0, 0.5)', 
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
              background: 'white',
              borderRadius: '12px',
              width: '90%',
              maxWidth: '800px',
              maxHeight: '80vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }}
          >
            <div className="debug-header">
              <div>
                <h3>Last Sync Data from Zerodha</h3>
                {lastSyncData && lastSyncData.timestamp && (
                  <p style={{ fontSize: '0.9em', color: '#666', margin: '0.5em 0 0 0' }}>
                    Synced at: {new Date(lastSyncData.timestamp).toLocaleString()}
                  </p>
                )}
              </div>
              <button 
                className="btn-close" 
                onClick={() => {
                  console.log('Close button clicked');
                  setShowLastSyncData(false);
                }}
              >
                ×
              </button>
            </div>
            <div className="debug-content">
              {lastSyncData && lastSyncData.positions && Array.isArray(lastSyncData.positions) && lastSyncData.positions.length > 0 && (
                <div className="debug-section">
                  <h4>Positions ({lastSyncData.positions.length})</h4>
                  <pre>{JSON.stringify(lastSyncData.positions, null, 2)}</pre>
                </div>
              )}
              {lastSyncData && lastSyncData.holdings && Array.isArray(lastSyncData.holdings) && lastSyncData.holdings.length > 0 && (
                <div className="debug-section">
                  <h4>Holdings ({lastSyncData.holdings.length})</h4>
                  <pre>{JSON.stringify(lastSyncData.holdings, null, 2)}</pre>
                </div>
              )}
              {lastSyncData && lastSyncData.quotes && typeof lastSyncData.quotes === 'object' && Object.keys(lastSyncData.quotes).length > 0 && (
                <div className="debug-section">
                  <h4>Quotes ({Object.keys(lastSyncData.quotes).length} symbols)</h4>
                  <pre>{JSON.stringify(lastSyncData.quotes, null, 2)}</pre>
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

export default ZerodhaAuth;

