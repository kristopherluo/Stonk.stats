/**
 * Settings - Settings panel and configuration
 */

import { state } from '../../core/state.js';
import { parseNumber, formatCurrency, formatWithCommas } from '../../core/utils.js';
import { showToast } from '../../components/ui/ui.js';
import { dataManager } from '../../core/dataManager.js';
import { clearDataModal } from '../../components/modals/clearDataModal.js';
import { priceTracker } from '../../core/priceTracker.js';
import { historicalPrices } from '../../core/historicalPrices.js';

class Settings {
  constructor() {
    this.elements = {};
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.loadAndApply();

    // Listen for account changes
    state.on('accountSizeChanged', (size) => {
      const unrealizedPnL = this.updateAccountDisplay(size);
      this.updateSummary(unrealizedPnL);
    });

    // Listen for price updates to refresh header with unrealized P&L
    state.on('pricesUpdated', () => {
      const unrealizedPnL = this.updateAccountDisplay(state.account.currentSize);
      this.updateSummary(unrealizedPnL);
    });

    // Listen for journal changes to refresh unrealized P&L
    state.on('journalEntryAdded', () => {
      const unrealizedPnL = this.updateAccountDisplay(state.account.currentSize);
      this.updateSummary(unrealizedPnL);
    });
    state.on('journalEntryUpdated', () => {
      const unrealizedPnL = this.updateAccountDisplay(state.account.currentSize);
      this.updateSummary(unrealizedPnL);
    });
    state.on('journalEntryDeleted', () => {
      const unrealizedPnL = this.updateAccountDisplay(state.account.currentSize);
      this.updateSummary(unrealizedPnL);
    });

    // Listen for cash flow changes
    state.on('cashFlowChanged', () => {
      const unrealizedPnL = this.updateAccountDisplay(state.account.currentSize);
      this.updateSummary(unrealizedPnL);
    });

    // Listen for settings changes (starting account size)
    state.on('settingsChanged', () => {
      const unrealizedPnL = this.updateAccountDisplay(state.account.currentSize);
      this.updateSummary(unrealizedPnL);
    });
  }

  cacheElements() {
    this.elements = {
      // Panel
      settingsPanel: document.getElementById('settingsPanel'),
      settingsOverlay: document.getElementById('settingsOverlay'),
      settingsBtn: document.getElementById('settingsBtn'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),

      // Settings inputs
      settingsAccountSize: document.getElementById('settingsAccountSize'),
      dynamicAccountToggle: document.getElementById('dynamicAccountToggle'),
      resetAccountBtn: document.getElementById('resetAccountBtn'),

      // Price tracking
      finnhubApiKey: document.getElementById('finnhubApiKey'),
      finnhubApiKeyBtn: document.getElementById('finnhubApiKeyBtn'),
      twelveDataApiKey: document.getElementById('twelveDataApiKey'),
      twelveDataApiKeyBtn: document.getElementById('twelveDataApiKeyBtn'),
      alphaVantageApiKey: document.getElementById('alphaVantageApiKey'),
      alphaVantageApiKeyBtn: document.getElementById('alphaVantageApiKeyBtn'),

      // Data management buttons
      exportDataBtn: document.getElementById('exportDataBtn'),
      importDataBtn: document.getElementById('importDataBtn'),
      clearDataBtn: document.getElementById('clearDataBtn'),

      // Cash Flow
      cashFlowNet: document.getElementById('cashFlowNet'),
      cashFlowDeposits: document.getElementById('cashFlowDeposits'),
      cashFlowWithdrawals: document.getElementById('cashFlowWithdrawals'),
      depositAmount: document.getElementById('depositAmount'),
      withdrawAmount: document.getElementById('withdrawAmount'),
      depositBtn: document.getElementById('depositBtn'),
      withdrawBtn: document.getElementById('withdrawBtn'),
      cashFlowHistory: document.getElementById('cashFlowHistory'),

      // Summary
      summaryStarting: document.getElementById('summaryStarting'),
      summaryPnL: document.getElementById('summaryPnL'),
      summaryUnrealized: document.getElementById('summaryUnrealized'),
      summaryCashFlow: document.getElementById('summaryCashFlow'),
      summaryCurrent: document.getElementById('summaryCurrent'),

      // Main calculator inputs
      accountSize: document.getElementById('accountSize'),

      // Header
      headerAccountValue: document.querySelector('.header__account-value')
    };
  }

