/**
 * Stats - Trading statistics UI and rendering
 * REFACTORED: Uses modular calculators, ~300 lines vs 1300 lines
 */

import { state } from '../../core/state.js';
import { showToast } from '../../components/ui/ui.js';
import { initFlatpickr, getCurrentWeekday } from '../../core/utils.js';
import { incrementalStatsCalculator } from './IncrementalStatsCalculator.js';
import { DateRangeFilter } from '../../shared/DateRangeFilter.js';
import { FilterPopup } from '../../shared/FilterPopup.js';
import { sharedMetrics } from '../../shared/SharedMetrics.js';
import { EquityChart } from './statsChart.js';
import { pnlCalendar } from './PnLCalendar.js';
import { priceTracker } from '../../core/priceTracker.js';
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
      profitFactor: document.getElementById('statProfitFactor'),
      profitFactorCard: document.getElementById('statProfitFactorCard'),
      profitFactorSub: document.getElementById('statProfitFactorSub'),
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

    // Initialize trades toggle (Opened/Closed)
    this.currentTradesMode = 'opened'; // Default to showing opened trades
    this.setupTradesToggle();

    // Listen for journal changes
    state.on('journalEntryAdded', () => {
      this.calculator.invalidateCache();
      if (state.ui.currentView === 'stats') {
        sharedMetrics.recalculateAll();
        this.refresh();
      }
    });
    state.on('journalEntryUpdated', () => {
      this.calculator.invalidateCache();
      if (state.ui.currentView === 'stats') {
        sharedMetrics.recalculateAll();
        this.refresh();
      }
    });
    state.on('journalEntryDeleted', () => {
      this.calculator.invalidateCache();
      if (state.ui.currentView === 'stats') {
        sharedMetrics.recalculateAll();
        this.refresh();
      }
    });
    state.on('accountSizeChanged', () => {
      if (state.ui.currentView === 'stats') {
        this.refresh();
      }
    });
    state.on('cashFlowChanged', () => {
      if (state.ui.currentView === 'stats') {
        this.refresh();
      }
    });
    state.on('settingsChanged', () => {
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
      // Add delay to ensure DOM is fully ready (especially for chart rendering)
      // Use same delay as viewChanged handler to ensure consistent behavior
      this.animateStatCards();
      setTimeout(() => {
        this.refresh();
      }, VIEW_TRANSITION_DELAY_MS);
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

  setupTradesToggle() {
    const toggle = document.getElementById('tradesToggle');
    if (!toggle) return;

    const options = toggle.querySelectorAll('.toggle-switch__option');

    options.forEach(option => {
      option.addEventListener('click', () => {
        const mode = option.dataset.mode;

        // Update active state
        options.forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');

        // Update data-active attribute for CSS animations
        const index = Array.from(options).indexOf(option);
        toggle.setAttribute('data-active', index);

        // Update current mode
        this.currentTradesMode = mode;

        // Re-render trades with the new mode
        if (this.selectedDate || this.selectedWeekRange) {
          this.handleCalendarDayClick(this.selectedDate, this.selectedWeekRange);
        }
      });
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
    const filteredTrades = this.filters.getFilteredTrades(allEntries);
    const startingBalance = state.settings.startingAccountSize;

    // Calculate realized P&L for both filtered and all trades (two calls required for different scopes)
    const realizedPnL = this.calculator.calculateRealizedPnL(filteredTrades);
    const allTradesRealizedPnL = this.calculator.calculateRealizedPnL(allEntries);

    // Get cash flow breakdown (eliminates duplicate filtering logic)
    const cashFlowBreakdown = this.calculator.calculateCashFlowBreakdown(
      filterState.dateFrom,
      filterState.dateTo
    );

    // Calculate realized account balance from all trades
    const realizedAccount = startingBalance + allTradesRealizedPnL + cashFlowBreakdown.net;

    // Get all trade metrics (eliminates duplicate filtering and calculations)
    const winsLosses = this.calculator.calculateWinsLosses(filteredTrades);
    const winRate = this.calculator.calculateWinRate(filteredTrades);
    const profitFactor = this.calculator.calculateProfitFactor(filteredTrades);
    const avgWinLossRatio = this.calculator.calculateAvgWinLossRatio(filteredTrades);
    const tradeExpectancy = this.calculator.calculateTradeExpectancy(filteredTrades);

    // Get shared metrics
    const openRisk = sharedMetrics.getOpenRisk();

    // Get earliest trade date for display
    const earliestTradeDate = allEntries.length > 0
      ? allEntries
          .filter(e => e.timestamp)
          .map(e => new Date(e.timestamp))
          .reduce((min, date) => date < min ? date : min, new Date())
      : new Date();

    const startDateStr = marketHours.formatDate(earliestTradeDate);

    // Calculate growth percentages
    const tradingGrowth = startingBalance > 0
      ? (realizedPnL / startingBalance) * 100
      : 0;

    const totalGrowth = startingBalance > 0
      ? ((realizedPnL + cashFlowBreakdown.net) / startingBalance) * 100
      : 0;

    // Store results
    this.stats = {
      realizedAccount,
      openRisk,
      realizedPnL,
      wins: winsLosses.wins,
      losses: winsLosses.losses,
      totalTrades: winsLosses.total,
      winRate,
      profitFactor,
      avgWinLossRatio,
      tradeExpectancy,
      totalPnL: realizedPnL,
      accountAtRangeStart: startingBalance,
      accountAtRangeStartDate: startDateStr,
      tradingGrowth,
      totalGrowth,
      netCashFlow: cashFlowBreakdown.net,
      deposits: cashFlowBreakdown.deposits,
      withdrawals: cashFlowBreakdown.withdrawals
    };
  }

  render() {
    const s = this.stats;

    // Update date range display
    this.updateDateRangeDisplay();

    // Current Account (Realized balance only)
    if (this.elements.openPositions) {
      this.elements.openPositions.textContent = `$${this.formatNumber(s.realizedAccount)}`;
    }
    // Subtitle is now static "Realized trades only" in HTML

    // Win Rate
    if (this.elements.winRate) {
      this.elements.winRate.textContent = s.winRate !== null ? `${s.winRate.toFixed(1)}%` : '-';
    }
    if (this.elements.winLoss) {
      this.elements.winLoss.innerHTML = `<span class="stat-card__sub--success-glow">${s.wins} win${s.wins !== 1 ? 's' : ''}</span> · <span class="stat-card__sub--danger">${s.losses} loss${s.losses !== 1 ? 'es' : ''}</span>`;
    }

    // Profit Factor
    if (this.elements.profitFactor) {
      if (s.profitFactor !== null) {
        this.elements.profitFactor.textContent = s.profitFactor.toFixed(2);

        // Color the card based on profit factor value
        const isPositive = s.profitFactor > 1.0;
        const isNegative = s.profitFactor < 1.0;
        this.elements.profitFactorCard?.classList.toggle('stat-card--success', isPositive);
        this.elements.profitFactorCard?.classList.toggle('stat-card--danger', isNegative);

        // Update description with colored values
        if (this.elements.profitFactorSub) {
          const formattedValue = `$${s.profitFactor.toFixed(2)}`;
          this.elements.profitFactorSub.innerHTML = ` Amount made for every <span class="stat-card__sub--danger">$1.00</span> lost`;
        }
      } else {
        this.elements.profitFactor.textContent = '-';
        this.elements.profitFactorCard?.classList.remove('stat-card--success', 'stat-card--danger');
        if (this.elements.profitFactorSub) {
          this.elements.profitFactorSub.textContent = 'Total wins / total losses';
        }
      }
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
      const allTrades = state.journal.entries;
      const cashFlowTransactions = state.cashFlow?.transactions || [];
      const startingBalance = state.settings.startingAccountSize;

      // Build timeline of balance changes from trade exits and cash flow
      const events = [];

      // Add trade close events (including trimmed trades)
      allTrades.forEach(trade => {
        if (trade.status === 'closed' && trade.exitDate) {
          const exitDateStr = trade.exitDate.split('T')[0];
          events.push({
            date: exitDateStr,
            type: 'trade_close',
            pnl: trade.pnl || 0
          });
        } else if (trade.status === 'trimmed' && trade.trimHistory) {
          // Add event for each trim
          trade.trimHistory.forEach(trim => {
            const trimDateStr = trim.date.split('T')[0];
            events.push({
              date: trimDateStr,
              type: 'trim',
              pnl: trim.pnl || 0
            });
          });
        }
      });

      // Add cash flow events
      cashFlowTransactions.forEach(tx => {
        const txDate = new Date(tx.timestamp);
        const txDateStr = marketHours.formatDate(txDate);
        const amount = tx.type === 'deposit' ? tx.amount : -tx.amount;
        events.push({
          date: txDateStr,
          type: 'cashflow',
          cashflow: amount
        });
      });

      // Sort events by date
      events.sort((a, b) => a.date.localeCompare(b.date));

      // Build cumulative balance data points
      let curveData = [];
      let currentBalance = startingBalance;

      // Add starting point
      if (events.length > 0) {
        curveData.push({
          date: events[0].date,
          balance: startingBalance,
          realizedBalance: startingBalance,
          unrealizedPnL: 0,
          dayPnL: 0,
          cashFlow: 0
        });
      }

      // Aggregate events by date
      const eventsByDate = {};
      events.forEach(event => {
        if (!eventsByDate[event.date]) {
          eventsByDate[event.date] = { pnl: 0, cashflow: 0 };
        }
        if (event.pnl) eventsByDate[event.date].pnl += event.pnl;
        if (event.cashflow) eventsByDate[event.date].cashflow += event.cashflow;
      });

      // Create data points for each date with events
      Object.keys(eventsByDate).sort().forEach(date => {
        const event = eventsByDate[date];
        const dayPnL = event.pnl;
        const dayCashFlow = event.cashflow;
        currentBalance += dayPnL + dayCashFlow;

        curveData.push({
          date,
          balance: currentBalance,
          realizedBalance: currentBalance,
          unrealizedPnL: 0,
          dayPnL,
          cashFlow: dayCashFlow
        });
      });

      // Extend curve to today if today is after the last data point
      const today = new Date();
      const todayStr = marketHours.formatDate(today);

      if (curveData.length > 0) {
        const lastPoint = curveData[curveData.length - 1];
        if (lastPoint.date < todayStr) {
          // Add a data point for today with the same balance as the last point
          curveData.push({
            date: todayStr,
            balance: currentBalance,
            realizedBalance: currentBalance,
            unrealizedPnL: 0,
            dayPnL: 0,
            cashFlow: 0
          });
        }
      } else if (events.length === 0) {
        // No events at all - show starting balance from beginning to today
        curveData.push({
          date: todayStr,
          balance: startingBalance,
          realizedBalance: startingBalance,
          unrealizedPnL: 0,
          dayPnL: 0,
          cashFlow: 0
        });
      }

      // Filter curve data for display
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
   * Refresh prices for open positions
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

      // Fetch current prices for open positions
      await priceTracker.refreshAllActivePrices();

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

    // Filter trades OPENED on this date/week
    let tradesOpened;
    if (weekRange) {
      tradesOpened = allTrades.filter(trade => {
        const entryDateStr = this._getEntryDateString(trade);
        return entryDateStr >= weekRange.from && entryDateStr <= weekRange.to;
      });
    } else {
      tradesOpened = allTrades.filter(trade => {
        const entryDateStr = this._getEntryDateString(trade);
        return entryDateStr === dateStr;
      });
    }

    // Sort trades by date (newest to oldest)
    tradesOpened.sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return dateB - dateA; // Descending (newest first)
    });

    // Filter trades CLOSED on this date/week
    let tradesClosed;
    if (weekRange) {
      tradesClosed = allTrades.filter(trade => {
        const exitDateStr = this._getExitDateString(trade);
        return exitDateStr && exitDateStr >= weekRange.from && exitDateStr <= weekRange.to;
      });
    } else {
      tradesClosed = allTrades.filter(trade => {
        const exitDateStr = this._getExitDateString(trade);
        return exitDateStr === dateStr;
      });
    }

    // Sort closed trades by exit date (newest to oldest)
    tradesClosed.sort((a, b) => {
      const dateA = this._getExitDate(a);
      const dateB = this._getExitDate(b);
      return dateB - dateA; // Descending (newest first)
    });

    // Format date range text
    let dateRangeText;
    if (weekRange) {
      const fromFormatted = this.formatDateDisplay(weekRange.from);
      const toFormatted = this.formatDateDisplay(weekRange.to);
      dateRangeText = `${fromFormatted} - ${toFormatted}`;
    } else {
      dateRangeText = this.formatDateDisplay(dateStr);
    }

    // Update date range display
    const dateRange = document.getElementById('selectedDayDateRange');
    if (dateRange) {
      dateRange.textContent = dateRangeText;
    }

    // Render trades based on current mode
    if (this.currentTradesMode === 'opened') {
      await this._renderTradesSection('selectedDayTrades', tradesOpened, weekRange, dateStr, 'opened');
    } else {
      await this._renderTradesSection('selectedDayTrades', tradesClosed, weekRange, dateStr, 'closed');
    }
  }

  /**
   * Helper to render a trades section (opened or closed)
   */
  async _renderTradesSection(containerId, trades, weekRange, dateStr, type) {
    const tradesContainer = document.getElementById(containerId);
    if (!tradesContainer) return;

    if (trades.length === 0) {
      const emptyMessage = weekRange
        ? `No trades ${type} during this week`
        : `No trades ${type} on this day`;
      tradesContainer.innerHTML = `
        <div class="selected-day-trades__empty">
          ${emptyMessage}
        </div>
      `;
      tradesContainer.classList.add('selected-day-trades--empty');
    } else {
      tradesContainer.classList.remove('selected-day-trades--empty');

      // Use shared journal table renderer with animation
      const tradesHTML = await renderJournalTableRows(trades, {
        shouldAnimate: true,
        expandedRows: new Set(),
        statsPageMode: true
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

      // Add click handlers
      tradesContainer.querySelectorAll('tbody tr').forEach(row => {
        row.addEventListener('click', (e) => {
          const tradeId = parseInt(row.dataset.id);
          if (weekRange) {
            this.openTradeInJournal(tradeId, null, weekRange);
          } else {
            this.openTradeInJournal(tradeId, dateStr);
          }
        });
      });
    }
  }

  /**
   * Get exit date string for a trade (handles both closed and trimmed trades)
   */
  _getExitDateString(trade) {
    if (trade.status === 'closed' && trade.exitDate) {
      return trade.exitDate.split('T')[0];
    } else if (trade.status === 'trimmed' && trade.trimHistory && trade.trimHistory.length > 0) {
      // Return the latest trim date
      const latestTrim = trade.trimHistory[trade.trimHistory.length - 1];
      return latestTrim.date.split('T')[0];
    }
    return null;
  }

  /**
   * Get exit date as Date object for sorting
   */
  _getExitDate(trade) {
    if (trade.status === 'closed' && trade.exitDate) {
      return new Date(trade.exitDate);
    } else if (trade.status === 'trimmed' && trade.trimHistory && trade.trimHistory.length > 0) {
      const latestTrim = trade.trimHistory[trade.trimHistory.length - 1];
      return new Date(latestTrim.date);
    }
    return new Date(0);
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
