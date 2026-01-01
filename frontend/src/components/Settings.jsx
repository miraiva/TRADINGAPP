import React, { useState, useEffect } from 'react';
import ImportTrades from './ImportTrades';
import ImportPayins from './ImportPayins';
import { zerodhaAPI } from '../services/api';
import './Settings.css';

// Helper to get connected accounts (from OAuth tokens)
const getConnectedAccounts = () => {
  try {
    const tokensJson = localStorage.getItem('zerodha_account_tokens');
    const tokens = tokensJson ? JSON.parse(tokensJson) : {};
    return Object.keys(tokens).map(userId => ({
      user_id: userId,
      user_name: tokens[userId].user_name
    }));
  } catch {
    return [];
  }
};

// Helper to get account details (manually added accounts)
const getAccountDetails = () => {
  try {
    const accountsJson = localStorage.getItem('account_details');
    return accountsJson ? JSON.parse(accountsJson) : {};
  } catch {
    return {};
  }
};

// Helper to save account details
const saveAccountDetails = (accounts) => {
  localStorage.setItem('account_details', JSON.stringify(accounts));
};

// Helper to get all accounts (connected + manually added)
const getAllAccounts = () => {
  const connected = getConnectedAccounts();
  const details = getAccountDetails();
  const allAccounts = {};
  
  // Add connected accounts
  connected.forEach(acc => {
    allAccounts[acc.user_id] = {
      user_id: acc.user_id,
      user_name: acc.user_name,
      is_connected: true,
      account_type: details[acc.user_id]?.account_type || 'TRADING_ONLY',
      trading_strategy: details[acc.user_id]?.trading_strategy || 'SWING',
      api_key: details[acc.user_id]?.api_key || '',
      secret_key: details[acc.user_id]?.secret_key || ''
    };
  });
  
  // Add manually added accounts (not connected via OAuth)
  Object.keys(details).forEach(userId => {
    if (!allAccounts[userId]) {
      allAccounts[userId] = {
        user_id: userId,
        user_name: details[userId].user_name || '',
        is_connected: false,
        account_type: details[userId].account_type || 'TRADING_ONLY',
        trading_strategy: details[userId].trading_strategy || 'SWING',
        api_key: details[userId].api_key || '',
        secret_key: details[userId].secret_key || ''
      };
    } else {
      // Merge details for connected accounts
      allAccounts[userId].user_name = allAccounts[userId].user_name || details[userId].user_name || '';
      allAccounts[userId].api_key = details[userId].api_key || '';
      allAccounts[userId].secret_key = details[userId].secret_key || '';
      allAccounts[userId].account_type = details[userId].account_type || allAccounts[userId].account_type;
      allAccounts[userId].trading_strategy = details[userId].trading_strategy || allAccounts[userId].trading_strategy || 'SWING';
    }
  });
  
  return Object.values(allAccounts);
};

