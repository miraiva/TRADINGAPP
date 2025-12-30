import React, { useState } from 'react';
import { tradesAPI } from '../services/api';
import './SellModal.css';

const SellModal = ({ trade, onClose, onSellComplete }) => {
  const [formData, setFormData] = useState({
    sell_date: new Date().toISOString().split('T')[0],
    sell_price: '',
    sell_charges: '0',
    exchange: 'NSE',
    order_type: 'MARKET',
  });

  const [executeViaAPI, setExecuteViaAPI] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Check if Zerodha is connected
  const zerodhaAccessToken = localStorage.getItem('zerodha_access_token');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError(null);
  };

  const calculateSellAmount = () => {
    const price = parseFloat(formData.sell_price) || 0;
    return (price * trade.quantity).toFixed(2);
  };

  const calculateProfitLoss = () => {
    if (!formData.sell_price) return null;
    const sellPrice = parseFloat(formData.sell_price);
    const sellAmount = sellPrice * trade.quantity;
    const totalBuy = trade.buy_amount + (trade.buy_charges || 0);
    const totalSell = sellAmount - (parseFloat(formData.sell_charges) || 0);
    return totalSell - totalBuy;
  };

  const calculateProfitPercentage = () => {
    const profitLoss = calculateProfitLoss();
    if (profitLoss === null) return null;
    const totalBuy = trade.buy_amount + (trade.buy_charges || 0);
    if (totalBuy === 0) return null;
    return (profitLoss / totalBuy) * 100;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const sellData = {
        sell_date: formData.sell_date,
        sell_charges: parseFloat(formData.sell_charges) || 0,
      };

      // Only include sell_price if provided or not executing via API with MARKET order
      if (formData.sell_price) {
        sellData.sell_price = parseFloat(formData.sell_price);
      } else if (!(executeViaAPI && formData.order_type === 'MARKET')) {
        // Require sell_price if not executing via API with MARKET order
        setError('Sell price is required');
        setLoading(false);
        return;
      }

      // Add API execution fields if enabled
      if (executeViaAPI && zerodhaAccessToken) {
        sellData.execute_via_api = true;
        sellData.access_token = zerodhaAccessToken;
        sellData.exchange = formData.exchange;
        sellData.order_type = formData.order_type;
      }

      await tradesAPI.sellTrade(trade.id, sellData);
      
      if (onSellComplete) {
        onSellComplete();
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to sell trade. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const profitLoss = calculateProfitLoss();
  const profitPercentage = calculateProfitPercentage();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Sell Trade</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-trade-info">
          <div className="info-row">
            <span className="info-label">Symbol:</span>
            <span className="info-value">{trade.symbol}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Quantity:</span>
            <span className="info-value">{trade.quantity}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Buy Price:</span>
            <span className="info-value">{formatCurrency(trade.buy_price)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Buy Amount:</span>
            <span className="info-value">{formatCurrency(trade.buy_amount)}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="sell-form">
          <div className="form-group">
            <label htmlFor="sell_date">Sell Date *</label>
            <input
              type="date"
              id="sell_date"
              name="sell_date"
              value={formData.sell_date}
              onChange={handleChange}
              required
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="sell_price">
              Sell Price {!(executeViaAPI && formData.order_type === 'MARKET') ? '*' : ''}
              {executeViaAPI && formData.order_type === 'MARKET' && (
                <span className="field-hint">(Will be populated from Zerodha execution)</span>
              )}
            </label>
            <input
              type="number"
              id="sell_price"
              name="sell_price"
              value={formData.sell_price}
              onChange={handleChange}
              required={!(executeViaAPI && formData.order_type === 'MARKET')}
              min="0"
              step="0.01"
              placeholder={executeViaAPI && formData.order_type === 'MARKET' ? "Auto-filled from execution" : "0.00"}
              className="form-input"
              disabled={executeViaAPI && formData.order_type === 'MARKET'}
            />
          </div>

          <div className="form-group">
            <label htmlFor="sell_charges">Sell Charges</label>
            <input
              type="number"
              id="sell_charges"
              name="sell_charges"
              value={formData.sell_charges}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              className="form-input"
            />
          </div>

          {zerodhaAccessToken && (
            <div className="form-group">
              <div className="api-toggle-container">
                <label className="api-toggle-label">
                  <input
                    type="checkbox"
                    checked={executeViaAPI}
                    onChange={(e) => setExecuteViaAPI(e.target.checked)}
                    className="api-toggle-checkbox"
                  />
                  <span className="api-toggle-text">Execute via Zerodha API</span>
                </label>
                {executeViaAPI && (
                  <div className="api-fields">
                    <div className="form-group">
                      <label htmlFor="exchange">Exchange *</label>
                      <select
                        id="exchange"
                        name="exchange"
                        value={formData.exchange}
                        onChange={handleChange}
                        required={executeViaAPI}
                        className="form-input form-select"
                      >
                        <option value="NSE">NSE</option>
                        <option value="BSE">BSE</option>
                        <option value="NFO">NFO</option>
                        <option value="CDS">CDS</option>
                        <option value="MCX">MCX</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="order_type">Order Type *</label>
                      <select
                        id="order_type"
                        name="order_type"
                        value={formData.order_type}
                        onChange={handleChange}
                        required={executeViaAPI}
                        className="form-input form-select"
                      >
                        <option value="MARKET">Market</option>
                        <option value="LIMIT">Limit</option>
                        <option value="SL">Stop Loss</option>
                        <option value="SL-M">Stop Loss Market</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {formData.sell_price && (
            <div className="calculation-preview">
              <div className="calc-row">
                <span>Sell Amount:</span>
                <span className="calc-value">{formatCurrency(calculateSellAmount())}</span>
              </div>
              {profitLoss !== null && (
                <>
                  <div className="calc-row">
                    <span>Profit/Loss:</span>
                    <span className={`calc-value ${profitLoss >= 0 ? 'profit' : 'loss'}`}>
                      {formatCurrency(profitLoss)}
                    </span>
                  </div>
                  {profitPercentage !== null && (
                    <div className="calc-row">
                      <span>Profit/Loss %:</span>
                      <span className={`calc-value ${profitPercentage >= 0 ? 'profit' : 'loss'}`}>
                        {profitPercentage >= 0 ? '+' : ''}{profitPercentage.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="form-message form-error">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-confirm"
              disabled={loading}
            >
              {loading ? 'Selling...' : 'Confirm Sell'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SellModal;

