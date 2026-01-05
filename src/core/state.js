/**
 * State Management - Centralized app state with event system
 */

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
        currentSize: 10000,
        realizedPnL: 0,
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

      // Journal meta: achievements, streaks, wizard settings
      journalMeta: {
        achievements: {
          unlocked: [], // { id, unlockedAt, notified }
          progress: {
            totalTrades: 0,
            currentStreak: 0,
            longestStreak: 0,
            lastTradeDate: null,
            tradesWithNotes: 0,
            tradesWithThesis: 0,
            completeWizardCount: 0
          }
        },
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
      }
    };

    this.listeners = new Map();
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

  // Settings methods
  updateSettings(updates) {
    Object.assign(this.state.settings, updates);
    this.emit('settingsChanged', this.state.settings);
    this.saveSettings();
  }

  // Account methods
  updateAccount(updates) {
    const oldAccount = { ...this.state.account };
    Object.assign(this.state.account, updates);
    this.emit('accountChanged', { old: oldAccount, new: this.state.account });
  }

  // Cash Flow methods
  addCashFlowTransaction(type, amount) {
    const transaction = {
      id: Date.now(),
      type, // 'deposit' or 'withdrawal'
      amount,
      timestamp: new Date().toISOString()
    };

    this.state.cashFlow.transactions.unshift(transaction);

    if (type === 'deposit') {
      this.state.cashFlow.totalDeposits += amount;
      this.state.account.currentSize += amount;
    } else if (type === 'withdrawal') {
      this.state.cashFlow.totalWithdrawals += amount;
      this.state.account.currentSize -= amount;
    }

    this.saveCashFlow();
    this.emit('cashFlowChanged', this.state.cashFlow);
    this.emit('accountSizeChanged', this.state.account.currentSize);
    return transaction;
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
    this.saveJournal();
    this.emit('journalEntryAdded', newEntry);
    return newEntry;
  }

  updateJournalEntry(id, updates) {
    const entry = this.state.journal.entries.find(e => e.id === id);
    if (entry) {
      Object.assign(entry, updates);
      this.saveJournal();
      this.emit('journalEntryUpdated', entry);
    }
    return entry;
  }

  deleteJournalEntry(id) {
    const index = this.state.journal.entries.findIndex(e => e.id === id);
    if (index > -1) {
      const deleted = this.state.journal.entries.splice(index, 1)[0];
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
        this.state.account.currentSize = this.state.settings.startingAccountSize;
        this.state.account.riskPercent = this.state.settings.defaultRiskPercent;
        this.state.account.maxPositionPercent = this.state.settings.defaultMaxPositionPercent;
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  saveJournal() {
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

        // Calculate realized P&L from closed and trimmed trades
        // Use totalRealizedPnL for trades with trim history, fallback to pnl for legacy
        this.state.account.realizedPnL = this.state.journal.entries
          .filter(t => (t.status === 'closed' || t.status === 'trimmed'))
          .reduce((sum, t) => sum + (t.totalRealizedPnL ?? t.pnl ?? 0), 0);

        if (this.state.settings.dynamicAccountEnabled) {
          this.state.account.currentSize =
            this.state.settings.startingAccountSize + this.state.account.realizedPnL;
        }
      }
    } catch (e) {
      console.error('Failed to load journal:', e);
    }
  }

  saveCashFlow() {
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

        // Apply cash flow to account size
        const netCashFlow = this.state.cashFlow.totalDeposits - this.state.cashFlow.totalWithdrawals;
        this.state.account.currentSize += netCashFlow;
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

  updateProgress(key, value) {
    this.state.journalMeta.achievements.progress[key] = value;
    this.saveJournalMeta();
  }

  // Streak calculation (calendar days)
  updateStreak() {
    const progress = this.state.journalMeta.achievements.progress;
    const today = new Date().toDateString();
    const lastDate = progress.lastTradeDate ? new Date(progress.lastTradeDate).toDateString() : null;

    if (lastDate === today) {
      // Same day, don't increment
      return progress.currentStreak;
    }

    if (lastDate) {
      const daysDiff = Math.floor(
        (new Date(today) - new Date(lastDate)) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff === 1) {
        // Consecutive day
        progress.currentStreak += 1;
      } else {
        // Streak broken, reset to 1
        progress.currentStreak = 1;
      }
    } else {
      // First trade ever
      progress.currentStreak = 1;
    }

    // Update longest streak
    if (progress.currentStreak > progress.longestStreak) {
      progress.longestStreak = progress.currentStreak;
    }

    progress.lastTradeDate = new Date().toISOString();
    this.saveJournalMeta();
    this.emit('streakUpdated', progress.currentStreak);
    return progress.currentStreak;
  }

  // Achievement methods
  unlockAchievement(id) {
    const unlocked = this.state.journalMeta.achievements.unlocked;
    if (!unlocked.find(a => a.id === id)) {
      const achievement = {
        id,
        unlockedAt: new Date().toISOString(),
        notified: false
      };
      unlocked.push(achievement);
      this.saveJournalMeta();
      this.emit('achievementUnlocked', achievement);
      return achievement;
    }
    return null;
  }

  isAchievementUnlocked(id) {
    return this.state.journalMeta.achievements.unlocked.some(a => a.id === id);
  }

  markAchievementNotified(id) {
    const achievement = this.state.journalMeta.achievements.unlocked.find(a => a.id === id);
    if (achievement) {
      achievement.notified = true;
      this.saveJournalMeta();
    }
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
  saveJournalMeta() {
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
          achievements: {
            unlocked: parsed.achievements?.unlocked || [],
            progress: {
              ...this.state.journalMeta.achievements.progress,
              ...(parsed.achievements?.progress || {})
            }
          },
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

  // Getters
  get settings() { return this.state.settings; }
  get account() { return this.state.account; }
  get trade() { return this.state.trade; }
  get results() { return this.state.results; }
  get journal() { return this.state.journal; }
  get journalMeta() { return this.state.journalMeta; }
  get ui() { return this.state.ui; }
}

// Export singleton instance
export const state = new AppState();
export { AppState };
