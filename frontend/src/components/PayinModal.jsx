import React, { useState, useEffect } from 'react';
import { payinAPI, tradesAPI } from '../services/api';
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

  // Calculate NAV when payin_date or amount changes
  useEffect(() => {
    const calculateNav = async () => {
      if (!formData.payin_date) return;
      
      setCalculatingNav(true);
      try {
        const currentPayinAmount = parseFloat(formData.amount) || 0;
        const navData = await payinAPI.calculateNav(
          formData.payin_date,
          formData.zerodha_user_id || null,
          currentPayinAmount > 0 ? currentPayinAmount : null
        );
        
        const nav = navData.nav || 0;
        
        if (nav > 0) {
          setFormData(prev => ({ ...prev, nav: nav.toFixed(2) }));
          
          // Calculate number of shares if amount is provided
          if (currentPayinAmount > 0 && nav > 0) {
            const shares = currentPayinAmount / nav;
            setFormData(prev => ({ ...prev, number_of_shares: shares.toFixed(4) }));
          } else {
            setFormData(prev => ({ ...prev, number_of_shares: '' }));
          }
        } else {
          setFormData(prev => ({ ...prev, nav: '', number_of_shares: '' }));
        }
      } catch (err) {
        console.warn('Failed to calculate NAV:', err);
        // Don't show error to user, just log it
        setFormData(prev => ({ ...prev, nav: '', number_of_shares: '' }));
      } finally {
        setCalculatingNav(false);
      }
    };
    
    if (formData.payin_date) {
      calculateNav();
    }
  }, [formData.payin_date, formData.zerodha_user_id, formData.amount]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: value
      };
      
      // Recalculate number of shares if amount or NAV changes
      if (name === 'amount' || name === 'nav') {
        const amount = parseFloat(newData.amount) || 0;
        const nav = parseFloat(newData.nav) || 0;
        if (amount > 0 && nav > 0) {
          newData.number_of_shares = (amount / nav).toFixed(4);
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
      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      const payinData = {
        payin_date: formData.payin_date,
        amount: parseFloat(formData.amount),
        paid_by: formData.paid_by || null,
        nav: formData.nav ? parseFloat(formData.nav) : null,
        number_of_shares: formData.number_of_shares ? parseFloat(formData.number_of_shares) : null,
        description: formData.description || null,
        zerodha_user_id: formData.zerodha_user_id || null,
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
                min="0.01"
                step="0.01"
                placeholder="Enter amount"
                className="form-input"
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
                min="0.01"
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

