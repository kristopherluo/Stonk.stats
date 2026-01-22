/**
 * Stats - Trading statistics UI and rendering
 * REFACTORED: Uses modular calculators, ~300 lines vs 1300 lines
 */

import { state } from '../../core/state.js';
import { showToast } from '../../components/ui/ui.js';
import { initFlatpickr, getCurrentWeekday } from '../../core/utils.js';
import { incrementalStatsCalculator } from './IncrementalStatsCalculator.js';
import { equityCurveManager } from './EquityCurveManager.js';
import { DateRangeFilter } from '../../shared/DateRangeFilter.js';
import { FilterPopup } from '../../shared/FilterPopup.js';
import { sharedMetrics } from '../../shared/SharedMetrics.js';
import { EquityChart } from './statsChart.js';
import { pnlCalendar } from './PnLCalendar.js';
import { priceTracker } from '../../core/priceTracker.js';
import eodCacheManager from '../../core/eodCacheManager.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';
import * as marketHours from '../../utils/marketHours.js';
import { getTradeEntryDateString } from '../../utils/tradeUtils.js';
import { viewManager } from '../../components/ui/viewManager.js';
import { journalView } from '../journal/journalView.js';
import { renderJournalTableRows } from '../../shared/journalTableRenderer.js';
import { convertHyphenKeyToUnderscoreKey, generateOptionKeyFromTrade } from '../../utils/optionKeyUtils.js';
import { createLogger } from '../../utils/logger.js';
import { getOpenTrades, isOpenTrade } from '../../shared/TradeFilters.js';

const logger = createLogger('Stats');

// Timing constants
const AUTO_REFRESH_INTERVAL_MS = 60000; // 60 seconds
const VIEW_TRANSITION_DELAY_MS = 550;
const JOURNAL_LOAD_DELAY_MS = 150;
const SCROLL_DELAY_MS = 200;
const ANIMATION_STAGGER_MS = 80;

class Stats {
  constructor() {
    this.elements = {};
    this.stats = {};
    this.filters = new DateRangeFilter();
    this.calculator = incrementalStatsCalculator; // Use incremental calculator
    this.chart = null;
    this.calendar = null; // P&L calendar component
    this.isCalculating = false;
    this.filterPopup = null; // Shared filter popup component
    this.autoRefreshInterval = null; // For auto-refreshing prices

    // Store flatpickr instances
    this.dateFromPicker = null;
    this.dateToPicker = null;
  }

