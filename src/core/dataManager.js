/**
 * DataManager - Handles data import/export and backup operations
 */

import { state } from './state.js';
import { showToast } from '../components/ui/ui.js';
import { priceTracker } from './priceTracker.js';
import { historicalPricesBatcher } from '../features/stats/HistoricalPricesBatcher.js';
import { equityCurveManager } from '../features/stats/EquityCurveManager.js';
import eodCacheManager from './eodCacheManager.js';
import { sharedMetrics } from '../shared/SharedMetrics.js';
import { storage } from '../utils/storage.js';

// These will be set after modules are initialized to avoid circular dependencies
let settingsModule = null;
let calculatorModule = null;
let journalModule = null;
let clearDataModalModule = null;
let statsModule = null;
let equityChartModule = null;
let positionsViewModule = null;
let journalViewModule = null;

export const dataManager = {
  // Set module references after initialization
  setModules(settings, calculator, journal, clearDataModal, stats, equityChart, positionsView, journalView) {
    settingsModule = settings;
    calculatorModule = calculator;
    journalModule = journal;
    clearDataModalModule = clearDataModal;
    statsModule = stats;
    equityChartModule = equityChart;
    positionsViewModule = positionsView;
    journalViewModule = journalView;
  },

  async exportAllData() {
    const data = {
      version: 3,
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

          // Write everything directly to IndexedDB
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

          // Clear EOD cache after import (imported trades may have different dates)
          await storage.removeItem('eodCache');
          await storage.removeItem('riskCalcPriceCache');

          showToast(`📤 Imported ${data.journal.length} trades - Reloading...`, 'success');

          // Reload page after short delay to ensure all IndexedDB writes complete
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          console.error('Import error:', err);
          showToast('❌ Failed to import data', 'error');
        }
      };
      reader.readAsText(file);
    });

    input.click();
  },

  clearAllData() {
    if (clearDataModalModule) clearDataModalModule.open();
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
    historicalPricesBatcher.setApiKey('');

    // Clear price tracker cache
    priceTracker.cache.clear();

    // Clear EOD cache
    await eodCacheManager.clearAllData();

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
    if (settingsModule) {
      await settingsModule.loadAndApply();
      settingsModule.updateAccountDisplay(state.account.currentSize);
    }
    if (calculatorModule) calculatorModule.calculate();
    if (journalModule) journalModule.render();
    if (journalViewModule) journalViewModule.render();
    if (positionsViewModule) positionsViewModule.render();
    if (statsModule) await statsModule.refresh();
    if (equityChartModule) equityChartModule.init();

    // Emit state change events to update any other listeners
    state.emit('accountSizeChanged', state.account.currentSize);
    state.emit('journalChanged', state.journal.entries);
    state.emit('cashFlowChanged', state.cashFlow);

    if (clearDataModalModule) clearDataModalModule.close();
    showToast('🗑️ All data cleared', 'success');
    console.log('All data cleared - reset to defaults');
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
