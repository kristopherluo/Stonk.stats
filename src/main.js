/**
 * Main - Application entry point
 */

import { state } from './core/state.js';
import { priceTracker } from './core/priceTracker.js';
import { calculator } from './features/calculator/calculator.js';
import { journal } from './features/journal/journal.js';
import { settings } from './features/settings/settings.js';
import { theme, keyboard, settingsToggle, focusManager, hintArrow, tooltipHandler } from './components/ui/ui.js';
import { trimModal } from './components/modals/trimModal.js';
import { wizard } from './components/modals/wizard.js';
import { dataManager } from './core/dataManager.js';
import { clearDataModal } from './components/modals/clearDataModal.js';
import { viewManager } from './components/ui/viewManager.js';
import { stats } from './features/stats/stats.js';
import { equityChart } from './features/stats/statsChart.js';
import { positionsView } from './features/positions/positionsView.js';
import { journalView } from './features/journal/journalView.js';
import { formatDate } from './utils/marketHours.js';
import { createLogger } from './utils/logger.js';
import { getOpenTrades } from './shared/TradeFilters.js';

const logger = createLogger('App');

class App {
  constructor() {
    this.init();
  }

  async init() {
    logger.info('Initializing TradeDeck...');

    // Initialize settings FIRST (loads saved data from IndexedDB)
    await settings.init();

    // Initialize price tracker
    await priceTracker.init();

    // Auto-fetch prices on load if we have open trades and cache is empty/stale
    const openTrades = getOpenTrades(state.journal.entries);
    const hasOpenTrades = openTrades.length > 0;
    const hasCachedPrices = priceTracker.cache.size > 0;

    if (hasOpenTrades && !hasCachedPrices) {
      // Show loading indicator on header
      settings.setAccountLoading(true);

      // Fetch prices for open positions
      priceTracker.fetchActivePrices()
        .then(() => {
          settings.setAccountLoading(false);
          settings.updateAccountDisplay(state.account.currentSize);
        })
        .catch((error) => {
          logger.error('Failed to fetch prices on load:', error);
          settings.setAccountLoading(false);
          settings.updateAccountDisplay(state.account.currentSize);
        });
    } else {
      // Update account display with cached prices
      settings.updateAccountDisplay(state.account.currentSize);
    }

    // Initialize theme after settings are loaded (so it doesn't overwrite saved settings)
    theme.init();

    // Initialize calculator
    calculator.init();

    // Initialize journal
    journal.init();

    // Initialize trim modal
    trimModal.init();

    // Initialize wizard
    wizard.init();

    // Initialize clear data modal
    clearDataModal.init();

    // Initialize view manager (4-view navigation)
    viewManager.init();

    // Initialize stats and chart
    await stats.init();
    equityChart.init();

    // Initialize positions and journal views
    positionsView.init();
    journalView.init();

    // Set up module references for dataManager (after all modules are initialized)
    dataManager.setModules(settings, calculator, journal, clearDataModal, stats, equityChart, positionsView, journalView);

    // Initialize keyboard shortcuts
    keyboard.init();

    // Initialize settings card toggle
    settingsToggle.init();

    // Initialize focus manager for visual attention flow
    focusManager.init();

    // Initialize hint arrow click handler (mobile scroll to input)
    hintArrow.init();

    // Initialize tooltip handler (prevent label clicks on mobile)
    tooltipHandler.init();

    // Sync Quick Settings summary with loaded values
    settingsToggle.updateSummary(
      state.account.currentSize,
      state.account.maxPositionPercent
    );

    // Set up global event listeners
    this.setupGlobalEvents();

    // Expose global functions for HTML onclick handlers
    this.setupGlobalFunctions();

    logger.info('TradeDeck initialized successfully');
  }

  setupGlobalEvents() {
    // Listen for account changes to update calculator and summary
    state.on('accountSizeChanged', () => {
      calculator.calculate();
      settingsToggle.updateSummary(
        state.account.currentSize,
        state.account.maxPositionPercent
      );
    });

    // Listen for results to update header and activate results panel
    state.on('resultsRendered', (results) => {
      settings.updateAccountDisplay(state.account.currentSize);

      // Activate results panel glow when we have real results
      if (results && results.shares > 0) {
        focusManager.activateResults();
      } else {
        focusManager.deactivateResults();
      }
    });

    // Deactivate results when trade is cleared
    state.on('tradeChanged', (trade) => {
      if (!trade.entry && !trade.stop) {
        focusManager.deactivateResults();
      }
    });

    // Update settings summary when settings change
    state.on('settingsChanged', () => {
      settingsToggle.updateSummary(
        state.account.currentSize,
        state.account.maxPositionPercent
      );
    });

    // Debug logging in development
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      state.on('settingsChanged', (s) => logger.debug('Settings:', s));
      state.on('tradeChanged', (t) => logger.debug('Trade:', t));
    }
  }

  setupGlobalFunctions() {
    // Expose functions needed by HTML onclick handlers
    window.closeTrade = (tradeId) => trimModal.open(tradeId);
    window.deleteTrade = (tradeId) => journal.deleteTrade(tradeId);
    window.exportAllData = () => dataManager.exportAllData();
    window.importData = () => dataManager.importData();
    window.clearAllData = () => dataManager.clearAllData();
    window.exportCSV = () => dataManager.exportCSV();
    window.copyCSV = () => dataManager.copyCSV();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new App());
} else {
  new App();
}

// Export for potential external use
export { App };
