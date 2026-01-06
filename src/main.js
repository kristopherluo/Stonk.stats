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
import { confetti } from './components/ui/confetti.js';
import { achievements } from './components/ui/achievements.js';
import { soundFx } from './components/ui/soundFx.js';
import { dataManager } from './core/dataManager.js';
import { clearDataModal } from './components/modals/clearDataModal.js';
import { viewManager } from './components/ui/viewManager.js';
import { stats } from './features/stats/stats.js';
import { equityChart } from './features/stats/statsChart.js';
import { positionsView } from './features/positions/positionsView.js';
import { journalView } from './features/journal/journalView.js';
import { compoundView } from './features/compound/compoundView.js';

class App {
  constructor() {
    this.init();
  }

  init() {
    console.log('Initializing TradeDeck...');

    // Set up module references for dataManager to avoid circular dependencies
    dataManager.setModules(settings, calculator, journal, clearDataModal);

    // Initialize settings FIRST (loads saved data before theme.init saves defaults)
    settings.init();

    // Initialize price tracker
    priceTracker.init();

    // Update account display after price cache is loaded
    settings.updateAccountDisplay(state.account.currentSize);

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

    // Initialize confetti
    confetti.init();

    // Initialize achievements
    achievements.init();

    // Initialize sound effects
    soundFx.init();

    // Initialize clear data modal
    clearDataModal.init();

    // Initialize view manager (4-view navigation)
    viewManager.init();

    // Initialize stats and chart
    stats.init();
    equityChart.init();

    // Initialize positions, journal, and compound views
    positionsView.init();
    journalView.init();
    compoundView.init();

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

    console.log('TradeDeck initialized successfully');
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
      state.on('settingsChanged', (s) => console.log('Settings:', s));
      state.on('tradeChanged', (t) => console.log('Trade:', t));
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
    window.exportTSV = () => dataManager.exportTSV();
    window.copyCSV = () => dataManager.copyCSV();
    window.copyTSV = () => dataManager.copyTSV();
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