const Settings = ({ onClose, onImportComplete, inSlider = false }) => {
  const [dataSource, setDataSource] = useState(
    localStorage.getItem('market_data_source') || 'ZERODHA'
  );
  const [defaultTradingAccount, setDefaultTradingAccount] = useState(
    localStorage.getItem('default_trading_account') || ''
  );
  const [marketDataAccount, setMarketDataAccount] = useState(
    localStorage.getItem('market_data_account') || 'UU6974'
  );
  const [privacyMode, setPrivacyMode] = useState(
    localStorage.getItem('privacy_mode') === 'true'
  );
  const [demoMode, setDemoMode] = useState(
    localStorage.getItem('demo_mode') === 'true'
  );
  const [refreshInterval, setRefreshInterval] = useState(
    localStorage.getItem('dashboard_refresh_interval') || '30' // Default 30 seconds
  );
  const [showImport, setShowImport] = useState(false);
  const [showImportPayin, setShowImportPayin] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({
    user_id: '',
    user_name: '',
    api_key: '',
    secret_key: '',
    account_type: 'TRADING_ONLY',
    trading_strategy: 'SWING' // 'SWING' or 'LONG_TERM'
  });
  
  const connectedAccounts = getConnectedAccounts();
  const allAccounts = getAllAccounts();

  useEffect(() => {
    // Load saved settings
    const saved = localStorage.getItem('market_data_source');
    if (saved) {
      setDataSource(saved);
    }
  }, []);

  const handleDataSourceChange = (e) => {
    const newSource = e.target.value;
    setDataSource(newSource);
    localStorage.setItem('market_data_source', newSource);
  };

  const handleDefaultTradingAccountChange = (e) => {
    const newAccount = e.target.value;
    setDefaultTradingAccount(newAccount);
    localStorage.setItem('default_trading_account', newAccount);
  };

  const handleMarketDataAccountChange = (e) => {
    const newAccount = e.target.value;
    setMarketDataAccount(newAccount);
    localStorage.setItem('market_data_account', newAccount);
  };

  const handlePrivacyModeChange = (e) => {
    const enabled = e.target.checked;
    setPrivacyMode(enabled);
    localStorage.setItem('privacy_mode', enabled.toString());
    // If privacy is enabled, disable demo mode
    if (enabled) {
      setDemoMode(false);
      localStorage.setItem('demo_mode', 'false');
    }
    // Trigger custom event to notify Dashboard
    window.dispatchEvent(new CustomEvent('displayModeChanged'));
  };

  const handleDemoModeChange = (e) => {
    const enabled = e.target.checked;
    setDemoMode(enabled);
    localStorage.setItem('demo_mode', enabled.toString());
    // If demo is enabled, disable privacy mode
    if (enabled) {
      setPrivacyMode(false);
      localStorage.setItem('privacy_mode', 'false');
    }
    // Trigger custom event to notify Dashboard
    window.dispatchEvent(new CustomEvent('displayModeChanged'));
  };

  const handleAccountFormChange = (e) => {
    const { name, value } = e.target;
    setAccountForm(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleAddAccount = () => {
    setEditingAccount(null);
    setAccountForm({
      user_id: '',
      user_name: '',
      api_key: '',
      secret_key: '',
      account_type: 'TRADING_ONLY',
      trading_strategy: 'SWING'
    });
    setShowAccountForm(true);
  };

  const handleEditAccount = async (account) => {
    setEditingAccount(account.user_id);
    
    // R-SM-2: API keys are saved to .env file via backend, not database
    // Try to load from backend first, then fallback to localStorage
    let apiKey = account.api_key || '';
    let secretKey = account.secret_key || '';
    
    try {
      const apiKeyData = await zerodhaAPI.getApiKey(account.user_id);
      if (apiKeyData && apiKeyData.configured) {
        // API key is configured in .env file (but we can't retrieve actual values for security)
        // If we don't have values in localStorage, leave empty so user can enter new values
        // Don't show placeholder as it would interfere with editing
        // The form will work if user enters values
      }
    } catch (error) {
      // API key not configured in .env file, use localStorage values
      // Reduced logging - configuration fallback is expected behavior
      // console.log('API key not configured in .env file, using localStorage values if available');
    }
    
    setAccountForm({
      user_id: account.user_id,
      user_name: account.user_name || '',
      api_key: apiKey,
      secret_key: secretKey,
      account_type: account.account_type || 'TRADING_ONLY',
      trading_strategy: account.trading_strategy || 'SWING'
    });
    setShowAccountForm(true);
  };

  const handleSaveAccount = async () => {
    if (!accountForm.user_id) {
      alert('Account ID is required');
      return;
    }

    // R-SM-2: Save API keys to .env file via backend (not database)
    // Save if both values are provided
    if (accountForm.api_key && accountForm.secret_key) {
      try {
        await zerodhaAPI.saveApiKey(
          accountForm.user_id,
          accountForm.api_key.trim(),
          accountForm.secret_key.trim()
        );
        alert('API key saved successfully to .env file. Restart the backend server for changes to take full effect.');
      } catch (error) {
        // Security: Don't log full error which might contain sensitive data
        console.error('Error saving API key to .env file');
        const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
        // Remove any potential sensitive data from error message
        const safeErrorMsg = errorMsg.replace(/api[_\s]?key|secret|token/gi, '[REDACTED]');
        alert(`Failed to save API key to .env file: ${safeErrorMsg}`);
        // Continue with localStorage save anyway
      }
    }

    // Also save to localStorage for backward compatibility
    const details = getAccountDetails();
    details[accountForm.user_id] = {
      user_name: accountForm.user_name,
      api_key: accountForm.api_key,
      secret_key: accountForm.secret_key,
      account_type: accountForm.account_type,
      trading_strategy: accountForm.trading_strategy
    };
    saveAccountDetails(details);

    // If this is a Main account and no market data account is set, set it
    if (accountForm.account_type === 'MAIN' && !marketDataAccount) {
      setMarketDataAccount(accountForm.user_id);
      localStorage.setItem('market_data_account', accountForm.user_id);
    }

    setShowAccountForm(false);
    setEditingAccount(null);
    setAccountForm({
      user_id: '',
      user_name: '',
      api_key: '',
      secret_key: '',
      account_type: 'TRADING_ONLY',
      trading_strategy: 'SWING'
    });
  };

  const handleDeleteAccount = (userId) => {
    if (window.confirm(`Are you sure you want to delete account ${userId}?`)) {
      const details = getAccountDetails();
      delete details[userId];
      saveAccountDetails(details);
      
      // If deleted account was the market data account, reset it
      if (marketDataAccount === userId) {
        const mainAccounts = allAccounts.filter(acc => acc.account_type === 'MAIN' && acc.user_id !== userId);
        if (mainAccounts.length > 0) {
          setMarketDataAccount(mainAccounts[0].user_id);
          localStorage.setItem('market_data_account', mainAccounts[0].user_id);
        } else {
          setMarketDataAccount('');
          localStorage.removeItem('market_data_account');
        }
      }
    }
  };

  const content = (
    <div className={`modal-content settings-modal ${inSlider ? 'in-slider' : ''}`} onClick={(e) => inSlider ? null : e.stopPropagation()}>
        {!inSlider && (
          <div className="modal-header">
            <h2>Settings</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        )}

        <div className="settings-content">
          <div className="settings-section">
            <h3 className="settings-section-title">Account Management</h3>
            <p className="settings-section-description">
              Add and manage account details (API Key, Secret Key, Account Type)
            </p>

            {!showAccountForm ? (
              <>
                <button
                  type="button"
                  className="btn-confirm"
                  onClick={handleAddAccount}
                  style={{ marginBottom: '1rem' }}
                >
                  + Add Account
                </button>

                {allAccounts.length > 0 && (
                  <div className="accounts-list" style={{ marginTop: '1rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                          <th style={{ padding: '0.75rem', fontWeight: '600' }}>Account ID</th>
                          <th style={{ padding: '0.75rem', fontWeight: '600' }}>Name</th>
                          <th style={{ padding: '0.75rem', fontWeight: '600' }}>Type</th>
                          <th style={{ padding: '0.75rem', fontWeight: '600' }}>Strategy</th>
                          <th style={{ padding: '0.75rem', fontWeight: '600' }}>Status</th>
                          <th style={{ padding: '0.75rem', fontWeight: '600' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allAccounts.map(account => (
                          <tr key={account.user_id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <td style={{ padding: '0.75rem' }}>{account.user_id}</td>
                            <td style={{ padding: '0.75rem' }}>{account.user_name || '-'}</td>
                            <td style={{ padding: '0.75rem' }}>
                              <span style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                backgroundColor: account.account_type === 'MAIN' ? '#dbeafe' : '#f3f4f6',
                                color: account.account_type === 'MAIN' ? '#1e40af' : '#374151'
                              }}>
                                {account.account_type === 'MAIN' ? 'Main' : 'Trading Only'}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem' }}>
                              <span style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px',
                                fontSize: '0.875rem',
                                backgroundColor: account.trading_strategy === 'LONG_TERM' ? '#fef3c7' : '#d1fae5',
                                color: account.trading_strategy === 'LONG_TERM' ? '#92400e' : '#065f46'
                              }}>
                                {account.trading_strategy === 'LONG_TERM' ? 'Long Term' : 'Swing'}
                              </span>
                            </td>
                            <td style={{ padding: '0.75rem' }}>
                              {account.is_connected ? (
                                <span style={{ color: '#10b981', fontSize: '0.875rem' }}>✓ Connected</span>
                              ) : (
                                <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Not Connected</span>
                              )}
                            </td>
                            <td style={{ padding: '0.75rem' }}>
                              <button
                                type="button"
                                onClick={() => handleEditAccount(account)}
                                style={{
                                  marginRight: '0.5rem',
                                  padding: '0.25rem 0.5rem',
                                  fontSize: '0.875rem',
                                  backgroundColor: '#3b82f6',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                Edit
                              </button>
                              {!account.is_connected && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAccount(account.user_id)}
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    fontSize: '0.875rem',
                                    backgroundColor: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="account-form" style={{ marginTop: '1rem' }}>
                <h4 style={{ marginBottom: '1rem', fontSize: '1.125rem', fontWeight: '600' }}>
                  {editingAccount ? 'Edit Account' : 'Add New Account'}
                </h4>
                
                {/* R-SM-2: Secrets Management Notice inside form */}
                <div style={{ 
                  backgroundColor: '#dbeafe', 
                  border: '1px solid #3b82f6', 
                  borderRadius: '8px', 
                  padding: '1rem', 
                  marginBottom: '1.5rem' 
                }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', fontWeight: '600', color: '#1e40af' }}>🔐 API Key Configuration</h4>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: '#1e3a8a', lineHeight: '1.5' }}>
                    API keys are saved to the <code style={{ fontSize: '0.75rem', backgroundColor: '#bfdbfe', padding: '0.125rem 0.25rem', borderRadius: '3px' }}>.env</code> file (not database) for security.<br/>
                    <strong>After saving, restart the backend server</strong> for changes to take full effect.
                  </p>
                </div>
                
                <div className="form-group">
                  <label htmlFor="account_user_id">Account ID (User ID) *</label>
                  <input
                    type="text"
                    id="account_user_id"
                    name="user_id"
                    value={accountForm.user_id}
                    onChange={handleAccountFormChange}
                    disabled={!!editingAccount}
                    required
                    className="form-input"
                    placeholder="e.g., UU6974"
                  />
                  {editingAccount && (
                    <p className="form-hint">Account ID cannot be changed</p>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="account_user_name">Account Name</label>
                  <input
                    type="text"
                    id="account_user_name"
                    name="user_name"
                    value={accountForm.user_name}
                    onChange={handleAccountFormChange}
                    className="form-input"
                    placeholder="Optional display name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="account_api_key">API Key *</label>
                  <input
                    type="text"
                    id="account_api_key"
                    name="api_key"
                    value={accountForm.api_key}
                    onChange={handleAccountFormChange}
                    className="form-input"
                    placeholder="Enter Zerodha API Key (saved to .env file)"
                    required
                  />
                  <p className="form-hint">
                    Required for Zerodha OAuth authentication. Saved to .env file (not database).
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="account_secret_key">Secret Key *</label>
                  <input
                    type="password"
                    id="account_secret_key"
                    name="secret_key"
                    value={accountForm.secret_key}
                    onChange={handleAccountFormChange}
                    className="form-input"
                    placeholder="Enter Secret Key (saved to .env file)"
                    required
                  />
                  <p className="form-hint">
                    Required for Zerodha OAuth authentication. Saved to .env file (not database). Restart backend after saving.
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="account_type">Account Type *</label>
                  <select
                    id="account_type"
                    name="account_type"
                    value={accountForm.account_type}
                    onChange={handleAccountFormChange}
                    className="form-input form-select"
                    required
                  >
                    <option value="MAIN">Main (Paid - for Market Data)</option>
                    <option value="TRADING_ONLY">Trading Only</option>
                  </select>
                  <p className="form-hint">
                    Main accounts are used for market data. Trading Only accounts are for trade execution.
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="trading_strategy">Trading Strategy *</label>
                  <select
                    id="trading_strategy"
                    name="trading_strategy"
                    value={accountForm.trading_strategy}
                    onChange={handleAccountFormChange}
                    className="form-input form-select"
                    required
                  >
                    <option value="SWING">Swing Trading</option>
                    <option value="LONG_TERM">Long Term</option>
                  </select>
                  <p className="form-hint">
                    Classify this account as Swing Trading (short-term) or Long Term (hold for extended periods).
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn-confirm"
                    onClick={handleSaveAccount}
                  >
                    {editingAccount ? 'Update Account' : 'Add Account'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setShowAccountForm(false);
                      setEditingAccount(null);
                      setAccountForm({
                        user_id: '',
                        user_name: '',
                        api_key: '',
                        secret_key: '',
                        account_type: 'TRADING_ONLY',
                        trading_strategy: 'SWING'
                      });
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Account Preferences</h3>
            <p className="settings-section-description">
              Configure default accounts for trading and market data
            </p>
            
            <div className="form-group">
              <label htmlFor="default-trading-account">Default Trading Account</label>
              <select
                id="default-trading-account"
                value={defaultTradingAccount}
                onChange={handleDefaultTradingAccountChange}
                className="form-input form-select"
              >
                <option value="">Select account...</option>
                {allAccounts.map(account => (
                  <option key={account.user_id} value={account.user_id}>
                    {account.user_id} {account.user_name ? `(${account.user_name})` : ''} 
                    {account.account_type === 'MAIN' ? ' [Main]' : ' [Trading]'}
                  </option>
                ))}
              </select>
              <p className="form-hint">
                This account will be used by default when executing trades
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="market-data-account">Market Data Account (Paid)</label>
              <select
                id="market-data-account"
                value={marketDataAccount}
                onChange={handleMarketDataAccountChange}
                className="form-input form-select"
              >
                {allAccounts.filter(acc => acc.account_type === 'MAIN').map(account => (
                  <option key={account.user_id} value={account.user_id}>
                    {account.user_id} {account.user_name ? `(${account.user_name})` : ''}
                  </option>
                ))}
                {allAccounts.filter(acc => acc.account_type === 'MAIN').length === 0 && (
                  <option value="">No Main accounts configured</option>
                )}
              </select>
              <p className="form-hint">
                Always use this account (with paid access) for market data queries. Only Main accounts are shown.
              </p>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Market Data Source</h3>
            <p className="settings-section-description">
              Choose the source for real-time market prices and historical data
            </p>
            
            <div className="form-group">
              <label htmlFor="data-source">Data Source</label>
              <select
                id="data-source"
                value={dataSource}
                onChange={handleDataSourceChange}
                className="form-input form-select"
              >
                <option value="ZERODHA">Zerodha (Paid Plan)</option>
                <option value="RAPIDAPI">RapidAPI (Yahoo Finance) - Fallback</option>
              </select>
              <p className="form-hint">
                {dataSource === 'ZERODHA' 
                  ? 'Using Zerodha for market data. Real-time data available with paid plan.'
                  : 'Using RapidAPI as fallback. Free tier has rate limits.'}
              </p>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Dashboard Settings</h3>
            <p className="settings-section-description">
              Configure dashboard refresh and display options
            </p>
            
            <div className="form-group">
              <label htmlFor="refresh-interval">Auto Refresh Interval</label>
              <select
                id="refresh-interval"
                value={refreshInterval}
                onChange={(e) => {
                  const newInterval = e.target.value;
                  setRefreshInterval(newInterval);
                  localStorage.setItem('dashboard_refresh_interval', newInterval);
                  // Trigger custom event to notify Dashboard (same-tab update)
                  window.dispatchEvent(new CustomEvent('dashboardRefreshIntervalChanged'));
                }}
                className="form-input form-select"
              >
                <option value="5">5 seconds</option>
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="300">5 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1800">30 minutes</option>
                <option value="3600">1 hour</option>
                <option value="0">Disabled</option>
              </select>
              <p className="form-hint">
                How often the dashboard should automatically refresh data. Set to "Disabled" to turn off auto-refresh.
              </p>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Display Options</h3>
            <p className="settings-section-description">
              Control how dashboard values are displayed
            </p>
            
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={privacyMode}
                  onChange={handlePrivacyModeChange}
                  style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: '600' }}>Privacy Mode</span>
              </label>
              <p className="form-hint" style={{ marginLeft: '2rem', marginTop: '0.5rem' }}>
                Hide all dashboard values (NAV, P/L, etc.) while keeping positions table visible. Useful for screenshots or presentations.
              </p>
            </div>

            <div className="form-group" style={{ marginTop: '1.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={demoMode}
                  onChange={handleDemoModeChange}
                  style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: '600' }}>Demo Mode</span>
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Import Trades</h3>
            <p className="settings-section-description">
              Import trades from Excel or JSON file for manual migration
            </p>
            
            <button
              type="button"
              className="btn-confirm"
              onClick={() => setShowImport(true)}
              style={{ marginTop: '1rem' }}
            >
              Import Trades
            </button>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Import Payins</h3>
            <p className="settings-section-description">
              Import payins from Excel or JSON file
            </p>
            
            <button
              type="button"
              className="btn-confirm"
              onClick={() => setShowImportPayin(true)}
              style={{ marginTop: '1rem' }}
            >
              Import Payins
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn-confirm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {showImport && (
          <ImportTrades
            onClose={() => setShowImport(false)}
            onImportComplete={() => {
              setShowImport(false);
              if (onImportComplete) {
                onImportComplete();
              }
            }}
          />
        )}

        {showImportPayin && (
          <ImportPayins
            onClose={() => setShowImportPayin(false)}
            onImportComplete={() => {
              setShowImportPayin(false);
              if (onImportComplete) {
                onImportComplete();
              }
            }}
          />
        )}
      </div>
  );

  if (inSlider) {
    return content;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-header">
        <h2>Settings</h2>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>
      {content}
    </div>
  );
};

export default Settings;

