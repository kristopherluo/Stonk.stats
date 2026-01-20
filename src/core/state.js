/**
 * State Management - Centralized app state with event system
 */

import { debounce } from './utils.js';
import { calculateRealizedPnL, getTradeRealizedPnL } from './utils/tradeCalculations.js';
import { compressTradeNotes, decompressTradeNotes } from '../utils/compression.js';
import { storage } from '../utils/storage.js';

import { createLogger } from '../utils/logger.js';

const logger = createLogger('State');

class AppState {
  constructor() {
    this.state = {
      settings: {
        startingAccountSize: 10000,
        defaultRiskPercent: 1,
        defaultMaxPositionPercent: 100,
        dynamicAccountEnabled: true,
        theme: 'dark',
        twelveDataBatchSize: 8 // Twelve Data API batch size (8 for free tier, higher for paid)
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
        sum + t.id + getTradeRealizedPnL(t), 0
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
  async saveSettings() {
    try {
      await storage.setItem('riskCalcSettings', this.state.settings);
    } catch (e) {
      logger.error('Failed to save settings:', e);
    }
  }

  /**
   * Save all state immediately (bypasses debouncing)
   * Used for critical operations like clear all data
   */
  async saveAllImmediate() {
    await Promise.all([
      this.saveSettings(),
      this._saveJournalImmediate(),
      this._saveCashFlowImmediate(),
      this._saveJournalMetaImmediate()
    ]);
  }

  async loadSettings() {
    try {
      const parsed = await storage.getItem('riskCalcSettings');
      if (parsed) {
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
      logger.error('Failed to load settings:', e);
    }
  }

  // Public method: uses debouncing to batch saves
  saveJournal() {
    this._debouncedSaveJournal();
  }

  // Private method: immediate save (called by debounced function)
  async _saveJournalImmediate() {
    try {
      // Save trades individually
      const tradeIds = [];

      for (const trade of this.state.journal.entries) {
        if (trade && trade.id) {
          // Compress notes before saving
          const compressedTrade = compressTradeNotes(trade);
          await storage.setItem(`trade_${trade.id}`, compressedTrade);
          tradeIds.push(trade.id);
        }
      }

      // Update the index
      await storage.setItem('riskCalcJournalIndex', tradeIds);

      logger.debug(`Saved ${tradeIds.length} trades to individual storage`);
    } catch (e) {
      logger.error('Failed to save journal:', e);
    }
  }

  /**
   * Save a single trade (optimized for single trade updates)
   * @param {Object} trade - Trade object to save
   */
  async saveTrade(trade) {
    try {
      if (!trade || !trade.id) {
        logger.error('Cannot save trade: missing trade or ID');
        return;
      }

      // Compress and save the trade
      const compressedTrade = compressTradeNotes(trade);
      await storage.setItem(`trade_${trade.id}`, compressedTrade);

      // Update index if this is a new trade
      const index = await storage.getItem('riskCalcJournalIndex') || [];
      if (!index.includes(trade.id)) {
        index.push(trade.id);
        await storage.setItem('riskCalcJournalIndex', index);
      }

      logger.debug(`Saved individual trade: ${trade.id}`);
    } catch (e) {
      logger.error('Failed to save individual trade:', e);
    }
  }

  /**
   * Delete a single trade from storage
   * @param {string} tradeId - ID of trade to delete
   */
  async deleteTrade(tradeId) {
    try {
      // Remove from storage
      await storage.removeItem(`trade_${tradeId}`);

      // Update index
      const index = await storage.getItem('riskCalcJournalIndex') || [];
      const newIndex = index.filter(id => id !== tradeId);
      await storage.setItem('riskCalcJournalIndex', newIndex);

      logger.debug(`Deleted trade: ${tradeId}`);
    } catch (e) {
      logger.error('Failed to delete trade:', e);
    }
  }

  async loadJournal() {
    try {
      // Check if we need to migrate from array storage to individual trade storage
      await this._migrateJournalToIndividualStorageIfNeeded();

      // Load from new individual trade storage format
      const tradeIndex = await storage.getItem('riskCalcJournalIndex');

      if (tradeIndex && Array.isArray(tradeIndex)) {
        // Load each trade individually
        const trades = await Promise.all(
          tradeIndex.map(id => storage.getItem(`trade_${id}`))
        );

        // Filter out any null trades (shouldn't happen, but be safe)
        this.state.journal.entries = trades
          .filter(trade => trade !== null)
          .map(trade => decompressTradeNotes(trade));

        logger.debug(`Loaded ${this.state.journal.entries.length} trades from individual storage`);
      } else {
        // No trades yet
        this.state.journal.entries = [];
      }

      // Migrate trades to add options fields if missing
      this._migrateTradesForOptions();
    } catch (e) {
      logger.error('Failed to load journal:', e);
    }
  }

  /**
   * Migrate journal from array storage (v2) to individual trade storage (v3)
   * This is a one-time migration that runs automatically on first load
   */
  async _migrateJournalToIndividualStorageIfNeeded() {
    try {
      // Check if old array format exists
      const oldJournal = await storage.getItem('riskCalcJournal');

      // If no old journal, we're either already migrated or have no data
      if (!oldJournal || !Array.isArray(oldJournal)) {
        return;
      }

      // Check if we've already migrated (index exists)
      const existingIndex = await storage.getItem('riskCalcJournalIndex');
      if (existingIndex) {
        logger.debug('Journal already migrated to individual storage');
        return;
      }

      logger.info(`Migrating ${oldJournal.length} trades to individual storage...`);

      // Save each trade individually
      const tradeIds = [];
      for (const trade of oldJournal) {
        if (trade && trade.id) {
          await storage.setItem(`trade_${trade.id}`, trade);
          tradeIds.push(trade.id);
        }
      }

      // Save the index
      await storage.setItem('riskCalcJournalIndex', tradeIds);

      // Backup old journal (don't delete immediately)
      await storage.setItem('riskCalcJournal_backup_v2', oldJournal);

      // Remove old journal array
      await storage.removeItem('riskCalcJournal');

      logger.info(`Migration complete: ${tradeIds.length} trades migrated. Old data backed up to 'riskCalcJournal_backup_v2'`);

    } catch (e) {
      logger.error('Failed to migrate journal to individual storage:', e);
      throw e; // Re-throw to prevent data loss
    }
  }

  /**
   * Migrate existing trades to include options fields
   * Adds assetType, strike, expirationDate, optionType, premium with default values
   */
  _migrateTradesForOptions() {
    let migrated = 0;
    this.state.journal.entries.forEach(trade => {
      if (!trade.assetType) {
        // Default to 'stock' for existing trades
        trade.assetType = 'stock';
        trade.strike = null;
        trade.expirationDate = null;
        trade.optionType = null;
        trade.premium = null;
        migrated++;
      }
    });

    if (migrated > 0) {
      logger.debug(`[State] Migrated ${migrated} trades to include options fields`);
      this.saveJournal(); // Save migrated data
    }
  }

  // Public method: uses debouncing to batch saves
  saveCashFlow() {
    this._debouncedSaveCashFlow();
  }

  // Private method: immediate save (called by debounced function)
  async _saveCashFlowImmediate() {
    try {
      await storage.setItem('riskCalcCashFlow', this.state.cashFlow);
    } catch (e) {
      logger.error('Failed to save cash flow:', e);
    }
  }

  async loadCashFlow() {
    try {
      const parsed = await storage.getItem('riskCalcCashFlow');
      if (parsed) {
        this.state.cashFlow = {
          transactions: parsed.transactions || [],
          totalDeposits: parsed.totalDeposits || 0,
          totalWithdrawals: parsed.totalWithdrawals || 0
        };
        // currentSize is now a computed property - no manual adjustment needed
      }
    } catch (e) {
      logger.error('Failed to load cash flow:', e);
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

  // JournalMeta persistence
  // Public method: uses debouncing to batch saves
  saveJournalMeta() {
    this._debouncedSaveJournalMeta();
  }

  // Private method: immediate save (called by debounced function)
  async _saveJournalMetaImmediate() {
    try {
      await storage.setItem('riskCalcJournalMeta', this.state.journalMeta);
    } catch (e) {
      logger.error('Failed to save journal meta:', e);
    }
  }

  async loadJournalMeta() {
    try {
      const parsed = await storage.getItem('riskCalcJournalMeta');
      if (parsed) {
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
      logger.error('Failed to load journal meta:', e);
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

    // Recalculate from trades using shared utility
    const pnl = calculateRealizedPnL(this.state.journal.entries);

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
      logger.error('Error calculating currentSize:', error);
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
