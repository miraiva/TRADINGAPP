import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line, LineChart, ComposedChart } from 'recharts';
import { tradesAPI, payinAPI } from '../services/api';
import TradesTable from './TradesTable';
import { filterTradesByView, getCurrentView, setCurrentView, getAccountIdsByStrategy, getAllAccountIds, getAccountDetails } from '../utils/accountUtils';
import { formatCurrencyWithMode, formatNumberWithMode, getPrivacyMode, getDemoMode } from '../utils/displayUtils';
import { calculatePortfolioXIRR } from '../utils/xirr';
import './Dashboard.css';

// Custom label component for pie chart with text wrapping
const CustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
  if (percent < 0.03) return null; // Don't show labels for very small slices
  
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  
  // Calculate label position (outside the pie)
  const labelRadius = outerRadius + 20;
  const labelX = cx + labelRadius * Math.cos(-midAngle * RADIAN);
  const labelY = cy + labelRadius * Math.sin(-midAngle * RADIAN);
  
  // Determine text anchor based on position
  const textAnchor = x > cx ? 'start' : 'end';
  
  // Split name into words for wrapping
  const words = name.split(' ');
  const maxWidth = 80; // Maximum width per line
  const lines = [];
  let currentLine = '';
  
  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length * 6 <= maxWidth) { // Approximate character width
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  });
  if (currentLine) lines.push(currentLine);
  
  return (
    <g>
      <text
        x={labelX}
        y={labelY}
        textAnchor={textAnchor}
        fill="#374151"
        fontSize="11"
        fontWeight="500"
      >
        {lines.map((line, index) => (
          <tspan
            key={index}
            x={labelX}
            dy={index === 0 ? 0 : 14}
            textAnchor={textAnchor}
          >
            {line}
          </tspan>
        ))}
        <tspan
          x={labelX}
          dy={14}
          textAnchor={textAnchor}
          fill="#6b7280"
          fontSize="10"
        >
          {`${(percent * 100).toFixed(0)}%`}
        </tspan>
      </text>
    </g>
  );
};

