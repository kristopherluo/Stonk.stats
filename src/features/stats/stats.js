/**
 * Stats - Trading statistics calculations and DOM rendering
 */

import { state } from '../../core/state.js';
import { priceTracker } from '../../core/priceTracker.js';
import { historicalPrices } from '../../core/historicalPrices.js';

class Stats {
  constructor() {
    this.elements = {};
    this.stats = {};
    this.filters = {
      dateFrom: null,
      dateTo: null
    };
  }

  init() {
    // Cache DOM elements
    this.elements = {
      // Trading Performance
      openPositions: document.getElementById('statOpenPositions'),
      openRisk: document.getElementById('statOpenRisk'),
      totalPnL: document.getElementById('statTotalPnL'),
      pnlCard: document.getElementById('statPnLCard'),
      pnlTrades: document.getElementById('statPnLTrades'),
      winRate: document.getElementById('statWinRate'),
      winLoss: document.getElementById('statWinLoss'),
      sharpe: document.getElementById('statSharpe'),

      // Account Growth
      currentAccount: document.getElementById('statCurrentAccount'),
      accountChange: document.getElementById('statAccountChange'),
      tradingGrowth: document.getElementById('statTradingGrowth'),
      tradingGrowthCard: document.getElementById('statTradingGrowthCard'),
      totalGrowth: document.getElementById('statTotalGrowth'),
      totalGrowthCard: document.getElementById('statTotalGrowthCard'),
      cashFlow: document.getElementById('statCashFlow'),

      // Chart
      chartValue: document.getElementById('statChartValue'),

      // Filter elements
      dateRange: document.getElementById('statsDateRange'),
      filterBtn: document.getElementById('statsFilterBtn'),
      filterPanel: document.getElementById('statsFilterPanel'),
      filterClose: document.getElementById('statsFilterClose'),
      filterBackdrop: document.getElementById('statsFilterBackdrop'),
      filterCount: document.getElementById('statsFilterCount'),
      applyFilters: document.getElementById('statsApplyFilters'),
      clearFilters: document.getElementById('statsClearFilters'),
      dateFrom: document.getElementById('statsFilterDateFrom'),
      dateTo: document.getElementById('statsFilterDateTo'),
      datePresetBtns: document.querySelectorAll('#statsFilterPanel .filter-preset-btn')
    };

    // Listen for journal changes
    state.on('journalEntryAdded', () => this.refresh());
    state.on('journalEntryUpdated', () => this.refresh());
    state.on('journalEntryDeleted', () => this.refresh());
    state.on('accountSizeChanged', () => this.refresh());
    state.on('cashFlowChanged', () => this.refresh());
    state.on('settingsChanged', () => this.refresh());
    state.on('pricesUpdated', () => this.refresh());
    state.on('viewChanged', (data) => {
      if (data.to === 'stats') this.refresh();
    });

    // Bind filter event handlers
    this.bindFilterEvents();

    // Initialize date inputs with gray styling since "All time" is default
    if (this.elements.dateFrom) this.elements.dateFrom.classList.add('preset-value');
    if (this.elements.dateTo) this.elements.dateTo.classList.add('preset-value');

    // Initial calculation
    this.refresh();
  }

