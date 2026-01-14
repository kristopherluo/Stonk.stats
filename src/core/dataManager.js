/**
 * DataManager - Handles data import/export and backup operations
 */

import { state } from './state.js';
import { showToast } from '../components/ui/ui.js';
import { priceTracker } from './priceTracker.js';
import { historicalPrices } from './historicalPrices.js';

// These will be set after modules are initialized to avoid circular dependencies
let settingsModule = null;
let calculatorModule = null;
let journalModule = null;
let clearDataModalModule = null;

export const dataManager = {
  // Set module references after initialization
  setModules(settings, calculator, journal, clearDataModal) {
    settingsModule = settings;
    calculatorModule = calculator;
    journalModule = journal;
    clearDataModalModule = clearDataModal;
  },

  exportAllData() {
    const data = {
      version: 3,
      exportDate: new Date().toISOString(),
      settings: state.settings,
      journal: state.journal.entries,
      journalMeta: state.state.journalMeta,
      cashFlow: state.state.cashFlow,
      account: {
        realizedPnL: state.account.realizedPnL
      },
      apiKeys: {
        finnhub: localStorage.getItem('finnhubApiKey') || '',
        twelveData: localStorage.getItem('twelveDataApiKey') || '',
        alphaVantage: localStorage.getItem('alphaVantageApiKey') || ''
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
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);

          if (!data.settings || !data.journal) {
            showToast('❌ Invalid backup file format', 'error');
            return;
          }

          // Write everything to localStorage immediately
          localStorage.setItem('riskCalcSettings', JSON.stringify(data.settings));
          localStorage.setItem('riskCalcJournal', JSON.stringify(data.journal || []));

          if (data.journalMeta) {
            localStorage.setItem('riskCalcJournalMeta', JSON.stringify(data.journalMeta));
          }

          // Always write cash flow, even if missing (set to default)
          const cashFlowData = data.cashFlow || {
            transactions: [],
            totalDeposits: 0,
            totalWithdrawals: 0
          };
          localStorage.setItem('riskCalcCashFlow', JSON.stringify(cashFlowData));

          // Restore API keys - always set them even if empty to overwrite existing
          if (data.apiKeys) {
            localStorage.setItem('finnhubApiKey', data.apiKeys.finnhub || '');
            localStorage.setItem('twelveDataApiKey', data.apiKeys.twelveData || '');
            localStorage.setItem('alphaVantageApiKey', data.apiKeys.alphaVantage || '');
          } else if (data.apiKey) {
            // Legacy support (version 1)
            localStorage.setItem('finnhubApiKey', data.apiKey);
            localStorage.setItem('twelveDataApiKey', '');
            localStorage.setItem('alphaVantageApiKey', '');
          }

          showToast(`📤 Imported ${data.journal.length} trades - Reloading...`, 'success');

          // Reload page after short delay to ensure all localStorage writes complete
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

  confirmClearAllData() {
    // Clear localStorage
    localStorage.removeItem('riskCalcSettings');
    localStorage.removeItem('riskCalcJournal');
    localStorage.removeItem('riskCalcJournalMeta');
    localStorage.removeItem('riskCalcCashFlow');
    localStorage.removeItem('historicalPriceCache');
    localStorage.removeItem('eodCache'); // EOD cache for equity curve
    localStorage.removeItem('companyDataCache'); // Company profile cache
    localStorage.removeItem('chartDataCache'); // TradingView chart cache

    // Clear API keys from localStorage
    localStorage.removeItem('finnhubApiKey');
    localStorage.removeItem('twelveDataApiKey');
    localStorage.removeItem('alphaVantageApiKey');

    // Clear API keys from service objects
    priceTracker.setApiKey('');
    historicalPrices.setApiKey('');

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

    // Save the reset state to localStorage so it persists
    state.saveSettings();
    state.saveJournal();
    state.saveJournalMeta();
    state.saveCashFlow();

    // Refresh UI
    if (settingsModule) settingsModule.loadAndApply();
    if (calculatorModule) calculatorModule.calculate();
    if (journalModule) journalModule.render();

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

    const headers = ['Date', 'Ticker', 'Entry', 'Stop', 'Target', 'Shares', 'Position Size', 'Risk $', 'Risk %', 'Status', 'Exit Price', 'P&L', 'Notes'];
    const rows = trades.map(t => [
      new Date(t.timestamp).toLocaleDateString(),
      t.ticker,
      t.entry,
      t.stop,
      t.target || '',
      t.shares,
      t.positionSize?.toFixed(2) || '',
      t.riskDollars?.toFixed(2) || '',
      t.riskPercent,
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
