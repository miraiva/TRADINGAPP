import React, { useState } from 'react';
import { tradesAPI } from '../services/api';
import './BuyForm.css';

const BuyForm = ({ onTradeAdded }) => {
  const [formData, setFormData] = useState({
    symbol: '',
    name: '',
    buy_date: new Date().toISOString().split('T')[0],
    buy_price: '',
    quantity: '',
    buy_charges: '0',
    industry: '',
    trader: '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear messages when user types
    if (error) setError(null);
    if (success) setSuccess(false);
  };

  const calculateAmount = () => {
    const price = parseFloat(formData.buy_price) || 0;
    const qty = parseInt(formData.quantity) || 0;
    return (price * qty).toFixed(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const tradeData = {
        ...formData,
        buy_price: parseFloat(formData.buy_price),
        quantity: parseInt(formData.quantity),
        buy_charges: parseFloat(formData.buy_charges) || 0,
        name: formData.name || null,
        industry: formData.industry || null,
        trader: formData.trader || null,
      };

      await tradesAPI.buyTrade(tradeData);
      
      setSuccess(true);
      // Reset form
      setFormData({
        symbol: '',
        name: '',
        buy_date: new Date().toISOString().split('T')[0],
        buy_price: '',
        quantity: '',
        buy_charges: '0',
        industry: '',
        trader: '',
      });

      // Notify parent component
      if (onTradeAdded) {
        onTradeAdded();
      }

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to add trade. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="buy-form-container">
      <div className="buy-form-header">
        <h2>Buy Trade</h2>
        <p className="form-subtitle">Enter a new buy position</p>
      </div>

      <form onSubmit={handleSubmit} className="buy-form">
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="symbol">Symbol *</label>
            <input
              type="text"
              id="symbol"
              name="symbol"
              value={formData.symbol}
              onChange={handleChange}
              required
              placeholder="e.g., AAPL"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="name">Company Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g., Apple Inc."
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="buy_date">Buy Date *</label>
            <input
              type="date"
              id="buy_date"
              name="buy_date"
              value={formData.buy_date}
              onChange={handleChange}
              required
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="buy_price">Buy Price *</label>
            <input
              type="number"
              id="buy_price"
              name="buy_price"
              value={formData.buy_price}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="quantity">Quantity *</label>
            <input
              type="number"
              id="quantity"
              name="quantity"
              value={formData.quantity}
              onChange={handleChange}
              required
              min="1"
              placeholder="0"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="buy_charges">Charges</label>
            <input
              type="number"
              id="buy_charges"
              name="buy_charges"
              value={formData.buy_charges}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="industry">Industry</label>
            <input
              type="text"
              id="industry"
              name="industry"
              value={formData.industry}
              onChange={handleChange}
              placeholder="e.g., Technology"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="trader">Trader</label>
            <input
              type="text"
              id="trader"
              name="trader"
              value={formData.trader}
              onChange={handleChange}
              placeholder="Trader name"
              className="form-input"
            />
          </div>
        </div>

        {formData.buy_price && formData.quantity && (
          <div className="amount-preview">
            <span className="amount-label">Total Amount:</span>
            <span className="amount-value">${calculateAmount()}</span>
          </div>
        )}

        {error && (
          <div className="form-message form-error">
            {error}
          </div>
        )}

        {success && (
          <div className="form-message form-success">
            Trade added successfully!
          </div>
        )}

        <button
          type="submit"
          className="btn-submit"
          disabled={loading}
        >
          {loading ? 'Adding...' : 'Add Trade'}
        </button>
      </form>
    </div>
  );
};

export default BuyForm;