  bindFilterEvents() {
    // Filter dropdown
    if (this.elements.filterBtn) {
      this.elements.filterBtn.addEventListener('click', () => this.toggleFilterPanel());
    }

    if (this.elements.filterClose) {
      this.elements.filterClose.addEventListener('click', () => this.closeFilterPanel());
    }

    if (this.elements.applyFilters) {
      this.elements.applyFilters.addEventListener('click', () => this.applyFilters());
    }

    if (this.elements.clearFilters) {
      this.elements.clearFilters.addEventListener('click', () => this.clearAllFilters());
    }

    // Filter backdrop
    if (this.elements.filterBackdrop) {
      this.elements.filterBackdrop.addEventListener('click', () => this.closeFilterPanel());
    }

    // Date range preset buttons
    if (this.elements.datePresetBtns) {
      this.elements.datePresetBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const range = e.target.dataset.range;
          this.handleDatePreset(range);
        });
      });
    }

    // Date inputs - clear preset selection and styling when manually changed
    if (this.elements.dateFrom) {
      this.elements.dateFrom.addEventListener('change', () => {
        this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
        this.elements.dateFrom?.classList.remove('preset-value');
        this.elements.dateTo?.classList.remove('preset-value');
      });
    }
    if (this.elements.dateTo) {
      this.elements.dateTo.addEventListener('change', () => {
        this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
        this.elements.dateFrom?.classList.remove('preset-value');
        this.elements.dateTo?.classList.remove('preset-value');
      });
    }

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.elements.filterPanel?.classList.contains('open')) {
        const isClickInside = this.elements.filterBtn?.contains(e.target) ||
                             this.elements.filterPanel?.contains(e.target);
        if (!isClickInside) {
          this.closeFilterPanel();
        }
      }
    });
  }

  toggleFilterPanel() {
    const isOpen = this.elements.filterPanel?.classList.contains('open');
    if (isOpen) {
      this.closeFilterPanel();
    } else {
      this.openFilterPanel();
    }
  }

  openFilterPanel() {
    // Restore UI to match current applied filters
    this.syncFilterUIToState();

    this.elements.filterPanel?.classList.add('open');
    this.elements.filterBtn?.classList.add('open');
    this.elements.filterBackdrop?.classList.add('open');
  }

  closeFilterPanel() {
    // Restore UI to last applied state when closing without applying
    this.syncFilterUIToState();

    this.elements.filterPanel?.classList.remove('open');
    this.elements.filterBtn?.classList.remove('open');
    this.elements.filterBackdrop?.classList.remove('open');
  }

  syncFilterUIToState() {
    // Sync date range to current filter state
    if (this.elements.dateFrom) {
      this.elements.dateFrom.value = this.filters.dateFrom || '';
    }
    if (this.elements.dateTo) {
      this.elements.dateTo.value = this.filters.dateTo || '';
    }

    // Determine which preset button should be active
    const hasDateFilter = this.filters.dateFrom || this.filters.dateTo;
    if (!hasDateFilter) {
      // "All time" preset
      this.elements.datePresetBtns?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === 'all');
      });
      if (this.elements.dateFrom) this.elements.dateFrom.classList.add('preset-value');
      if (this.elements.dateTo) this.elements.dateTo.classList.add('preset-value');
    } else {
      // Check if current date range matches a preset
      const matchingPreset = this.findMatchingPreset();
      this.elements.datePresetBtns?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === matchingPreset);
      });
    }
  }

  findMatchingPreset() {
    if (!this.filters.dateFrom || !this.filters.dateTo) return null;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Check if dateTo is today
    if (this.filters.dateTo !== todayStr) return null;

    // Calculate days difference from dateFrom to today
    const fromDate = new Date(this.filters.dateFrom);
    const daysDiff = Math.floor((today - fromDate) / (1000 * 60 * 60 * 24));

    // Match to preset (with some tolerance for date calculation differences)
    if (Math.abs(daysDiff - 30) <= 1) return '30';
    if (Math.abs(daysDiff - 90) <= 1) return '90';
    if (Math.abs(daysDiff - 365) <= 1) return '365';

    return null;
  }

  handleDatePreset(range) {
    // Update active button
    this.elements.datePresetBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === range);
    });

    if (range === 'all') {
      // Clear date range
      if (this.elements.dateFrom) {
        this.elements.dateFrom.value = '';
        this.elements.dateFrom.classList.add('preset-value');
      }
      if (this.elements.dateTo) {
        this.elements.dateTo.value = '';
        this.elements.dateTo.classList.add('preset-value');
      }
    } else {
      // Calculate date range based on preset
      const today = new Date();
      const daysBack = parseInt(range);
      const fromDate = new Date(today);
      fromDate.setDate(today.getDate() - daysBack);

      const fromStr = fromDate.toISOString().split('T')[0];
      const toStr = today.toISOString().split('T')[0];

      if (this.elements.dateFrom) {
        this.elements.dateFrom.value = fromStr;
        this.elements.dateFrom.classList.remove('preset-value');
      }
      if (this.elements.dateTo) {
        this.elements.dateTo.value = toStr;
        this.elements.dateTo.classList.remove('preset-value');
      }
    }
  }

  applyFilters() {
    // Get values from UI
    const dateFrom = this.elements.dateFrom?.value || null;
    const dateTo = this.elements.dateTo?.value || null;

    // Update filter state
    this.filters.dateFrom = dateFrom;
    this.filters.dateTo = dateTo;

    // Update filter count badge
    const filterCount = (dateFrom || dateTo) ? 1 : 0;
    if (this.elements.filterCount) {
      if (filterCount > 0) {
        this.elements.filterCount.textContent = filterCount;
        this.elements.filterCount.style.display = 'inline-flex';
      } else {
        this.elements.filterCount.style.display = 'none';
      }
    }

    // Close panel
    this.closeFilterPanel();

    // Re-calculate and render with filtered data
    this.refresh();
  }

  clearAllFilters() {
    // Reset to "All time"
    this.elements.datePresetBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === 'all');
    });

    if (this.elements.dateFrom) {
      this.elements.dateFrom.value = '';
      this.elements.dateFrom.classList.add('preset-value');
    }
    if (this.elements.dateTo) {
      this.elements.dateTo.value = '';
      this.elements.dateTo.classList.add('preset-value');
    }
  }

  refresh() {
    this.calculate();
    this.render();

    // Emit event to update chart
    state.emit('statsUpdated');
  }

  getFilteredTrades() {
    let filtered = state.journal.entries;

    // Filter by date range
    if (this.filters.dateFrom || this.filters.dateTo) {
      filtered = filtered.filter(trade => {
        const tradeDate = new Date(trade.timestamp);
        const tradeDateOnly = tradeDate.toISOString().split('T')[0]; // YYYY-MM-DD

        let inRange = true;

        if (this.filters.dateFrom) {
          inRange = inRange && tradeDateOnly >= this.filters.dateFrom;
        }

        if (this.filters.dateTo) {
          inRange = inRange && tradeDateOnly <= this.filters.dateTo;
        }

        return inRange;
      });
    }

    return filtered;
  }

  calculate() {
    const filteredEntries = this.getFilteredTrades();
    const allEntries = state.journal.entries; // Always use all trades for account metrics
    const settings = state.settings;
    const account = state.account;

    // Trading Performance (uses filtered trades)
    // Open positions
    const openTrades = filteredEntries.filter(e => e.status === 'open');
    const openRiskTotal = openTrades.reduce((sum, t) => sum + (t.riskDollars || 0), 0);

    // Closed trades (includes 'closed' and 'trimmed')
    const closedTrades = filteredEntries.filter(e => e.status === 'closed' || e.status === 'trimmed');

    // P&L from closed trades - use totalRealizedPnL for trades with trim history
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.totalRealizedPnL ?? t.pnl ?? 0), 0);

    // Win/Loss calculation
    const wins = closedTrades.filter(t => (t.totalRealizedPnL ?? t.pnl ?? 0) > 0);
    const losses = closedTrades.filter(t => (t.totalRealizedPnL ?? t.pnl ?? 0) < 0);
    const winRate = closedTrades.length > 0
      ? (wins.length / closedTrades.length) * 100
      : null;

    // Sharpe ratio calculation
    const sharpe = this.calculateSharpe(closedTrades);

    // Account Growth (always uses ALL trades, not filtered)
    const allClosedTrades = allEntries.filter(e => e.status === 'closed' || e.status === 'trimmed');
    const allTimePnL = allClosedTrades.reduce((sum, t) => sum + (t.totalRealizedPnL ?? t.pnl ?? 0), 0);

    // Get current unrealized P&L from open positions
    const allOpenTrades = allEntries.filter(e => e.status === 'open' || e.status === 'trimmed');
    const unrealizedPnL = priceTracker.calculateTotalUnrealizedPnL(allOpenTrades);

    const startingAccount = settings.startingAccountSize;
    const currentAccount = account.currentSize + (unrealizedPnL?.totalPnL || 0);
    const netCashFlow = account.currentSize - startingAccount - allTimePnL;

    const tradingGrowth = startingAccount > 0
      ? ((allTimePnL + (unrealizedPnL?.totalPnL || 0)) / startingAccount) * 100
      : 0;
    const totalGrowth = startingAccount > 0
      ? ((currentAccount - startingAccount) / startingAccount) * 100
      : 0;

    this.stats = {
      openPositions: openTrades.length,
      openRiskTotal,
      closedTradeCount: closedTrades.length,
      totalPnL,
      wins: wins.length,
      losses: losses.length,
      winRate,
      sharpe,
      startingAccount,
      currentAccount,
      tradingGrowth,
      totalGrowth,
      netCashFlow
    };

    return this.stats;
  }

  calculateSharpe(closedTrades) {
    if (closedTrades.length < 2) return null;

    // Get returns as percentages
    const returns = closedTrades.map(t => {
      const pnl = t.totalRealizedPnL ?? t.pnl ?? 0;
      const positionSize = t.positionSize || 1;
      return (pnl / positionSize) * 100;
    });

    // Mean return
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Standard deviation
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Sharpe ratio (simplified, no risk-free rate)
    if (stdDev === 0) return null;
    return mean / stdDev;
  }

  render() {
    const s = this.stats;

    // Update date range display
    this.updateDateRangeDisplay();

    // Trading Performance
    if (this.elements.openPositions) {
      this.elements.openPositions.textContent = s.openPositions;
    }
    if (this.elements.openRisk) {
      this.elements.openRisk.textContent = `$${this.formatNumber(s.openRiskTotal)} at risk`;
    }

    // Total P&L
    if (this.elements.totalPnL) {
      const isPositive = s.totalPnL >= 0;
      this.elements.totalPnL.textContent = `${isPositive ? '+' : ''}$${this.formatNumber(s.totalPnL)}`;
      this.elements.pnlCard?.classList.toggle('stat-card--success', isPositive && s.totalPnL !== 0);
      this.elements.pnlCard?.classList.toggle('stat-card--danger', !isPositive);
    }
    if (this.elements.pnlTrades) {
      this.elements.pnlTrades.textContent = `${s.closedTradeCount} closed trade${s.closedTradeCount !== 1 ? 's' : ''}`;
    }

    // Win Rate
    if (this.elements.winRate) {
      this.elements.winRate.textContent = s.winRate !== null
        ? `${s.winRate.toFixed(1)}%`
        : '—';
    }
    if (this.elements.winLoss) {
      const winText = `${s.wins} win${s.wins !== 1 ? 's' : ''}`;
      const lossText = `${s.losses} loss${s.losses !== 1 ? 'es' : ''}`;
      this.elements.winLoss.textContent = `${winText} · ${lossText}`;
    }

    // Sharpe Ratio
    if (this.elements.sharpe) {
      this.elements.sharpe.textContent = s.sharpe !== null
        ? s.sharpe.toFixed(2)
        : '—';
    }

    // Account Growth
    if (this.elements.currentAccount) {
      this.elements.currentAccount.textContent = `$${this.formatNumber(s.currentAccount)}`;
    }
    if (this.elements.accountChange) {
      const change = s.currentAccount - s.startingAccount;
      const isPositive = change >= 0;
      this.elements.accountChange.textContent = `${isPositive ? '+' : '-'}$${this.formatNumber(change)} from start`;
    }

    // Trading Growth
    if (this.elements.tradingGrowth) {
      const isPositive = s.tradingGrowth >= 0;
      this.elements.tradingGrowth.textContent = `${isPositive ? '+' : ''}${s.tradingGrowth.toFixed(2)}%`;
      this.elements.tradingGrowthCard?.classList.toggle('stat-card--success', isPositive && s.tradingGrowth !== 0);
      this.elements.tradingGrowthCard?.classList.toggle('stat-card--danger', !isPositive);
    }

    // Total Growth
    if (this.elements.totalGrowth) {
      const isPositive = s.totalGrowth >= 0;
      this.elements.totalGrowth.textContent = `${isPositive ? '+' : ''}${s.totalGrowth.toFixed(2)}%`;
      this.elements.totalGrowthCard?.classList.toggle('stat-card--success', isPositive && s.totalGrowth !== 0);
      this.elements.totalGrowthCard?.classList.toggle('stat-card--danger', !isPositive);
    }

    // Net Cash Flow
    if (this.elements.cashFlow) {
      const isPositive = s.netCashFlow >= 0;
      this.elements.cashFlow.textContent = `${isPositive ? '+' : ''}$${this.formatNumber(s.netCashFlow)}`;
    }

    // Chart value (current account)
    if (this.elements.chartValue) {
      this.elements.chartValue.textContent = `$${this.formatNumber(s.currentAccount)}`;
    }
  }

  formatNumber(num) {
    return Math.abs(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  updateDateRangeDisplay() {
    if (!this.elements.dateRange) return;

    let rangeText = 'All time';

    if (this.filters.dateFrom || this.filters.dateTo) {
      // Check if it matches a preset first
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      if (this.filters.dateFrom && this.filters.dateTo === todayStr) {
        const fromDate = new Date(this.filters.dateFrom);
        const daysDiff = Math.floor((today - fromDate) / (1000 * 60 * 60 * 24));

        if (Math.abs(daysDiff - 30) <= 1) {
          rangeText = 'Last 30 days';
        } else if (Math.abs(daysDiff - 90) <= 1) {
          rangeText = 'Last 3 months';
        } else if (Math.abs(daysDiff - 365) <= 1) {
          rangeText = 'Last year';
        } else {
          // Custom range
          rangeText = this.formatCustomDateRange();
        }
      } else {
        // Custom range
        rangeText = this.formatCustomDateRange();
      }
    }

    this.elements.dateRange.textContent = rangeText;
  }

  formatCustomDateRange() {
    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (this.filters.dateFrom && this.filters.dateTo) {
      return `${formatDate(this.filters.dateFrom)} - ${formatDate(this.filters.dateTo)}`;
    } else if (this.filters.dateFrom) {
      return `Since ${formatDate(this.filters.dateFrom)}`;
    } else if (this.filters.dateTo) {
      return `Until ${formatDate(this.filters.dateTo)}`;
    }
    return 'All time';
  }

  async buildEquityCurve() {
    try {
      const entries = this.getFilteredTrades();
      const allEntries = state.journal.entries; // Need all entries for open positions
      const startingBalance = state.settings.startingAccountSize;

      // Get closed trades sorted by close date
      const closedTrades = entries
        .filter(e => e.status === 'closed' || e.status === 'trimmed')
        .map(t => ({
          date: t.closeDate || t.timestamp,
          pnl: t.totalRealizedPnL ?? t.pnl ?? 0,
          ticker: t.ticker,
          entry: t
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (closedTrades.length === 0) {
        return [];
      }

      // Build data points for each closed trade
      let balance = startingBalance;
      const dataPoints = [{
        date: new Date(closedTrades[0].date).getTime() - 86400000,
        balance: startingBalance,
        pnl: 0,
        ticker: 'Start'
      }];

      // Group trades by day and create one point per day
      const tradesByDay = new Map();
      closedTrades.forEach(trade => {
        const dateStr = historicalPrices.formatDate(trade.date);
        if (!tradesByDay.has(dateStr)) {
          tradesByDay.set(dateStr, []);
        }
        tradesByDay.get(dateStr).push(trade);
      });

      // Create one data point per day with end-of-day balance
      const tradePoints = [];
      const sortedDays = Array.from(tradesByDay.keys()).sort();

      sortedDays.forEach(dateStr => {
        const dayTrades = tradesByDay.get(dateStr);
        // Add all P&L from trades on this day
        const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
        balance += dayPnL;

        tradePoints.push({
          date: new Date(dateStr).getTime(),
          dateStr,
          balance,
          pnl: dayPnL,
          ticker: dayTrades.map(t => t.ticker).join(', ')
        });
      });

      // Check if we have an API key for historical prices
      const hasApiKey = historicalPrices.apiKey !== null;

      if (hasApiKey) {
        // Get all unique tickers that were open at any point
        const allTickers = [...new Set(allEntries.map(e => e.ticker).filter(t => t))];

        if (allTickers.length > 0) {
          await historicalPrices.batchFetchPrices(allTickers);
        }

        // Now build final data points with unrealized P&L
        tradePoints.forEach(point => {
          // Find positions that were open on this date
          const openOnDate = allEntries.filter(e => {
            if (!e.timestamp) return false;
            const entryDate = new Date(e.timestamp);
            const closeDate = e.closeDate ? new Date(e.closeDate) : null;
            const pointDate = new Date(point.date);

            // Position was open if entry <= pointDate < close (or no close yet)
            return entryDate <= pointDate && (!closeDate || closeDate > pointDate);
          });

          // Calculate unrealized P&L for all open positions on this date
          let unrealizedPnL = 0;
          openOnDate.forEach(trade => {
            const pnl = historicalPrices.calculateUnrealizedPnL(trade, point.dateStr);
            unrealizedPnL += pnl;
          });

          // Add point with realized + unrealized P&L
          dataPoints.push({
            date: point.date,
            balance: point.balance + unrealizedPnL,
            pnl: point.pnl,
            ticker: point.ticker,
            unrealizedPnL
          });
        });
      } else {
        // No API key - just show realized P&L
        tradePoints.forEach(point => {
          dataPoints.push({
            date: point.date,
            balance: point.balance,
            pnl: point.pnl,
            ticker: point.ticker
          });
        });
      }

      // Add current point with current unrealized P&L
      const currentOpenTrades = allEntries.filter(e => e.status === 'open' || e.status === 'trimmed');
      const currentUnrealizedPnL = priceTracker.calculateTotalUnrealizedPnL(currentOpenTrades);

      if (currentUnrealizedPnL && currentUnrealizedPnL.totalPnL !== 0) {
        dataPoints.push({
          date: Date.now(),
          balance: balance + currentUnrealizedPnL.totalPnL,
          pnl: 0,
          ticker: 'Current',
          unrealizedPnL: currentUnrealizedPnL.totalPnL
        });
      }

      return dataPoints;
    } catch (error) {
      console.error('Error building equity curve:', error);
      // Return basic equity curve without historical unrealized P&L
      return this.buildBasicEquityCurve();
    }
  }

  // Fallback: Build basic equity curve without historical unrealized P&L
  buildBasicEquityCurve() {
    const entries = this.getFilteredTrades();
    const startingBalance = state.settings.startingAccountSize;

    const closedTrades = entries
      .filter(e => e.status === 'closed' || e.status === 'trimmed')
      .map(t => ({
        date: t.closeDate || t.timestamp,
        pnl: t.totalRealizedPnL ?? t.pnl ?? 0,
        ticker: t.ticker
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (closedTrades.length === 0) {
      return [];
    }

    // Group trades by day
    const tradesByDay = new Map();
    closedTrades.forEach(trade => {
      const dateStr = historicalPrices.formatDate(trade.date);
      if (!tradesByDay.has(dateStr)) {
        tradesByDay.set(dateStr, []);
      }
      tradesByDay.get(dateStr).push(trade);
    });

    let balance = startingBalance;
    const dataPoints = [{
      date: new Date(closedTrades[0].date).getTime() - 86400000,
      balance: startingBalance,
      pnl: 0,
      ticker: 'Start'
    }];

    // Create one point per day
    const sortedDays = Array.from(tradesByDay.keys()).sort();
    sortedDays.forEach(dateStr => {
      const dayTrades = tradesByDay.get(dateStr);
      const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
      balance += dayPnL;

      dataPoints.push({
        date: new Date(dateStr).getTime(),
        balance,
        pnl: dayPnL,
        ticker: dayTrades.map(t => t.ticker).join(', ')
      });
    });

    return dataPoints;
  }

  getStats() {
    return this.stats;
  }
}

export const stats = new Stats();
export { Stats };