  async init() {
    // Initialize incremental calculator
    await this.calculator.init();

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
      expectancy: document.getElementById('statExpectancy'),

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

    // Initialize P&L calendar
    this.calendar = pnlCalendar;
    this.calendar.statsCalculator = this.calculator; // Give calendar access to live balance calculation
    this.calendar.onDayClick = (dateStr, weekRange) => this.handleCalendarDayClick(dateStr, weekRange);

    // Note: Calendar init is async, but we don't await it here to avoid blocking
    // The auto-select of today will happen after the calendar renders
    this.calendar.init();

    // Listen for journal changes - use SMART invalidation for specific trades
    state.on('journalEntryAdded', (entry) => {
      try {
        equityCurveManager.invalidateForTrade(entry);
        this.calculator.invalidateCache(); // Invalidate stats cache
        // Only refresh if currently on stats page
        if (state.ui.currentView === 'stats') {
          sharedMetrics.recalculateAll();
          this.refresh();
        }
      } catch (error) {
        logger.error('Error in journalEntryAdded handler:', error);
      }
    });
    state.on('journalEntryUpdated', (entry) => {
      try {
        equityCurveManager.invalidateForTrade(entry);
        this.calculator.invalidateCache(); // Invalidate stats cache
        // Only refresh if currently on stats page
        if (state.ui.currentView === 'stats') {
          sharedMetrics.recalculateAll();
          this.refresh();
        }
      } catch (error) {
        logger.error('Error in journalEntryUpdated handler:', error);
      }
    });
    state.on('journalEntryDeleted', (entry) => {
      try {
        equityCurveManager.invalidateForTrade(entry);
        this.calculator.invalidateCache(); // Invalidate stats cache
        // Only refresh if currently on stats page
        if (state.ui.currentView === 'stats') {
          sharedMetrics.recalculateAll();
          this.refresh();
        }
      } catch (error) {
        logger.error('Error in journalEntryDeleted handler:', error);
      }
    });
    state.on('accountSizeChanged', () => {
      // Starting balance changed - affects all days
      eodCacheManager.clearAllData();
      // Only refresh if currently on stats page
      if (state.ui.currentView === 'stats') {
        this.refresh();
      }
    });
    state.on('cashFlowChanged', (cashFlow) => {
      try {
        // Cash flow changed - find earliest transaction and invalidate from there
        if (cashFlow && cashFlow.transactions && cashFlow.transactions.length > 0) {
          const dates = cashFlow.transactions.map(tx => new Date(tx.timestamp));
          const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));

          const dateStr = marketHours.formatDate(earliestDate);
          equityCurveManager.invalidateFromDate(dateStr);
        } else {
          eodCacheManager.clearAllData();
        }
        // Only refresh if currently on stats page
        if (state.ui.currentView === 'stats') {
          this.refresh();
        }
      } catch (error) {
        logger.error('Error in cashFlowChanged handler:', error);
        // Fallback to full invalidation
        eodCacheManager.clearAllData();
        if (state.ui.currentView === 'stats') {
          this.refresh();
        }
      }
    });
    state.on('settingsChanged', () => {
      // Settings changed - affects all days (could be starting balance, etc.)
      eodCacheManager.clearAllData();
      // Only refresh if currently on stats page
      if (state.ui.currentView === 'stats') {
        this.refresh();
      }
    });
    state.on('pricesUpdated', () => {
      // Only refresh if we're currently on the stats page
      if (state.ui.currentView === 'stats') {
        sharedMetrics.recalculateAll();
        this.refresh();
      }
    });
    state.on('viewChanged', (data) => {
      if (data.to === 'stats') {
        this.animateStatCards();
        this.startAutoRefresh(); // Start polling prices
        setTimeout(() => {
          this.refresh();
        }, VIEW_TRANSITION_DELAY_MS);
      } else if (data.from === 'stats') {
        this.stopAutoRefresh(); // Stop polling when leaving stats page
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

    // Initial calculation and render - ONLY if stats view is active
    const statsView = document.getElementById('statsView');
    if (statsView && statsView.classList.contains('view--active')) {
      this.refresh();
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
    const todayStr = marketHours.formatDate(today);
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

    this.isCalculating = true;
    this.showLoadingState(true);

    try {
      // FIX: Auto-fetch prices if cache is empty (prevents silent $0 unrealized P&L)
      const activeTrades = getOpenTrades(state.journal.entries);
      if (activeTrades.length > 0 && priceTracker.cache.size === 0) {
        logger.debug('[Stats] Price cache empty, fetching current prices...');
        try {
          await priceTracker.fetchActivePrices();
        } catch (error) {
          logger.error('[Stats] Failed to fetch prices:', error);
          // Continue anyway - will show without unrealized P&L
        }
      }

      await this.calculate();
      this.render();
      await this.renderEquityCurve();

      // Refresh calendar after equity curve is built
      if (this.calendar) {
        this.calendar.refresh();
      }
    } catch (error) {
      logger.error('Error refreshing stats:', error);
      showToast('Error calculating stats', 'error');
    } finally {
      this.showLoadingState(false);
      this.isCalculating = false;
    }
  }

  async calculate() {
    const allEntries = state.journal.entries;
    const filterState = this.filters.getActiveFilter();

    // Build FULL equity curve (no filters) to ensure accurate balance calculations
    // Filtering happens at display level, not calculation level
    await equityCurveManager.buildEquityCurve(null, null);

    // Get filtered trades
    const filteredTrades = this.filters.getFilteredTrades(allEntries);

    // Calculate all metrics using new modular calculators
    const currentAccount = this.calculator.calculateCurrentAccount();
    const openRisk = sharedMetrics.getOpenRisk(); // Shared with Positions page!
    const realizedPnL = this.calculator.calculateRealizedPnL(filteredTrades);
    const winsLosses = this.calculator.calculateWinsLosses(filteredTrades);
    const winRate = this.calculator.calculateWinRate(filteredTrades);
    const avgWinLossRatio = this.calculator.calculateAvgWinLossRatio(filteredTrades);
    const tradeExpectancy = this.calculator.calculateTradeExpectancy(filteredTrades);
    const netCashFlow = this.calculator.calculateNetCashFlow(filterState.dateFrom, filterState.dateTo);

    // Calculate deposits and withdrawals separately for breakdown display
    const cashFlowTransactions = state.cashFlow?.transactions || [];
    const filteredTransactions = filterState.dateFrom || filterState.dateTo
      ? cashFlowTransactions.filter(tx => {
          const txDate = new Date(tx.timestamp);
          txDate.setHours(0, 0, 0, 0);
          const txDateStr = marketHours.formatDate(txDate);

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
    const pnlResult = await this.calculator.calculatePnL(filterState.dateFrom, filterState.dateTo);

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
      avgWinLossRatio,
      tradeExpectancy,
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
      this.elements.pnlTrades.innerHTML = `<span class="stat-card__sub--highlight">${s.totalTrades}</span> realized trade${s.totalTrades !== 1 ? 's' : ''}`;
    }

    // Win Rate
    if (this.elements.winRate) {
      this.elements.winRate.textContent = s.winRate !== null ? `${s.winRate.toFixed(1)}%` : '-';
    }
    if (this.elements.winLoss) {
      this.elements.winLoss.innerHTML = `<span class="stat-card__sub--success-glow">${s.wins} win${s.wins !== 1 ? 's' : ''}</span> · <span class="stat-card__sub--danger">${s.losses} loss${s.losses !== 1 ? 'es' : ''}</span>`;
    }

    // Average Win/Loss Ratio
    if (this.elements.sharpe) {
      this.elements.sharpe.textContent = s.avgWinLossRatio !== null ? s.avgWinLossRatio.toFixed(2) : '-';
    }

    // Trade Expectancy
    if (this.elements.expectancy) {
      if (s.tradeExpectancy !== null) {
        const isPositive = s.tradeExpectancy >= 0;
        this.elements.expectancy.textContent = isPositive
          ? `+$${this.formatNumber(Math.abs(s.tradeExpectancy))}`
          : `-$${this.formatNumber(Math.abs(s.tradeExpectancy))}`;
        document.getElementById('statExpectancyCard')?.classList.toggle('stat-card--success', isPositive && s.tradeExpectancy !== 0);
        document.getElementById('statExpectancyCard')?.classList.toggle('stat-card--danger', !isPositive);
      } else {
        this.elements.expectancy.textContent = '$0.00';
      }
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
      const startDate = this.formatDateShort(s.accountAtRangeStartDate);
      const startAmount = this.formatNumberShort(s.accountAtRangeStart);
      this.elements.accountChange.innerHTML = `From <span class="stat-card__sub--highlight">${startDate} · $${startAmount}</span>`;
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
      totalGrowthSub.textContent = 'Including cash flow';
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

    // Net Cash Flow subtitle with colored deposits/withdrawals
    const cashFlowSub = this.elements.cashFlowCard?.querySelector('.stat-card__sub');
    if (cashFlowSub) {
      cashFlowSub.innerHTML = `(<span class="stat-card__sub--success-glow">Deposits</span> - <span class="stat-card__sub--danger">withdrawals</span>)`;
    }
  }

  async renderEquityCurve() {
    if (!this.chart) {
      logger.warn('Chart not initialized');
      return;
    }

    try {
      // Show loading
      if (this.elements.chartLoading) {
        this.elements.chartLoading.style.display = 'inline-flex';
      }

      const filterState = this.filters.getActiveFilter();

      // Build full equity curve (no filters) for accurate calculations
      const curveObject = await equityCurveManager.buildEquityCurve(null, null);

      // Convert object to array format for chart
      let curveData = Object.entries(curveObject)
        .map(([date, data]) => ({
          date,
          balance: data.balance,
          realizedBalance: data.realizedBalance,
          unrealizedPnL: data.unrealizedPnL,
          dayPnL: data.dayPnL,
          cashFlow: data.cashFlow
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Filter curve data for display (after calculation)
      if (filterState.dateFrom || filterState.dateTo) {
        curveData = curveData.filter(point => {
          let inRange = true;
          if (filterState.dateFrom) {
            inRange = inRange && point.date >= filterState.dateFrom;
          }
          if (filterState.dateTo) {
            inRange = inRange && point.date <= filterState.dateTo;
          }
          return inRange;
        });
      }

      this.chart.setData(curveData);
      this.chart.render();

      // Update chart value display
      if (this.elements.chartValue && curveData.length > 0) {
        const lastPoint = curveData[curveData.length - 1];
        this.elements.chartValue.textContent = `$${this.formatNumber(lastPoint.balance)}`;
      }
    } catch (error) {
      logger.error('Error rendering equity curve:', error);
      logger.error('Error stack:', error.stack);
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

  formatDateShort(dateStr) {
    if (!dateStr) return '';

    // Parse YYYY-MM-DD string
    const [year, month, day] = dateStr.split('-').map(Number);

    // Format as "MM/DD/YYYY"
    return `${month}/${day}/${year}`;
  }

  formatNumberShort(num) {
    // Format with thousands separator but no decimals
    return Math.abs(num).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  /**
   * Start auto-refreshing prices (every 60 seconds)
   * Called when stats page becomes active
   */
  startAutoRefresh() {
    if (!priceTracker.apiKey) {
      logger.debug('[Stats] No Finnhub API key, skipping auto-refresh');
      return;
    }

    // Clear any existing interval
    this.stopAutoRefresh();

    // Refresh immediately
    this.refreshPrices(true);

    // Set up 60-second interval
    this.autoRefreshInterval = setInterval(() => {
      // Only refresh during market hours to avoid after-hours prices
      if (marketHours.isMarketOpen()) {
        this.refreshPrices(true);
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    logger.debug('[Stats] Started auto-refresh (60s interval)');
  }

  /**
   * Stop auto-refreshing prices
   * Called when leaving stats page
   */
  stopAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
      logger.debug('[Stats] Stopped auto-refresh');
    }
  }

  /**
   * Refresh prices from Finnhub
   * Also checks if we should save EOD snapshot
   * @param {boolean} silent - If true, don't show toast notifications
   */
  async refreshPrices(silent = false) {
    try {
      // Get all open/trimmed positions
      const activeTrades = getOpenTrades(state.journal.entries);

      if (activeTrades.length === 0) {
        logger.debug('[Stats] No active trades to refresh prices for');
        return;
      }

      // Check if market is closed and if we need to fetch closing prices for EOD
      const isAfterClose = marketHours.isAfterMarketClose();
      const tradingDay = marketHours.getTradingDay();
      const needsEOD = isAfterClose && !eodCacheManager.hasEODData(tradingDay);

      // Fetch prices (will use previous close if after hours, for EOD snapshot)
      await priceTracker.refreshAllActivePrices(needsEOD);

      // Check if we should save EOD snapshot
      await this.checkAndSaveEOD();

      // Recalculate stats with new prices
      sharedMetrics.recalculateAll();

      // Only calculate and render if we're on the stats page
      if (state.ui.currentView === 'stats') {
        this.calculate();
        this.render();
      }

      if (!silent) {
        showToast('Prices updated', 'success');
      }
    } catch (error) {
      logger.error('[Stats] Error refreshing prices:', error);
      if (!silent) {
        showToast('Error refreshing prices', 'error');
      }
    }
  }

  /**
   * Check if we should save EOD snapshot
   * Saves once per trading day after market close (4pm EST)
   */
  async checkAndSaveEOD() {
    try {
      const isAfterClose = marketHours.isAfterMarketClose();
      const tradingDay = marketHours.getTradingDay();

      // Only save if:
      // 1. It's after market close (after 4pm EST, before next 9:30am EST)
      // 2. We haven't already saved data for this trading day
      // 3. The market was actually open today (not a holiday/weekend)
      //    - We check this by seeing if tradingDay matches current weekday
      //    - On holidays/weekends, getTradingDay() returns a past date
      const currentWeekday = marketHours.formatDate(getCurrentWeekday());
      const isActualTradingDay = tradingDay === currentWeekday;

      if (isAfterClose && !eodCacheManager.hasEODData(tradingDay) && isActualTradingDay) {
        logger.debug(`[Stats] Market closed, saving EOD snapshot for ${tradingDay}`);
        await this.saveEODSnapshot(tradingDay);
      } else if (isAfterClose && !isActualTradingDay) {
        logger.debug(`[Stats] Not saving EOD for ${tradingDay} because current day is ${currentWeekday} (holiday/weekend)`);
      }
    } catch (error) {
      logger.error('[Stats] Error checking/saving EOD:', error);
    }
  }

  /**
   * Save EOD snapshot for a specific trading day
   *
   * Options are stored using unique keys: ticker_strike_expiration_type
   * This ensures multiple option contracts on the same underlying ticker
   * don't overwrite each other.
   *
   * Format conversion: priceTracker uses hyphen format internally,
   * but EOD snapshots use underscore format for consistency with
   * AccountBalanceCalculator and EquityCurveManager.
   *
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   */
  async saveEODSnapshot(dateStr) {
    try {
      // Get current prices (should be EOD prices if after 4pm)
      const priceCache = priceTracker.cache || {};
      const prices = {};
      for (const [ticker, data] of Object.entries(priceCache)) {
        if (data && data.price) {
          prices[ticker] = data;
        }
      }

      // Get options prices from optionsCache (Map with hyphen keys)
      // Convert to standard underscore format using utility
      const optionsCache = priceTracker.optionsCache || new Map();
      for (const [hyphenKey, data] of optionsCache.entries()) {
        if (data && data.price) {
          const underscoreKey = convertHyphenKeyToUnderscoreKey(hyphenKey);
          prices[underscoreKey] = { price: data.price, timestamp: data.timestamp };
        }
      }

      // Get trades that were open on this date
      const openTrades = state.journal.entries.filter(trade => {
        const entryDateStr = this._getEntryDateString(trade);
        const enteredBefore = entryDateStr <= dateStr;
        const notClosedYet = !trade.exitDate || trade.exitDate > dateStr;
        return isOpenTrade(trade) && enteredBefore && notClosedYet;
      });

      // Build EOD prices map and track which tickers we have prices for
      const stockPrices = {};
      const positionsOwned = [];
      const incompleteTickers = [];

      for (const trade of openTrades) {
        let key, priceData;

        if (trade.assetType === 'options') {
          // Use unique key for options
          key = `${trade.ticker}_${trade.strike}_${trade.expirationDate}_${trade.optionType}`;
          priceData = prices[key];
        } else {
          // Use ticker for stocks
          key = trade.ticker;
          priceData = prices[trade.ticker];
        }

        if (priceData) {
          const price = typeof priceData === 'number' ? priceData : priceData.price;
          stockPrices[key] = price;
          positionsOwned.push(key);
        } else {
          incompleteTickers.push(key);
        }
      }

      // Calculate balance using shared calculator
      const balanceData = accountBalanceCalculator.calculateCurrentBalance({
        startingBalance: state.settings.startingAccountSize,
        allTrades: state.journal.entries,
        cashFlowTransactions: state.cashFlow.transactions,
        currentPrices: prices
      });

      // Calculate cash flow for this specific day
      const dayCashFlow = accountBalanceCalculator.calculateDayCashFlow(
        state.cashFlow.transactions,
        dateStr
      );

      // Determine if data is complete
      const isIncomplete = incompleteTickers.length > 0;

      // Save snapshot
      eodCacheManager.saveEODSnapshot(dateStr, {
        balance: balanceData.balance,
        realizedBalance: balanceData.realizedBalance,
        unrealizedPnL: balanceData.unrealizedPnL,
        stockPrices,
        positionsOwned,
        cashFlow: dayCashFlow,
        timestamp: Date.now(),
        source: 'finnhub',
        incomplete: isIncomplete,
        missingTickers: incompleteTickers
      });

      if (isIncomplete) {
        logger.warn(`[Stats] Saved incomplete EOD snapshot for ${dateStr}. Missing tickers:`, incompleteTickers);
      } else {
        logger.debug(`[Stats] Saved complete EOD snapshot for ${dateStr}:`, {
          balance: balanceData.balance,
          positions: positionsOwned.length
        });
      }
    } catch (error) {
      logger.error(`[Stats] Failed to save EOD snapshot for ${dateStr}:`, error);

      // Mark day as incomplete with error
      eodCacheManager.saveEODSnapshot(dateStr, {
        balance: 0,
        incomplete: true,
        error: error.message,
        timestamp: Date.now(),
        source: 'finnhub'
      });
    }
  }

  /**
   * Get entry date string from trade timestamp
   * Converts timestamp to 'YYYY-MM-DD' format
   */
  _getEntryDateString(trade) {
    return getTradeEntryDateString(trade);
  }

  /**
   * Handle calendar day click
   * Displays trades for the selected date (or week range for Saturday) using shared journal table renderer
   * @param {string} dateStr - Date string in YYYY-MM-DD format
   * @param {Object|null} weekRange - Optional week range { from, to } for Saturday clicks
   */
  async handleCalendarDayClick(dateStr, weekRange = null) {
    this.selectedDate = dateStr;
    this.selectedWeekRange = weekRange; // Store for later use when opening trades

    const allTrades = state.journal.entries;
    let tradesFiltered;

    if (weekRange) {
      // Filter trades within the week range (Monday through Friday)
      tradesFiltered = allTrades.filter(trade => {
        const entryDateStr = this._getEntryDateString(trade);
        return entryDateStr >= weekRange.from && entryDateStr <= weekRange.to;
      });
    } else {
      // Filter trades for single day
      tradesFiltered = allTrades.filter(trade => {
        const entryDateStr = this._getEntryDateString(trade);
        return entryDateStr === dateStr;
      });
    }

    // Sort trades by date (oldest to newest) for consistent ordering
    tradesFiltered.sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return dateA - dateB; // Ascending (oldest first)
    });

    // Update date range display
    const dateRangeContainer = document.getElementById('selectedDayDateRange');
    if (dateRangeContainer) {
      // Format date range
      let dateRangeText;
      if (weekRange) {
        const fromFormatted = this.formatDateDisplay(weekRange.from);
        const toFormatted = this.formatDateDisplay(weekRange.to);
        dateRangeText = `${fromFormatted} - ${toFormatted}`;
      } else {
        dateRangeText = this.formatDateDisplay(dateStr);
      }
      dateRangeContainer.textContent = dateRangeText;
    }

    // Update trades table
    const tradesContainer = document.getElementById('selectedDayTrades');
    if (tradesContainer) {
      if (tradesFiltered.length === 0) {
        const emptyMessage = weekRange
          ? 'No trades opened during this week'
          : 'No trades opened on this day';
        tradesContainer.innerHTML = `
          <div class="selected-day-trades__empty">
            ${emptyMessage}
          </div>
        `;
      } else {
        // Use shared journal table renderer (single source of truth!)
        const tradesHTML = await renderJournalTableRows(tradesFiltered, {
          shouldAnimate: false,
          expandedRows: new Set(),
          statsPageMode: true  // Use simplified columns for stats page
        });

        tradesContainer.innerHTML = `
          <table class="journal-table journal-table--stats">
            <thead>
              <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Options</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Shares/Cons</th>
                <th>P&L $</th>
                <th>P&L %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${tradesHTML}
            </tbody>
          </table>
        `;

        // Add click handlers to open journal entries with date filter preserved
        tradesContainer.querySelectorAll('tbody tr').forEach(row => {
          row.addEventListener('click', (e) => {
            const tradeId = parseInt(row.dataset.id); // Note: dataset.id not dataset.tradeId
            // Pass week range if this was a weekly selection
            if (weekRange) {
              this.openTradeInJournal(tradeId, null, weekRange);
            } else {
              this.openTradeInJournal(tradeId, dateStr);
            }
          });
        });
      }
    }
  }

  /**
   * Open a trade in the journal view
   * @param {number} tradeId - ID of the trade to open
   * @param {string} dateStr - Optional date string to filter to (if coming from calendar day click)
   * @param {Object} weekRange - Optional week range { from, to } for weekly selections
   */
  openTradeInJournal(tradeId, dateStr = null, weekRange = null) {
    // Set filters BEFORE navigation (they'll be used by the viewChanged render)
    if (weekRange) {
      journalView.applyFiltersFromExternal({
        dateFrom: weekRange.from,
        dateTo: weekRange.to,
        resetToDefaults: true
      });
    } else if (dateStr) {
      journalView.applyFiltersFromExternal({
        dateFrom: dateStr,
        dateTo: dateStr,
        resetToDefaults: true
      });
    } else {
      journalView.dateRangeFilter.clearFilters();
      journalView.handleDatePreset('max');
      journalView.filterPopup?.updateFilterCount(0);
    }

    // Navigate to journal (will trigger render via viewChanged event)
    viewManager.navigateTo('journal');

    // Wait for journal render to complete before scrolling
    this._waitForJournalRender().then(() => {
      this._scrollToAndExpandTrade(tradeId);
    });
  }

  /**
   * Wait for journal view to finish rendering
   * @returns {Promise} Resolves when journal render is complete
   */
  async _waitForJournalRender() {
    const maxWait = 2000; // Maximum 2 seconds
    const checkInterval = 50; // Check every 50ms
    let waited = 0;

    while (!journalView.isReadyForScroll && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    if (waited >= maxWait) {
      console.warn('Timeout waiting for journal render');
    }
  }

  /**
   * Scroll to a trade and expand it, ensuring the entire expanded content is visible
   * @param {number} tradeId - Trade ID to scroll to and expand
   */
  async _scrollToAndExpandTrade(tradeId) {
    // Find the row
    const row = document.querySelector(`.journal-table__row[data-id="${tradeId}"]`);
    if (!row) {
      return;
    }

    // Expand the row FIRST (without scrolling yet)
    journalView.toggleRowExpand(tradeId);

    // Wait for expanded content to render (chart/summary have retry logic up to 600ms)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Now do ONE smooth scroll to show the expanded content
    const detailsRow = document.querySelector(`[data-details-id="${tradeId}"]`);
    if (detailsRow) {
      // Scroll the expanded content into view with smooth animation
      detailsRow.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }
}

export const stats = new Stats();
export { Stats };
