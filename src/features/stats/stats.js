/**
 * Stats - Trading statistics calculations and DOM rendering
 */

import { state } from '../../core/state.js';
import { priceTracker } from '../../core/priceTracker.js';
import { historicalPrices } from '../../core/historicalPrices.js';
import { showToast } from '../../components/ui/ui.js';

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
      chartLoading: document.getElementById('equityChartLoading'),

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
    const todayStr = this.formatDateLocal(today);

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

      // Format dates in local timezone (not UTC) to avoid off-by-one errors
      const fromStr = this.formatDateLocal(fromDate);
      const toStr = this.formatDateLocal(today);

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

  formatDateLocal(date) {
    // Format date as YYYY-MM-DD in local timezone
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  applyFilters() {
    // Get values from UI
    let dateFrom = this.elements.dateFrom?.value || null;
    let dateTo = this.elements.dateTo?.value || null;

    // Prevent future dates
    const today = this.formatDateLocal(new Date());
    if (dateFrom && dateFrom > today) {
      showToast('⚠️ Cannot select future dates', 'warning');
      dateFrom = today;
      if (this.elements.dateFrom) this.elements.dateFrom.value = today;
    }
    if (dateTo && dateTo > today) {
      showToast('⚠️ Cannot select future dates', 'warning');
      dateTo = today;
      if (this.elements.dateTo) this.elements.dateTo.value = today;
    }

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
        const tradeDateOnly = this.formatDateLocal(tradeDate);

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
    const netCashFlow = state.getCashFlowNet();

    // Calculate current account value (includes trading P&L + cash flow)
    const currentAccount = startingAccount + allTimePnL + (unrealizedPnL?.totalPnL || 0) + netCashFlow;

    // Trading growth and total growth both measure trading performance (exclude cash flow)
    const tradingGrowth = startingAccount > 0
      ? ((allTimePnL + (unrealizedPnL?.totalPnL || 0)) / startingAccount) * 100
      : 0;
    const totalGrowth = tradingGrowth; // Total growth = trading growth (both exclude cash flow)

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
      this.elements.openRisk.innerHTML = `<span class="stat-card__sub--danger">$${this.formatNumber(s.openRiskTotal)}</span> at risk`;
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
      this.elements.winLoss.innerHTML = `<span class="text-success">${winText}</span> · <span class="text-danger">${lossText}</span>`;
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
      const colorClass = change > 0 ? 'text-success' : (change < 0 ? 'text-danger' : '');
      this.elements.accountChange.innerHTML = `<span class="${colorClass}">${isPositive ? '+' : ''}$${this.formatNumber(change)}</span> from start`;
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
      const colorClass = s.netCashFlow > 0 ? 'text-success' : (s.netCashFlow < 0 ? 'text-danger' : '');
      this.elements.cashFlow.textContent = `${isPositive ? '+' : ''}$${this.formatNumber(s.netCashFlow)}`;
      this.elements.cashFlow.className = `stat-card__value ${colorClass}`;
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
      const todayStr = this.formatDateLocal(today);

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
      // Parse YYYY-MM-DD string manually to avoid UTC timezone issues
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day); // month is 0-indexed
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

  findActualPriceDate(ticker, targetDateStr) {
    // Helper to find which date was actually used for the price lookup
    if (!historicalPrices.cache[ticker]) return null;

    // Check exact match first
    if (historicalPrices.cache[ticker][targetDateStr]) {
      return targetDateStr;
    }

    // Look for nearest previous date (up to 7 days back, same as getPriceOnDate)
    const targetDate = new Date(targetDateStr);
    for (let i = 1; i <= 7; i++) {
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - i);
      const prevDateStr = historicalPrices.formatDate(prevDate);

      if (historicalPrices.cache[ticker][prevDateStr]) {
        return prevDateStr;
      }
    }

    return null;
  }

  async buildEquityCurve() {
    // Show loading spinner
    if (this.elements.chartLoading) {
      this.elements.chartLoading.style.display = 'inline-flex';
    }

    try {
      // Always use ALL entries for equity curve - we want to see the true account balance
      const allEntries = state.journal.entries;
      const startingBalance = state.settings.startingAccountSize;
      const cashFlowTransactions = (state.cashFlow && state.cashFlow.transactions) || [];

      // Get closed trades sorted by close date (from ALL entries, not filtered)
      const closedTrades = allEntries
        .filter(e => e.status === 'closed' || e.status === 'trimmed')
        .map(t => ({
          date: t.closeDate || t.timestamp,
          pnl: t.totalRealizedPnL ?? t.pnl ?? 0,
          ticker: t.ticker,
          entry: t
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      // Get all entry dates to determine the start date
      const allEntryDates = allEntries
        .filter(e => e.timestamp)
        .map(e => new Date(e.timestamp));

      if (closedTrades.length === 0 && allEntryDates.length === 0) {
        return [];
      }

      // Determine date range: from first trade entry OR filter start date to filter end date (or today if no filter)
      let firstDate;
      if (this.filters.dateFrom) {
        // If filter is set, start from filter date
        firstDate = new Date(this.filters.dateFrom);
        firstDate.setHours(0, 0, 0, 0);
      } else {
        // Otherwise start from first trade entry
        firstDate = allEntryDates.length > 0
          ? new Date(Math.min(...allEntryDates.map(d => d.getTime())))
          : new Date(closedTrades[0].date);
        firstDate.setHours(0, 0, 0, 0);
      }

      // Apply date filter if set, otherwise use today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let endDate = today;
      if (this.filters.dateTo) {
        endDate = new Date(this.filters.dateTo);
        endDate.setHours(0, 0, 0, 0);
      }

      // Check if we're filtering to a date before today
      const isFilteredToBeforeToday = this.filters.dateTo && endDate < today;

      // Check if we have an API key for historical prices
      const hasApiKey = historicalPrices.apiKey !== null;

      console.log('Equity Curve Debug:');
      console.log('First Date:', firstDate);
      console.log('End Date:', endDate);
      console.log('Today:', today);
      console.log('All Entries Count:', allEntries.length);
      console.log('Closed Trades Count:', closedTrades.length);
      console.log('Has API Key:', hasApiKey);
      console.log('Is Filtered To Before Today:', isFilteredToBeforeToday);

      // Calculate starting balance for the filtered period
      let adjustedStartingBalance = startingBalance;
      if (this.filters.dateFrom) {
        // Calculate realized P&L and cash flow up to the filter start date
        const filterStartDate = new Date(this.filters.dateFrom);
        filterStartDate.setHours(0, 0, 0, 0);

        // Add realized P&L from trades closed before filter start date
        const tradesBeforeFilter = closedTrades.filter(trade => {
          const closeDate = new Date(trade.date);
          closeDate.setHours(0, 0, 0, 0);
          return closeDate < filterStartDate;
        });
        const realizedPnLBeforeFilter = tradesBeforeFilter.reduce((sum, t) => sum + t.pnl, 0);

        // Add cash flow before filter start date
        const cashFlowBeforeFilter = cashFlowTransactions
          .filter(transaction => {
            const txDate = new Date(transaction.timestamp);
            txDate.setHours(0, 0, 0, 0);
            return txDate < filterStartDate;
          })
          .reduce((sum, tx) => {
            const amount = tx.type === 'deposit' ? tx.amount : -tx.amount;
            return sum + amount;
          }, 0);

        adjustedStartingBalance = startingBalance + realizedPnLBeforeFilter + cashFlowBeforeFilter;
      }

      // Add starting point (day before first date in filtered range)
      const dataPoints = [{
        date: firstDate.getTime() - 86400000,
        balance: adjustedStartingBalance,
        pnl: 0,
        ticker: 'Start'
      }];

      // Group closed trades by day
      const tradesByDay = new Map();
      closedTrades.forEach(trade => {
        const dateStr = historicalPrices.formatDate(trade.date);
        if (!tradesByDay.has(dateStr)) {
          tradesByDay.set(dateStr, []);
        }
        tradesByDay.get(dateStr).push(trade);
      });

      // Group cash flow by day
      const cashFlowByDay = new Map();
      cashFlowTransactions.forEach(transaction => {
        const dateStr = historicalPrices.formatDate(transaction.timestamp);
        if (!cashFlowByDay.has(dateStr)) {
          cashFlowByDay.set(dateStr, 0);
        }
        const amount = transaction.type === 'deposit' ? transaction.amount : -transaction.amount;
        cashFlowByDay.set(dateStr, cashFlowByDay.get(dateStr) + amount);
      });

      // Build array of all days from first trade through today (inclusive)
      const tradePoints = [];
      const currentDate = new Date(firstDate);

      // Track cumulative values
      let cumulativeRealizedPnL = 0;
      let cumulativeCashFlow = 0;

      // Loop through each day from first trade to end date (inclusive)
      while (currentDate.getTime() <= endDate.getTime()) {
        const dateStr = historicalPrices.formatDate(currentDate);
        const dateTimestamp = currentDate.getTime();

        // Add realized P&L from trades closed on this day
        let dayPnL = 0;
        if (tradesByDay.has(dateStr)) {
          const dayTrades = tradesByDay.get(dateStr);
          dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
          cumulativeRealizedPnL += dayPnL;
        }

        // Add cash flow from this day
        if (cashFlowByDay.has(dateStr)) {
          cumulativeCashFlow += cashFlowByDay.get(dateStr);
        }

        // Calculate balance for this day (realized only for now)
        const realizedBalance = startingBalance + cumulativeRealizedPnL + cumulativeCashFlow;

        tradePoints.push({
          date: dateTimestamp,
          dateStr,
          realizedBalance,
          pnl: dayPnL,
          ticker: tradesByDay.has(dateStr)
            ? tradesByDay.get(dateStr).map(t => t.ticker).join(', ')
            : ''
        });

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
      }

      console.log('Trade Points Created:', tradePoints.length);
      console.log('Date Range:', tradePoints.length > 0 ?
        `${tradePoints[0].dateStr} to ${tradePoints[tradePoints.length - 1].dateStr}` : 'none');

      // Debug: Check a sample of tradePoints
      if (tradePoints.length > 0) {
        console.log('Sample tradePoints:', {
          first: tradePoints[0],
          last: tradePoints[tradePoints.length - 1],
          secondToLast: tradePoints.length > 1 ? tradePoints[tradePoints.length - 2] : null
        });
      }

      if (hasApiKey) {
        // Get all unique tickers that were open at any point
        const allTickers = [...new Set(allEntries.map(e => e.ticker).filter(t => t))];
        console.log('Fetching historical prices for tickers:', allTickers);

        if (allTickers.length > 0) {
          const results = await historicalPrices.batchFetchPrices(allTickers);
          console.log('Historical prices fetch results:', results);
          console.log('Historical prices cache sample:',
            allTickers[0] ? historicalPrices.cache[allTickers[0]] : 'no tickers');
        }
      }

      // Debug: Check what prices are available
      console.log('PriceTracker.prices available:', priceTracker.prices);
      const sampleTicker = allEntries.length > 0 ? allEntries[0].ticker : null;
      if (sampleTicker) {
        console.log(`Sample current price for ${sampleTicker}:`, priceTracker.prices?.[sampleTicker]);
      }

      // Build final data points with unrealized P&L for ALL days
      // If no historical API key, use current prices as approximation
      tradePoints.forEach((point, idx) => {
        // Only log for last few days to avoid spam
        const isRecentDay = idx >= tradePoints.length - 5;

        // Find positions that were open on this date
        const openOnDate = allEntries.filter(e => {
          if (!e.timestamp) return false;
          const entryDate = new Date(e.timestamp);
          entryDate.setHours(0, 0, 0, 0);
          const closeDate = e.closeDate ? new Date(e.closeDate) : null;
          if (closeDate) closeDate.setHours(0, 0, 0, 0);
          const pointDate = new Date(point.date);

          // Position was open if entry <= pointDate < close (or no close yet)
          return entryDate <= pointDate && (!closeDate || closeDate > pointDate);
        });

        if (isRecentDay) {
          console.log(`\n=== Day ${point.dateStr} ===`);
          console.log('Open positions:', openOnDate.map(t => t.ticker));
        }

        // Calculate unrealized P&L for all open positions on this date
        let unrealizedPnL = 0;
        openOnDate.forEach(trade => {
          if (!trade.entry || !trade.shares) return;

          // Determine how many shares were held on this specific date
          // Need to account for trims that happened before this date
          let sharesOnDate = trade.shares;
          if (trade.trimHistory && Array.isArray(trade.trimHistory)) {
            trade.trimHistory.forEach(trim => {
              const trimDate = new Date(trim.date);
              trimDate.setHours(0, 0, 0, 0);
              const pointDate = new Date(point.date);
              if (trimDate <= pointDate) {
                sharesOnDate -= trim.shares;
              }
            });
          }

          if (sharesOnDate <= 0) return; // No shares held on this date

          if (hasApiKey) {
            // Use historical prices if available
            const historicalPrice = historicalPrices.getPriceOnDate(trade.ticker, point.dateStr);

            if (historicalPrice) {
              // Check if this price is recent (within 2 days of the point date)
              const pointDateObj = new Date(point.date);
              const priceDate = this.findActualPriceDate(trade.ticker, point.dateStr);

              if (priceDate) {
                const priceDateObj = new Date(priceDate);
                const daysDiff = Math.floor((pointDateObj - priceDateObj) / (1000 * 60 * 60 * 24));

                if (isRecentDay) {
                  console.log(`  ${trade.ticker}:`);
                  console.log(`    Historical price date: ${priceDate}`);
                  console.log(`    Days diff: ${daysDiff}`);
                  console.log(`    Historical price: $${historicalPrice}`);
                }

                // If price is more than 2 days old, try to use current price instead
                if (daysDiff > 2) {
                  // Check if we have current price data
                  let currentPrice = null;
                  if (priceTracker.prices && priceTracker.prices[trade.ticker]) {
                    currentPrice = priceTracker.prices[trade.ticker].price;
                  }

                  if (isRecentDay) {
                    console.log(`    Price is STALE (>${2} days old)`);
                    console.log(`    Current price available:`, currentPrice);
                  }

                  if (currentPrice) {
                    unrealizedPnL += (currentPrice - trade.entry) * sharesOnDate;
                    if (isRecentDay) {
                      console.log(`    ✓ USING CURRENT PRICE: $${currentPrice}`);
                    }
                  } else {
                    // Fall back to historical price even if old
                    unrealizedPnL += (historicalPrice - trade.entry) * sharesOnDate;
                    if (isRecentDay) {
                      console.log(`    ✗ FALLING BACK TO STALE HISTORICAL PRICE: $${historicalPrice}`);
                    }
                  }
                } else {
                  unrealizedPnL += (historicalPrice - trade.entry) * sharesOnDate;
                  if (isRecentDay) {
                    console.log(`    ✓ Using fresh historical price: $${historicalPrice}`);
                  }
                }
              } else {
                unrealizedPnL += (historicalPrice - trade.entry) * sharesOnDate;
                if (isRecentDay) {
                  console.log(`  ${trade.ticker}: No price date found, using historical: $${historicalPrice}`);
                }
              }
            } else {
              // No historical price found - use current price as fallback
              const currentPrice = priceTracker.prices?.[trade.ticker]?.price;
              if (currentPrice) {
                unrealizedPnL += (currentPrice - trade.entry) * sharesOnDate;
                if (isRecentDay) {
                  console.log(`  ${trade.ticker}: No historical price, using current: $${currentPrice}`);
                }
              } else {
                if (isRecentDay) {
                  console.log(`  ${trade.ticker}: NO PRICE AVAILABLE AT ALL`);
                }
              }
            }
          } else {
            // No API key - use current prices as approximation
            const currentPrice = priceTracker.prices?.[trade.ticker]?.price;
            if (currentPrice) {
              unrealizedPnL += (currentPrice - trade.entry) * sharesOnDate;
            }
          }
        });

        if (isRecentDay) {
          console.log(`  Total unrealized P&L: $${unrealizedPnL.toFixed(2)}`);
          console.log(`  Realized balance: $${point.realizedBalance.toFixed(2)}`);
          console.log(`  Total balance: $${(point.realizedBalance + unrealizedPnL).toFixed(2)}`);
        }

        // Balance = realized balance + unrealized P&L on that day
        dataPoints.push({
          date: point.date,
          balance: point.realizedBalance + unrealizedPnL,
          pnl: point.pnl,
          ticker: point.ticker,
          unrealizedPnL
        });
      });

      // Only add a final point for RIGHT NOW if we're not filtering to a date before today
      if (!isFilteredToBeforeToday) {
        const currentOpenTrades = allEntries.filter(e => e.status === 'open' || e.status === 'trimmed');
        if (currentOpenTrades.length > 0) {
          const currentUnrealizedPnL = priceTracker.calculateTotalUnrealizedPnL(currentOpenTrades);
          const lastRealizedBalance = tradePoints.length > 0
            ? tradePoints[tradePoints.length - 1].realizedBalance
            : startingBalance;

          // Add current moment with live prices
          dataPoints.push({
            date: Date.now(),
            balance: lastRealizedBalance + (currentUnrealizedPnL?.totalPnL || 0),
            pnl: 0,
            ticker: 'Now',
            unrealizedPnL: currentUnrealizedPnL?.totalPnL || 0
          });
        }
      }

      console.log('Final Data Points:', dataPoints.length);
      if (dataPoints.length > 0) {
        console.log('Last 3 Data Points:', {
          thirdToLast: dataPoints.length > 2 ? {
            date: new Date(dataPoints[dataPoints.length - 3].date).toISOString(),
            balance: dataPoints[dataPoints.length - 3].balance,
            unrealizedPnL: dataPoints[dataPoints.length - 3].unrealizedPnL
          } : null,
          secondToLast: dataPoints.length > 1 ? {
            date: new Date(dataPoints[dataPoints.length - 2].date).toISOString(),
            balance: dataPoints[dataPoints.length - 2].balance,
            unrealizedPnL: dataPoints[dataPoints.length - 2].unrealizedPnL
          } : null,
          last: {
            date: new Date(dataPoints[dataPoints.length - 1].date).toISOString(),
            balance: dataPoints[dataPoints.length - 1].balance,
            unrealizedPnL: dataPoints[dataPoints.length - 1].unrealizedPnL
          }
        });
      }

      return dataPoints;
    } catch (error) {
      console.error('Error building equity curve:', error);
      // Return basic equity curve without historical unrealized P&L
      return this.buildBasicEquityCurve();
    } finally {
      // Hide loading spinner
      if (this.elements.chartLoading) {
        this.elements.chartLoading.style.display = 'none';
      }
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
