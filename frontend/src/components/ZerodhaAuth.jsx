import React, { useState, useEffect, useRef } from 'react';
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
      // Clean URL but preserve any existing path to avoid navigation issues
      // Only remove query parameters, don't change the path
      const currentPath = window.location.pathname;
      window.history.replaceState({}, document.title, currentPath);
    }
  }, []);

  // Listen to websocket errors and connection state
  useEffect(() => {
    const handleWebsocketError = (error) => {
      // Log only error type, not full error object which might contain sensitive data
      console.error('ZerodhaAuth: WebSocket error detected');
      const mainStatus = getMainAccountStatus();
      if (mainStatus.isConnected) {
        setWebsocketError(true);
      }
    };

    const handleWebsocketConnected = () => {
      // Reduced logging - only log on state changes
      // console.log('ZerodhaAuth: WebSocket connected successfully');
      // Clear error when websocket connects successfully
      setWebsocketError(false);
    };

    const handleWebsocketDisconnected = () => {
      // Reduced logging - WebSocket disconnects are normal
      // console.log('ZerodhaAuth: WebSocket disconnected');
      // Only set error if WebSocket was actually connected before
      // Don't set error if WebSocket was never initialized (it's created on-demand)
      const mainStatus = getMainAccountStatus();
      const wasConnected = websocketService.isConnected() || (websocketService.ws && websocketService.ws.readyState === WebSocket.OPEN);
      
      if (mainStatus.isConnected && wasConnected) {
        // When websocket disconnects after being connected, don't log every time
        // The periodic check will clear it if websocket reconnects
        // Don't immediately set error - give it time to reconnect
        // setWebsocketError(true);
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
            // WebSocket is closed - only set error if it was previously connected
            // (might have been closed intentionally or temporarily)
            // Don't set error immediately as it might reconnect
            // Reduced logging - WebSocket state changes are frequent
            // Only set error if WebSocket was explicitly connected before
            // Otherwise, it's just not initialized yet (which is fine)
          } else if (readyState === WebSocket.OPEN) {
            // WebSocket is open, clear error
            // Reduced logging - connection state changes are frequent
            // if (websocketError) {
            //   console.log('ZerodhaAuth: WebSocket is now OPEN, clearing error state');
            // }
            setWebsocketError(false);
          }
          // CONNECTING and CLOSING states are transient, don't change error state
        } else {
          // No websocket instance exists - this is OK! WebSocket is created on-demand
          // (e.g., when TradesTable needs to update prices)
          // Only set error if WebSocket was explicitly connected and then disconnected
          // Don't set error just because WebSocket doesn't exist yet
          if (websocketError) {
            // Clear error if WebSocket doesn't exist - it will be created when needed
            setWebsocketError(false);
          }
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
  const fetchInProgressRef = useRef(false);
  const abortControllerRef = useRef(null);
  
  useEffect(() => {
    return () => {
      // Cleanup: abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    const fetchAvailableUserIds = async () => {
      // Prevent duplicate concurrent requests
      if (fetchInProgressRef.current) {
        return;
      }

      // Cancel any previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();
      fetchInProgressRef.current = true;

      try {
        setLoadingUserIds(true);
        
        // Get user IDs from backend API keys endpoint (which returns configured status)
        // Falls back to account_details in localStorage
        try {
          const response = await zerodhaAPI.getAllApiKeys();
          
          // Check if request was aborted
          if (abortControllerRef.current?.signal.aborted) {
            return;
          }
          
          if (response.api_keys && response.api_keys.length > 0) {
            // If API key is configured, get user IDs from account_details
            const accountDetailsJson = localStorage.getItem('account_details');
            const accountDetails = accountDetailsJson ? JSON.parse(accountDetailsJson) : {};
            const userIds = Object.keys(accountDetails).filter(id => id && id.trim() !== '');
            
            if (userIds.length > 0) {
              setAvailableUserIds(userIds);
              if (!selectedUserId && userIds.length > 0) {
                setSelectedUserId(userIds[0]);
              }
            } else {
              setAvailableUserIds([]);
            }
          } else {
            // No API keys configured, still show account_details user IDs
            const accountDetailsJson = localStorage.getItem('account_details');
            const accountDetails = accountDetailsJson ? JSON.parse(accountDetailsJson) : {};
            const userIds = Object.keys(accountDetails).filter(id => id && id.trim() !== '');
            setAvailableUserIds(userIds);
            if (!selectedUserId && userIds.length > 0) {
              setSelectedUserId(userIds[0]);
            }
          }
        } catch (localStorageErr) {
          // Reduced logging - localStorage errors are usually not critical
          // console.warn('Error fetching user IDs:', localStorageErr);
          // Fallback to localStorage
          const accountDetailsJson = localStorage.getItem('account_details');
          const accountDetails = accountDetailsJson ? JSON.parse(accountDetailsJson) : {};
          const userIds = Object.keys(accountDetails).filter(id => id && id.trim() !== '');
          setAvailableUserIds(userIds);
        }
      } catch (err) {
        // Don't log error if request was aborted
        if (err.name !== 'AbortError' && !abortControllerRef.current?.signal.aborted) {
          // Reduced logging - only log unexpected errors
          // console.error('Error fetching available user IDs:', err);
        }
        setAvailableUserIds([]);
      } finally {
        setLoadingUserIds(false);
        fetchInProgressRef.current = false;
      }
    };

    // Only fetch if not connected (when showing connect button)
    // Debounce to avoid rapid refetches
    if (!accessToken) {
      const timeoutId = setTimeout(() => {
        fetchAvailableUserIds();
      }, 200); // Small debounce
      return () => clearTimeout(timeoutId);
    }
  }, [accessToken, selectedUserId]);

  const handleConnect = async (e) => {
    // Prevent any default behavior
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Log for debugging
    console.log('handleConnect called', { selectedUserId, targetUserId, availableUserIds, loading });
    
    // Don't proceed if already loading
    if (loading) {
      console.log('Already loading, ignoring click');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      
      // Use selectedUserId from dropdown, or targetUserId prop, or try to get from account_details
      let userIdToUse = selectedUserId || targetUserId;
      
      // If no selectedUserId but we have availableUserIds, use the first one
      if (!userIdToUse && availableUserIds.length > 0) {
        userIdToUse = availableUserIds[0];
        setSelectedUserId(userIdToUse);
        console.log('Auto-selected first user ID:', userIdToUse);
      }
      
      if (!userIdToUse) {
        // Try to get from account_details (if user is connecting from Settings)
        const accountDetails = getAccountDetails();
        const accountIds = Object.keys(accountDetails);
        if (accountIds.length === 1) {
          userIdToUse = accountIds[0];
          console.log('Using single account from account_details:', userIdToUse);
        }
      }
      
      // Validate that a user ID is selected
      if (!userIdToUse) {
        const errorMsg = availableUserIds.length === 0 
          ? 'No API keys configured. Please add API keys in Settings first.'
          : 'Please select a User ID from the dropdown';
        setError(errorMsg);
        setLoading(false);
        console.error('No user ID available:', { availableUserIds, accountDetails: getAccountDetails() });
        return;
      }
      
      console.log('Connecting with user ID:', userIdToUse);
      
      // Use POST method with user_id (this will use the API key from database for that user)
      const response = await zerodhaAPI.getLoginUrlPost(userIdToUse);
      
      if (response.login_url) {
        // Store selectedUserId in sessionStorage so we can use it after OAuth redirect
        sessionStorage.setItem('zerodha_connecting_user_id', userIdToUse);
        
        // On mobile, ensure the redirect happens properly
        // Use setTimeout to ensure the redirect happens after any async operations
        setTimeout(() => {
          window.location.href = response.login_url;
        }, 100);
      } else {
        setError('Failed to get login URL from server');
        setLoading(false);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to get login URL';
      setError(errorMsg);
      console.error('Error getting login URL:', err);
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

        // Force immediate status refresh in this component
        // Use setTimeout to ensure localStorage is updated
        setTimeout(() => {
          // Manually trigger status refresh
          const accounts = getAllConnectedAccounts();
          if (accounts.length > 0) {
            const defaultAcc = localStorage.getItem('default_trading_account') || accounts[0].user_id;
            const token = getAccountToken(defaultAcc);
            const account = accounts.find(acc => acc.user_id === defaultAcc) || accounts[0];
            
            if (token) {
              setAccessToken(token);
              setUserId(defaultAcc);
              setUserName(account?.user_name || null);
            }
          }
          // Dispatch another status change event to ensure all components update
          window.dispatchEvent(new CustomEvent('zerodhaStatusChanged'));
        }, 100);

        // Trigger migration after successful connection (only if not already migrated for this account)
        handleAutoMigration();
        
        // Security: Never log access tokens, even partially
        console.log('Zerodha connected successfully');
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
        // Reduced logging - migration completion details not needed in console
        // console.log(`Auto-migration completed for ${userId}`);
        
        // Trigger price update after migration to populate LTP for migrated trades
        // Use market data account token (paid account) for price updates
        try {
          // Import dynamically to avoid circular dependencies
          const { tradesAPI } = await import('../services/api');
          const { getMarketDataToken } = await import('../services/api');
          const marketDataToken = getMarketDataToken();
          if (marketDataToken) {
            await tradesAPI.updatePrices('ZERODHA');
            // Reduced logging - price updates are routine operations
            // console.log('Price update completed after migration');
          } else {
            // console.warn('Market data token not available, skipping price update');
          }
        } catch (priceErr) {
          // Reduced logging - price update failures are handled silently
          // console.warn('Failed to update prices after migration:', priceErr);
          // Don't fail migration if price update fails
        }
        
        if (onSyncComplete) {
          onSyncComplete();
        }
      }
    } catch (err) {
      // Migration might fail if already done or account has no holdings - that's OK
      // Only log if it's not a 400 error (which usually means already migrated)
      if (err.response?.status !== 400) {
        // Reduced logging - only log unexpected migration errors
        // console.warn(`Auto-migration failed for ${userId}:`, err);
      } else {
        // Silent fail for 400 errors (already migrated or no holdings)
        // Reduced logging - skipped migrations are expected
        // console.log(`Auto-migration skipped or already done for ${userId}`);
      }
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
      // Reduced logging - sync data received is not critical to log
      // console.log('Last sync data received:', data);
      setLastSyncData(data);
      setShowLastSyncData(true);
      // console.log('Modal should be visible now');
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
                onTouchStart={(e) => {
                  // Ensure touch events work on mobile
                  e.stopPropagation();
                }}
                disabled={loading || !selectedUserId}
                style={{
                  cursor: (loading || !selectedUserId) ? 'not-allowed' : 'pointer',
                  opacity: (loading || !selectedUserId) ? 0.6 : 1
                }}
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

