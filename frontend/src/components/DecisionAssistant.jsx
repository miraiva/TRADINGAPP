import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { tradesAPI, marketDataAPI, referenceDataAPI, aiAssistantAPI } from '../services/api';
import './DecisionAssistant.css';

const DecisionAssistant = ({ onClose, inSlider = false }) => {
  const [openTrades, setOpenTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [selectedDeals, setSelectedDeals] = useState([]);
  const [targetPrice, setTargetPrice] = useState('');
  const [targetProbability, setTargetProbability] = useState(100);
  const [dealsExpanded, setDealsExpanded] = useState(true);
  
  // Comparison stocks - now a dynamic array
  const [compareStocks, setCompareStocks] = useState([]);
  const [showAddCompareForm, setShowAddCompareForm] = useState(false);
  const [currentCompareStock, setCurrentCompareStock] = useState({
    symbol: '',
    targetPrice: '',
    probability: 100,
    currentPrice: null
  });
  const [compareSymbolSearch, setCompareSymbolSearch] = useState('');
  const [filteredCompareStocks, setFilteredCompareStocks] = useState([]);
  const [loadingCompareStocks, setLoadingCompareStocks] = useState(false);
  const [loadingComparePrice, setLoadingComparePrice] = useState(false);
  const [compareSearchTimeout, setCompareSearchTimeout] = useState(null);

  // AI mode state
  const [aiModeEnabled, setAiModeEnabled] = useState(false);
  const [aiModel, setAiModel] = useState('chatgpt-mini');
  const [aiIndicators, setAiIndicators] = useState({
    volume: false,
    awayFrom52WeekHigh: false,
    epsGrowth: false,
    netProfitGrowth: false,
    peVsIndustry: false,
    marketCap: false
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  // Fetch open trades only when component is actually opened (inSlider means it's visible)
  useEffect(() => {
    if (!inSlider) return; // Don't fetch if not visible
    
    const fetchOpenTrades = async () => {
      try {
        setLoading(true);
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        );
        
        const trades = await Promise.race([
          tradesAPI.getAllTrades('OPEN'),
          timeoutPromise
        ]);
        setOpenTrades(trades || []);
      } catch (err) {
        console.error('Error fetching open trades:', err);
        setOpenTrades([]);
        // Don't show error to user, just log it
      } finally {
        setLoading(false);
      }
    };
    fetchOpenTrades();
  }, [inSlider]);

  // Get unique symbols from open trades, sorted by highest unrealized P/L
  const availableSymbols = useMemo(() => {
    // Group trades by symbol and calculate total unrealized P/L
    const symbolMap = {};
    
    openTrades.forEach(trade => {
      const symbol = trade.symbol;
      if (!symbol) return;
      
      if (!symbolMap[symbol]) {
        symbolMap[symbol] = {
          symbol: symbol,
          unrealizedPL: 0
        };
      }
      
      // Calculate unrealized P/L: (current_price - buy_price) * quantity
      const buyPrice = trade.buy_price || 0;
      const currentPrice = trade.current_price || buyPrice;
      const quantity = trade.quantity || 0;
      const profitLoss = (currentPrice - buyPrice) * quantity;
      
      symbolMap[symbol].unrealizedPL += profitLoss;
    });
    
    // Convert to array and sort by unrealized P/L (highest first)
    const symbols = Object.values(symbolMap).sort((a, b) => b.unrealizedPL - a.unrealizedPL);
    return symbols;
  }, [openTrades]);
  
  const [symbolSearchInput, setSymbolSearchInput] = useState('');
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const symbolDropdownRef = useRef(null);
  const symbolInputRef = useRef(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  
  // Compare stock dropdown refs
  const compareSymbolDropdownRef = useRef(null);
  const compareSymbolInputRef = useRef(null);
  const [compareDropdownPosition, setCompareDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
  
  // Update dropdown position when it opens
  useEffect(() => {
    if (showSymbolDropdown && symbolInputRef.current) {
      const rect = symbolInputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, [showSymbolDropdown]);

  // Update compare dropdown position when it opens
  useEffect(() => {
    if (compareSymbolSearch && compareSymbolSearch.length > 0 && compareSymbolInputRef.current) {
      const rect = compareSymbolInputRef.current.getBoundingClientRect();
      setCompareDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, [compareSymbolSearch]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showSymbolDropdown && 
          symbolDropdownRef.current && !symbolDropdownRef.current.contains(event.target) &&
          symbolInputRef.current && !symbolInputRef.current.contains(event.target)) {
        setShowSymbolDropdown(false);
      }
      if (compareSymbolSearch && compareSymbolSearch.length > 0 &&
          compareSymbolDropdownRef.current && !compareSymbolDropdownRef.current.contains(event.target) &&
          compareSymbolInputRef.current && !compareSymbolInputRef.current.contains(event.target)) {
        setCompareSymbolSearch('');
      }
    };
    
    if (showSymbolDropdown || (compareSymbolSearch && compareSymbolSearch.length > 0)) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSymbolDropdown, compareSymbolSearch]);

  // Get deals for selected symbol
  const dealsForSymbol = useMemo(() => {
    if (!selectedSymbol) return [];
    return openTrades.filter(t => t.symbol === selectedSymbol);
  }, [selectedSymbol, openTrades]);

  // Handle symbol selection
  const handleSymbolSelect = (symbol) => {
    setSelectedSymbol(symbol);
    setSymbolSearchInput(symbol);
    setShowSymbolDropdown(false);
    setSelectedDeals([]);
    setTargetPrice('');
    setTargetProbability(100);
    setCompareStocks([]); // Clear comparison stocks when symbol changes
    setAiError(null); // Clear AI error
  };
  
  // Filter symbols based on search input
  const filteredAvailableSymbols = useMemo(() => {
    if (!symbolSearchInput || symbolSearchInput.length === 0) {
      return availableSymbols;
    }
    const searchLower = symbolSearchInput.toLowerCase();
    return availableSymbols.filter(s => 
      s.symbol.toLowerCase().includes(searchLower)
    );
  }, [availableSymbols, symbolSearchInput]);
  
  // Initialize symbol search input when symbol is selected
  useEffect(() => {
    if (selectedSymbol && !symbolSearchInput) {
      setSymbolSearchInput(selectedSymbol);
    }
  }, [selectedSymbol]);

  // Handle deal selection
  const handleDealToggle = (dealId) => {
    setSelectedDeals(prev => {
      if (prev.includes(dealId)) {
        return prev.filter(id => id !== dealId);
      } else {
        return [...prev, dealId];
      }
    });
  };

  // Handle select all deals
  const handleSelectAllDeals = () => {
    if (selectedDeals.length === dealsForSymbol.length) {
      setSelectedDeals([]);
    } else {
      setSelectedDeals(dealsForSymbol.map(d => d.id));
      // Collapse deals section after selection
      setTimeout(() => setDealsExpanded(false), 300);
    }
  };
  
  // Collapse deals when deals are selected
  useEffect(() => {
    if (selectedDeals.length > 0 && selectedDeals.length === dealsForSymbol.length) {
      setTimeout(() => setDealsExpanded(false), 500);
    }
  }, [selectedDeals.length, dealsForSymbol.length]);

  // Search stocks for comparison form (with debounce)
  useEffect(() => {
    if (compareSearchTimeout) {
      clearTimeout(compareSearchTimeout);
    }

    if (!compareSymbolSearch || compareSymbolSearch.length < 1) {
      setFilteredCompareStocks([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setLoadingCompareStocks(true);
        const results = await referenceDataAPI.searchStocks(compareSymbolSearch, 'NSE', 20);
        const transformed = results.map(stock => ({
          symbol: stock.symbol,
          name: stock.company_name || stock.symbol,
          industry: stock.industry || ''
        }));
        setFilteredCompareStocks(transformed);
      } catch (err) {
        console.error('Error searching stocks:', err);
        setFilteredCompareStocks([]);
      } finally {
        setLoadingCompareStocks(false);
      }
    }, 300);

    setCompareSearchTimeout(timeout);

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [compareSymbolSearch]);

  // Handle comparison stock selection in form
  const handleCompareStockSelect = async (symbol) => {
    setCurrentCompareStock(prev => ({ ...prev, symbol, currentPrice: null }));
    setCompareSymbolSearch('');

    // Fetch current price for the selected symbol - try NSE first, then BSE
    try {
      setLoadingComparePrice(true);
      const dataSource = localStorage.getItem('market_data_source') || 'ZERODHA';
      
      // Try NSE first
      let priceResponse = null;
      try {
        priceResponse = await marketDataAPI.getPrice(symbol, 'NSE', dataSource);
      } catch (err) {
        // If NSE fails, try BSE
        console.log(`Failed to fetch ${symbol} from NSE, trying BSE...`);
        try {
          priceResponse = await marketDataAPI.getPrice(symbol, 'BSE', dataSource);
        } catch (bseErr) {
          console.warn(`Failed to fetch price for ${symbol} from both NSE and BSE:`, bseErr);
          priceResponse = null;
        }
      }
      
      if (priceResponse && priceResponse.success && priceResponse.data) {
        const currentPrice = priceResponse.data.current_price;
        setCurrentCompareStock(prev => ({ ...prev, currentPrice }));
      } else {
        console.warn(`Could not fetch price for ${symbol}`);
        setCurrentCompareStock(prev => ({ ...prev, currentPrice: null }));
      }
    } catch (err) {
      console.warn('Failed to fetch price for', symbol, err);
      setCurrentCompareStock(prev => ({ ...prev, currentPrice: null }));
    } finally {
      setLoadingComparePrice(false);
    }
  };
  
  // Add compare stock to list
  const handleAddCompareStock = () => {
    if (currentCompareStock.symbol && currentCompareStock.targetPrice) {
      setCompareStocks(prev => [...prev, { ...currentCompareStock }]);
      setCurrentCompareStock({ symbol: '', targetPrice: '', probability: 100, currentPrice: null });
      setCompareSymbolSearch('');
      setShowAddCompareForm(false);
    }
  };
  
  // Remove compare stock
  const handleRemoveCompareStock = (index) => {
    setCompareStocks(prev => prev.filter((_, i) => i !== index));
  };

  // Handle AI indicator toggle
  const handleIndicatorToggle = (indicator) => {
    setAiIndicators(prev => ({
      ...prev,
      [indicator]: !prev[indicator]
    }));
  };

  // Handle AI comparison call
  const handleAIGenerate = async () => {
    if (!selectedSymbol || selectedDeals.length === 0 || !targetPrice) {
      setAiError('Please select a stock, deals, and enter target price first');
      return;
    }

    setAiLoading(true);
    setAiError(null);

    try {
      // Get current price for the selected symbol
      const selectedDealsData = dealsForSymbol.filter(d => selectedDeals.includes(d.id));
      const totalQuantity = selectedDealsData.reduce((sum, deal) => sum + (deal.quantity || 0), 0);
      const currentAmount = selectedDealsData.reduce((sum, deal) => {
        const currentPrice = deal.current_price || deal.buy_price || 0;
        return sum + (currentPrice * (deal.quantity || 0));
      }, 0);
      const currentPrice = currentAmount / totalQuantity;

      // Build indicators array
      const indicators = [];
      if (aiIndicators.volume) indicators.push('Volume');
      if (aiIndicators.awayFrom52WeekHigh) indicators.push('% away from 52-week high');
      if (aiIndicators.epsGrowth) indicators.push('EPS growth');
      if (aiIndicators.netProfitGrowth) indicators.push('Net profit growth');
      if (aiIndicators.peVsIndustry) indicators.push('PE vs industry');
      if (aiIndicators.marketCap) indicators.push('Market cap');

      // Call AI API
      const response = await aiAssistantAPI.getComparison(
        selectedSymbol,
        currentPrice,
        aiModel,
        indicators
      );

      // Fetch current prices for AI-suggested stocks and populate compareStocks
      const newCompareStocks = [];
      for (const stock of response.stocks) {
        try {
          const dataSource = localStorage.getItem('market_data_source') || 'ZERODHA';
          let priceResponse = null;
          
          // Try NSE first
          try {
            priceResponse = await marketDataAPI.getPrice(stock.symbol, 'NSE', dataSource);
          } catch (err) {
            // If NSE fails, try BSE
            try {
              priceResponse = await marketDataAPI.getPrice(stock.symbol, 'BSE', dataSource);
            } catch (bseErr) {
              console.warn(`Failed to fetch price for ${stock.symbol}:`, bseErr);
            }
          }

          const currentPrice = priceResponse && priceResponse.success && priceResponse.data
            ? priceResponse.data.current_price
            : null;

          newCompareStocks.push({
            symbol: stock.symbol,
            targetPrice: stock.targetPrice.toString(),
            probability: stock.probability,
            currentPrice: currentPrice
          });
        } catch (err) {
          console.warn(`Error fetching price for ${stock.symbol}:`, err);
          // Still add the stock, but without current price
          newCompareStocks.push({
            symbol: stock.symbol,
            targetPrice: stock.targetPrice.toString(),
            probability: stock.probability,
            currentPrice: null
          });
        }
      }

      // Replace existing compare stocks with AI suggestions
      setCompareStocks(newCompareStocks);
    } catch (err) {
      console.error('Error generating AI comparison:', err);
      setAiError(err.response?.data?.detail || err.message || 'Failed to generate AI comparison');
    } finally {
      setAiLoading(false);
    }
  };

  // Calculate profits
  const calculations = useMemo(() => {
    if (!selectedSymbol || selectedDeals.length === 0 || !targetPrice) {
      return null;
    }

    // Get selected deals data
    const selectedDealsData = dealsForSymbol.filter(d => selectedDeals.includes(d.id));
    
    // Calculate total quantity and current amount for selected deals
    const totalQuantity = selectedDealsData.reduce((sum, deal) => sum + (deal.quantity || 0), 0);
    const currentAmount = selectedDealsData.reduce((sum, deal) => {
      const currentPrice = deal.current_price || deal.buy_price || 0;
      return sum + (currentPrice * (deal.quantity || 0));
    }, 0);
    const targetAmount = parseFloat(targetPrice) * totalQuantity;

    // Calculate profit for selected symbol
    const sellProfit = targetAmount - currentAmount;
    const sellProfitIndexed = sellProfit * (targetProbability / 100);

    const results = {
      sell: {
        symbol: selectedSymbol,
        quantity: totalQuantity,
        currentPrice: currentAmount / totalQuantity,
        targetPrice: parseFloat(targetPrice),
        currentAmount: currentAmount, // Current value of shares being sold
        amount: targetAmount, // Target amount from selling
        profit: sellProfit,
        profitIndexed: sellProfitIndexed,
        probability: targetProbability
      },
      compare: [],
      totalCurrentAmount: currentAmount // Store for display
    };

    // Calculate profits for comparison stocks
    // Distribute the currentAmount equally among all comparison stocks
    // So total amount of all comparison shares = amount being sold
    const numValidCompareStocks = compareStocks.filter(
      stock => stock.symbol && stock.targetPrice && stock.currentPrice
    ).length;
    
    const amountPerCompareStock = numValidCompareStocks > 0 
      ? currentAmount / numValidCompareStocks 
      : 0;
    
    compareStocks.forEach((stock, index) => {
      if (stock.symbol && stock.targetPrice && stock.currentPrice) {
        const currentPriceNum = parseFloat(stock.currentPrice);
        const targetPriceNum = parseFloat(stock.targetPrice);
        const probability = parseFloat(stock.probability) || 100;
        
        // Each comparison stock gets an equal portion of the currentAmount
        // Calculate quantity that can be bought with this portion at current market price
        const quantity = amountPerCompareStock / currentPriceNum;
        const compareCurrentAmount = amountPerCompareStock; // Investment amount (equal portion)
        const compareTargetAmount = targetPriceNum * quantity; // Amount at target price
        const compareProfit = compareTargetAmount - compareCurrentAmount;
        const compareProfitIndexed = compareProfit * (probability / 100);

        results.compare.push({
          symbol: stock.symbol,
          quantity: quantity,
          currentPrice: currentPriceNum,
          targetPrice: targetPriceNum,
          amount: compareTargetAmount,
          currentAmount: compareCurrentAmount, // Investment amount for this stock
          profit: compareProfit,
          profitIndexed: compareProfitIndexed,
          probability: probability
        });
      }
    });

    return results;
  }, [selectedSymbol, selectedDeals, targetPrice, targetProbability, compareStocks, dealsForSymbol]);

  // Get recommendation
  const recommendation = useMemo(() => {
    if (!calculations) return null;

    const allProfits = [
      { symbol: calculations.sell.symbol, profit: calculations.sell.profitIndexed, type: 'sell' },
      ...calculations.compare.map(c => ({ symbol: c.symbol, profit: c.profitIndexed, type: 'buy' }))
    ].filter(p => p.profit !== undefined && !isNaN(p.profit));

    if (allProfits.length === 0) return null;

    const best = allProfits.reduce((max, curr) => 
      curr.profit > max.profit ? curr : max
    );

    return {
      action: best.type === 'sell' ? 'sell' : 'buy',
      symbol: best.symbol,
      profit: best.profit
    };
  }, [calculations]);

  const formatCurrency = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '0';
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className={`decision-assistant ${inSlider ? 'in-slider' : ''}`}>
      {!inSlider && (
        <div className="decision-assistant-header">
          <h2>Decision Assistant</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
      )}

      <div className="decision-assistant-content">
        {/* Step 1: Select Symbol and Deals */}
        <div className="decision-section">
          <h3>1. Select Share to be Sold</h3>
          <div className="form-group">
            <label>Symbol *</label>
            <div className="symbol-input-wrapper" ref={symbolDropdownRef}>
              <input
                ref={symbolInputRef}
                type="text"
                value={symbolSearchInput}
                onChange={(e) => {
                  setSymbolSearchInput(e.target.value);
                  setShowSymbolDropdown(true);
                }}
                onFocus={() => {
                  setShowSymbolDropdown(true);
                  if (!symbolSearchInput && selectedSymbol) {
                    setSymbolSearchInput(selectedSymbol);
                  }
                }}
                onClick={() => {
                  setShowSymbolDropdown(true);
                }}
                placeholder="Search or select symbol from open positions..."
                className="form-input"
              />
              {showSymbolDropdown && filteredAvailableSymbols.length > 0 && createPortal(
                <div 
                  className="symbol-dropdown symbol-dropdown-fixed"
                  ref={symbolDropdownRef}
                  style={{
                    position: 'fixed',
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`,
                    width: `${dropdownPosition.width}px`,
                    zIndex: 10000
                  }}
                >
                  {filteredAvailableSymbols.slice(0, 15).map((item) => (
                    <div
                      key={item.symbol}
                      className="symbol-option symbol-option-with-pl"
                      onMouseDown={(e) => {
                        e.preventDefault(); // Prevent input blur
                        handleSymbolSelect(item.symbol);
                      }}
                    >
                      <span className="symbol-option-symbol">{item.symbol}</span>
                      <span className={`symbol-option-pl ${item.unrealizedPL >= 0 ? 'profit' : 'loss'}`}>
                        P/L: {formatCurrency(item.unrealizedPL)}
                      </span>
                    </div>
                  ))}
                </div>,
                document.body
              )}
              {showSymbolDropdown && filteredAvailableSymbols.length === 0 && symbolSearchInput.length > 0 && createPortal(
                <div 
                  className="symbol-dropdown symbol-dropdown-fixed"
                  style={{
                    position: 'fixed',
                    top: `${dropdownPosition.top}px`,
                    left: `${dropdownPosition.left}px`,
                    width: `${dropdownPosition.width}px`,
                    zIndex: 10000
                  }}
                >
                  <div className="symbol-dropdown-empty">No symbols found</div>
                </div>,
                document.body
              )}
            </div>
          </div>

          {selectedSymbol && dealsForSymbol.length > 0 && (
            <div className="deals-selection">
              <div className="deals-header">
                <label>Select Deals (Open Positions) *</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="select-all-btn"
                    onClick={handleSelectAllDeals}
                  >
                    {selectedDeals.length === dealsForSymbol.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <button
                    type="button"
                    className="collapse-toggle-btn"
                    onClick={() => setDealsExpanded(!dealsExpanded)}
                  >
                    {dealsExpanded ? '▼' : '▶'}
                  </button>
                </div>
              </div>
              {dealsExpanded && (
                <div className="deals-list">
                  {dealsForSymbol.map(deal => {
                    // Calculate unrealized profit for this deal
                    const buyPrice = deal.buy_price || 0;
                    const currentPrice = deal.current_price || buyPrice;
                    const quantity = deal.quantity || 0;
                    const unrealizedPL = (currentPrice - buyPrice) * quantity;
                    
                    return (
                      <label key={deal.id} className="deal-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedDeals.includes(deal.id)}
                          onChange={() => handleDealToggle(deal.id)}
                        />
                        <div className="deal-info">
                          <span className="deal-quantity">Qty: {formatNumber(deal.quantity)}</span>
                          <span className="deal-price">Price: {formatCurrency(deal.current_price || deal.buy_price)}</span>
                          <span className="deal-amount">Amount: {formatCurrency((deal.current_price || deal.buy_price) * (deal.quantity || 0))}</span>
                          <span className={`deal-pl ${unrealizedPL >= 0 ? 'profit' : 'loss'}`}>
                            P/L: {formatCurrency(unrealizedPL)}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              {!dealsExpanded && selectedDeals.length > 0 && (
                <div className="deals-summary">
                  {selectedDeals.length} deal(s) selected
                </div>
              )}
            </div>
          )}

          {selectedSymbol && selectedDeals.length > 0 && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Target Price *</label>
                  <input
                    type="number"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder="Enter target price"
                    className="form-input"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div className="form-group">
                  <label>Target Probability (%)</label>
                  <input
                    type="number"
                    value={targetProbability}
                    onChange={(e) => setTargetProbability(Math.min(100, Math.max(0, parseInt(e.target.value) || 100)))}
                    placeholder="100"
                    className="form-input"
                    min="0"
                    max="100"
                  />
                </div>
              </div>

              {/* AI Mode Toggle */}
              <div className="ai-mode-section" style={{ marginTop: '1.5rem', padding: '1rem', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={aiModeEnabled}
                      onChange={(e) => {
                        setAiModeEnabled(e.target.checked);
                        setAiError(null); // Clear error when toggling
                      }}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span>🤖 AI-Assisted Mode</span>
                  </label>
                </div>

                {aiModeEnabled && (
                  <div className="ai-mode-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Model Selection */}
                    <div className="form-group">
                      <label>AI Model</label>
                      <select
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="form-select"
                      >
                        <option value="chatgpt-mini">ChatGPT Mini (Default)</option>
                        <option value="chatgpt">ChatGPT</option>
                        <option value="deepseek">DeepSeek</option>
                      </select>
                    </div>

                    {/* Indicators */}
                    <div className="form-group">
                      <label>Financial Indicators (Optional)</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={aiIndicators.volume}
                            onChange={() => handleIndicatorToggle('volume')}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span>Volume</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={aiIndicators.awayFrom52WeekHigh}
                            onChange={() => handleIndicatorToggle('awayFrom52WeekHigh')}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span>% away from 52-week high</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={aiIndicators.epsGrowth}
                            onChange={() => handleIndicatorToggle('epsGrowth')}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span>EPS growth</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={aiIndicators.netProfitGrowth}
                            onChange={() => handleIndicatorToggle('netProfitGrowth')}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span>Net profit growth</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={aiIndicators.peVsIndustry}
                            onChange={() => handleIndicatorToggle('peVsIndustry')}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span>PE vs industry</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={aiIndicators.marketCap}
                            onChange={() => handleIndicatorToggle('marketCap')}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                          <span>Market cap</span>
                        </label>
                      </div>
                    </div>

                    {/* Generate Button */}
                    <button
                      type="button"
                      className="btn-confirm"
                      onClick={handleAIGenerate}
                      disabled={aiLoading || !targetPrice}
                      style={{ width: '100%', marginTop: '0.5rem' }}
                    >
                      {aiLoading ? 'Generating...' : '🤖 Generate AI Comparison'}
                    </button>

                    {aiError && (
                      <div style={{ padding: '0.75rem', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', fontSize: '0.875rem' }}>
                        {aiError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Step 2: Add Compare Stock Form - Above Table */}
        {selectedSymbol && selectedDeals.length > 0 && targetPrice && showAddCompareForm && (
          <div className="decision-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Add Compare Stock</h3>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setShowAddCompareForm(false);
                  setCurrentCompareStock({ symbol: '', targetPrice: '', probability: 100, currentPrice: null });
                  setCompareSymbolSearch('');
                }}
              >
                ×
              </button>
            </div>
            <div className="add-compare-form">
              <div className="form-group">
                <label>Symbol *</label>
                <div className="symbol-input-wrapper">
                  <input
                    ref={compareSymbolInputRef}
                    type="text"
                    value={currentCompareStock.symbol}
                    onChange={(e) => {
                      setCurrentCompareStock(prev => ({ ...prev, symbol: e.target.value }));
                      setCompareSymbolSearch(e.target.value);
                    }}
                    onFocus={() => {
                      if (currentCompareStock.symbol) {
                        setCompareSymbolSearch(currentCompareStock.symbol);
                      }
                    }}
                    placeholder="Search or type symbol..."
                    className="form-input"
                  />
                  {compareSymbolSearch && compareSymbolSearch.length > 0 && createPortal(
                    <div 
                      className="symbol-dropdown symbol-dropdown-fixed"
                      ref={compareSymbolDropdownRef}
                      style={{
                        position: 'fixed',
                        top: `${compareDropdownPosition.top}px`,
                        left: `${compareDropdownPosition.left}px`,
                        width: `${compareDropdownPosition.width}px`,
                        zIndex: 10000
                      }}
                    >
                      {loadingCompareStocks ? (
                        <div className="symbol-dropdown-loading">Searching...</div>
                      ) : filteredCompareStocks.length > 0 ? (
                        filteredCompareStocks.slice(0, 10).map((s) => (
                          <div
                            key={s.symbol}
                            className="symbol-option"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleCompareStockSelect(s.symbol);
                            }}
                          >
                            <span className="symbol-option-symbol">{s.symbol}</span>
                            <span className="symbol-option-name">{s.name}</span>
                          </div>
                        ))
                      ) : compareSymbolSearch.length >= 1 ? (
                        <div className="symbol-dropdown-empty">No stocks found</div>
                      ) : null}
                    </div>,
                    document.body
                  )}
                </div>
              </div>
              {currentCompareStock.symbol && (
                <div className="form-group">
                  <label>Current Price</label>
                  <input
                    type="text"
                    value={currentCompareStock.currentPrice ? formatCurrency(currentCompareStock.currentPrice) : (loadingComparePrice ? 'Loading...' : 'Click to fetch price')}
                    className="form-input"
                    readOnly
                    style={{ background: '#f3f4f6', cursor: 'not-allowed' }}
                    onClick={async () => {
                      if (!loadingComparePrice && !currentCompareStock.currentPrice && currentCompareStock.symbol) {
                        await handleCompareStockSelect(currentCompareStock.symbol);
                      }
                    }}
                  />
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label>Target Price *</label>
                  <input
                    type="number"
                    value={currentCompareStock.targetPrice}
                    onChange={(e) => {
                      setCurrentCompareStock(prev => ({ ...prev, targetPrice: e.target.value }));
                    }}
                    placeholder="Enter target price"
                    className="form-input"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div className="form-group">
                  <label>Probability (%)</label>
                  <input
                    type="number"
                    value={currentCompareStock.probability}
                    onChange={(e) => {
                      const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 100));
                      setCurrentCompareStock(prev => ({ ...prev, probability: val }));
                    }}
                    placeholder="100"
                    className="form-input"
                    min="0"
                    max="100"
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setShowAddCompareForm(false);
                    setCurrentCompareStock({ symbol: '', targetPrice: '', probability: 100, currentPrice: null });
                    setCompareSymbolSearch('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-confirm"
                  onClick={handleAddCompareStock}
                  disabled={!currentCompareStock.symbol || !currentCompareStock.targetPrice}
                >
                  Add Stock
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Results */}
        {calculations && (
          <div className="decision-section results-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>2. Profit Analysis</h3>
              {compareStocks.length < 3 && (
                <button
                  type="button"
                  className="add-compare-btn"
                  onClick={() => setShowAddCompareForm(true)}
                >
                  + Add Compare Stock
                </button>
              )}
            </div>
            
            {/* Compare Stocks List */}
            {compareStocks.length > 0 && (
              <div className="compare-stocks-list" style={{ marginBottom: '1rem' }}>
                {compareStocks.map((stock, index) => (
                  <div key={index} className="compare-stock-item">
                    <span className="compare-stock-symbol">{stock.symbol}</span>
                    <span className="compare-stock-details">
                      Target: {formatCurrency(stock.targetPrice)} | Prob: {stock.probability}%
                    </span>
                    <button
                      type="button"
                      className="remove-compare-btn"
                      onClick={() => handleRemoveCompareStock(index)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="comparison-table-wrapper">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th className="metric-column">Metric</th>
                    <th className="stock-column sell-column">
                      <div className="stock-header">
                        <div className="stock-label">SHARE TO BE SOLD</div>
                        <div className="stock-name">{calculations.sell.symbol}</div>
                      </div>
                    </th>
                    {calculations.compare.map((stock, index) => (
                      <th key={index} className="stock-column compare-column">
                        <div className="stock-header">
                          <div className="stock-label">COMPARE {index + 1}</div>
                          <div className="stock-name">{stock.symbol}</div>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="metric-cell">Quantity</td>
                    <td className="value-cell sell-value">{formatNumber(calculations.sell.quantity)}</td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className="value-cell compare-value">{formatNumber(stock.quantity)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="metric-cell">Current Price</td>
                    <td className="value-cell sell-value">{formatCurrency(calculations.sell.currentPrice)}</td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className="value-cell compare-value">{formatCurrency(stock.currentPrice)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="metric-cell">Target Price</td>
                    <td className="value-cell sell-value">{formatCurrency(calculations.sell.targetPrice)}</td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className="value-cell compare-value">{formatCurrency(stock.targetPrice)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="metric-cell">Target Probability</td>
                    <td className="value-cell sell-value">{calculations.sell.probability}%</td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className="value-cell compare-value">{stock.probability}%</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="metric-cell">Current Amount</td>
                    <td className="value-cell sell-value">{formatCurrency(calculations.totalCurrentAmount || calculations.sell.currentAmount)}</td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className="value-cell compare-value">{formatCurrency(stock.currentAmount || 0)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="metric-cell">Target Amount</td>
                    <td className="value-cell sell-value">{formatCurrency(calculations.sell.amount)}</td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className="value-cell compare-value">{formatCurrency(stock.amount)}</td>
                    ))}
                  </tr>
                  <tr className="profit-row">
                    <td className="metric-cell">Potential Profit</td>
                    <td className={`value-cell sell-value ${calculations.sell.profit >= 0 ? 'profit' : 'loss'}`}>
                      {formatCurrency(calculations.sell.profit)}
                    </td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className={`value-cell compare-value ${stock.profit >= 0 ? 'profit' : 'loss'}`}>
                        {formatCurrency(stock.profit)}
                      </td>
                    ))}
                  </tr>
                  <tr className="profit-row indexed">
                    <td className="metric-cell"><strong>Indexed Profit</strong></td>
                    <td className={`value-cell sell-value ${calculations.sell.profitIndexed >= 0 ? 'profit' : 'loss'}`}>
                      <strong>{formatCurrency(calculations.sell.profitIndexed)}</strong>
                    </td>
                    {calculations.compare.map((stock, index) => (
                      <td key={index} className={`value-cell compare-value ${stock.profitIndexed >= 0 ? 'profit' : 'loss'}`}>
                        <strong>{formatCurrency(stock.profitIndexed)}</strong>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Recommendation */}
            {recommendation && (
              <div className="recommendation-section">
                <button className="recommend-btn">
                  RECOMMEND DECISION
                </button>
                <div className="recommendation-text">
                  {recommendation.action === 'sell' ? (
                    <span>
                      You should <strong>hold {recommendation.symbol}</strong> and not sell it. 
                      It has a better potential (Profit: {formatCurrency(recommendation.profit)})
                    </span>
                  ) : (
                    <span>
                      You should <strong>sell {selectedSymbol}</strong> and <strong>buy {recommendation.symbol}</strong> stock immediately, 
                      it has a better potential (Profit: {formatCurrency(recommendation.profit)})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DecisionAssistant;