  bindEvents() {
    // Open/close
    if (this.elements.settingsBtn) {
      this.elements.settingsBtn.addEventListener('click', () => this.open());
    }
    if (this.elements.closeSettingsBtn) {
      this.elements.closeSettingsBtn.addEventListener('click', () => this.close());
    }
    if (this.elements.settingsOverlay) {
      this.elements.settingsOverlay.addEventListener('click', () => this.close());
    }

    // Settings account size with K/M instant conversion
    if (this.elements.settingsAccountSize) {
      const syncAccountSize = (value) => {
        state.updateSettings({ startingAccountSize: value });

        // Calculate new current size: starting + realized P&L + net cash flow
        // Note: unrealized P&L should NOT be included in account.currentSize
        const realizedPnL = state.account.realizedPnL;
        const netCashFlow = state.getCashFlowNet();

        const newCurrentSize = value + realizedPnL + netCashFlow;

        state.updateAccount({ currentSize: newCurrentSize });
        this.updateSummary();
        // Sync to Quick Settings field
        if (this.elements.accountSize) {
          this.elements.accountSize.value = formatWithCommas(newCurrentSize);
        }
        this.updateAccountDisplay(newCurrentSize);
        state.emit('accountSizeChanged', newCurrentSize);
      };

      this.elements.settingsAccountSize.addEventListener('input', (e) => {
        const inputValue = e.target.value.trim();

        // Instant format when K/M notation is used
        if (inputValue && (inputValue.toLowerCase().includes('k') || inputValue.toLowerCase().includes('m'))) {
          const converted = parseNumber(inputValue);
          if (converted !== null) {
            const cursorPosition = e.target.selectionStart;
            const originalLength = e.target.value.length;
            e.target.value = formatWithCommas(converted);
            const newLength = e.target.value.length;
            const newCursorPosition = Math.max(0, cursorPosition + (newLength - originalLength));
            e.target.setSelectionRange(newCursorPosition, newCursorPosition);
            syncAccountSize(converted);
          }
        }
      });

      this.elements.settingsAccountSize.addEventListener('blur', (e) => {
        const value = parseNumber(e.target.value);
        if (value) {
          e.target.value = formatWithCommas(value);
          syncAccountSize(value);
        }
      });

      this.elements.settingsAccountSize.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = parseNumber(e.target.value);
          if (value) {
            e.target.value = formatWithCommas(value);
            syncAccountSize(value);
          }
          e.target.blur();
        }
      });
    }

    // Dynamic account toggle
    if (this.elements.dynamicAccountToggle) {
      this.elements.dynamicAccountToggle.addEventListener('change', (e) => {
        state.updateSettings({ dynamicAccountEnabled: e.target.checked });
      });
    }

    // Finnhub API Key
    if (this.elements.finnhubApiKey && this.elements.finnhubApiKeyBtn) {
      const saveApiKey = (apiKey) => {
        priceTracker.setApiKey(apiKey);
        if (apiKey) {
          showToast('✅ Finnhub API key saved - prices will auto-refresh on Positions page', 'success');
        }
      };

      // Button click handler
      this.elements.finnhubApiKeyBtn.addEventListener('click', () => {
        const apiKey = this.elements.finnhubApiKey.value.trim();
        saveApiKey(apiKey);
      });

      // Enter key handler
      this.elements.finnhubApiKey.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const apiKey = e.target.value.trim();
          saveApiKey(apiKey);
          this.elements.finnhubApiKeyBtn.focus();
        }
      });
    }

    // Twelve Data API Key
    if (this.elements.twelveDataApiKey && this.elements.twelveDataApiKeyBtn) {
      const saveTwelveDataKey = (apiKey) => {
        localStorage.setItem('twelveDataApiKey', apiKey);
        historicalPrices.setApiKey(apiKey);
        if (apiKey) {
          showToast('✅ Twelve Data API key saved - 800 calls/day for charts!', 'success');
        }
      };

      // Button click handler
      this.elements.twelveDataApiKeyBtn.addEventListener('click', () => {
        const apiKey = this.elements.twelveDataApiKey.value.trim();
        saveTwelveDataKey(apiKey);
      });

      // Enter key handler
      this.elements.twelveDataApiKey.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const apiKey = e.target.value.trim();
          saveTwelveDataKey(apiKey);
          this.elements.twelveDataApiKeyBtn.focus();
        }
      });
    }

    // Alpha Vantage API Key
    if (this.elements.alphaVantageApiKey && this.elements.alphaVantageApiKeyBtn) {
      const saveAlphaVantageKey = (apiKey) => {
        localStorage.setItem('alphaVantageApiKey', apiKey);
        if (apiKey) {
          showToast('✅ Alpha Vantage API key saved - 25 calls/day for company descriptions!', 'success');
        }
      };

      // Button click handler
      this.elements.alphaVantageApiKeyBtn.addEventListener('click', () => {
        const apiKey = this.elements.alphaVantageApiKey.value.trim();
        saveAlphaVantageKey(apiKey);
      });

      // Enter key handler
      this.elements.alphaVantageApiKey.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const apiKey = e.target.value.trim();
          saveAlphaVantageKey(apiKey);
          this.elements.alphaVantageApiKeyBtn.focus();
        }
      });
    }

    // Reset account
    if (this.elements.resetAccountBtn) {
      this.elements.resetAccountBtn.addEventListener('click', () => this.resetAccount());
    }

    // Cash Flow: Deposit
    if (this.elements.depositBtn) {
      this.elements.depositBtn.addEventListener('click', () => this.handleDeposit());
    }
    if (this.elements.depositAmount) {
      this.elements.depositAmount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleDeposit();
        }
      });
    }

    // Cash Flow: Withdraw
    if (this.elements.withdrawBtn) {
      this.elements.withdrawBtn.addEventListener('click', () => this.handleWithdraw());
    }
    if (this.elements.withdrawAmount) {
      this.elements.withdrawAmount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleWithdraw();
        }
      });
    }

    // Data management buttons
    if (this.elements.exportDataBtn) {
      this.elements.exportDataBtn.addEventListener('click', () => dataManager.exportAllData());
    }
    if (this.elements.importDataBtn) {
      this.elements.importDataBtn.addEventListener('click', () => dataManager.importData());
    }
    if (this.elements.clearDataBtn) {
      this.elements.clearDataBtn.addEventListener('click', () => clearDataModal.open());
    }
  }

  loadAndApply() {
    // Load saved settings
    state.loadSettings();
    state.loadJournal();
    state.loadJournalMeta();
    state.loadCashFlow();

    // Migrate existing journal entries to new schema
    state.migrateJournalEntries();

    // Apply theme
    const theme = state.settings.theme || 'dark';
    document.documentElement.dataset.theme = theme;

    // Apply to settings panel
    if (this.elements.settingsAccountSize) {
      this.elements.settingsAccountSize.value = formatWithCommas(state.settings.startingAccountSize);
    }
    if (this.elements.dynamicAccountToggle) {
      this.elements.dynamicAccountToggle.checked = state.settings.dynamicAccountEnabled;
    }

    // Apply to main calculator
    if (this.elements.accountSize) {
      this.elements.accountSize.value = formatWithCommas(state.account.currentSize);
    }

    // Load API keys
    const finnhubKey = localStorage.getItem('finnhubApiKey') || '';
    if (this.elements.finnhubApiKey) {
      this.elements.finnhubApiKey.value = finnhubKey;
    }

    const twelveDataKey = localStorage.getItem('twelveDataApiKey') || '';
    if (this.elements.twelveDataApiKey) {
      this.elements.twelveDataApiKey.value = twelveDataKey;
    }
    // Load API key into historicalPrices
    if (twelveDataKey) {
      historicalPrices.setApiKey(twelveDataKey);
    }

    const alphaVantageKey = localStorage.getItem('alphaVantageApiKey') || '';
    if (this.elements.alphaVantageApiKey) {
      this.elements.alphaVantageApiKey.value = alphaVantageKey;
    }

    // Update header
    this.updateAccountDisplay(state.account.currentSize);

    // Update cash flow display
    this.updateCashFlowDisplay();
  }

  open() {
    this.elements.settingsPanel?.classList.add('open');
    this.elements.settingsOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
    state.setUI('settingsOpen', true);
    this.updateSummary();
  }

  close() {
    this.elements.settingsPanel?.classList.remove('open');
    this.elements.settingsOverlay?.classList.remove('open');
    document.body.style.overflow = '';
    state.setUI('settingsOpen', false);
  }

  updateSummary(cachedUnrealizedPnL = null) {
    const starting = state.settings.startingAccountSize;
    const realizedPnL = state.account.realizedPnL;
    const cashFlow = state.getCashFlowNet();

    // Use cached unrealized P&L if provided, otherwise calculate
    let unrealizedPnL = 0;
    if (cachedUnrealizedPnL !== null) {
      unrealizedPnL = cachedUnrealizedPnL;
    } else {
      const allOpenTrades = state.journal.entries.filter(e => e.status === 'open' || e.status === 'trimmed');
      const unrealizedPnLData = priceTracker.calculateTotalUnrealizedPnL(allOpenTrades);
      unrealizedPnL = unrealizedPnLData?.totalPnL || 0;
    }

    const current = starting + realizedPnL + unrealizedPnL + cashFlow;

    if (this.elements.summaryStarting) {
      this.elements.summaryStarting.textContent = formatCurrency(starting);
    }

    if (this.elements.summaryPnL) {
      this.elements.summaryPnL.textContent = (realizedPnL >= 0 ? '+' : '') + formatCurrency(realizedPnL);
      this.elements.summaryPnL.className = 'account-summary__value ' +
        (realizedPnL >= 0 ? 'account-summary__value--success' : 'account-summary__value--danger');
    }

    if (this.elements.summaryUnrealized) {
      this.elements.summaryUnrealized.textContent = (unrealizedPnL >= 0 ? '+' : '') + formatCurrency(unrealizedPnL);
      this.elements.summaryUnrealized.className = 'account-summary__value ' +
        (unrealizedPnL >= 0 ? 'account-summary__value--success' : 'account-summary__value--danger');
    }

    if (this.elements.summaryCashFlow) {
      this.elements.summaryCashFlow.textContent = (cashFlow >= 0 ? '+' : '') + formatCurrency(cashFlow);
      this.elements.summaryCashFlow.className = 'account-summary__value ' +
        (cashFlow >= 0 ? 'account-summary__value--success' : 'account-summary__value--danger');
    }

    if (this.elements.summaryCurrent) {
      this.elements.summaryCurrent.textContent = formatCurrency(current);
    }
  }

  updateAccountDisplay(size) {
    // Calculate total account from components to avoid double-counting
    const starting = state.settings.startingAccountSize;
    const realizedPnL = state.account.realizedPnL;
    const cashFlow = state.getCashFlowNet();

    // Get current unrealized P&L from open positions
    const allOpenTrades = state.journal.entries.filter(e => e.status === 'open' || e.status === 'trimmed');
    const unrealizedPnLData = priceTracker.calculateTotalUnrealizedPnL(allOpenTrades);
    const unrealizedPnL = unrealizedPnLData?.totalPnL || 0;

    // Calculate total: starting + realized + unrealized + cash flow
    const totalAccount = starting + realizedPnL + unrealizedPnL + cashFlow;

    if (this.elements.headerAccountValue) {
      const newText = formatCurrency(totalAccount);
      if (this.elements.headerAccountValue.textContent !== newText) {
        this.elements.headerAccountValue.textContent = newText;
        this.flashHeaderAccount();
      }
    }

    if (this.elements.accountSize) {
      this.elements.accountSize.value = formatWithCommas(totalAccount);
    }

    // Return unrealized P&L to avoid recalculating in updateSummary
    return unrealizedPnL;
  }

  flashHeaderAccount() {
    this.elements.headerAccountValue?.classList.add('updated');
    setTimeout(() => {
      this.elements.headerAccountValue?.classList.remove('updated');
    }, 500);
  }

  resetAccount() {
    state.updateAccount({
      realizedPnL: 0,
      currentSize: state.settings.startingAccountSize
    });

    this.updateAccountDisplay(state.account.currentSize);
    this.updateSummary();

    // Emit for calculator to recalculate
    state.emit('accountSizeChanged', state.account.currentSize);

    showToast('🔄 Account reset to starting balance', 'success');
  }

  handleDeposit() {
    if (!this.elements.depositAmount) return;

    const amount = parseNumber(this.elements.depositAmount.value);
    if (!amount || amount <= 0) {
      showToast('⚠️ Please enter a valid deposit amount', 'warning');
      return;
    }

    state.addCashFlowTransaction('deposit', amount);
    this.elements.depositAmount.value = '';
    this.updateSummary();
    showToast(`✅ Deposited ${formatCurrency(amount)}`, 'success');
  }

  handleWithdraw() {
    if (!this.elements.withdrawAmount) return;

    const amount = parseNumber(this.elements.withdrawAmount.value);
    if (!amount || amount <= 0) {
      showToast('⚠️ Please enter a valid withdrawal amount', 'warning');
      return;
    }

    state.addCashFlowTransaction('withdrawal', amount);
    this.elements.withdrawAmount.value = '';
    this.updateSummary();
    showToast(`✅ Withdrew ${formatCurrency(amount)}`, 'success');
  }

  updateCashFlowDisplay() {
    const cashFlow = state.state.cashFlow;
    const netCashFlow = state.getCashFlowNet();

    // Update summary values
    if (this.elements.cashFlowNet) {
      this.elements.cashFlowNet.textContent = formatCurrency(netCashFlow);
      this.elements.cashFlowNet.style.color = netCashFlow >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    if (this.elements.cashFlowDeposits) {
      this.elements.cashFlowDeposits.textContent = formatCurrency(cashFlow.totalDeposits);
    }

    if (this.elements.cashFlowWithdrawals) {
      this.elements.cashFlowWithdrawals.textContent = formatCurrency(cashFlow.totalWithdrawals);
    }

    // Update transaction history
    this.renderCashFlowHistory();
  }

  renderCashFlowHistory() {
    if (!this.elements.cashFlowHistory) return;

    const transactions = state.state.cashFlow.transactions;

    if (transactions.length === 0) {
      this.elements.cashFlowHistory.innerHTML = '';
      return;
    }

    const maxShow = 5; // Show latest 5 transactions
    const recentTransactions = transactions.slice(0, maxShow);

    const historyHTML = `
      <div class="cash-flow-history__title">Recent Transactions</div>
      <div class="cash-flow-history__list">
        ${recentTransactions.map(t => `
          <div class="cash-flow-transaction">
            <div class="cash-flow-transaction__info">
              <span class="cash-flow-transaction__type cash-flow-transaction__type--${t.type}">
                ${t.type === 'deposit' ? '↑ Deposit' : '↓ Withdrawal'}
              </span>
              <span class="cash-flow-transaction__date">${this.formatTransactionDate(t.timestamp)}</span>
            </div>
            <span class="cash-flow-transaction__amount">
              ${t.type === 'deposit' ? '+' : '-'}${formatCurrency(t.amount)}
            </span>
          </div>
        `).join('')}
      </div>
    `;

    this.elements.cashFlowHistory.innerHTML = historyHTML;
  }

  formatTransactionDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

export const settings = new Settings();
export { Settings };
