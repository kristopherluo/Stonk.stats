/**
 * Stats - Trading statistics UI and rendering
 * REFACTORED: Uses modular calculators, ~300 lines vs 1300 lines
 */

import { state } from '../../core/state.js';
import { showToast } from '../../components/ui/ui.js';
import { initFlatpickr, getCurrentWeekday } from '../../core/utils.js';
import { StatsCalculator } from './StatsCalculator.js';
import { equityCurveManager } from './EquityCurveManager.js';
import { DateRangeFilter } from '../../shared/DateRangeFilter.js';
import { FilterPopup } from '../../shared/FilterPopup.js';
import { sharedMetrics } from '../../shared/SharedMetrics.js';
import { EquityChart } from './statsChart.js';

class Stats {
  constructor() {
    this.elements = {};
    this.stats = {};
    this.filters = new DateRangeFilter();
    this.calculator = new StatsCalculator();
    this.chart = null;
    this.isCalculating = false;
    this.filterPopup = null; // Shared filter popup component

    // Store flatpickr instances
    this.dateFromPicker = null;
    this.dateToPicker = null;
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
      currentAccountCard: document.getElementById('statCurrentAccountCard'),
      accountChange: document.getElementById('statAccountChange'),
      tradingGrowth: document.getElementById('statTradingGrowth'),
      tradingGrowthCard: document.getElementById('statTradingGrowthCard'),
      totalGrowth: document.getElementById('statTotalGrowth'),
      totalGrowthCard: document.getElementById('statTotalGrowthCard'),
      cashFlow: document.getElementById('statCashFlow'),
      cashFlowCard: document.getElementById('statCashFlowCard'),

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

    // Initialize equity chart
    this.chart = new EquityChart();
    this.chart.init();

    // Listen for journal changes - use SMART invalidation for specific trades
    state.on('journalEntryAdded', (entry) => {
      try {
        equityCurveManager.invalidateForTrade(entry);
        sharedMetrics.recalculateAll();
        this.refresh();
      } catch (error) {
        console.error('Error in journalEntryAdded handler:', error);
      }
    });
    state.on('journalEntryUpdated', (entry) => {
      try {
        equityCurveManager.invalidateForTrade(entry);
        sharedMetrics.recalculateAll();
        this.refresh();
      } catch (error) {
        console.error('Error in journalEntryUpdated handler:', error);
      }
    });
    state.on('journalEntryDeleted', (entry) => {
      try {
        equityCurveManager.invalidateForTrade(entry);
        sharedMetrics.recalculateAll();
        this.refresh();
      } catch (error) {
        console.error('Error in journalEntryDeleted handler:', error);
      }
    });
    state.on('accountSizeChanged', () => {
      // Starting balance changed - affects all days
      equityCurveManager.invalidateCache();
      this.refresh();
    });
    state.on('cashFlowChanged', (cashFlow) => {
      try {
        // Cash flow changed - find earliest transaction and invalidate from there
        if (cashFlow && cashFlow.transactions && cashFlow.transactions.length > 0) {
          const dates = cashFlow.transactions.map(tx => new Date(tx.timestamp));
          const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));

          const dateStr = this.formatDateLocal(earliestDate);
          equityCurveManager.invalidateFromDate(dateStr);
        } else {
          equityCurveManager.invalidateCache();
        }
        this.refresh();
      } catch (error) {
        console.error('Error in cashFlowChanged handler:', error);
        // Fallback to full invalidation
        equityCurveManager.invalidateCache();
        this.refresh();
      }
    });
    state.on('settingsChanged', () => {
      // Settings changed - affects all days (could be starting balance, etc.)
      equityCurveManager.invalidateCache();
      this.refresh();
    });
    state.on('pricesUpdated', () => {
      sharedMetrics.recalculateAll();
      this.refresh();
    });
    state.on('viewChanged', (data) => {
      if (data.to === 'stats') {
        this.animateStatCards();
        setTimeout(() => {
          this.refresh();
        }, 550);
      }
    });

    // Initialize date pickers
    this.initializeDatePickers();

    // Initialize shared filter popup
    this.filterPopup = new FilterPopup({
      elements: {
        filterBtn: this.elements.filterBtn,
        filterPanel: this.elements.filterPanel,
        filterBackdrop: this.elements.filterBackdrop,
        filterClose: this.elements.filterClose,
        applyBtn: this.elements.applyFilters,
        resetBtn: this.elements.clearFilters,
        filterCount: this.elements.filterCount
      },
      onOpen: () => this.onFilterOpen(),
      onApply: () => this.applyFilters(),
      onReset: () => this.clearFilters()
    });

    // Bind date preset buttons and input change handlers
    this.bindDateFilterEvents();

    // Initialize Max preset dates
    this.handleDatePreset('max');

    // Initial calculation and render
    this.refresh();

    const statsView = document.getElementById('statsView');
    if (statsView && statsView.classList.contains('view--active')) {
      setTimeout(() => this.animateStatCards(), 100);
    }
  }

  initializeDatePickers() {
    // Calculate earliest trade date for minDate constraint
    const allTrades = state.journal.entries;
    let minDate = null;

    if (allTrades && allTrades.length > 0) {
      const datesWithTrades = allTrades
        .filter(t => t.timestamp)
        .map(t => new Date(t.timestamp));

      if (datesWithTrades.length > 0) {
        minDate = new Date(Math.min(...datesWithTrades));
        // IMPORTANT: Set to start of day (midnight) to avoid time component issues
        minDate.setHours(0, 0, 0, 0);
      }
    }

    const options = minDate ? { minDate: minDate } : {};
    this.dateFromPicker = initFlatpickr(this.elements.dateFrom, options);
    this.dateToPicker = initFlatpickr(this.elements.dateTo, options);
  }

  bindDateFilterEvents() {
    // Date preset buttons
    this.elements.datePresetBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        this.handleDatePreset(range);
      });
    });

    // Handle Enter key in date inputs
    this.elements.dateFrom?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.applyFilters();
        this.filterPopup.close();
      }
    });
    this.elements.dateTo?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.applyFilters();
        this.filterPopup.close();
      }
    });

    // Date input changes - remove preset styling
    this.elements.dateFrom?.addEventListener('change', () => {
      this.elements.dateFrom.classList.remove('preset-value');
      this.elements.dateTo?.classList.remove('preset-value');
      this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
    });
    this.elements.dateTo?.addEventListener('change', () => {
      this.elements.dateFrom?.classList.remove('preset-value');
      this.elements.dateTo.classList.remove('preset-value');
      this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
    });
  }

  onFilterOpen() {
    // Sync UI to current filter state when opening popup
    this.filters.syncFilterUIToState(this.elements, this.elements.datePresetBtns);
  }

  handleDatePreset(range) {
    // Clear active state from all preset buttons
    this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));

    // Set active state on clicked button
    const clickedBtn = Array.from(this.elements.datePresetBtns || []).find(
      btn => btn.dataset.range === range
    );
    clickedBtn?.classList.add('active');

    // Get dates from filter handler (uses working journal logic)
    const dates = this.filters.handleDatePreset(range);

    // Set date inputs using flatpickr
    if (this.dateFromPicker && dates.dateFrom) {
      const [year, month, day] = dates.dateFrom.split('-').map(Number);
      const fromDate = new Date(year, month - 1, day);
      this.dateFromPicker.setDate(fromDate);
      this.elements.dateFrom?.classList.add('preset-value');
    }

    if (this.dateToPicker && dates.dateTo) {
      const [year, month, day] = dates.dateTo.split('-').map(Number);
      const toDate = new Date(year, month - 1, day);
      this.dateToPicker.setDate(toDate);
      this.elements.dateTo?.classList.add('preset-value');
    }

    // Store filter state so it's applied immediately
    this.filters.setFilter(dates.dateFrom, dates.dateTo);

    // Update filter count badge (0 if Max preset, 1 otherwise)
    const hasFilters = !this.filters.isMaxPreset();
    this.filterPopup.updateFilterCount(hasFilters ? 1 : 0);
  }

  applyFilters() {
    const dateFrom = this.elements.dateFrom?.value || null;
    const dateTo = this.elements.dateTo?.value || null;

    // Validation: start date must be before or equal to end date
    if (dateFrom && dateTo && dateFrom > dateTo) {
      showToast('Start date must be before end date', 'error');
      return;
    }

    // Validation: dates can't be in the future
    const today = getCurrentWeekday();
    const todayStr = this.formatDateLocal(today);
    if ((dateFrom && dateFrom > todayStr) || (dateTo && dateTo > todayStr)) {
      showToast('Dates cannot be in the future', 'error');
      return;
    }

    // Update filters
    this.filters.setFilter(dateFrom, dateTo);

    // Update filter count badge (0 to hide, 1 if date filter active AND not Max preset)
    const hasFilters = (dateFrom || dateTo) && !this.filters.isMaxPreset();
    this.filterPopup.updateFilterCount(hasFilters ? 1 : 0);

    // Refresh (FilterPopup handles closing)
    this.refresh();
  }

  clearFilters() {
    this.filters.clearFilters();

    // Clear date pickers
    this.dateFromPicker?.clear();
    this.dateToPicker?.clear();

    // Reset to Max preset
    this.handleDatePreset('max');

    // Update filter count badge
    this.filterPopup.updateFilterCount(0);

    // Don't close panel - let user continue adjusting filters
    // (matches behavior of journal and positions pages)
  }

  async refresh() {
    if (this.isCalculating) return;

    console.time('[Stats] refresh total');
    this.isCalculating = true;
    this.showLoadingState(true);

    try {
      console.time('[Stats] calculate');
      await this.calculate();
      console.timeEnd('[Stats] calculate');

      console.time('[Stats] render');
      this.render();
      console.timeEnd('[Stats] render');

      console.time('[Stats] renderEquityCurve');
      await this.renderEquityCurve();
      console.timeEnd('[Stats] renderEquityCurve');
    } catch (error) {
      console.error('Error refreshing stats:', error);
      showToast('Error calculating stats', 'error');
    } finally {
      this.showLoadingState(false);
      this.isCalculating = false;
      console.timeEnd('[Stats] refresh total');
    }
  }

  async calculate() {
    const allEntries = state.journal.entries;
    const filterState = this.filters.getActiveFilter();

    // Build equity curve FIRST to ensure cache is up to date for P&L calculation
    await equityCurveManager.buildEquityCurve(filterState.dateFrom, filterState.dateTo);

    // Get filtered trades
    const filteredTrades = this.filters.getFilteredTrades(allEntries);

    // Calculate all metrics using new modular calculators
    const currentAccount = this.calculator.calculateCurrentAccount();
    const openRisk = sharedMetrics.getOpenRisk(); // Shared with Positions page!
    const realizedPnL = this.calculator.calculateRealizedPnL(filteredTrades);
    const winsLosses = this.calculator.calculateWinsLosses(filteredTrades);
    const winRate = this.calculator.calculateWinRate(filteredTrades);
    const sharpe = this.calculator.calculateSharpeRatio(filteredTrades);
    const netCashFlow = this.calculator.calculateNetCashFlow(filterState.dateFrom, filterState.dateTo);

    // Calculate deposits and withdrawals separately for breakdown display
    const cashFlowTransactions = state.cashFlow?.transactions || [];
    const filteredTransactions = filterState.dateFrom || filterState.dateTo
      ? cashFlowTransactions.filter(tx => {
          const txDate = new Date(tx.timestamp);
          txDate.setHours(0, 0, 0, 0);
          const txDateStr = this.formatDateLocal(txDate);

          let inRange = true;
          if (filterState.dateFrom) {
            inRange = inRange && txDateStr >= filterState.dateFrom;
          }
          if (filterState.dateTo) {
            inRange = inRange && txDateStr <= filterState.dateTo;
          }
          return inRange;
        })
      : cashFlowTransactions;

    const deposits = filteredTransactions
      .filter(tx => tx.type === 'deposit')
      .reduce((sum, tx) => sum + tx.amount, 0);

    const withdrawals = filteredTransactions
      .filter(tx => tx.type === 'withdrawal')
      .reduce((sum, tx) => sum + tx.amount, 0);

    // Calculate P&L using NEW simplified approach (equity curve lookup)
    const pnlResult = this.calculator.calculatePnL(filterState.dateFrom, filterState.dateTo);

    // Calculate percentages
    const tradingGrowth = pnlResult.startingBalance > 0
      ? (pnlResult.pnl / pnlResult.startingBalance) * 100
      : 0;

    const totalGrowth = pnlResult.startingBalance > 0
      ? ((pnlResult.pnl + netCashFlow) / pnlResult.startingBalance) * 100
      : 0;

    // Store results
    this.stats = {
      currentAccount,
      openRisk,
      realizedPnL,
      wins: winsLosses.wins,
      losses: winsLosses.losses,
      totalTrades: winsLosses.total,
      winRate,
      sharpe,
      totalPnL: pnlResult.pnl,
      accountAtRangeStart: pnlResult.startingBalance,
      accountAtRangeStartDate: pnlResult.startDateStr,
      tradingGrowth,
      totalGrowth,
      netCashFlow,
      deposits,
      withdrawals
    };
  }

  render() {
    const s = this.stats;

    // Update date range display
    this.updateDateRangeDisplay();

    // Current Account
    if (this.elements.openPositions) {
      this.elements.openPositions.textContent = `$${this.formatNumber(s.currentAccount)}`;
    }
    if (this.elements.openRisk) {
      this.elements.openRisk.innerHTML = `<span class="stat-card__sub--danger">$${this.formatNumber(s.openRisk)}</span> open risk`;
    }

    // Realized P&L
    if (this.elements.totalPnL) {
      const isPositive = s.realizedPnL >= 0;
      this.elements.totalPnL.textContent = isPositive
        ? `+$${this.formatNumber(Math.abs(s.realizedPnL))}`
        : `-$${this.formatNumber(Math.abs(s.realizedPnL))}`;
      this.elements.pnlCard?.classList.toggle('stat-card--success', isPositive && s.realizedPnL !== 0);
      this.elements.pnlCard?.classList.toggle('stat-card--danger', !isPositive);
    }
    if (this.elements.pnlTrades) {
      this.elements.pnlTrades.innerHTML = `<span class="stat-card__sub--highlight">${s.totalTrades}</span> closed trade${s.totalTrades !== 1 ? 's' : ''}`;
    }

    // Win Rate
    if (this.elements.winRate) {
      this.elements.winRate.textContent = s.winRate !== null ? `${s.winRate.toFixed(1)}%` : '-';
    }
    if (this.elements.winLoss) {
      this.elements.winLoss.innerHTML = `<span class="stat-card__sub--success-glow">${s.wins} win${s.wins !== 1 ? 's' : ''}</span> · <span class="stat-card__sub--danger">${s.losses} loss${s.losses !== 1 ? 'es' : ''}</span>`;
    }

    // Sharpe Ratio
    if (this.elements.sharpe) {
      this.elements.sharpe.textContent = s.sharpe !== null ? s.sharpe.toFixed(2) : '-';
    }

    // P&L (Total with unrealized)
    if (this.elements.currentAccount) {
      const isPositive = s.totalPnL >= 0;
      this.elements.currentAccount.textContent = isPositive
        ? `+$${this.formatNumber(Math.abs(s.totalPnL))}`
        : `-$${this.formatNumber(Math.abs(s.totalPnL))}`;
      this.elements.currentAccountCard?.classList.toggle('stat-card--success', isPositive && s.totalPnL !== 0);
      this.elements.currentAccountCard?.classList.toggle('stat-card--danger', !isPositive);
    }
    if (this.elements.accountChange) {
      const startDate = this.formatDateDisplay(s.accountAtRangeStartDate);
      this.elements.accountChange.innerHTML = `From starting <span class="stat-card__sub--highlight">$${this.formatNumber(s.accountAtRangeStart)}</span> on ${startDate}`;
    }

    // Trading Growth %
    if (this.elements.tradingGrowth) {
      const isPositive = s.tradingGrowth >= 0;
      this.elements.tradingGrowth.textContent = isPositive
        ? `+${s.tradingGrowth.toFixed(2)}%`
        : `${s.tradingGrowth.toFixed(2)}%`;
      this.elements.tradingGrowthCard?.classList.toggle('stat-card--success', isPositive && s.tradingGrowth !== 0);
      this.elements.tradingGrowthCard?.classList.toggle('stat-card--danger', !isPositive);
    }

    // Trading Growth % subtitle
    const tradingGrowthSub = this.elements.tradingGrowthCard?.querySelector('.stat-card__sub');
    if (tradingGrowthSub) {
      tradingGrowthSub.textContent = 'P&L / starting';
    }

    // Total Growth %
    if (this.elements.totalGrowth) {
      const isPositive = s.totalGrowth >= 0;
      this.elements.totalGrowth.textContent = isPositive
        ? `+${s.totalGrowth.toFixed(2)}%`
        : `${s.totalGrowth.toFixed(2)}%`;
      this.elements.totalGrowthCard?.classList.toggle('stat-card--success', isPositive && s.totalGrowth !== 0);
      this.elements.totalGrowthCard?.classList.toggle('stat-card--danger', !isPositive);
    }

    // Total Growth % subtitle
    const totalGrowthSub = this.elements.totalGrowthCard?.querySelector('.stat-card__sub');
    if (totalGrowthSub) {
      totalGrowthSub.textContent = '(P&L + Net Cash Flow) / starting';
    }

    // Net Cash Flow
    if (this.elements.cashFlow) {
      const isPositive = s.netCashFlow >= 0;
      this.elements.cashFlow.textContent = isPositive
        ? `+$${this.formatNumber(Math.abs(s.netCashFlow))}`
        : `-$${this.formatNumber(Math.abs(s.netCashFlow))}`;
      this.elements.cashFlowCard?.classList.toggle('stat-card--success', isPositive && s.netCashFlow !== 0);
      this.elements.cashFlowCard?.classList.toggle('stat-card--danger', !isPositive);
    }
  }

  async renderEquityCurve() {
    if (!this.chart) {
      console.warn('Chart not initialized');
      return;
    }

    try {
      // Show loading
      if (this.elements.chartLoading) {
        this.elements.chartLoading.style.display = 'inline-flex';
      }

      const filterState = this.filters.getActiveFilter();

      // Build equity curve (uses cache if available!)
      const curveData = await equityCurveManager.buildEquityCurve(
        filterState.dateFrom,
        filterState.dateTo
      );

      console.log('Equity curve data points:', curveData.length);

      this.chart.setData(curveData);
      this.chart.render();

      // Update chart value display
      if (this.elements.chartValue && curveData.length > 0) {
        const lastPoint = curveData[curveData.length - 1];
        this.elements.chartValue.textContent = `$${this.formatNumber(lastPoint.balance)}`;
      }
    } catch (error) {
      console.error('Error rendering equity curve:', error);
      console.error('Error stack:', error.stack);
      showToast(`Error loading equity curve: ${error.message}`, 'error');
    } finally {
      // Hide loading
      if (this.elements.chartLoading) {
        this.elements.chartLoading.style.display = 'none';
      }
    }
  }

  updateDateRangeDisplay() {
    if (!this.elements.dateRange) return;

    const filterState = this.filters.getActiveFilter();

    // Format dates nicely (same as journal page)
    const formatShortDate = (dateStr) => {
      if (!dateStr) return '';
      // Parse YYYY-MM-DD string manually to avoid UTC timezone issues
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (!filterState.dateFrom && !filterState.dateTo) {
      this.elements.dateRange.textContent = 'All time';
    } else if (filterState.dateFrom && filterState.dateTo) {
      this.elements.dateRange.textContent = `${formatShortDate(filterState.dateFrom)} - ${formatShortDate(filterState.dateTo)}`;
    } else if (filterState.dateFrom) {
      this.elements.dateRange.textContent = `From ${formatShortDate(filterState.dateFrom)}`;
    } else {
      this.elements.dateRange.textContent = `Until ${formatShortDate(filterState.dateTo)}`;
    }
  }

  showLoadingState(show) {
    const cardsToLoad = [
      this.elements.currentAccountCard,
      this.elements.pnlCard,
      this.elements.tradingGrowthCard,
      this.elements.totalGrowthCard
    ];

    cardsToLoad.forEach(card => {
      if (!card) return;

      if (show) {
        if (!card.querySelector('.stat-card-loading')) {
          const spinner = document.createElement('div');
          spinner.className = 'stat-card-loading';
          spinner.innerHTML = `
            <svg class="spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          `;
          card.style.position = 'relative';
          card.appendChild(spinner);
        }
      } else {
        const spinner = card.querySelector('.stat-card-loading');
        if (spinner) {
          spinner.remove();
        }
      }
    });
  }

  animateStatCards() {
    const statsSections = document.querySelectorAll('.stats-view .stats-section');

    statsSections.forEach(section => {
      const cards = section.querySelectorAll('.stat-card');
      cards.forEach(card => {
        card.classList.remove('stat-card--animate');
        card.style.animationDelay = '';
      });
      // Chart fade-in is now handled in renderEquityCurve()
    });

    void document.body.offsetHeight;

    setTimeout(() => {
      statsSections.forEach((section, sectionIndex) => {
        const cards = section.querySelectorAll('.stat-card');

        if (cards.length > 0) {
          cards.forEach((card, cardIndex) => {
            const totalIndex = (sectionIndex * 4) + cardIndex;
            card.style.animationDelay = `${totalIndex * 80}ms`;
            card.classList.add('stat-card--animate');
          });
        }

        // Chart already has fade-in class applied above
      });
    }, 50);
  }

  formatNumber(num) {
    return Math.abs(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDateDisplay(dateStr) {
    if (!dateStr) return '';

    // Parse YYYY-MM-DD string
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    // Format as "Dec 12, 2025"
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
}

export const stats = new Stats();
export { Stats };
