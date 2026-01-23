/**
 * DataManager - Handles data import/export and backup operations
 */

import { state } from './state.js';
import { showToast } from '../components/ui/ui.js';
import { priceTracker } from './priceTracker.js';
import { sharedMetrics } from '../shared/SharedMetrics.js';
import { storage } from '../utils/storage.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DataManager');

// Module registry for dependency injection (avoids circular imports)
const modules = new Map();

export const dataManager = {
  /**
   * Register a module for use by dataManager
   * Called from main.js after module initialization
   */
  registerModule(name, module) {
    if (!name || !module) {
      logger.warn(`Attempted to register invalid module: ${name}`);
      return;
    }
    modules.set(name, module);
    logger.debug(`Registered module: ${name}`);
  },

  /**
   * Get a registered module by name
   * @returns {Object|null} Module instance or null if not found
   */
  getModule(name) {
    return modules.get(name) || null;
  },

  /**
   * Legacy method for backward compatibility
   * @deprecated Use registerModule() instead
   */
  setModules(settings, calculator, journal, clearDataModal, stats, equityChart, positionsView, journalView) {
    this.registerModule('settings', settings);
    this.registerModule('calculator', calculator);
    this.registerModule('journal', journal);
    this.registerModule('clearDataModal', clearDataModal);
    this.registerModule('stats', stats);
    this.registerModule('equityChart', equityChart);
    this.registerModule('positionsView', positionsView);
    this.registerModule('journalView', journalView);
  },

  async exportAllData() {
    const data = {
      version: 4, // Incremented to include cache data with timestamps
      exportDate: new Date().toISOString(),
      settings: state.settings,
      journal: state.journal.entries,
      journalMeta: state.journalMeta,
      cashFlow: state.cashFlow,
      account: {
        realizedPnL: state.account.realizedPnL
      },
      apiKeys: {
        finnhub: (await storage.getItem('finnhubApiKey')) || '',
        twelveData: (await storage.getItem('twelveDataApiKey')) || '',
        alphaVantage: (await storage.getItem('alphaVantageApiKey')) || ''
      },
      // Include cache data with timestamps to avoid refetching on import
      caches: {
        riskCalcPriceCache: await storage.getItem('riskCalcPriceCache'),
        optionsPriceCache: await storage.getItem('optionsPriceCache'),
        historicalPriceCache: await storage.getItem('historicalPriceCache'),
        eodCache: await storage.getItem('eodCache'),
        companySummaryCache: await storage.getItem('companySummaryCache'),
        companyDataCache: await storage.getItem('companyDataCache')
      }
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('📥 Data exported successfully', 'success');
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = JSON.parse(event.target.result);

          if (!data.settings || !data.journal) {
            showToast('❌ Invalid backup file format', 'error');
            return;
          }

          // Clear existing journal data to prevent conflicts with imported data
          // Get existing index first, before clearing it
          const existingIndex = await storage.getItem('riskCalcJournalIndex');

          // Clear individual trade keys from old local data
          if (existingIndex && Array.isArray(existingIndex)) {
            for (const id of existingIndex) {
              await storage.removeItem(`trade_${id}`);
            }
          }

          // Clear the index - this will force migration to run on reload
          await storage.removeItem('riskCalcJournalIndex');

          // Write imported data to IndexedDB
          await storage.setItem('riskCalcSettings', data.settings);
          await storage.setItem('riskCalcJournal', data.journal || []);

          if (data.journalMeta) {
            await storage.setItem('riskCalcJournalMeta', data.journalMeta);
          }

          // Always write cash flow, even if missing (set to default)
          const cashFlowData = data.cashFlow || {
            transactions: [],
            totalDeposits: 0,
            totalWithdrawals: 0
          };
          await storage.setItem('riskCalcCashFlow', cashFlowData);

          // Restore API keys - always set them even if empty to overwrite existing
          if (data.apiKeys) {
            await storage.setItem('finnhubApiKey', data.apiKeys.finnhub || '');
            await storage.setItem('twelveDataApiKey', data.apiKeys.twelveData || '');
            await storage.setItem('alphaVantageApiKey', data.apiKeys.alphaVantage || '');
          }

          // Import cache data if available (v2+ format)
          // Preserves timestamps so importing doesn't trigger mass API refetches
          if (data.caches) {
            logger.debug('[Import] Restoring cache data with timestamps...');
            if (data.caches.riskCalcPriceCache) {
              await storage.setItem('riskCalcPriceCache', data.caches.riskCalcPriceCache);
            }
            if (data.caches.optionsPriceCache) {
              await storage.setItem('optionsPriceCache', data.caches.optionsPriceCache);
            }
            if (data.caches.historicalPriceCache) {
              await storage.setItem('historicalPriceCache', data.caches.historicalPriceCache);
            }
            if (data.caches.eodCache) {
              await storage.setItem('eodCache', data.caches.eodCache);
            }
            if (data.caches.companySummaryCache) {
              await storage.setItem('companySummaryCache', data.caches.companySummaryCache);
            }
            if (data.caches.companyDataCache) {
              await storage.setItem('companyDataCache', data.caches.companyDataCache);
            }
          } else {
            // Old format (v1) without cache data - clear caches to force fresh fetch
            logger.debug('[Import] Old format detected, clearing caches...');
            await storage.removeItem('eodCache');
            await storage.removeItem('riskCalcPriceCache');
          }

          showToast(`📤 Imported ${data.journal.length} trades - Reloading...`, 'success');

          // Reload page after short delay to ensure all IndexedDB writes complete
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          logger.error('Import error:', err);
          showToast('❌ Failed to import data', 'error');
        }
      };
      reader.readAsText(file);
    });

    input.click();
  },

  clearAllData() {
    const clearDataModal = this.getModule('clearDataModal');
    if (clearDataModal) clearDataModal.open();
  },

  async confirmClearAllData() {
    // Clear IndexedDB (primary storage)
    await storage.removeItem('riskCalcSettings');
    await storage.removeItem('riskCalcJournal');
    await storage.removeItem('riskCalcJournalMeta');
    await storage.removeItem('riskCalcCashFlow');
    await storage.removeItem('historicalPriceCache');
    await storage.removeItem('eodCache');
    await storage.removeItem('companyDataCache');
    await storage.removeItem('chartDataCache');
    await storage.removeItem('riskCalcPriceCache');

    // Clear API keys from IndexedDB
    await storage.removeItem('finnhubApiKey');
    await storage.removeItem('twelveDataApiKey');
    await storage.removeItem('alphaVantageApiKey');

    // Also clear localStorage backups
    localStorage.removeItem('riskCalcSettings');
    localStorage.removeItem('riskCalcJournal');
    localStorage.removeItem('riskCalcJournalMeta');
    localStorage.removeItem('riskCalcCashFlow');
    localStorage.removeItem('historicalPriceCache');
    localStorage.removeItem('eodCache');
    localStorage.removeItem('companyDataCache');
    localStorage.removeItem('chartDataCache');
    localStorage.removeItem('riskCalcPriceCache');
    localStorage.removeItem('finnhubApiKey');
    localStorage.removeItem('twelveDataApiKey');
    localStorage.removeItem('alphaVantageApiKey');

    // Clear API keys from service objects
    await priceTracker.setApiKey('');

    // Clear price tracker cache
    priceTracker.cache.clear();

    // Reset state
    const savedTheme = state.settings.theme;
    state.state.settings = {
      startingAccountSize: 10000,
      defaultRiskPercent: 1,
      defaultMaxPositionPercent: 100,
      dynamicAccountEnabled: true,
      theme: savedTheme
    };
    state.state.account = {
      currentSize: 10000,
      realizedPnL: 0,
      riskPercent: 1,
      maxPositionPercent: 100
    };
    state.state.cashFlow = {
      transactions: [],
      totalDeposits: 0,
      totalWithdrawals: 0
    };
    state.state.journal.entries = [];

    // Reset journal meta
    state.state.journalMeta = {
      settings: {
        wizardEnabled: false,
        celebrationsEnabled: true
      },
      schemaVersion: 1
    };

    // Invalidate account cache to force recalculation
    if (state._invalidateAccountCache) {
      state._invalidateAccountCache();
    }

    // Save the reset state immediately (bypasses debouncing)
    await state.saveAllImmediate();

    // Recalculate shared metrics
    sharedMetrics.recalculateAll();

    // Refresh ALL UI components immediately
    const settings = this.getModule('settings');
    if (settings) {
      await settings.loadAndApply();
      settings.updateAccountDisplay(state.account.currentSize);
    }

    const calculator = this.getModule('calculator');
    if (calculator) calculator.calculate();

    const journal = this.getModule('journal');
    if (journal) journal.render();

    const journalView = this.getModule('journalView');
    if (journalView) journalView.render();

    const positionsView = this.getModule('positionsView');
    if (positionsView) positionsView.render();

    const stats = this.getModule('stats');
    if (stats) await stats.refresh();

    const equityChart = this.getModule('equityChart');
    if (equityChart) equityChart.init();

    // Emit state change events to update any other listeners
    state.emit('accountSizeChanged', state.account.currentSize);
    state.emit('journalChanged', state.journal.entries);
    state.emit('cashFlowChanged', state.cashFlow);

    const clearDataModal = this.getModule('clearDataModal');
    if (clearDataModal) clearDataModal.close();
    showToast('🗑️ All data cleared', 'success');
    logger.debug('All data cleared - reset to defaults');
  },

  exportCSV() {
    const trades = state.journal.entries;
    if (trades.length === 0) {
      showToast('⚠️ No trades to export', 'warning');
      return;
    }

    const headers = ['Date', 'Ticker', 'Asset Type', 'Entry', 'Stop', 'Target', 'Shares/Contracts', 'Position Size', 'Risk $', 'Risk %', 'Strike', 'Expiration', 'Option Type', 'Premium', 'Status', 'Exit Price', 'P&L', 'Notes'];
    const rows = trades.map(t => [
      new Date(t.timestamp).toLocaleDateString(),
      t.ticker,
      t.assetType || 'stock',
      t.entry,
      t.stop,
      t.target || '',
      t.shares,
      t.positionSize?.toFixed(2) || '',
      t.riskDollars?.toFixed(2) || '',
      t.riskPercent,
      t.strike || '',
      t.expirationDate || '',
      t.optionType || '',
      t.premium || '',
      t.status,
      t.exitPrice || '',
      t.pnl?.toFixed(2) || '',
      `"${(t.notes || '').replace(/"/g, '""')}"`
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    this.downloadFile(csv, 'trades.csv', 'text/csv');
    showToast('📥 CSV exported', 'success');
  },

  copyCSV() {
    const trades = state.journal.entries;
    if (trades.length === 0) {
      showToast('⚠️ No trades to copy', 'warning');
      return;
    }

    const headers = ['Date', 'Ticker', 'Entry', 'Stop', 'Shares', 'Risk $', 'Status', 'P&L'];
    const rows = trades.map(t => [
      new Date(t.timestamp).toLocaleDateString(),
      t.ticker,
      t.entry,
      t.stop,
      t.shares,
      t.riskDollars?.toFixed(2) || '',
      t.status,
      t.pnl?.toFixed(2) || ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    navigator.clipboard.writeText(csv).then(() => {
      showToast('📋 CSV copied to clipboard', 'success');
    }).catch(() => {
      showToast('❌ Failed to copy', 'error');
    });
  },

  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
