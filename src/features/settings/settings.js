/**
 * Settings - Settings panel and configuration
 */

import { state } from '../../core/state.js';
import { parseNumber, formatCurrency, formatWithCommas, initFlatpickr, getCurrentWeekday, restrictToNumberInput, formatDate } from '../../core/utils.js';
import { showToast } from '../../components/ui/ui.js';
import { dataManager } from '../../core/dataManager.js';
import { clearDataModal } from '../../components/modals/clearDataModal.js';
import { priceTracker } from '../../core/priceTracker.js';
import { historicalPricesBatcher } from '../stats/HistoricalPricesBatcher.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';
import { getStorageUsage, formatBytes, getStorageBreakdownPercent } from '../../utils/storageMonitor.js';
import { storage } from '../../utils/storage.js';
import eodCacheManager from '../../core/eodCacheManager.js';

class Settings {
  constructor() {
    this.elements = {};
    // Store flatpickr instances
    this.depositDatePicker = null;
    this.withdrawDatePicker = null;
    // Store previous valid starting account size
    this.previousValidAccountSize = null;
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    this.initializeDatePickers();
    this.setupNumberRestrictions();
    await this.loadAndApply();
    await this.updateStorageMonitor();

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
      settingsAccountSizeError: document.getElementById('settingsAccountSizeError'),

      // Price tracking
      finnhubApiKey: document.getElementById('finnhubApiKey'),
      finnhubApiKeyBtn: document.getElementById('finnhubApiKeyBtn'),
      twelveDataApiKey: document.getElementById('twelveDataApiKey'),
      twelveDataApiKeyBtn: document.getElementById('twelveDataApiKeyBtn'),
      alphaVantageApiKey: document.getElementById('alphaVantageApiKey'),
      alphaVantageApiKeyBtn: document.getElementById('alphaVantageApiKeyBtn'),
      optionsPriceApiKey: document.getElementById('optionsPriceApiKey'),
      optionsPriceApiKeyBtn: document.getElementById('optionsPriceApiKeyBtn'),

      // Data management buttons
      exportDataBtn: document.getElementById('exportDataBtn'),
      importDataBtn: document.getElementById('importDataBtn'),
      clearDataBtn: document.getElementById('clearDataBtn'),

      // Cash Flow
      cashFlowNet: document.getElementById('cashFlowNet'),
      cashFlowDeposits: document.getElementById('cashFlowDeposits'),
      cashFlowWithdrawals: document.getElementById('cashFlowWithdrawals'),
      depositAmount: document.getElementById('depositAmount'),
      depositAmountError: document.getElementById('depositAmountError'),
      depositDate: document.getElementById('depositDate'),
      depositBtn: document.getElementById('depositBtn'),
      withdrawAmount: document.getElementById('withdrawAmount'),
      withdrawAmountError: document.getElementById('withdrawAmountError'),
      withdrawDate: document.getElementById('withdrawDate'),
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
        // Only sync if value is valid (> 0)
        if (value <= 0) {
          return false;
        }

        state.updateSettings({ startingAccountSize: value });

        this.updateSummary();

        // Sync to Quick Settings field (now reads computed value)
        if (this.elements.accountSize) {
          this.elements.accountSize.value = formatWithCommas(state.currentSize);
        }

        this.updateAccountDisplay(state.currentSize);
        state.emit('accountSizeChanged', state.currentSize);

        // Store as previous valid value
        this.previousValidAccountSize = value;
        return true;
      };

