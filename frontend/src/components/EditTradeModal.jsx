import React, { useState, useEffect } from 'react';
import { tradesAPI, referenceDataAPI } from '../services/api';
import './BuyModal.css';

// Load symbol-industry mapping
let symbolIndustryMapping = {};
let mappingLoaded = false;
const loadSymbolIndustryMapping = async () => {
  if (mappingLoaded) return; // Already loaded
  try {
    const response = await fetch('/symbol_industry_mapping.json');
    const data = await response.json();
    // Create a map for quick lookup
    symbolIndustryMapping = {};
    data.forEach(item => {
      symbolIndustryMapping[item.symbol.toUpperCase()] = item.industry;
    });
    mappingLoaded = true;
  } catch (err) {
    console.warn('Failed to load symbol-industry mapping:', err);
  }
};

// Load mapping on module load
loadSymbolIndustryMapping();

const EditTradeModal = ({ trade, onClose, onUpdateComplete, inSlider = false }) => {
  const [formData, setFormData] = useState({
    symbol: trade?.symbol || '',
    buy_date: trade?.buy_date || new Date().toISOString().split('T')[0],
    buy_price: trade?.buy_price || '',
    quantity: trade?.quantity || '',
    buy_charges: trade?.buy_charges || '0',
    industry: trade?.industry || '',
    trader: trade?.trader || '',
    zerodha_user_id: trade?.zerodha_user_id || '',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [filteredStocks, setFilteredStocks] = useState([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);

  // Auto-populate industry from mapping when trade is loaded and industry is blank
  useEffect(() => {
    const populateIndustryFromMapping = async () => {
      if (!trade?.symbol) return;
      
      // If industry is already set, don't override
      if (trade.industry && trade.industry.trim() !== '') return;
      
      // Ensure mapping is loaded
      await loadSymbolIndustryMapping();
      
      const symbol = trade.symbol.toUpperCase();
      if (symbolIndustryMapping[symbol]) {
        setFormData(prev => ({
          ...prev,
          industry: symbolIndustryMapping[symbol]
        }));
      }
    };
    
    populateIndustryFromMapping();
  }, [trade]);

  // Static list of industries (alphabetically arranged)
  const industriesList = [
    'Aerospace & Defense',
    'Automobiles & Auto Parts',
    'Banking Services',
    'Beverages',
    'Chemicals',
    'Coal',
    'Communications & Networking',
    'Computers, Phones & Household Electronics',
    'Construction & Engineering',
    'Construction Materials',
    'Diversified Industrial Goods Wholesale',
    'Diversified Retail',
    'Electrical Utilities & IPPs',
    'ETF',
    'Financial Technology (Fintech) & Infrastructure',
    'Food & Drug Retailing',
    'Food & Tobacco',
    'Freight & Logistics Services',
    'Healthcare Providers & Services',
    'Hotels & Entertainment Services',
    'Insurance',
    'Integrated Hardware & Software',
    'Investment Banking & Investment Services',
    'Machinery, Equipment & Components',
    'Media & Publishing',
    'Metals & Mining',
    'Natural Gas Utilities',
    'Oil & Gas',
    'Passenger Transportation Services',
    'Personal & Household Products & Services',
    'Pharmaceuticals',
    'Professional & Commercial Services',
    'Real Estate Operations',
    'School, College & University',
    'Semiconductors & Semiconductor Equipment',
    'Software & IT Services',
    'Telecommunications Services',
    'Textiles & Apparel',
    'Transport Infrastructure'
  ];

  // Search stocks from reference data API with debounce
  useEffect(() => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (!symbolSearch || symbolSearch.length < 1) {
      setFilteredStocks([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setLoadingStocks(true);
        const results = await referenceDataAPI.searchStocks(symbolSearch, 'NSE', 20);
        
        const transformed = results.map(stock => ({
          symbol: stock.symbol,
          company_name: stock.company_name || stock.symbol,
          industry: stock.industry || ''
        }));
        
        setFilteredStocks(transformed);
        setShowSymbolDropdown(true);
      } catch (err) {
        console.warn('Failed to search stocks:', err);
        setFilteredStocks([]);
      } finally {
        setLoadingStocks(false);
      }
    }, 300);

    setSearchTimeout(timeout);

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [symbolSearch]);

  const handleSymbolSelect = async (selectedSymbol) => {
    setSymbolSearch('');
    setShowSymbolDropdown(false);
    
    // First, check the symbol-industry mapping (fastest, no API call)
    const mappedIndustry = symbolIndustryMapping[selectedSymbol.toUpperCase()];
    
    const selectedStock = filteredStocks.find(s => s.symbol === selectedSymbol);
    
    if (selectedStock) {
      setFormData(prev => ({
        ...prev,
        symbol: selectedStock.symbol,
        industry: mappedIndustry || selectedStock.industry || prev.industry
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        symbol: selectedSymbol,
        industry: mappedIndustry || prev.industry
      }));
    }
    
    // Try to fetch reference data (but prefer mapping if available)
    if (!mappedIndustry) {
      try {
        const refData = await referenceDataAPI.getStockReference(selectedSymbol, 'NSE', false);
        if (refData) {
          setFormData(prev => ({
            ...prev,
            industry: refData.industry || prev.industry
          }));
        }
      } catch (err) {
        console.warn('Failed to fetch reference data:', err);
      }
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const updateData = {
        symbol: formData.symbol,
        buy_date: formData.buy_date,
        buy_price: parseFloat(formData.buy_price),
        quantity: parseInt(formData.quantity),
        buy_charges: parseFloat(formData.buy_charges) || 0,
        industry: formData.industry || null,
        trader: formData.trader || null,
        zerodha_user_id: formData.zerodha_user_id || null,
      };

      await tradesAPI.updateTrade(trade.id, updateData);
      
      if (onUpdateComplete) {
        onUpdateComplete();
      }
      onClose();
    } catch (err) {
      console.error('Error updating trade:', err);
      
      let errorMessage = 'Failed to update trade. Please try again.';
      
      if (err.response?.data) {
        const errorData = err.response.data;
        
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
        } else if (typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        } else if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.msg) {
          errorMessage = errorData.detail.msg;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        }
      } else if (err.message) {
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
          <h2>Edit Trade</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="buy-modal-form">
        {error && (
          <div className="form-message form-error">
            {error}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="symbol">Symbol *</label>
          <div className="symbol-input-wrapper">
            <input
              type="text"
              id="symbol"
              name="symbol"
              value={symbolSearch || formData.symbol}
              onChange={(e) => {
                setSymbolSearch(e.target.value);
                if (e.target.value) {
                  setFormData(prev => ({ ...prev, symbol: '' }));
                }
              }}
              onFocus={() => {
                if (symbolSearch && filteredStocks.length > 0) {
                  setShowSymbolDropdown(true);
                }
              }}
              onBlur={(e) => {
                // Delay to allow click on dropdown item
                setTimeout(() => {
                  setShowSymbolDropdown(false);
                  // When user finishes typing, check mapping for industry
                  const symbol = e.target.value.trim().toUpperCase();
                  if (symbol && symbolIndustryMapping[symbol]) {
                    setFormData(prev => ({
                      ...prev,
                      symbol: symbol,
                      industry: symbolIndustryMapping[symbol] || prev.industry
                    }));
                    setSymbolSearch('');
                  }
                }, 200);
              }}
              placeholder="Search or type symbol"
              className="form-input"
              required
            />
            {showSymbolDropdown && filteredStocks.length > 0 && (
              <div className="symbol-dropdown">
                {filteredStocks.slice(0, 15).map((stock) => (
                  <div
                    key={stock.symbol}
                    className="symbol-option"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSymbolSelect(stock.symbol);
                    }}
                  >
                    <span className="symbol-option-symbol">{stock.symbol}</span>
                    <span className="symbol-option-name">{stock.company_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="industry">Industry</label>
          <select
            id="industry"
            name="industry"
            value={formData.industry}
            onChange={handleChange}
            className="form-input form-select"
          >
            <option value="">Select Industry</option>
            {industriesList.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </select>
        </div>

        <div className="form-row">
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
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="buy_price">Buy Price *</label>
            <input
              type="number"
              id="buy_price"
              name="buy_price"
              value={formData.buy_price}
              onChange={handleChange}
              required
              min="0.01"
              step="0.01"
              placeholder="0.00"
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
        </div>

        <div className="form-row">
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
            {loading ? 'Updating...' : 'Update Trade'}
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

export default EditTradeModal;

