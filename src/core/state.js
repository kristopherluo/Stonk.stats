/**
 * State Management - Centralized app state with event system
 */

import { debounce } from './utils.js';

class AppState {
  constructor() {
    this.state = {
      settings: {
        startingAccountSize: 10000,
        defaultRiskPercent: 1,
        defaultMaxPositionPercent: 100,
        dynamicAccountEnabled: true,
        theme: 'dark'
      },

      account: {
        // currentSize and realizedPnL are now computed properties (see getters below)
        riskPercent: 1,
        maxPositionPercent: 100
      },

      cashFlow: {
        transactions: [], // { id, type: 'deposit'|'withdrawal', amount, timestamp }
        totalDeposits: 0,
        totalWithdrawals: 0
      },

      trade: {
        ticker: '',
        entry: null,
        stop: null,
        target: null,
        notes: ''
      },

      results: {
        shares: 0,
        positionSize: 0,
        riskDollars: 0,
        stopDistance: 0,
        stopPerShare: 0,
        rMultiple: null,
        target5R: null,
        profit: null,
        roi: null,
        riskReward: null,
        isLimited: false,
        percentOfAccount: 0
      },

      journal: {
        entries: [],
        filter: 'all'
      },

      // Journal meta: wizard settings
      journalMeta: {
        settings: {
          wizardEnabled: true,  // Default ON to encourage ticker entry
          celebrationsEnabled: true
        },
        schemaVersion: 1
      },

      ui: {
        scenariosExpanded: false,
        alertExpanded: false,
        settingsOpen: false,
        journalOpen: false
      },

      // Shared metrics (calculated once, used across multiple pages)
      metrics: {
        openRisk: 0,
        lastCalculated: null
      }
    };

    this.listeners = new Map();

    // Create debounced save methods to prevent localStorage blocking on every mutation
    // 300ms delay allows multiple rapid changes to be batched into single save
    this._debouncedSaveJournal = debounce(() => this._saveJournalImmediate(), 300);
    this._debouncedSaveCashFlow = debounce(() => this._saveCashFlowImmediate(), 300);
    this._debouncedSaveJournalMeta = debounce(() => this._saveJournalMetaImmediate(), 300);

    // Cache for computed account values (realizedPnL, currentSize)
    // Invalidated when trades, cash flow, or starting balance changes
    this._accountCache = {
      realizedPnL: null,
      currentSize: null,
      lastInvalidated: Date.now(),
      dependencies: {
        tradesHash: null,
        cashFlowHash: null,
        startingBalance: null
      }
    };

    // Cache Proxy instance to fix identity comparison issues
    this._accountProxy = null;
  }