      // Real-time sanitization and validation
      this.elements.settingsAccountSize.addEventListener('input', (e) => {
        // Sanitize and validate as user types
        this.sanitizeAccountSizeInput(e);

        const inputValue = e.target.value.trim();

        // Instant format when K/M notation is used
        if (inputValue && (inputValue.toLowerCase().includes('k') || inputValue.toLowerCase().includes('m'))) {
          const converted = parseNumber(inputValue);
          if (converted !== null && converted > 0) {
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
        if (value && value > 0) {
          e.target.value = formatWithCommas(value);
          syncAccountSize(value);
        } else if (value && value <= 0) {
          // Show error if value is <= 0
          this.showInputError(
            this.elements.settingsAccountSize,
            this.elements.settingsAccountSizeError,
            'Starting account balance must be greater than 0'
          );
        }
      });

      this.elements.settingsAccountSize.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = parseNumber(e.target.value);
          if (value && value > 0) {
            e.target.value = formatWithCommas(value);
            syncAccountSize(value);
            this.clearInputError(this.elements.settingsAccountSize, this.elements.settingsAccountSizeError);
          } else if (value && value <= 0) {
            // Show error if value is <= 0
            this.showInputError(
              this.elements.settingsAccountSize,
              this.elements.settingsAccountSizeError,
              'Starting account balance must be greater than 0'
            );
          }
          e.target.blur();
        }
      });
    }

    // Finnhub API Key
    if (this.elements.finnhubApiKey && this.elements.finnhubApiKeyBtn) {
      const saveApiKey = async (apiKey) => {
        await priceTracker.setApiKey(apiKey);
        if (apiKey) {
          // Update button to active state
          this.setApiKeyButtonActive(this.elements.finnhubApiKeyBtn);
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

      // Re-enable button when input changes
      this.elements.finnhubApiKey.addEventListener('input', () => {
        this.setApiKeyButtonInactive(this.elements.finnhubApiKeyBtn);
      });
    }

    // Twelve Data API Key
    if (this.elements.twelveDataApiKey && this.elements.twelveDataApiKeyBtn) {
      const saveTwelveDataKey = async (apiKey) => {
        await storage.setItem('twelveDataApiKey', apiKey);
        historicalPricesBatcher.setApiKey(apiKey);
        if (apiKey) {
          // Update button to active state
          this.setApiKeyButtonActive(this.elements.twelveDataApiKeyBtn);
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

      // Re-enable button when input changes
      this.elements.twelveDataApiKey.addEventListener('input', () => {
        this.setApiKeyButtonInactive(this.elements.twelveDataApiKeyBtn);
      });
    }

    // Alpha Vantage API Key
    if (this.elements.alphaVantageApiKey && this.elements.alphaVantageApiKeyBtn) {
      const saveAlphaVantageKey = async (apiKey) => {
        await storage.setItem('alphaVantageApiKey', apiKey);
        if (apiKey) {
          // Update button to active state
          this.setApiKeyButtonActive(this.elements.alphaVantageApiKeyBtn);
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

      // Re-enable button when input changes
      this.elements.alphaVantageApiKey.addEventListener('input', () => {
        this.setApiKeyButtonInactive(this.elements.alphaVantageApiKeyBtn);
      });
    }

    // Options Price API Key
    if (this.elements.optionsPriceApiKey && this.elements.optionsPriceApiKeyBtn) {
      const saveOptionsPriceKey = async (apiKey) => {
        await storage.setItem('optionsPriceApiKey', apiKey);
        // TODO: Set API key in options price tracker when implemented
        if (apiKey) {
          showToast('Options API key saved', 'success');
          this.setApiKeyButtonActive(this.elements.optionsPriceApiKeyBtn);
        }
      };

      // Button click handler
      this.elements.optionsPriceApiKeyBtn.addEventListener('click', () => {
        const apiKey = this.elements.optionsPriceApiKey.value.trim();
        saveOptionsPriceKey(apiKey);
      });

      // Enter key handler
      this.elements.optionsPriceApiKey.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const apiKey = e.target.value.trim();
          saveOptionsPriceKey(apiKey);
          this.elements.optionsPriceApiKeyBtn.focus();
        }
      });

      // Re-enable button when input changes
      this.elements.optionsPriceApiKey.addEventListener('input', () => {
        this.setApiKeyButtonInactive(this.elements.optionsPriceApiKeyBtn);
      });
    }

    // Cash Flow: Deposit
    if (this.elements.depositAmount) {
      // Real-time validation
      this.elements.depositAmount.addEventListener('input', (e) => this.sanitizeDepositInput(e));
    }
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
    if (this.elements.withdrawAmount) {
      // Real-time validation
      this.elements.withdrawAmount.addEventListener('input', (e) => this.sanitizeWithdrawInput(e));
    }
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

  initializeDatePickers() {
    // Initialize deposit date picker
    if (this.elements.depositDate) {
      this.depositDatePicker = initFlatpickr(this.elements.depositDate, {
        defaultDate: getCurrentWeekday(),  // Default to today or recent weekday
        onChange: (selectedDates, dateStr, instance) => {
          // Optional: Add visual feedback when date changes
          this.elements.depositDate.classList.add('has-value');
        }
      });
    }

    // Initialize withdraw date picker
    if (this.elements.withdrawDate) {
      this.withdrawDatePicker = initFlatpickr(this.elements.withdrawDate, {
        defaultDate: getCurrentWeekday(),
        onChange: (selectedDates, dateStr, instance) => {
          this.elements.withdrawDate.classList.add('has-value');
        }
      });
    }
  }

  setupNumberRestrictions() {
    // Restrict all $ amount inputs to numbers and decimals only
    restrictToNumberInput(this.elements.settingsAccountSize, true);
    restrictToNumberInput(this.elements.depositAmount, true);
    restrictToNumberInput(this.elements.withdrawAmount, true);
  }

  async loadAndApply() {
    // Initialize async storage managers
    await eodCacheManager.init();
    await historicalPricesBatcher.init();

    // Load saved settings (async with IndexedDB)
    await state.loadSettings();
    await state.loadJournal();
    await state.loadJournalMeta();
    await state.loadCashFlow();

    // Apply theme
    const theme = state.settings.theme || 'dark';
    document.documentElement.dataset.theme = theme;

    // Apply to settings panel
    if (this.elements.settingsAccountSize) {
      this.elements.settingsAccountSize.value = formatWithCommas(state.settings.startingAccountSize);
    }

    // Apply to main calculator
    if (this.elements.accountSize) {
      this.elements.accountSize.value = formatWithCommas(state.account.currentSize);
    }

    // Load API keys
    const finnhubKey = (await storage.getItem('finnhubApiKey')) || '';
    if (this.elements.finnhubApiKey) {
      this.elements.finnhubApiKey.value = finnhubKey;
    }
    // Set Finnhub key in priceTracker and activate button if key exists
    if (finnhubKey) {
      await priceTracker.setApiKey(finnhubKey);
      this.setApiKeyButtonActive(this.elements.finnhubApiKeyBtn);
    }

    const twelveDataKey = (await storage.getItem('twelveDataApiKey')) || '';
    if (this.elements.twelveDataApiKey) {
      this.elements.twelveDataApiKey.value = twelveDataKey;
    }
    // Load API key into batcher
    if (twelveDataKey) {
      historicalPricesBatcher.setApiKey(twelveDataKey);
      this.setApiKeyButtonActive(this.elements.twelveDataApiKeyBtn);
    }

    const alphaVantageKey = (await storage.getItem('alphaVantageApiKey')) || '';
    if (this.elements.alphaVantageApiKey) {
      this.elements.alphaVantageApiKey.value = alphaVantageKey;
    }
    if (alphaVantageKey) {
      this.setApiKeyButtonActive(this.elements.alphaVantageApiKeyBtn);
    }

    const optionsPriceKey = (await storage.getItem('optionsPriceApiKey')) || '';
    if (this.elements.optionsPriceApiKey) {
      this.elements.optionsPriceApiKey.value = optionsPriceKey;
    }
    if (optionsPriceKey) {
      // TODO: Set API key in options price tracker when implemented
      this.setApiKeyButtonActive(this.elements.optionsPriceApiKeyBtn);
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

    // Store current valid starting account size
    this.previousValidAccountSize = state.settings.startingAccountSize;

    // Clear any existing errors
    this.clearInputError(this.elements.settingsAccountSize, this.elements.settingsAccountSizeError);
  }

  close() {
    // Check if current account size value is invalid
    const currentValue = parseNumber(this.elements.settingsAccountSize?.value);

    if (!currentValue || currentValue <= 0) {
      // Restore previous valid value
      if (this.previousValidAccountSize && this.previousValidAccountSize > 0) {
        this.elements.settingsAccountSize.value = formatWithCommas(this.previousValidAccountSize);
        this.clearInputError(this.elements.settingsAccountSize, this.elements.settingsAccountSizeError);
      }
    }

    this.elements.settingsPanel?.classList.remove('open');
    this.elements.settingsOverlay?.classList.remove('open');
    document.body.style.overflow = '';
    state.setUI('settingsOpen', false);
  }

  updateSummary(cachedUnrealizedPnL = null) {
    const starting = state.settings.startingAccountSize;
    const realizedPnL = state.account.realizedPnL; // Use computed property
    const cashFlow = state.getCashFlowNet();

    // Calculate unrealized P&L
    let unrealizedPnL = 0;
    if (cachedUnrealizedPnL !== null) {
      unrealizedPnL = cachedUnrealizedPnL;
    } else {
      const activeTrades = (state.journal?.entries || []).filter(e => e.status === 'open' || e.status === 'trimmed');
      for (const trade of activeTrades) {
        const pnl = priceTracker.calculateUnrealizedPnL(trade);
        if (pnl) {
          unrealizedPnL += pnl.unrealizedPnL;
        }
      }
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
    // Use shared account balance calculator (same logic as Stats page)
    const currentPrices = priceTracker.getPricesAsObject();

    const result = accountBalanceCalculator.calculateCurrentBalance({
      startingBalance: state.settings.startingAccountSize,
      allTrades: state.journal.entries,
      cashFlowTransactions: state.cashFlow.transactions,
      currentPrices
    });

    const totalAccount = result.balance;
    const unrealizedPnL = result.unrealizedPnL;

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

  setAccountLoading(isLoading) {
    if (!this.elements.headerAccountValue) return;

    if (isLoading) {
      this.elements.headerAccountValue.classList.add('animate-pulse');
      this.elements.headerAccountValue.style.opacity = '0.6';
    } else {
      this.elements.headerAccountValue.classList.remove('animate-pulse');
      this.elements.headerAccountValue.style.opacity = '1';
    }
  }

  handleDeposit() {
    if (!this.elements.depositAmount) return;

    // Clear any previous error
    this.clearInputError(this.elements.depositAmount, this.elements.depositAmountError);

    const amount = parseNumber(this.elements.depositAmount.value);
    if (!amount || amount <= 0) {
      this.showInputError(
        this.elements.depositAmount,
        this.elements.depositAmountError,
        'Please enter a valid deposit amount'
      );
      return;
    }

    // Get selected date or default to today
    let selectedDate = new Date();
    if (this.depositDatePicker && this.depositDatePicker.selectedDates.length > 0) {
      selectedDate = this.depositDatePicker.selectedDates[0];
    }

    // Add transaction with custom timestamp
    state.addCashFlowTransaction('deposit', amount, selectedDate.toISOString());

    // Clear inputs and reset date to today
    this.elements.depositAmount.value = '';
    if (this.depositDatePicker) {
      this.depositDatePicker.setDate(getCurrentWeekday());
    }

    this.updateCashFlowDisplay();  // Immediate UI update
    showToast(`✅ Deposited ${formatCurrency(amount)}`, 'success');
  }

  handleWithdraw() {
    if (!this.elements.withdrawAmount) return;

    // Clear any previous error
    this.clearInputError(this.elements.withdrawAmount, this.elements.withdrawAmountError);

    const amount = parseNumber(this.elements.withdrawAmount.value);
    if (!amount || amount <= 0) {
      this.showInputError(
        this.elements.withdrawAmount,
        this.elements.withdrawAmountError,
        'Please enter a valid withdrawal amount'
      );
      return;
    }

    // Get selected date or default to today
    let selectedDate = new Date();
    if (this.withdrawDatePicker && this.withdrawDatePicker.selectedDates.length > 0) {
      selectedDate = this.withdrawDatePicker.selectedDates[0];
    }

    // Add transaction with custom timestamp
    state.addCashFlowTransaction('withdrawal', amount, selectedDate.toISOString());

    // Clear inputs and reset date to today
    this.elements.withdrawAmount.value = '';
    if (this.withdrawDatePicker) {
      this.withdrawDatePicker.setDate(getCurrentWeekday());
    }

    this.updateCashFlowDisplay();  // Immediate UI update
    showToast(`✅ Withdrew ${formatCurrency(amount)}`, 'success');
  }

  handleDeleteTransaction(transactionId) {
    if (!confirm('Delete this transaction? This cannot be undone.')) {
      return;
    }

    const deleted = state.deleteCashFlowTransaction(transactionId);

    if (deleted) {
      const type = deleted.type === 'deposit' ? 'Deposit' : 'Withdrawal';
      showToast(`🗑️ ${type} deleted`, 'success');
      this.updateCashFlowDisplay();  // Immediate UI update
    }
  }

  updateCashFlowDisplay() {
    const cashFlow = state.state.cashFlow;
    const netCashFlow = state.getCashFlowNet();

    // Update summary values
    if (this.elements.cashFlowDeposits) {
      this.elements.cashFlowDeposits.textContent = `+${formatCurrency(cashFlow.totalDeposits)}`;
    }

    if (this.elements.cashFlowWithdrawals) {
      const withdrawalAmount = Math.abs(cashFlow.totalWithdrawals);
      this.elements.cashFlowWithdrawals.textContent = `-${formatCurrency(withdrawalAmount)}`;
    }

    if (this.elements.cashFlowNet) {
      this.elements.cashFlowNet.textContent = formatCurrency(netCashFlow);

      // Color based on value: green if positive, red if negative, white if zero
      this.elements.cashFlowNet.classList.remove('cash-flow-summary__value--success', 'cash-flow-summary__value--danger');
      if (netCashFlow > 0) {
        this.elements.cashFlowNet.classList.add('cash-flow-summary__value--success');
      } else if (netCashFlow < 0) {
        this.elements.cashFlowNet.classList.add('cash-flow-summary__value--danger');
      }
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

    // Show ALL transactions, not just 5
    const historyHTML = `
      <div class="cash-flow-history__title">Recent Transactions</div>
      <div class="cash-flow-history__list">
        ${transactions.map(t => `
          <div class="cash-flow-transaction">
            <div class="cash-flow-transaction__info">
              <span class="cash-flow-transaction__type cash-flow-transaction__type--${t.type}">
                ${t.type === 'deposit' ? '↑ Deposit' : '↓ Withdrawal'}
              </span>
              <span class="cash-flow-transaction__date">${this.formatTransactionDate(t.timestamp)}</span>
            </div>
            <div class="cash-flow-transaction__right">
              <span class="cash-flow-transaction__amount">
                ${t.type === 'deposit' ? '+' : '-'}${formatCurrency(t.amount)}
              </span>
              <button class="btn-icon btn-icon--danger" data-action="delete-transaction" data-id="${t.id}" title="Delete transaction">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"></path>
                </svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.elements.cashFlowHistory.innerHTML = historyHTML;

    // Bind delete button events
    this.elements.cashFlowHistory.querySelectorAll('[data-action="delete-transaction"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        this.handleDeleteTransaction(id);
      });
    });
  }

  formatTransactionDate(timestamp) {
    const date = new Date(timestamp);

    // Format as "Dec 9, 2025"
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();

    return `${month} ${day}, ${year}`;
  }

  setApiKeyButtonActive(button) {
    if (!button) return;

    button.textContent = 'Active';
    button.disabled = true;
    button.classList.add('active');
    // Keep btn--primary for neon/cyberpunk theme instead of solid green
  }

  setApiKeyButtonInactive(button) {
    if (!button) return;

    button.textContent = 'Use Key';
    button.disabled = false;
    button.classList.remove('active');
  }

  /**
   * Show inline error for an input field
   */
  showInputError(inputElement, errorElement, message) {
    if (inputElement) {
      inputElement.classList.add('input--error');
    }
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('input-error--visible');
    }
  }

  /**
   * Clear inline error for an input field
   */
  clearInputError(inputElement, errorElement) {
    if (inputElement) {
      inputElement.classList.remove('input--error');
    }
    if (errorElement) {
      errorElement.classList.remove('input-error--visible');
      errorElement.textContent = '';
    }
  }

  /**
   * Sanitize decimal input - only allow numbers and one decimal point
   */
  sanitizeDecimalInput(e) {
    const input = e.target;
    const originalValue = input.value;
    let value = originalValue;

    // Allow only numbers and one decimal point
    value = value.replace(/[^\d.]/g, '');

    // Allow only one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }

    // Only update if value changed (to avoid triggering another input event)
    if (value !== originalValue) {
      input.value = value;
    }
  }

  /**
   * Sanitize and validate account size input
   */
  sanitizeAccountSizeInput(e) {
    // First apply decimal sanitization
    this.sanitizeDecimalInput(e);

    // Clear error first
    this.clearInputError(this.elements.settingsAccountSize, this.elements.settingsAccountSizeError);

    const value = this.elements.settingsAccountSize?.value.trim();

    // Skip validation if field is empty (will validate on blur/enter)
    if (!value) {
      return;
    }

    // Parse the value (supports K/M notation)
    const parsedValue = parseNumber(value);

    if (parsedValue !== null && parsedValue <= 0) {
      this.showInputError(
        this.elements.settingsAccountSize,
        this.elements.settingsAccountSizeError,
        'Starting account balance must be greater than 0'
      );
    }
  }

  /**
   * Sanitize and validate deposit amount input
   */
  sanitizeDepositInput(e) {
    // First apply decimal sanitization
    this.sanitizeDecimalInput(e);

    // Clear error first
    this.clearInputError(this.elements.depositAmount, this.elements.depositAmountError);

    const value = this.elements.depositAmount?.value.trim();

    // Skip validation if field is empty
    if (!value) {
      return;
    }

    // Parse the value
    const parsedValue = parseNumber(value);

    if (parsedValue !== null && parsedValue <= 0) {
      this.showInputError(
        this.elements.depositAmount,
        this.elements.depositAmountError,
        'Deposit amount must be greater than 0'
      );
    }
  }

  /**
   * Sanitize and validate withdraw amount input
   */
  sanitizeWithdrawInput(e) {
    // First apply decimal sanitization
    this.sanitizeDecimalInput(e);

    // Clear error first
    this.clearInputError(this.elements.withdrawAmount, this.elements.withdrawAmountError);

    const value = this.elements.withdrawAmount?.value.trim();

    // Skip validation if field is empty
    if (!value) {
      return;
    }

    // Parse the value
    const parsedValue = parseNumber(value);

    if (parsedValue !== null && parsedValue <= 0) {
      this.showInputError(
        this.elements.withdrawAmount,
        this.elements.withdrawAmountError,
        'Withdrawal amount must be greater than 0'
      );
    }
  }
  /**
   * Update storage monitor display
   */
  async updateStorageMonitor() {
    const usage = await getStorageUsage();
    const breakdown = await getStorageBreakdownPercent();

    // Update usage text
    const usageText = document.getElementById('storageUsageText');
    if (usageText) {
      usageText.textContent = `${formatBytes(usage.totalUsed)} / ${formatBytes(usage.limit)} (${usage.percentUsed.toFixed(1)}%)`;
    }

    // Update progress bar
    const bar = document.getElementById('storageBar');
    if (bar) {
      bar.style.width = `${Math.min(usage.percentUsed, 100)}%`;
      bar.className = 'storage-monitor__bar';
      if (usage.warningLevel === 'warning') {
        bar.classList.add('warning');
      } else if (usage.warningLevel === 'critical') {
        bar.classList.add('critical');
      }
    }

    // Update warning
    const warning = document.getElementById('storageWarning');
    const warningText = document.getElementById('storageWarningText');
    if (warning && warningText) {
      if (usage.warningLevel !== 'safe') {
        warning.style.display = 'flex';
        if (usage.warningLevel === 'critical') {
          warning.classList.add('critical');
          warningText.textContent = 'Storage critically low! Clear old data to free up space.';
        } else {
          warning.classList.remove('critical');
          warningText.textContent = 'Storage usage is high. Consider clearing old price data.';
        }
      } else {
        warning.style.display = 'none';
      }
    }

    // Update breakdown
    const breakdownEl = document.getElementById('storageBreakdown');
    if (breakdownEl) {
      breakdownEl.innerHTML = Object.entries(breakdown.breakdown)
        .filter(([key, data]) => data.bytes > 0)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(([key, data]) => `
          <div class="storage-monitor__breakdown-item">
            <span class="storage-monitor__breakdown-name">${key}</span>
            <div class="storage-monitor__breakdown-value">
              <span>${data.formatted}</span>
              <div class="storage-monitor__breakdown-bar">
                <div class="storage-monitor__breakdown-bar-fill" style="width: ${data.percent}%"></div>
              </div>
            </div>
          </div>
        `).join('');
    }

    // Bind clear old data button
    const clearBtn = document.getElementById('clearOldDataBtn');
    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = 'true';
      clearBtn.addEventListener('click', () => this.handleClearOldData());
    }
  }

  /**
   * Handle clear old data button click
   */
  async handleClearOldData() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffDateStr = formatDate(cutoffDate);

    const removedCount = historicalPricesBatcher.cleanupPricesOlderThan(
      cutoffDateStr,
      state.journal.entries
    );

    if (removedCount > 0) {
      showToast(`Cleaned up ${removedCount} old price data points`, 'success');
    } else {
      showToast('No old price data to clean up', 'info');
    }

    // Update storage display
    await this.updateStorageMonitor();
  }
}

export const settings = new Settings();
export { Settings };
