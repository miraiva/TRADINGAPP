import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { snapshotAPI, tradesAPI } from '../services/api';
import { getCurrentView, filterTradesByView } from '../utils/accountUtils';
import { formatCurrencyWithMode, formatNumberWithMode } from '../utils/displayUtils';
import './Charts.css';

const Charts = ({ showHeader = false, onClose = null }) => {
  const [snapshots, setSnapshots] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState(getCurrentView());

  const fetchSnapshots = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Build query params based on current view
      // Ignore account IDs - fetch all snapshots for the strategy
      const params = {
        limit: 1000 // Increase limit to fetch all snapshots
      };
      
      if (view === 'OVERALL') {
        params.trading_strategy = 'OVERALL';
      } else if (view === 'SWING') {
        params.trading_strategy = 'SWING';
      } else if (view === 'LONG_TERM') {
        params.trading_strategy = 'LONG_TERM';
      }
      
      // Fetch snapshots - the backend filters by trading_strategy
      // Don't filter by zerodha_user_id - include all snapshots regardless of account
      let data = await snapshotAPI.getSnapshots(params);
      
      console.log(`Charts: Fetched ${data?.length || 0} snapshots for view=${view}`);
      
      // Group by date and aggregate values if multiple snapshots exist for the same date
      const dateMap = {};
      (data || []).forEach(snapshot => {
        const date = snapshot.snapshot_date;
        if (!dateMap[date]) {
          dateMap[date] = {
            snapshot_date: date,
            nav: snapshot.nav || 0,
            portfolio_value: snapshot.portfolio_value || 0,
            count: 1
          };
        } else {
          // Aggregate values (average for NAV, sum for portfolio value)
          const existing = dateMap[date];
          existing.nav = (existing.nav * existing.count + (snapshot.nav || 0)) / (existing.count + 1);
          existing.portfolio_value = existing.portfolio_value + (snapshot.portfolio_value || 0);
          existing.count += 1;
        }
      });
      
      // Convert back to array
      data = Object.values(dateMap);
      
      setSnapshots(data || []);
    } catch (err) {
      console.error('Charts: Error fetching snapshots:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to fetch snapshots');
      setSnapshots([]);
    }
  }, [view]);

  const fetchTrades = useCallback(async () => {
    try {
      // Fetch all trades
      const allTrades = await tradesAPI.getAllTrades();
      
      // Filter trades by current view
      const filtered = filterTradesByView(allTrades, view);
      
      // Only include OPEN trades for unrealised P/L
      const openTrades = filtered.filter(trade => trade.status === 'OPEN');
      
      setTrades(openTrades || []);
    } catch (err) {
      console.error('Charts: Error fetching trades:', err);
      setTrades([]);
    }
  }, [view]);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchSnapshots(), fetchTrades()]);
      setLoading(false);
    };
    loadData();
  }, [fetchSnapshots, fetchTrades]);

  // Listen for view changes from Dashboard
  useEffect(() => {
    const handleViewChange = () => {
      const newView = getCurrentView();
      setView(newView);
    };
    window.addEventListener('storage', handleViewChange);
    window.addEventListener('viewChanged', handleViewChange);
    const interval = setInterval(handleViewChange, 1000);
    return () => {
      window.removeEventListener('storage', handleViewChange);
      window.removeEventListener('viewChanged', handleViewChange);
      clearInterval(interval);
    };
  }, []);

  // Listen for snapshot creation
  useEffect(() => {
    const handleSnapshotCreated = () => {
      fetchSnapshots();
    };
    window.addEventListener('snapshotCreated', handleSnapshotCreated);
    return () => {
      window.removeEventListener('snapshotCreated', handleSnapshotCreated);
    };
  }, [fetchSnapshots]);

  // Helper function to format dates
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-IN', { 
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  // Prepare chart data for NAV and Portfolio Value - sort by date and format
  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];

    // Sort by date
    const sorted = [...snapshots].sort((a, b) => {
      const dateA = new Date(a.snapshot_date);
      const dateB = new Date(b.snapshot_date);
      return dateA - dateB;
    });

    // Format data for charts
    return sorted.map(snapshot => ({
      date: snapshot.snapshot_date,
      dateFormatted: formatDate(snapshot.snapshot_date),
      nav: snapshot.nav || 0,
      portfolioValue: snapshot.portfolio_value || 0,
    }));
  }, [snapshots]);

  // Prepare P/L Position data - group by symbol
  const plPositionData = useMemo(() => {
    if (!trades || trades.length === 0) return [];

    // Group trades by symbol and calculate unrealised P/L
    const symbolMap = {};
    
    trades.forEach(trade => {
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
  }, [trades]);

  const formatCurrency = (value) => {
    if (value == null || value === undefined) return '-';
    return formatCurrencyWithMode(value);
  };

  const formatNumber = (value, decimals = 2) => {
    if (value == null || value === undefined) return '-';
    return formatNumberWithMode(value, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  if (loading && snapshots.length === 0) {
    return (
      <div className="charts-container">
        <div className="charts-loading">
          <div className="spinner"></div>
          <p>Loading chart data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="charts-container">
        <div className="charts-error">
          <p>Error: {error}</p>
          <button className="btn-retry" onClick={() => { fetchSnapshots(); fetchTrades(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="charts-container">
      <div className="charts-header-bar">
        <h2 className="charts-title">Portfolio Charts ({view})</h2>
        {onClose && (
          <button className="charts-close-btn" onClick={onClose} title="Close">
            ×
          </button>
        )}
      </div>

      <div className="charts-list">
        {/* NAV Chart with Zoom */}
        <div className="chart-card">
          <h3 className="chart-title">NAV Over Time</h3>
          {chartData.length === 0 ? (
            <div className="chart-empty">No data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 40, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="dateFormatted" 
                  tick={{ fontSize: 10 }}
                  angle={-90}
                  textAnchor="end"
                  height={60}
                />
                <YAxis 
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => formatNumber(value, 2)}
                  width={80}
                  domain={[10, 'auto']}
                />
                <Tooltip 
                  formatter={(value) => formatNumber(value, 2)}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="nav" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  dot={false}
                  name="NAV"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Portfolio Value Chart with Zoom */}
        <div className="chart-card">
          <h3 className="chart-title">Portfolio Value Over Time</h3>
          {chartData.length === 0 ? (
            <div className="chart-empty">No data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 40, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="dateFormatted" 
                  tick={{ fontSize: 10 }}
                  angle={-90}
                  textAnchor="end"
                  height={60}
                />
                <YAxis 
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                    return value.toString();
                  }}
                  width={80}
                  domain={[2750000, 'auto']}
                />
                <Tooltip 
                  formatter={(value) => formatCurrency(value)}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <Line 
                  type="monotone" 
                  dataKey="portfolioValue" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  dot={false}
                  name="Portfolio Value"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Profit/Loss Position Chart */}
        <div className="chart-card chart-card-fixed">
          <h3 className="chart-title">Profit and Loss Position (Unrealised P/L per Symbol)</h3>
          {plPositionData.length === 0 ? (
            <div className="chart-empty">No open positions available</div>
          ) : (
            <div className="chart-inner-container">
              <ResponsiveContainer width="100%" height={400}>
              <BarChart 
                data={plPositionData} 
                margin={{ top: 5, right: 20, bottom: 100, left: 20 }}
                barCategoryGap="10%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="symbol" 
                  tick={{ fontSize: 8 }}
                  angle={-90}
                  textAnchor="end"
                  height={100}
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
                  width={80}
                />
                <Tooltip 
                  formatter={(value) => formatCurrency(value)}
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
                      key={`cell-${index}`} 
                      fill={entry.unrealisedPL >= 0 ? '#10b981' : '#ef4444'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Charts;
