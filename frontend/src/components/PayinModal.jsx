import React, { useState, useEffect } from 'react';
import { payinAPI, tradesAPI } from '../services/api';
import { getAccountDetails } from '../utils/accountUtils';
import './BuyModal.css';

const PayinModal = ({ onClose, onPayinComplete, inSlider = false }) => {
  const [formData, setFormData] = useState({
    payin_date: new Date().toISOString().split('T')[0],
    amount: '',
    paid_by: '',
    nav: '',
    number_of_shares: '',
    description: '',
    zerodha_user_id: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [calculatingNav, setCalculatingNav] = useState(false);

  // Get default user ID from localStorage
  useEffect(() => {
    const defaultTradingAccount = localStorage.getItem('default_trading_account');
    if (defaultTradingAccount) {
      setFormData(prev => ({ ...prev, zerodha_user_id: defaultTradingAccount }));
    }
  }, []);

  // Get NAV based on user ID's associated strategy (SWING/LONG_TERM) when payin_date or user ID changes
  useEffect(() => {
    const getNavForStrategy = async () => {
      if (!formData.payin_date || !formData.zerodha_user_id) return;
      
      setCalculatingNav(true);
      try {
        // Determine strategy from user ID
        const accountDetails = getAccountDetails();
        const userStrategy = accountDetails[formData.zerodha_user_id]?.trading_strategy || 'SWING';
        
        // First, try to get NAV from snapshots
        let navData = await payinAPI.getLatestNavForStrategy(
          formData.zerodha_user_id,
          userStrategy
        );
        
        let nav = navData?.nav;
        
        // If no NAV from snapshot, calculate it from payins/trades (like Dashboard does)
        if (!nav || nav <= 0) {
          try {
            const calculatedNav = await payinAPI.calculateNav(
              formData.payin_date,
              formData.zerodha_user_id || null,
              null
            );
            // Dashboard formula: NAV = (Payin + Booked P/L + Float P/L) / Total Shares
            // The calculateNav API now returns NAV calculated using the same formula as Dashboard
            nav = calculatedNav?.nav;
          } catch (calcErr) {
            console.warn('Failed to calculate NAV:', calcErr);
          }
        }
        
        if (nav && nav > 0) {
          setFormData(prev => ({ ...prev, nav: nav.toFixed(2) }));
          
          // Calculate number of shares if amount is already entered
          const currentPayinAmount = parseFloat(formData.amount);
          if (currentPayinAmount && currentPayinAmount !== 0 && nav > 0) {
            const shares = currentPayinAmount / nav;
            setFormData(prev => ({ ...prev, number_of_shares: Math.abs(shares).toFixed(4) }));
          }
        } else {
          // No NAV found
          setFormData(prev => ({ ...prev, nav: '' }));
        }
      } catch (err) {
        console.warn('Failed to get NAV for strategy:', err);
        setFormData(prev => ({ ...prev, nav: '' }));
      } finally {
        setCalculatingNav(false);
      }
    };
    
    if (formData.payin_date && formData.zerodha_user_id) {
      getNavForStrategy();
    }
  }, [formData.payin_date, formData.zerodha_user_id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: value
      };
      
      // Auto-populate number of shares when amount or NAV changes
      // Formula: Number of shares = Payin Amount / NAV (supports negative amounts for withdrawals)
      if (name === 'amount' || name === 'nav') {
        const amount = parseFloat(newData.amount);
        const nav = parseFloat(newData.nav);
        if (amount !== 0 && !isNaN(amount) && nav > 0 && !isNaN(nav)) {
          // Use absolute value for shares calculation (withdrawals still have positive shares)
          newData.number_of_shares = Math.abs(amount / nav).toFixed(4);
        } else {
          newData.number_of_shares = '';
        }
      }
      
      return newData;
    });
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.payin_date) {
        throw new Error('Payin date is required');
      }
      if (!formData.amount || parseFloat(formData.amount) === 0) {
        throw new Error('Amount cannot be zero (use negative value for withdrawal)');
      }

      const payinData = {
        payin_date: formData.payin_date,
        amount: parseFloat(formData.amount),
        paid_by: formData.paid_by && formData.paid_by.trim() ? formData.paid_by.trim() : null,
        nav: formData.nav && formData.nav.trim() ? parseFloat(formData.nav) : null,
        number_of_shares: formData.number_of_shares && formData.number_of_shares.trim() ? parseFloat(formData.number_of_shares) : null,
        description: formData.description && formData.description.trim() ? formData.description.trim() : null,
        zerodha_user_id: formData.zerodha_user_id && formData.zerodha_user_id.trim() ? formData.zerodha_user_id.trim() : null,
      };

      await payinAPI.createPayin(payinData);
      
      // Dispatch event to notify other components (like PayinsTable) to refresh
      window.dispatchEvent(new CustomEvent('payinAdded'));
      // Also trigger storage event for cross-tab updates
      localStorage.setItem('payin_refresh', Date.now().toString());
      
      if (onPayinComplete) {
        onPayinComplete();
      }
      onClose();
    } catch (err) {
      console.error('Error creating payin:', err);
      
      // Handle different error formats
      let errorMessage = 'Failed to create payin';
      
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

  const content = (
    <div className={`modal-content buy-modal-content ${inSlider ? 'in-slider' : ''}`} onClick={(e) => inSlider ? null : e.stopPropagation()}>
        {!inSlider && (
          <div className="modal-header">
            <h2>Add Payin</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="buy-modal-form">
          {error && (
            <div className="form-message form-error">
              {error}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="payin_date">Date *</label>
              <input
                type="date"
                id="payin_date"
                name="payin_date"
                value={formData.payin_date}
                onChange={handleChange}
                required
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="amount">Payin Amount (₹) *</label>
              <input
                type="number"
                id="amount"
                name="amount"
                value={formData.amount}
                onChange={handleChange}
                required
                step="0.01"
                placeholder="Enter amount (negative for withdrawal)"
                className="form-input"
                onKeyDown={(e) => {
                  // Allow negative sign, numbers, decimal point, backspace, delete, arrow keys
                  if (!/[0-9.\-]/.test(e.key) && !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
                    e.preventDefault();
                  }
                  // Allow negative sign only at the start
                  if (e.key === '-' && (e.target.selectionStart !== 0 || e.target.value.includes('-'))) {
                    e.preventDefault();
                  }
                }}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="paid_by">Paid By</label>
              <input
                type="text"
                id="paid_by"
                name="paid_by"
                value={formData.paid_by}
                onChange={handleChange}
                placeholder="e.g., Bank Transfer, UPI, etc."
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="nav">
                NAV (₹)
                {calculatingNav && <span style={{ fontSize: '0.75rem', color: '#6b7280', marginLeft: '0.5rem' }}>Calculating...</span>}
              </label>
              <input
                type="number"
                id="nav"
                name="nav"
                value={formData.nav}
                onChange={handleChange}
                step="0.01"
                placeholder="Auto-calculated"
                className="form-input"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="number_of_shares">Number of Shares</label>
              <input
                type="number"
                id="number_of_shares"
                name="number_of_shares"
                value={formData.number_of_shares}
                onChange={handleChange}
                min="0"
                step="0.0001"
                placeholder="Auto-calculated (Amount/NAV)"
                className="form-input"
                readOnly
              />
            </div>

            <div className="form-group">
              <label htmlFor="zerodha_user_id">User ID</label>
              <input
                type="text"
                id="zerodha_user_id"
                name="zerodha_user_id"
                value={formData.zerodha_user_id}
                onChange={handleChange}
                placeholder="e.g., UU6974"
                className="form-input"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="description">Comments/Notes</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Optional notes about this payin"
                rows="3"
                className="form-input"
                style={{ resize: 'vertical', minHeight: '80px' }}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="btn-cancel"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-confirm btn-confirm-buy"
              disabled={loading}
            >
              {loading ? 'Adding...' : 'Add Payin'}
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

export default PayinModal;