const Dashboard = ({ refreshKey = 0, onBuyClick }) => {
  const [isTableExpanded, setIsTableExpanded] = useState(true); // Always open by default
  const [trades, setTrades] = useState([]);
  const [payins, setPayins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'OPEN', 'CLOSED'
  const [searchTerm, setSearchTerm] = useState('');
  const [profitFilter, setProfitFilter] = useState(null); // null, 'green', 'amber', 'red', 'dark-red'
  const [view, setView] = useState(getCurrentView()); // 'OVERALL', 'SWING', 'LONG_TERM'
  const [privacyMode, setPrivacyMode] = useState(getPrivacyMode());
  const [demoMode, setDemoMode] = useState(getDemoMode());
  const [selectedIndustry, setSelectedIndustry] = useState(null); // Selected industry from pie chart

  // Fetch trades and payins independently so one failure doesn't block the other
  // Note: This function ONLY updates trades and payins data - all filter states are preserved
  // Filters (filter, searchTerm, profitFilter, selectedIndustry, view) are in separate state
  // variables and are NOT modified by this function
  const fetchData = useCallback(async () => {
    setLoading(true);
    
    // Fetch trades and payins independently with longer timeout
    // This way if one times out, the other can still succeed
    const tradesPromise = tradesAPI.getAllTrades(null, true).catch(err => {
      console.error('Error fetching trades:', err);
      return []; // Return empty array on error
    });
    
    const payinsPromise = payinAPI.getAllPayins(null, true).catch(err => {
      console.error('Error fetching payins:', err);
      return []; // Return empty array on error
    });
    
    // Wait for both, but don't fail if one fails
    const [tradesData, payinsData] = await Promise.allSettled([
      tradesPromise,
      payinsPromise
    ]);
    
    // Extract data from settled promises
    // IMPORTANT: Only update trades and payins state - all filter states remain unchanged
    // Filter states (filter, searchTerm, profitFilter, selectedIndustry, view) are preserved
    setTrades(tradesData.status === 'fulfilled' ? (tradesData.value || []) : []);
    setPayins(payinsData.status === 'fulfilled' ? (payinsData.value || []) : []);
    
    setLoading(false);
  }, []); // Empty dependency array - fetchData doesn't depend on any props/state

  useEffect(() => {
    fetchData();
  }, [refreshKey]);

  // Auto-refresh based on settings
  const [refreshInterval, setRefreshInterval] = useState(() => {
    return localStorage.getItem('dashboard_refresh_interval') || '30'; // Default 30 seconds
  });

  useEffect(() => {
    const intervalMs = parseInt(refreshInterval, 10) * 1000; // Convert to milliseconds
    
    // If interval is 0 or invalid, disable auto-refresh
    if (!intervalMs || intervalMs <= 0) {
      console.log('Dashboard: Auto-refresh disabled');
      return;
    }
    
    console.log(`Dashboard: Auto-refresh enabled with interval of ${refreshInterval} seconds`);
    const intervalId = setInterval(() => {
      console.log('Dashboard: Auto-refreshing data (filters will be preserved)...');
      // fetchData is a stable reference that preserves all filter states
      fetchData();
    }, intervalMs);
    
    // Cleanup interval on unmount or when interval changes
    return () => {
      clearInterval(intervalId);
    };
  }, [refreshInterval, fetchData]); // Re-run when refreshInterval or fetchData changes

  // Listen for refresh interval changes (from Settings or other tabs)
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'dashboard_refresh_interval') {
        const newInterval = e.newValue || '30';
        console.log(`Dashboard: Refresh interval changed to ${newInterval} seconds`);
        setRefreshInterval(newInterval);
      }
    };
    
    // Also listen for custom events (same-tab updates)
    const handleCustomStorage = () => {
      const newInterval = localStorage.getItem('dashboard_refresh_interval') || '30';
      setRefreshInterval(newInterval);
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('dashboardRefreshIntervalChanged', handleCustomStorage);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('dashboardRefreshIntervalChanged', handleCustomStorage);
    };
  }, []);

  // Listen for payin changes (add, update, delete)
  useEffect(() => {
    const handlePayinChange = () => {
      fetchData();
    };
    
    window.addEventListener('payinAdded', handlePayinChange);
    window.addEventListener('payinUpdated', handlePayinChange);
    window.addEventListener('payinDeleted', handlePayinChange);
    
    // Also listen to storage events (cross-tab updates)
    const handleStorageChange = (e) => {
      if (e.key === 'payin_refresh') {
        fetchData();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('payinAdded', handlePayinChange);
      window.removeEventListener('payinUpdated', handlePayinChange);
      window.removeEventListener('payinDeleted', handlePayinChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Listen for privacy/demo mode changes
  useEffect(() => {
    const handleDisplayModeChange = () => {
      setPrivacyMode(getPrivacyMode());
      setDemoMode(getDemoMode());
    };

    // Listen for custom event (same tab) and storage event (other tabs)
    window.addEventListener('displayModeChanged', handleDisplayModeChange);
    window.addEventListener('storage', handleDisplayModeChange);
    
    return () => {
      window.removeEventListener('displayModeChanged', handleDisplayModeChange);
      window.removeEventListener('storage', handleDisplayModeChange);
    };
  }, []);

  // Filter trades based on selected view
  const filteredTrades = useMemo(() => {
    if (!trades || !Array.isArray(trades)) {
      return [];
    }
    return filterTradesByView(trades, view) || [];
  }, [trades, view]);

  // Filter payins based on selected view
  const filteredPayins = useMemo(() => {
    if (!payins || payins.length === 0) return [];
    
    // Get account IDs based on view
    let accountIds = [];
    
    if (view === 'OVERALL') {
      // For OVERALL, combine account IDs from both Swing and Long Term strategies
      // This ensures we get the exact same accounts used in individual views
      const swingIds = getAccountIdsByStrategy('SWING');
      const longTermIds = getAccountIdsByStrategy('LONG_TERM');
      // Combine and remove duplicates
      accountIds = Array.from(new Set([...swingIds, ...longTermIds]));
      
      // Debug logging (remove after fixing)
      if (process.env.NODE_ENV === 'development') {
        console.log('OVERALL Payins Filter - Swing IDs:', swingIds);
        console.log('OVERALL Payins Filter - Long Term IDs:', longTermIds);
        console.log('OVERALL Payins Filter - Combined IDs:', accountIds);
        console.log('Total payins:', payins.length);
      }
    } else {
      // For SWING or LONG_TERM, get accounts for that strategy
      accountIds = getAccountIdsByStrategy(view === 'LONG_TERM' ? 'LONG_TERM' : 'SWING');
    }
    
    if (accountIds.length === 0) {
      return [];
    }
    
    const filtered = payins.filter(payin => {
      const payinAccountId = payin.zerodha_user_id;
      // Exclude payins without account ID - only include payins from classified accounts
      if (!payinAccountId) {
        return false;
      }
      return accountIds.includes(payinAccountId);
    });
    
    // Debug logging (remove after fixing)
    if (view === 'OVERALL' && process.env.NODE_ENV === 'development') {
      console.log('OVERALL Filtered payins count:', filtered.length);
      const totalAmount = filtered.reduce((sum, p) => sum + (p.amount || 0), 0);
      console.log('OVERALL Filtered payins total amount:', totalAmount);
    }
    
    return filtered;
  }, [payins, view]);

  // Handle view change
  const handleViewChange = (newView) => {
    setView(newView);
    setCurrentView(newView);
  };

  // Handle industry selection from pie chart
  const handleIndustryClick = (data, index) => {
    const clickedIndustry = data.name;
    // Toggle: if same industry clicked again, clear filter
    if (selectedIndustry === clickedIndustry) {
      setSelectedIndustry(null);
    } else {
      setSelectedIndustry(clickedIndustry);
    }
    // Expand table if collapsed
    if (!isTableExpanded) {
      setIsTableExpanded(true);
    }
  };

  // Clear industry filter
  const clearIndustryFilter = () => {
    setSelectedIndustry(null);
  };

  // Calculate dashboard metrics
  const metrics = useMemo(() => {
    try {
      // Booked P/L (realized from closed trades)
      const bookedPL = (filteredTrades || [])
        .filter(t => t.status === 'CLOSED' && t.profit_loss !== null)
        .reduce((sum, t) => sum + (t.profit_loss || 0), 0);

    // Float P/L (unrealized from open trades)
    // Calculate dynamically from current_price to reflect real-time WebSocket updates
    const floatPL = (filteredTrades || [])
      .filter(t => t.status === 'OPEN')
      .reduce((sum, t) => {
        const buyPrice = t.buy_price || 0;
        const currentPrice = t.current_price || buyPrice; // Use current_price if available, fallback to buy_price
        const quantity = t.quantity || 0;
        
        // Calculate profit/loss: (current_price - buy_price) * quantity
        const profitLoss = (currentPrice - buyPrice) * quantity;
        return sum + profitLoss;
      }, 0);

    // Payin (total invested) - Sum from actual payin transactions
    // If no payins exist, fallback to summing trade buy amounts for backward compatibility
    const payin = filteredPayins.length > 0
      ? filteredPayins.reduce((sum, p) => sum + (p.amount || 0), 0)
      : (filteredTrades || []).reduce((sum, t) => sum + (t.buy_amount || 0) + (t.buy_charges || 0), 0);

    // Open Positions (Invested Amount - buy price x quantity)
    const openPositions = (filteredTrades || [])
      .filter(t => t.status === 'OPEN')
      .reduce((sum, t) => {
        const investedAmount = (t.buy_price || 0) * (t.quantity || 0);
        return sum + investedAmount;
      }, 0);

    // Total Portfolio = Payin + Booked P/L + Float P/L
    const totalPortfolio = payin + bookedPL + floatPL;

    // NAV = Total Portfolio / Total Number of Shares
    // Calculate total number of shares from all payins
    const totalShares = filteredPayins.length > 0
      ? filteredPayins.reduce((sum, p) => sum + (p.number_of_shares || 0), 0)
      : 0;
    
    // NAV = Total Portfolio / Total Shares (if shares exist, otherwise use Total Portfolio)
    const nav = totalShares > 0 ? totalPortfolio / totalShares : totalPortfolio;

    // Calculate total charges (buy_charges + sell_charges, or 0.5% of amount if not available)
    const totalCharges = (filteredTrades || []).reduce((sum, t) => {
      // ✅ CHANGE #1: ignore CLOSED trades
      if (t.status !== 'OPEN') return sum;
    
      const buyCharges = t.buy_charges || 0;
      const sellCharges = t.sell_charges || 0;
      const charges = buyCharges + sellCharges;
    
      if (charges > 0) {
        return sum + charges;
      }
    
      // ✅ CHANGE #2: estimate only on OPEN buy amount
      return sum + ((t.buy_amount || 0) * 0.0015);
    }, 0);

    // Balance = Payin + Booked P/L - Invested Amount (Open Deals) - Total Charges
    const balance = payin + bookedPL - openPositions - totalCharges;

    // Utilisation % = (Invested Amount (Open Deals) / (PAYIN + Booked Profit - Total Charges)) * 100
    // Available capital = Payin + Booked Profit - Total Charges (only positive booked profit counts as available capital)
    const availableCapital = payin + Math.max(0, bookedPL) - totalCharges;
    const utilisation = availableCapital > 0 ? (openPositions / availableCapital) * 100 : 0;

    // XIRR calculation (proper implementation using cash flow dates)
    // XIRR requires: cash flows (payins as negative, current value as positive) and their dates
    let xirr = null;
    if (filteredPayins.length > 0 && totalPortfolio > 0) {
      const calculatedXIRR = calculatePortfolioXIRR(filteredPayins, totalPortfolio);
      xirr = calculatedXIRR !== null ? calculatedXIRR : 0;
    } else if (payin > 0) {
      // Fallback: if no payins with dates, use simple return calculation
      xirr = ((bookedPL + floatPL) / payin) * 100;
    } else {
      xirr = 0;
    }

    // Absolute Profit % = ((Total Portfolio - Payin) / Payin) × 100
    // Or equivalently: ((Booked P/L + Float P/L) / Payin) × 100
    const absoluteProfitPercent = payin > 0 ? ((totalPortfolio - payin) / payin) * 100 : 0;

    // Day Change: Sum of day_change from all open trades
    // day_change is the absolute change in price per share, so we multiply by quantity
    const dayChangeAmount = (filteredTrades || [])
      .filter(t => t.status === 'OPEN')
      .reduce((sum, t) => {
        // day_change is already the change per share, multiply by quantity to get total change
        if (t.day_change !== null && t.day_change !== undefined) {
          return sum + (t.day_change * (t.quantity || 0));
        } else if (t.day_change_percentage !== null && t.day_change_percentage !== undefined && t.buy_price) {
          // Calculate from percentage: (day_change_percentage / 100) * buy_price * quantity
          const priceChange = (t.day_change_percentage / 100) * (t.buy_price || 0);
          return sum + (priceChange * (t.quantity || 0));
        }
        return sum;
      }, 0);

    // Day Change Percentage: (Day Change Amount / Invested Amount in Open Positions) × 100
    const dayChangePercent = openPositions > 0 ? (dayChangeAmount / openPositions) * 100 : 0;

    return {
      nav,
      bookedPL,
      floatPL,
      openPositions,
      totalPortfolio,
      payin,
      balance,
      utilisation,
      xirr,
      absoluteProfitPercent,
      dayChangeAmount: dayChangeAmount || 0,
      dayChangePercent: dayChangePercent || 0,
    };
    } catch (error) {
      console.error('Error calculating dashboard metrics:', error);
      // Return default values on error
      return {
        nav: 0,
        bookedPL: 0,
        floatPL: 0,
        openPositions: 0,
        totalPortfolio: 0,
        payin: 0,
        balance: 0,
        utilisation: 0,
        xirr: 0,
        absoluteProfitPercent: 0,
        dayChangeAmount: 0,
        dayChangePercent: 0,
      };
    }
  }, [filteredTrades, filteredPayins]);

  // Calculate industry allocation for pie chart
  const industryData = useMemo(() => {
    const industryMap = {};
    
    filteredTrades.forEach(trade => {
      if (trade.status === 'OPEN') {
        const industry = trade.industry || 'Unknown';
        const currentValue = (trade.current_price || 0) * (trade.quantity || 0);
        
        if (!industryMap[industry]) {
          industryMap[industry] = 0;
        }
        industryMap[industry] += currentValue;
      }
    });

    return Object.entries(industryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 industries
  }, [filteredTrades]);

  // Calculate monthly profit for bar chart
  const monthlyProfitData = useMemo(() => {
    const monthMap = {};
    
    filteredTrades.forEach(trade => {
      if (trade.status === 'CLOSED' && trade.sell_date) {
        const date = new Date(trade.sell_date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const profit = trade.profit_loss || 0;
        
        if (!monthMap[monthKey]) {
          monthMap[monthKey] = 0;
        }
        monthMap[monthKey] += profit;
      }
    });

    const data = Object.entries(monthMap)
      .map(([month, profit]) => ({ month, profit }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Calculate 6-month moving average
    const dataWithAverage = data.map((item, index) => {
      if (index < 5) {
        return { ...item, average: null };
      }
      
      // Calculate average of last 6 months including current
      const last6Months = data.slice(index - 5, index + 1);
      const sum = last6Months.reduce((acc, d) => acc + d.profit, 0);
      const average = sum / 6;
      
      return { ...item, average };
    });

    return dataWithAverage;
  }, [filteredTrades]);

  // Calculate P/L Position data - group by symbol (for Long Term view)
  const plPositionData = useMemo(() => {
    if (!filteredTrades || filteredTrades.length === 0) return [];

    // Only include OPEN trades for unrealised P/L
    const openTrades = filteredTrades.filter(trade => trade.status === 'OPEN');
    if (openTrades.length === 0) return [];

    // Group trades by symbol and calculate unrealised P/L
    const symbolMap = {};
    
    openTrades.forEach(trade => {
      const symbol = trade.symbol || 'Unknown';
      if (!symbolMap[symbol]) {
        symbolMap[symbol] = {
          symbol: symbol,
          quantity: 0,
          totalCost: 0,
          currentValue: 0,
          unrealisedPL: 0
        };
      }
      
      const quantity = trade.quantity || 0;
      const buyPrice = trade.buy_price || 0;
      const currentPrice = trade.current_price || buyPrice;
      
      symbolMap[symbol].quantity += quantity;
      symbolMap[symbol].totalCost += quantity * buyPrice;
      symbolMap[symbol].currentValue += quantity * currentPrice;
    });

    // Calculate unrealised P/L for each symbol
    const data = Object.values(symbolMap).map(item => ({
      symbol: item.symbol,
      unrealisedPL: item.currentValue - item.totalCost
    }));

    // Sort by unrealised P/L (highest first)
    return data.sort((a, b) => b.unrealisedPL - a.unrealisedPL);
  }, [filteredTrades]);

  // Calculate Y-axis domain - start at -5k for negatives
  const yAxisDomain = useMemo(() => {
    if (monthlyProfitData.length === 0) return [-5000, 'auto'];
    
    const maxProfit = Math.max(...monthlyProfitData.map(d => d.profit || 0));
    const minProfit = Math.min(...monthlyProfitData.map(d => d.profit || 0));
    
    // Minimum is -5k, maximum is auto (or at least 5k if all values are positive)
    const min = Math.max(minProfit, -5000);
    const max = Math.max(maxProfit, 5000);
    
    return [min, max];
  }, [monthlyProfitData]);

  // Colors for pie chart
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#8dd1e1', '#d084d0'];

  // Format currency with display mode (for dashboard only, not positions table)
  const formatCurrency = (value) => {
    return formatCurrencyWithMode(value);
  };

  // Format number with display mode (for dashboard only, not positions table)
  const formatNumber = (value) => {
    return formatNumberWithMode(value);
  };

  // Format NAV with 2 decimal places
  const formatNAV = (value) => {
    return formatCurrencyWithMode(value, { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  };

  // Format XIRR with 2 decimal places
  const formatXIRR = (value) => {
    return formatNumberWithMode(value, { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  };

  if (loading && filteredTrades.length === 0) {
    return (
      <div className="dashboard-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Safety check: ensure metrics exists
  if (!metrics) {
    return (
      <div className="dashboard-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Calculating metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Header Metrics */}
      <div className="dashboard-header">
        <div className="header-left">
          <div className="header-title">
            <h1>Portfolio Dashboard</h1>
            <span className="current-time">{new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {/* View Toggle */}
          <div className="view-toggle-container">
            <button
              className={`view-toggle-btn ${view === 'OVERALL' ? 'active' : ''}`}
              onClick={() => handleViewChange('OVERALL')}
              title="Show all accounts"
            >
              Overall
            </button>
            <button
              className={`view-toggle-btn ${view === 'SWING' ? 'active' : ''}`}
              onClick={() => handleViewChange('SWING')}
              title="Show swing trading accounts only"
            >
              Swing
            </button>
            <button
              className={`view-toggle-btn ${view === 'LONG_TERM' ? 'active' : ''}`}
              onClick={() => handleViewChange('LONG_TERM')}
              title="Show long term accounts only"
            >
              Long Term
            </button>
          </div>
        </div>
        <div className="header-right">
          <div className="profit-filter-buttons">
            <button
              type="button"
              className={`profit-filter-btn profit-filter-green ${profitFilter === 'green' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProfitFilter(profitFilter === 'green' ? null : 'green');
              }}
              title="Profit > 4%"
            />
            <button
              type="button"
              className={`profit-filter-btn profit-filter-amber ${profitFilter === 'amber' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProfitFilter(profitFilter === 'amber' ? null : 'amber');
              }}
              title="Profit 0% to 4%"
            />
            <button
              type="button"
              className={`profit-filter-btn profit-filter-red ${profitFilter === 'red' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProfitFilter(profitFilter === 'red' ? null : 'red');
              }}
              title="Loss 0% to -10%"
            />
            <button
              type="button"
              className={`profit-filter-btn profit-filter-dark-red ${profitFilter === 'dark-red' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setProfitFilter(profitFilter === 'dark-red' ? null : 'dark-red');
              }}
              title="Loss < -10%"
            />
          </div>
          <div className="header-metrics">
            <div className="metric-card-header">
              <span className="metric-label">NAV</span>
              <span className="metric-value">{formatNAV(metrics.nav)}</span>
            </div>
            <div className="metric-card-header">
              <span className="metric-label">Absolute Profit %</span>
              <span className={`metric-value ${metrics.absoluteProfitPercent >= 0 ? 'positive' : 'negative'}`}>
                {formatNumber(metrics.absoluteProfitPercent)}%
              </span>
            </div>
            <div className="metric-card-header">
              <span className="metric-label">XIRR</span>
              <span className={`metric-value ${metrics.xirr >= 0 ? 'positive' : 'negative'}`}>
                {formatXIRR(metrics.xirr)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="dashboard-summary">
        <div className="summary-cards">
          <div className="summary-card">
            <div className="card-label">BOOKED PROFIT/LOSS</div>
            <div className={`card-value ${metrics.bookedPL >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(metrics.bookedPL)}
            </div>
          </div>

          <div className="summary-card">
            <div className="card-label">PAYIN</div>
            <div className="card-value">{formatCurrency(metrics.payin)}</div>
          </div>

          <div className="summary-card">
            <div className="card-label">FLOAT PROFIT/LOSS</div>
            <div className={`card-value ${metrics.floatPL >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(metrics.floatPL)}
            </div>
          </div>

          <div className="summary-card">
            <div className="card-label">Invested Amount (Open Deals)</div>
            <div className="card-value">{formatCurrency(metrics.openPositions)}</div>
          </div>

          <div className="summary-card">
            <div className="card-label">BALANCE/UTILISATION%</div>
            <div className="card-value">
              {formatCurrency(metrics.balance)}
              <span className="utilisation-percent"> {formatNumber(metrics.utilisation)}%</span>
            </div>
          </div>

          <div className="summary-card">
            <div className="card-label">TOTAL PORTFOLIO</div>
            <div className={`card-value ${metrics.totalPortfolio >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(metrics.totalPortfolio)}
              {metrics && (metrics.dayChangeAmount !== undefined || metrics.dayChangePercent !== undefined) && (
                <span className={`day-change-indicator ${(metrics.dayChangeAmount || 0) >= 0 ? 'positive' : 'negative'}`}>
                  ({formatCurrency(metrics.dayChangeAmount || 0)} / {formatNumber(metrics.dayChangePercent || 0)}%)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="charts-section">
          <div className="chart-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3>Industry Allocation</h3>
              {selectedIndustry && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Filtered by: <strong>{selectedIndustry}</strong>
                  </span>
                  <button
                    onClick={clearIndustryFilter}
                    style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      background: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.25rem',
                      cursor: 'pointer'
                    }}
                    title="Clear industry filter"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={industryData}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={CustomLabel}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                  onClick={handleIndustryClick}
                  style={{ cursor: 'pointer' }}
                >
                  {industryData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={COLORS[index % COLORS.length]}
                      style={{
                        opacity: selectedIndustry && selectedIndustry !== entry.name ? 0.3 : 1,
                        cursor: 'pointer'
                      }}
                    />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value, name) => {
                    const displayValue = formatCurrencyWithMode(value);
                    return [displayValue, name];
                  }}
                  labelFormatter={(name) => name}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-container">
            {view === 'LONG_TERM' ? (
              <>
                <h3>Profit and Loss Position </h3>
                {plPositionData.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                    No open positions available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart 
                      data={plPositionData} 
                      margin={{ top: 5, right: 10, bottom: 45, left: 10 }}
                      barCategoryGap="10%"
                    >
                      <XAxis 
                        dataKey="symbol" 
                        tick={{ fontSize: 10 }}
                        angle={-90}
                        textAnchor="end"
                        height={45}
                        interval={0}
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => {
                            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                            if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                            if (value <= -1000000) return `-${(Math.abs(value) / 1000000).toFixed(1)}M`;
                            if (value <= -1000) return `-${(Math.abs(value) / 1000).toFixed(0)}k`;
                            return value.toString();
                          }}
                          width={50}
                        />
                        <Tooltip 
                          formatter={(value) => formatCurrencyWithMode(value)}
                          labelFormatter={(label) => `Symbol: ${label}`}
                        />
                        <Bar 
                          dataKey="unrealisedPL"
                          name="Unrealised P/L"
                          radius={[2, 2, 0, 0]}
                          maxBarSize={20}
                        >
                          {plPositionData.map((entry, index) => (
                            <Cell 
                              key={`pl-cell-${index}`} 
                              fill={entry.unrealisedPL >= 0 ? '#10b981' : '#ef4444'} 
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                )}
              </>
            ) : (
              <>
                <h3>Monthly Profit</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={monthlyProfitData} margin={{ top: 5, right: 5, bottom: 15, left: 0 }}>
                    <XAxis 
                      dataKey="month" 
                      tickFormatter={(value) => {
                        const [year, month] = value.split('-');
                        const date = new Date(parseInt(year), parseInt(month) - 1);
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        return `${monthNames[date.getMonth()]}-${year.slice(2)}`;
                      }}
                      tick={{ fontSize: 10 }}
                      angle={-90}
                      textAnchor="end"
                      height={40}
                      interval={1}
                    />
                    <YAxis 
                      tickFormatter={(value) => {
                        if (value >= 1000) {
                          return `${(value / 1000).toFixed(0)}k`;
                        } else if (value <= -1000) {
                          return `${(value / 1000).toFixed(0)}k`;
                        }
                        return value.toString();
                      }} 
                      tick={{ fontSize: 10 }}
                      width={40}
                      domain={yAxisDomain}
                    />
                    <Tooltip 
                      formatter={(value, name) => {
                        const displayValue = formatCurrencyWithMode(value);
                        if (name === 'average') {
                          return [displayValue, '6-Month Average'];
                        }
                        return [displayValue, 'Profit'];
                      }}
                    />
                    <Bar 
                      dataKey="profit" 
                      barSize={30}
                      radius={[4, 4, 0, 0]}
                    >
                      {monthlyProfitData.map((entry, index) => (
                        <Cell 
                          key={`bar-cell-${index}`} 
                          fill={entry.profit >= 0 ? '#059669' : '#dc2626'} 
                        />
                      ))}
                    </Bar>
                    <Line 
                      type="monotone" 
                      dataKey="average" 
                      stroke="#1e3a8a" 
                      strokeWidth={3}
                      dot={false}
                      strokeDasharray="5 5"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Collapsible Trades Table */}
      <div className="trades-section">
        <div className="trades-section-header">
          <div 
            className="trades-section-title"
            onClick={() => setIsTableExpanded(!isTableExpanded)}
          >
            <h2>POSITIONS</h2>
            <div className="table-toggle">
              <span className="toggle-label">{isTableExpanded ? 'Collapse' : 'Expand'}</span>
              <span className={`toggle-icon ${isTableExpanded ? 'expanded' : ''}`}>▼</span>
            </div>
          </div>
          {isTableExpanded && (
            <div className="trades-section-controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search by symbol, trader, or industry..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <div className="filter-buttons">
                <button
                  className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  All
                </button>
                <button
                  className={`filter-btn ${filter === 'OPEN' ? 'active' : ''}`}
                  onClick={() => setFilter('OPEN')}
                >
                  Open
                </button>
                <button
                  className={`filter-btn ${filter === 'CLOSED' ? 'active' : ''}`}
                  onClick={() => setFilter('CLOSED')}
                >
                  Closed
                </button>
              </div>
            </div>
          )}
        </div>
        {isTableExpanded && (
          <div className="trades-table-wrapper">
            {Array.isArray(filteredTrades) ? (
              <TradesTable 
                trades={filteredTrades} 
                loading={loading} 
                filter={filter} 
                searchTerm={searchTerm} 
                industryFilter={selectedIndustry}
                profitFilter={profitFilter}
                onTradesUpdate={(updatedTrades) => {
                  // Update Dashboard's trades state when TradesTable updates prices via WebSocket
                  setTrades(prevTrades => {
                    return prevTrades.map(trade => {
                      const updated = updatedTrades.find(t => t.id === trade.id);
                      return updated || trade;
                    });
                  });
                }}
              />
            ) : (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Loading positions...</p>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default Dashboard;