  // Event system
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(data));
    }
  }

  // Cache management for computed properties
  /**
   * Calculate hash of trades for cache invalidation
   * Quick hash: count + sum of IDs + sum of realized P&L
   */
  _hashTrades() {
    return this.state.journal.entries.length +
      this.state.journal.entries.reduce((sum, t) =>
        sum + t.id + (t.totalRealizedPnL ?? t.pnl ?? 0), 0
      );
  }

  /**
   * Calculate hash of cash flow for cache invalidation
   */
  _hashCashFlow() {
    return this.state.cashFlow.transactions.length +
      this.state.cashFlow.totalDeposits +
      this.state.cashFlow.totalWithdrawals;
  }

  /**
   * Check if account cache needs recalculation
   * Memoizes hash calculations to avoid redundant iterations
   */
  _needsRecalculation() {
    const tradesHash = this._hashTrades();
    const cashFlowHash = this._hashCashFlow();
    const startingBalance = this.state.settings.startingAccountSize;

    const changed = tradesHash !== this._accountCache.dependencies.tradesHash ||
           cashFlowHash !== this._accountCache.dependencies.cashFlowHash ||
           startingBalance !== this._accountCache.dependencies.startingBalance;

    // Cache computed hashes to avoid recalculating in _updateCacheDependencies
    if (changed) {
      this._accountCache._tempHashes = { tradesHash, cashFlowHash, startingBalance };
    }

    return changed;
  }

  /**
   * Update cache dependency hashes after recalculation
   * Uses memoized hashes from _needsRecalculation to avoid redundant iterations
   */
  _updateCacheDependencies() {
    // Use cached hashes if available (from _needsRecalculation)
    if (this._accountCache._tempHashes) {
      this._accountCache.dependencies = { ...this._accountCache._tempHashes };
      delete this._accountCache._tempHashes;
    } else {
      // Fallback: recalculate (shouldn't happen in normal flow)
      this._accountCache.dependencies.tradesHash = this._hashTrades();
      this._accountCache.dependencies.cashFlowHash = this._hashCashFlow();
      this._accountCache.dependencies.startingBalance = this.state.settings.startingAccountSize;
    }
  }

  /**
   * Invalidate account cache (called when trades/cashflow change)
   */
  _invalidateAccountCache() {
    this._accountCache.realizedPnL = null;
    this._accountCache.currentSize = null;
    this._accountCache.lastInvalidated = Date.now();
  }

  // Settings methods
  updateSettings(updates) {
    Object.assign(this.state.settings, updates);
    this.emit('settingsChanged', this.state.settings);
    this.saveSettings();
  }

  // Account methods
  updateAccount(updates) {
    const oldAccount = { ...this.state.account };

    // Only allow updating riskPercent and maxPositionPercent
    // realizedPnL and currentSize are computed properties
    const allowedUpdates = {};
    if ('riskPercent' in updates) {
      allowedUpdates.riskPercent = updates.riskPercent;
    }
    if ('maxPositionPercent' in updates) {
      allowedUpdates.maxPositionPercent = updates.maxPositionPercent;
    }

    Object.assign(this.state.account, allowedUpdates);
    this.emit('accountChanged', { old: oldAccount, new: this.state.account });
  }

  // Cash Flow methods
  addCashFlowTransaction(type, amount, timestamp = null) {
    const transaction = {
      id: Date.now(),
      type, // 'deposit' or 'withdrawal'
      amount,
      timestamp: timestamp || new Date().toISOString()  // Use provided or default to now
    };

    this.state.cashFlow.transactions.unshift(transaction);

    if (type === 'deposit') {
      this.state.cashFlow.totalDeposits += amount;
    } else if (type === 'withdrawal') {
      this.state.cashFlow.totalWithdrawals += amount;
    }

    this._invalidateAccountCache();
    this.saveCashFlow();
    this.emit('cashFlowChanged', this.state.cashFlow);
    this.emit('accountSizeChanged', this.currentSize);
    return transaction;
  }

  deleteCashFlowTransaction(id) {
    const index = this.state.cashFlow.transactions.findIndex(tx => tx.id === id);

    if (index === -1) return null;

    const deleted = this.state.cashFlow.transactions.splice(index, 1)[0];

    // Update totals
    if (deleted.type === 'deposit') {
      this.state.cashFlow.totalDeposits -= deleted.amount;
    } else if (deleted.type === 'withdrawal') {
      this.state.cashFlow.totalWithdrawals -= deleted.amount;
    }

    this._invalidateAccountCache();
    this.saveCashFlow();
    this.emit('cashFlowChanged', this.state.cashFlow);
    this.emit('accountSizeChanged', this.currentSize);

    return deleted;
  }

  getCashFlowNet() {
    return this.state.cashFlow.totalDeposits - this.state.cashFlow.totalWithdrawals;
  }

  // Trade methods
  updateTrade(updates) {
    Object.assign(this.state.trade, updates);
    this.emit('tradeChanged', this.state.trade);
  }

  // Results methods
  updateResults(results) {
    this.state.results = { ...this.state.results, ...results };
    this.emit('resultsChanged', this.state.results);
  }

  // Journal methods
  addJournalEntry(entry) {
    const newEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.state.journal.entries.unshift(newEntry);
    this._invalidateAccountCache();
    this.saveJournal();
    this.emit('journalEntryAdded', newEntry);
    return newEntry;
  }

  updateJournalEntry(id, updates) {
    const entry = this.state.journal.entries.find(e => e.id === id);
    if (entry) {
      Object.assign(entry, updates);
      this._invalidateAccountCache();
      this.saveJournal();
      this.emit('journalEntryUpdated', entry);
    }
    return entry;
  }

  deleteJournalEntry(id) {
    const index = this.state.journal.entries.findIndex(e => e.id === id);
    if (index > -1) {
      const deleted = this.state.journal.entries.splice(index, 1)[0];
      this._invalidateAccountCache();
      this.saveJournal();
      this.emit('journalEntryDeleted', deleted);
      return deleted;
    }
    return null;
  }

  getOpenTrades() {
    return this.state.journal.entries.filter(e => e.status === 'open');
  }

  getFilteredEntries(filter = 'all') {
    if (filter === 'all') return this.state.journal.entries;
    return this.state.journal.entries.filter(e => e.status === filter);
  }

  // UI state methods
  toggleUI(key) {
    this.state.ui[key] = !this.state.ui[key];
    this.emit('uiChanged', { key, value: this.state.ui[key] });
  }

  setUI(key, value) {
    this.state.ui[key] = value;
    this.emit('uiChanged', { key, value });
  }

  // Persistence
  saveSettings() {
    try {
      localStorage.setItem('riskCalcSettings', JSON.stringify(this.state.settings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('riskCalcSettings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Replace settings object entirely to ensure all properties are reset
        this.state.settings = {
          startingAccountSize: parsed.startingAccountSize ?? 10000,
          defaultRiskPercent: parsed.defaultRiskPercent ?? 1,
          defaultMaxPositionPercent: parsed.defaultMaxPositionPercent ?? 100,
          dynamicAccountEnabled: parsed.dynamicAccountEnabled ?? true,
          theme: parsed.theme ?? 'dark'
        };
        // currentSize is now a computed property - no manual assignment needed
        this.state.account.riskPercent = this.state.settings.defaultRiskPercent;
        this.state.account.maxPositionPercent = this.state.settings.defaultMaxPositionPercent;
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  // Public method: uses debouncing to batch saves
  saveJournal() {
    this._debouncedSaveJournal();
  }

  // Private method: immediate save (called by debounced function)
  _saveJournalImmediate() {
    try {
      localStorage.setItem('riskCalcJournal', JSON.stringify(this.state.journal.entries));
    } catch (e) {
      console.error('Failed to save journal:', e);
    }
  }

  loadJournal() {
    try {
      const saved = localStorage.getItem('riskCalcJournal');
      if (saved) {
        this.state.journal.entries = JSON.parse(saved);
        // realizedPnL and currentSize are now computed properties - no manual calculation needed
      }
    } catch (e) {
      console.error('Failed to load journal:', e);
    }
  }

  // Public method: uses debouncing to batch saves
  saveCashFlow() {
    this._debouncedSaveCashFlow();
  }

  // Private method: immediate save (called by debounced function)
  _saveCashFlowImmediate() {
    try {
      localStorage.setItem('riskCalcCashFlow', JSON.stringify(this.state.cashFlow));
    } catch (e) {
      console.error('Failed to save cash flow:', e);
    }
  }

  loadCashFlow() {
    try {
      const saved = localStorage.getItem('riskCalcCashFlow');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.state.cashFlow = {
          transactions: parsed.transactions || [],
          totalDeposits: parsed.totalDeposits || 0,
          totalWithdrawals: parsed.totalWithdrawals || 0
        };
        // currentSize is now a computed property - no manual adjustment needed
      }
    } catch (e) {
      console.error('Failed to load cash flow:', e);
    }
  }

  // JournalMeta methods
  updateJournalMeta(updates) {
    Object.assign(this.state.journalMeta, updates);
    this.saveJournalMeta();
    this.emit('journalMetaChanged', this.state.journalMeta);
  }

  updateJournalMetaSettings(updates) {
    Object.assign(this.state.journalMeta.settings, updates);
    this.saveJournalMeta();
    this.emit('journalMetaSettingsChanged', this.state.journalMeta.settings);
  }

  // Migration helper for existing journal entries
  migrateJournalEntries() {
    let migrated = false;
    this.state.journal.entries = this.state.journal.entries.map(entry => {
      if (!entry.hasOwnProperty('thesis')) {
        migrated = true;
        return {
          ...entry,
          thesis: null,
          wizardComplete: false,
          wizardSkipped: []
        };
      }
      return entry;
    });
    if (migrated) {
      this.saveJournal();
      console.log('Migrated journal entries to new schema');
    }
  }

  // JournalMeta persistence
  // Public method: uses debouncing to batch saves
  saveJournalMeta() {
    this._debouncedSaveJournalMeta();
  }

  // Private method: immediate save (called by debounced function)
  _saveJournalMetaImmediate() {
    try {
      localStorage.setItem('riskCalcJournalMeta', JSON.stringify(this.state.journalMeta));
    } catch (e) {
      console.error('Failed to save journal meta:', e);
    }
  }

  loadJournalMeta() {
    try {
      const saved = localStorage.getItem('riskCalcJournalMeta');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Deep merge to preserve defaults for missing keys
        this.state.journalMeta = {
          settings: {
            ...this.state.journalMeta.settings,
            ...(parsed.settings || {})
          },
          schemaVersion: parsed.schemaVersion || 1
        };
      }
    } catch (e) {
      console.error('Failed to load journal meta:', e);
    }
  }

  // Computed properties with caching
  /**
   * Computed property: Realized P&L from closed/trimmed trades
   * Always calculated from journal entries, never stored
   * Includes totalRealizedPnL from trimmed trades
   */
  get realizedPnL() {
    // Check cache
    if (this._accountCache.realizedPnL !== null && !this._needsRecalculation()) {
      return this._accountCache.realizedPnL;
    }

    // Recalculate from trades
    const pnl = this.state.journal.entries
      .filter(t => (t.status === 'closed' || t.status === 'trimmed'))
      .reduce((sum, t) => sum + (t.totalRealizedPnL ?? t.pnl ?? 0), 0);

    // Update cache
    this._accountCache.realizedPnL = pnl;
    this._updateCacheDependencies();

    return pnl;
  }

  /**
   * Computed property: Current account size (realized balance)
   * Formula: starting + realized P&L + net cash flow
   * Does NOT include unrealized P&L (that's added for display only)
   */
  get currentSize() {
    // Check cache
    if (this._accountCache.currentSize !== null && !this._needsRecalculation()) {
      return this._accountCache.currentSize;
    }

    try {
      // Recalculate
      const netCashFlow = this.getCashFlowNet();
      const size = this.state.settings.startingAccountSize + this.realizedPnL + netCashFlow;

      // Update cache
      this._accountCache.currentSize = size;

      return size;
    } catch (error) {
      console.error('Error calculating currentSize:', error);
      // Fallback: return starting balance + realized P&L (no cash flow)
      return this.state.settings.startingAccountSize + this.realizedPnL;
    }
  }

  // Getters
  get settings() { return this.state.settings; }
  get account() {
    // Cache Proxy instance to fix identity comparison (state.account === state.account)
    if (!this._accountProxy) {
      const self = this;
      this._accountProxy = new Proxy(this.state.account, {
        get(target, prop) {
          if (prop === 'realizedPnL') return self.realizedPnL;
          if (prop === 'currentSize') return self.currentSize;
          return target[prop];
        }
      });
    }
    return this._accountProxy;
  }
  get cashFlow() { return this.state.cashFlow; }
  get trade() { return this.state.trade; }
  get results() { return this.state.results; }
  get journal() { return this.state.journal; }
  get journalMeta() { return this.state.journalMeta; }
  get ui() { return this.state.ui; }
}

// Export singleton instance
export const state = new AppState();
export { AppState };
