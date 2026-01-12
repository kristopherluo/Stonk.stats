/**
 * EquityCurveManager - Manages equity curve calculation and caching
 * Single source of truth for end-of-day account balances
 */

import { state } from '../../core/state.js';
import { historicalPricesBatcher } from './HistoricalPricesBatcher.js';
import { priceTracker } from '../../core/priceTracker.js';
import { getCurrentWeekday, getPreviousBusinessDay } from '../../core/utils.js';

class EquityCurveManager {
  constructor() {
    this.cache = null;
    this.CACHE_KEY = 'equityCurveCache';
    this.CACHE_VERSION = 2; // Bumped for smart invalidation support
    this.loadCache();
  }

  /**
   * Calculate hash of trades and cash flow to detect changes
   */
  _calculateDataHash() {
    const trades = state.journal.entries.map(e => ({
      id: e.id,
      timestamp: e.timestamp,
      closeDate: e.closeDate,
      status: e.status,
      pnl: e.totalRealizedPnL ?? e.pnl,
      ticker: e.ticker,
      entry: e.entry,
      shares: e.shares,
      trimHistory: e.trimHistory
    }));

    const cashFlow = (state.cashFlow?.transactions || []).map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      timestamp: t.timestamp
    }));

    const startingBalance = state.settings.startingAccountSize;

    // Simple hash: stringify and use length + checksum
    const str = JSON.stringify({ trades, cashFlow, startingBalance });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Load cache from localStorage
   */
  loadCache() {
    try {
      const saved = localStorage.getItem(this.CACHE_KEY);
      if (saved) {
        this.cache = JSON.parse(saved);

        // Invalidate if version mismatch
        if (this.cache.version !== this.CACHE_VERSION) {
          this.cache = null;
        }
      }
    } catch (error) {
      console.error('Failed to load equity curve cache:', error);
      this.cache = null;
    }
  }

  /**
   * Save cache to localStorage
   */
  saveCache() {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(this.cache));
    } catch (error) {
      console.error('Failed to save equity curve cache:', error);
    }
  }

  /**
   * Invalidate cache (called when trades or cash flow change)
   * LEGACY: Full invalidation - use invalidateForTrade() for targeted invalidation
   */
  invalidateCache() {
    this.cache = null;
    try {
      localStorage.removeItem(this.CACHE_KEY);
    } catch (error) {
      console.error('Failed to remove equity curve cache:', error);
    }
  }

  /**
   * Smart invalidation: Only invalidate dates affected by a specific trade
   * @param {Object} trade - The trade that was added/updated/deleted
   */
  invalidateForTrade(trade) {
    if (!this.cache || !this.cache.curve) {
      // No cache exists, nothing to invalidate
      return;
    }

    // Determine affected date range
    const { startDate, endDate } = this._getAffectedDateRange(trade);

    // Delete cached days in the affected range
    const affectedDays = [];
    for (const dateStr in this.cache.curve) {
      if (dateStr >= startDate && dateStr <= endDate) {
        delete this.cache.curve[dateStr];
        affectedDays.push(dateStr);
      }
    }

    // Update last calculated date if we deleted the last day
    const remainingDates = Object.keys(this.cache.curve).sort();
    if (remainingDates.length > 0) {
      this.cache.lastCalculatedDate = remainingDates[remainingDates.length - 1];
    } else {
      // All days deleted, invalidate entire cache
      this.invalidateCache();
      return;
    }

    // Mark as partially invalidated (skip hash check on next build)
    this.cache.partiallyInvalidated = true;
    this.cache.lastUpdated = Date.now();

    this.saveCache();
  }

  /**
   * Invalidate all dates from a specific date onwards
   * Used for cash flow changes that affect all future balances
   * @param {string} startDateStr - YYYY-MM-DD format
   */
  invalidateFromDate(startDateStr) {
    if (!this.cache || !this.cache.curve) {
      return;
    }

    // Delete all days from startDate onwards
    for (const dateStr in this.cache.curve) {
      if (dateStr >= startDateStr) {
        delete this.cache.curve[dateStr];
      }
    }

    // Update last calculated date
    const remainingDates = Object.keys(this.cache.curve).sort();
    if (remainingDates.length > 0) {
      this.cache.lastCalculatedDate = remainingDates[remainingDates.length - 1];
    } else {
      this.invalidateCache();
      return;
    }

    // Mark as partially invalidated (skip hash check on next build)
    this.cache.partiallyInvalidated = true;
    this.cache.lastUpdated = Date.now();
    this.saveCache();
  }

  /**
   * Get the date range affected by a trade change
   * @param {Object} trade - The trade object
   * @returns {Object} { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
   */
  _getAffectedDateRange(trade) {
    // Start date: When the trade was entered
    const entryDate = new Date(trade.timestamp);
    entryDate.setHours(0, 0, 0, 0);
    const startDate = this._formatDate(entryDate);

    // End date: When the trade was closed, or today if still open
    let endDate;
    if (trade.status === 'closed' && trade.closeDate) {
      const closeDate = new Date(trade.closeDate);
      closeDate.setHours(0, 0, 0, 0);
      endDate = this._formatDate(closeDate);
    } else {
      // Still open or trimmed - affects all days through today
      const today = getCurrentWeekday();
      today.setHours(0, 0, 0, 0);
      endDate = this._formatDate(today);
    }

    return { startDate, endDate };
  }

  /**
   * Check if cache is valid for current data
   */
  _isCacheValid() {
    if (!this.cache) return false;

    const currentHash = this._calculateDataHash();
    return this.cache.dataHash === currentHash;
  }

  /**
   * Get EOD balance for a specific date
   * Returns null if date is not in cache
   * @param {string|Date} date - Date as YYYY-MM-DD string or Date object
   */
  getEODBalance(date) {
    if (!this.cache || !this.cache.curve) return null;

    // If already a string, use it directly; otherwise format it
    const dateStr = typeof date === 'string' ? date : this._formatDate(date);
    return this.cache.curve[dateStr]?.balance || null;
  }

  /**
   * Get EOD realized balance (without unrealized P&L) for a specific date
   * @param {string|Date} date - Date as YYYY-MM-DD string or Date object
   */
  getEODRealizedBalance(date) {
    if (!this.cache || !this.cache.curve) return null;

    // If already a string, use it directly; otherwise format it
    const dateStr = typeof date === 'string' ? date : this._formatDate(date);
    return this.cache.curve[dateStr]?.realizedBalance || null;
  }

  /**
   * Format date to YYYY-MM-DD string
   */
  _formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Parse YYYY-MM-DD string to Date object (avoids UTC issues)
   */
  _parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  /**
   * Calculate unrealized P&L for open positions on a specific date
   */
  async _calculateUnrealizedPnLAtDate(dateStr, allEntries) {
    const targetDate = this._parseDate(dateStr);
    targetDate.setHours(23, 59, 59, 999); // End of day

    // Check if this is today (or current weekday if today is weekend)
    const currentWeekday = getCurrentWeekday();
    currentWeekday.setHours(0, 0, 0, 0);
    const targetDateOnly = new Date(targetDate);
    targetDateOnly.setHours(0, 0, 0, 0);
    const isToday = targetDateOnly.getTime() === currentWeekday.getTime();

    // For today, use simple filtering (same as calculateCurrentAccount)
    if (isToday) {
      const allOpenTrades = allEntries.filter(e => e.status === 'open' || e.status === 'trimmed');
      const result = priceTracker.calculateTotalUnrealizedPnL(allOpenTrades);
      return result?.totalPnL || 0;
    }

    // For historical dates, use complex date-based filtering
    const openOnDate = allEntries.filter(trade => {
      const entryDate = new Date(trade.timestamp);
      entryDate.setHours(0, 0, 0, 0);

      // Trade must have been entered before or on this date
      if (entryDate > targetDateOnly) return false;

      // If trade is closed/trimmed, check if it closed after this date
      if (trade.status === 'closed' || trade.status === 'trimmed') {
        if (!trade.closeDate) return false;
        const closeDate = new Date(trade.closeDate);
        closeDate.setHours(0, 0, 0, 0);

        // For closed trades, must have closed after this date
        if (trade.status === 'closed' && closeDate <= targetDateOnly) return false;

        // For trimmed trades, include if they have remaining shares on this date
        if (trade.status === 'trimmed') {
          let sharesOnDate = trade.shares;
          if (trade.trimHistory && Array.isArray(trade.trimHistory)) {
            trade.trimHistory.forEach(trim => {
              const trimDate = new Date(trim.date);
              trimDate.setHours(0, 0, 0, 0);
              if (trimDate <= targetDateOnly) {
                sharesOnDate -= trim.shares;
              }
            });
          }
          if (sharesOnDate <= 0) return false;
        }
      }

      return true;
    });

    // If no open positions, return 0
    if (openOnDate.length === 0) return 0;

    // For historical dates, use historical prices
    let totalUnrealizedPnL = 0;
    const hasApiKey = historicalPricesBatcher.apiKey !== null;

    if (!hasApiKey) {
      // Fallback: use current prices (not ideal but better than nothing)
      const result = priceTracker.calculateTotalUnrealizedPnL(openOnDate);
      return result?.totalPnL || 0;
    }

    for (const trade of openOnDate) {
      // Calculate shares held on this date (accounting for trimming)
      let sharesOnDate = trade.shares;
      if (trade.trimHistory && Array.isArray(trade.trimHistory)) {
        trade.trimHistory.forEach(trim => {
          const trimDate = new Date(trim.date);
          trimDate.setHours(0, 0, 0, 0);
          if (trimDate <= targetDateOnly) {
            sharesOnDate -= trim.shares;
          }
        });
      }

      // Get historical price
      const price = historicalPricesBatcher.getPriceOnDate(trade.ticker, dateStr);

      if (price && trade.entry) {
        totalUnrealizedPnL += (price - trade.entry) * sharesOnDate;
      }
    }

    return totalUnrealizedPnL;
  }

  /**
   * Build equity curve from earliest trade to today
   * Uses cache if valid, otherwise recalculates
   */
  async buildEquityCurve(filterStartDate = null, filterEndDate = null) {
    console.time('[Stats] buildEquityCurve total');

    // Check if cache exists and has data
    const hasCacheData = this.cache && this.cache.curve && Object.keys(this.cache.curve).length > 0;

    // If partially invalidated, skip hash check and just fill gaps
    const useCache = hasCacheData && (this.cache.partiallyInvalidated || this._isCacheValid());

    if (useCache) {
      console.time('[Stats] fillCacheGaps');
      // Cache exists - check for gaps and fill them
      await this._fillCacheGaps();
      console.timeEnd('[Stats] fillCacheGaps');

      // Verify cache still exists after filling gaps
      if (!this.cache || !this.cache.curve) {
        // Cache was cleared during gap filling - rebuild from scratch
        await this._rebuildFullCurve();
        return this._getFilteredCurve(filterStartDate, filterEndDate);
      }

      // Check if we need to append new days
      const cacheEndDate = new Date(this.cache.lastCalculatedDate);
      const today = getCurrentWeekday();
      today.setHours(0, 0, 0, 0);

      if (cacheEndDate < today) {
        // Append new days from cache end to today
        console.time('[Stats] appendNewDays');
        await this._appendNewDays();
        console.timeEnd('[Stats] appendNewDays');
      } else if (cacheEndDate.getTime() === today.getTime()) {
        // Today is already in cache, but prices may have changed
        // Recalculate today's unrealized P&L with current prices
        console.time('[Stats] recalculateTodayUnrealizedPnL');
        await this._recalculateTodayUnrealizedPnL();
        console.timeEnd('[Stats] recalculateTodayUnrealizedPnL');
      }

      // Clear partial invalidation flag and update hash
      if (this.cache.partiallyInvalidated) {
        this.cache.partiallyInvalidated = false;
        this.cache.dataHash = this._calculateDataHash();
        this.saveCache();
      }

      // Return filtered curve data
      console.timeEnd('[Stats] buildEquityCurve total');
      return this._getFilteredCurve(filterStartDate, filterEndDate);
    }

    // Cache invalid or doesn't exist - rebuild from scratch
    console.log('[Stats] Cache invalid - rebuilding full curve');
    console.time('[Stats] rebuildFullCurve');
    await this._rebuildFullCurve();
    console.timeEnd('[Stats] rebuildFullCurve');

    // Return filtered curve data
    console.timeEnd('[Stats] buildEquityCurve total');
    return this._getFilteredCurve(filterStartDate, filterEndDate);
  }

  /**
   * Recalculate today's unrealized P&L with current prices
   * Only updates today's data point in the cache
   */
  async _recalculateTodayUnrealizedPnL() {
    if (!this.cache || !this.cache.curve) return;

    const today = getCurrentWeekday();
    today.setHours(0, 0, 0, 0);
    const todayStr = this._formatDate(today);

    // Check if today exists in cache
    if (!this.cache.curve[todayStr]) return;

    const allEntries = state.journal.entries;
    const existingData = this.cache.curve[todayStr];

    // Recalculate unrealized P&L for today with current prices
    const unrealizedPnL = await this._calculateUnrealizedPnLAtDate(todayStr, allEntries);

    // Get the existing realized balance (doesn't change with prices)
    const realizedBalance = existingData.realizedBalance;

    // Update today's data with new unrealized P&L
    this.cache.curve[todayStr] = {
      balance: realizedBalance + unrealizedPnL,
      realizedBalance: realizedBalance,
      unrealizedPnL: unrealizedPnL,
      dayPnL: existingData.dayPnL,
      cashFlow: existingData.cashFlow
    };

    // Save updated cache
    this.saveCache();
  }

  /**
   * Rebuild the entire equity curve from scratch
   */
  async _rebuildFullCurve() {
    const allEntries = state.journal.entries;
    const startingBalance = state.settings.startingAccountSize;
    const cashFlowTransactions = (state.cashFlow && state.cashFlow.transactions) || [];

    // Get closed trades sorted by close date
    const closedTrades = allEntries
      .filter(e => e.status === 'closed' || e.status === 'trimmed')
      .map(t => ({
        date: t.closeDate || t.timestamp,
        pnl: t.totalRealizedPnL ?? t.pnl ?? 0,
        ticker: t.ticker,
        entry: t
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Get all entry dates to determine the start date
    const allEntryDates = allEntries
      .filter(e => e.timestamp)
      .map(e => new Date(e.timestamp));

    if (closedTrades.length === 0 && allEntryDates.length === 0) {
      // No data yet
      this.cache = {
        version: this.CACHE_VERSION,
        dataHash: this._calculateDataHash(),
        lastCalculatedDate: this._formatDate(new Date()),
        lastUpdated: Date.now(),
        curve: {}
      };
      this.saveCache();
      return;
    }

    // Determine start date: earliest trade entry
    const firstDate = allEntryDates.length > 0
      ? new Date(Math.min(...allEntryDates.map(d => d.getTime())))
      : new Date(closedTrades[0].date);
    firstDate.setHours(0, 0, 0, 0);

    // End date: today (or current weekday)
    const endDate = getCurrentWeekday();
    endDate.setHours(0, 0, 0, 0);

    // Fetch all historical prices first (BATCHED!)
    const hasApiKey = historicalPricesBatcher.apiKey !== null;
    if (hasApiKey) {
      const allTickers = [...new Set(allEntries.map(e => e.ticker).filter(t => t))];
      if (allTickers.length > 0) {
        await historicalPricesBatcher.batchFetchPrices(allTickers);
      }
    }

    // Group closed trades by day
    const tradesByDay = new Map();
    closedTrades.forEach(trade => {
      const dateStr = this._formatDate(trade.date);
      if (!tradesByDay.has(dateStr)) {
        tradesByDay.set(dateStr, []);
      }
      tradesByDay.get(dateStr).push(trade);
    });

    // Group cash flow by day
    const cashFlowByDay = new Map();
    cashFlowTransactions.forEach(transaction => {
      const dateStr = this._formatDate(transaction.timestamp);
      if (!cashFlowByDay.has(dateStr)) {
        cashFlowByDay.set(dateStr, 0);
      }
      const amount = transaction.type === 'deposit' ? transaction.amount : -transaction.amount;
      cashFlowByDay.set(dateStr, cashFlowByDay.get(dateStr) + amount);
    });

    // Build equity curve day by day
    const curve = {};
    const currentDate = new Date(firstDate);
    let cumulativeRealizedPnL = 0;
    let cumulativeCashFlow = 0;

    while (currentDate.getTime() <= endDate.getTime()) {
      const dateStr = this._formatDate(currentDate);
      const dayOfWeek = currentDate.getDay();

      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
        continue;
      }

      // Add realized P&L from trades closed on this day
      let dayPnL = 0;
      if (tradesByDay.has(dateStr)) {
        const dayTrades = tradesByDay.get(dateStr);
        dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
        cumulativeRealizedPnL += dayPnL;
      }

      // Add cash flow from this day
      if (cashFlowByDay.has(dateStr)) {
        cumulativeCashFlow += cashFlowByDay.get(dateStr);
      }

      // Calculate realized balance (without unrealized P&L)
      const realizedBalance = startingBalance + cumulativeRealizedPnL + cumulativeCashFlow;

      // Calculate unrealized P&L for this date
      const unrealizedPnL = await this._calculateUnrealizedPnLAtDate(dateStr, allEntries);

      // Store in curve
      curve[dateStr] = {
        balance: realizedBalance + unrealizedPnL,
        realizedBalance: realizedBalance,
        unrealizedPnL: unrealizedPnL,
        dayPnL: dayPnL,
        cashFlow: cashFlowByDay.get(dateStr) || 0
      };

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    // Save cache
    this.cache = {
      version: this.CACHE_VERSION,
      dataHash: this._calculateDataHash(),
      lastCalculatedDate: this._formatDate(endDate),
      lastUpdated: Date.now(),
      curve: curve
    };
    this.saveCache();
  }

  /**
   * Fill gaps in the cache (missing dates between first and last calculated date)
   * This is called after partial invalidation to recalculate only affected dates
   */
  async _fillCacheGaps() {
    if (!this.cache || !this.cache.curve) {
      return;
    }

    const allEntries = state.journal.entries;
    if (allEntries.length === 0) {
      return;
    }

    // Get all dates that should exist (all weekdays from first entry to last calculated date)
    const firstEntry = allEntries.reduce((earliest, entry) => {
      const entryDate = new Date(entry.timestamp);
      return !earliest || entryDate < earliest ? entryDate : earliest;
    }, null);

    if (!firstEntry) return;

    const startDate = new Date(firstEntry);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(this.cache.lastCalculatedDate);
    endDate.setHours(0, 0, 0, 0);

    // Find all missing dates (gaps in the cache)
    const missingDates = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateStr = this._formatDate(currentDate);
      const dayOfWeek = currentDate.getDay();

      // Skip weekends
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        if (!this.cache.curve[dateStr]) {
          missingDates.push(dateStr);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    if (missingDates.length === 0) {
      return;
    }

    // Get tickers that were active during the missing dates
    const minMissingDate = missingDates[0];
    const maxMissingDate = missingDates[missingDates.length - 1];
    const affectedTickers = new Set();

    allEntries.forEach(trade => {
      const entryDate = this._formatDate(new Date(trade.timestamp));
      let exitDate = this._formatDate(getCurrentWeekday());

      if (trade.status === 'closed' && trade.closeDate) {
        exitDate = this._formatDate(new Date(trade.closeDate));
      }

      // If trade was active during missing dates, include its ticker
      if (exitDate >= minMissingDate && entryDate <= maxMissingDate) {
        affectedTickers.add(trade.ticker);
      }
    });

    // Fetch historical prices ONLY for affected tickers
    if (affectedTickers.size > 0) {
      const hasApiKey = historicalPricesBatcher.apiKey !== null;
      if (hasApiKey) {
        await historicalPricesBatcher.batchFetchPrices(Array.from(affectedTickers));
      }
    }

    // Recalculate missing days
    const startingBalance = state.settings.startingAccountSize;
    const cashFlowTransactions = (state.cashFlow && state.cashFlow.transactions) || [];

    // Get closed trades
    const closedTrades = allEntries
      .filter(e => e.status === 'closed' || e.status === 'trimmed')
      .map(t => ({
        date: t.closeDate || t.timestamp,
        pnl: t.totalRealizedPnL ?? t.pnl ?? 0,
        ticker: t.ticker,
        entry: t
      }));

    // Group by day
    const tradesByDay = new Map();
    closedTrades.forEach(trade => {
      const dateStr = this._formatDate(trade.date);
      if (!tradesByDay.has(dateStr)) {
        tradesByDay.set(dateStr, []);
      }
      tradesByDay.get(dateStr).push(trade);
    });

    const cashFlowByDay = new Map();
    cashFlowTransactions.forEach(transaction => {
      const dateStr = this._formatDate(transaction.timestamp);
      if (!cashFlowByDay.has(dateStr)) {
        cashFlowByDay.set(dateStr, 0);
      }
      const amount = transaction.type === 'deposit' ? transaction.amount : -transaction.amount;
      cashFlowByDay.set(dateStr, cashFlowByDay.get(dateStr) + amount);
    });

    // Calculate missing days
    for (const dateStr of missingDates) {
      // Calculate cumulative values up to this date
      const allClosedUpToDate = closedTrades.filter(t => {
        const tradeDate = this._formatDate(t.date);
        return tradeDate <= dateStr;
      });
      const cumulativeRealizedPnL = allClosedUpToDate.reduce((sum, t) => sum + t.pnl, 0);

      const allCashFlowUpToDate = cashFlowTransactions.filter(t => {
        const txDate = this._formatDate(t.timestamp);
        return txDate <= dateStr;
      });
      const cumulativeCashFlow = allCashFlowUpToDate.reduce((sum, tx) => {
        const amount = tx.type === 'deposit' ? tx.amount : -tx.amount;
        return sum + amount;
      }, 0);

      // Calculate realized balance
      const realizedBalance = startingBalance + cumulativeRealizedPnL + cumulativeCashFlow;

      // Calculate unrealized P&L
      const unrealizedPnL = await this._calculateUnrealizedPnLAtDate(dateStr, allEntries);

      // Store in cache
      this.cache.curve[dateStr] = {
        balance: realizedBalance + unrealizedPnL,
        realizedBalance: realizedBalance,
        unrealizedPnL: unrealizedPnL,
        dayPnL: tradesByDay.get(dateStr)?.reduce((sum, t) => sum + t.pnl, 0) || 0,
        cashFlow: cashFlowByDay.get(dateStr) || 0
      };
    }

    // Update last calculated date (should be the max of existing dates)
    const allDates = Object.keys(this.cache.curve).sort();
    if (allDates.length > 0) {
      this.cache.lastCalculatedDate = allDates[allDates.length - 1];
    }

    this.saveCache();
  }

  /**
   * Append new days to existing cache (from last calculated date to today)
   */
  async _appendNewDays() {
    if (!this.cache || !this.cache.curve) {
      // No cache to append to - rebuild from scratch
      await this._rebuildFullCurve();
      return;
    }

    const allEntries = state.journal.entries;
    const startingBalance = state.settings.startingAccountSize;
    const cashFlowTransactions = (state.cashFlow && state.cashFlow.transactions) || [];

    // Start from day after last calculated date
    const startDate = new Date(this.cache.lastCalculatedDate);
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);

    // End at today
    const endDate = getCurrentWeekday();
    endDate.setHours(0, 0, 0, 0);

    // If no new days, nothing to append
    if (startDate > endDate) {
      return;
    }

    // Get closed trades
    const closedTrades = allEntries
      .filter(e => e.status === 'closed' || e.status === 'trimmed')
      .map(t => ({
        date: t.closeDate || t.timestamp,
        pnl: t.totalRealizedPnL ?? t.pnl ?? 0,
        ticker: t.ticker,
        entry: t
      }));

    // Group by day
    const tradesByDay = new Map();
    closedTrades.forEach(trade => {
      const dateStr = this._formatDate(trade.date);
      if (!tradesByDay.has(dateStr)) {
        tradesByDay.set(dateStr, []);
      }
      tradesByDay.get(dateStr).push(trade);
    });

    const cashFlowByDay = new Map();
    cashFlowTransactions.forEach(transaction => {
      const dateStr = this._formatDate(transaction.timestamp);
      if (!cashFlowByDay.has(dateStr)) {
        cashFlowByDay.set(dateStr, 0);
      }
      const amount = transaction.type === 'deposit' ? transaction.amount : -transaction.amount;
      cashFlowByDay.set(dateStr, cashFlowByDay.get(dateStr) + amount);
    });

    // Fetch historical prices ONLY for tickers active during the new date range (BATCHED!)
    const hasApiKey = historicalPricesBatcher.apiKey !== null;
    if (hasApiKey) {
      // Find tickers that were active between startDate and endDate
      const affectedTickers = new Set();
      allEntries.forEach(trade => {
        const entryDate = this._formatDate(new Date(trade.timestamp));
        let exitDate = this._formatDate(endDate);

        if (trade.status === 'closed' && trade.closeDate) {
          exitDate = this._formatDate(new Date(trade.closeDate));
        }

        // If trade was active during the new date range, include its ticker
        const startDateStr = this._formatDate(startDate);
        const endDateStr = this._formatDate(endDate);
        if (exitDate >= startDateStr && entryDate <= endDateStr) {
          affectedTickers.add(trade.ticker);
        }
      });

      if (affectedTickers.size > 0) {
        console.log('[Stats] Fetching historical prices for tickers:', Array.from(affectedTickers));
        console.log('[Stats] Date range:', this._formatDate(startDate), 'to', this._formatDate(endDate));
        await historicalPricesBatcher.batchFetchPrices(Array.from(affectedTickers));
      } else {
        console.log('[Stats] No tickers need price fetching for this date range');
      }
    }

    // Get last calculated values to continue from
    const lastDateStr = this.cache.lastCalculatedDate;
    const lastData = this.cache.curve[lastDateStr];

    // Calculate cumulative values from all time
    const allClosedTradesUpToLastDate = closedTrades.filter(t => {
      const tradeDate = new Date(t.date);
      tradeDate.setHours(0, 0, 0, 0);
      const lastDate = new Date(lastDateStr);
      lastDate.setHours(0, 0, 0, 0);
      return tradeDate <= lastDate;
    });
    let cumulativeRealizedPnL = allClosedTradesUpToLastDate.reduce((sum, t) => sum + t.pnl, 0);

    const allCashFlowUpToLastDate = cashFlowTransactions.filter(t => {
      const txDate = new Date(t.timestamp);
      txDate.setHours(0, 0, 0, 0);
      const lastDate = new Date(lastDateStr);
      lastDate.setHours(0, 0, 0, 0);
      return txDate <= lastDate;
    });
    let cumulativeCashFlow = allCashFlowUpToLastDate.reduce((sum, tx) => {
      const amount = tx.type === 'deposit' ? tx.amount : -tx.amount;
      return sum + amount;
    }, 0);

    // Append new days
    const currentDate = new Date(startDate);
    while (currentDate.getTime() <= endDate.getTime()) {
      const dateStr = this._formatDate(currentDate);
      const dayOfWeek = currentDate.getDay();

      // Skip weekends
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentDate.setHours(0, 0, 0, 0);
        continue;
      }

      // Add realized P&L from trades closed on this day
      let dayPnL = 0;
      if (tradesByDay.has(dateStr)) {
        const dayTrades = tradesByDay.get(dateStr);
        dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
        cumulativeRealizedPnL += dayPnL;
      }

      // Add cash flow from this day
      if (cashFlowByDay.has(dateStr)) {
        cumulativeCashFlow += cashFlowByDay.get(dateStr);
      }

      // Calculate realized balance
      const realizedBalance = startingBalance + cumulativeRealizedPnL + cumulativeCashFlow;

      // Calculate unrealized P&L
      const unrealizedPnL = await this._calculateUnrealizedPnLAtDate(dateStr, allEntries);

      // Store in curve
      this.cache.curve[dateStr] = {
        balance: realizedBalance + unrealizedPnL,
        realizedBalance: realizedBalance,
        unrealizedPnL: unrealizedPnL,
        dayPnL: dayPnL,
        cashFlow: cashFlowByDay.get(dateStr) || 0
      };

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }

    // Update cache metadata
    this.cache.lastCalculatedDate = this._formatDate(endDate);
    this.cache.lastUpdated = Date.now();
    this.cache.dataHash = this._calculateDataHash();
    this.saveCache();
  }

  /**
   * Get filtered curve data for display (based on date range filter)
   * Returns array of {date, balance, pnl, ticker, unrealizedPnL}
   */
  _getFilteredCurve(filterStartDate = null, filterEndDate = null) {
    if (!this.cache || !this.cache.curve) return [];

    const allDates = Object.keys(this.cache.curve).sort();

    // Determine date range
    let startDateStr = filterStartDate || allDates[0];
    let endDateStr = filterEndDate || allDates[allDates.length - 1];

    // Filter dates within range
    const filteredDates = allDates.filter(dateStr => {
      return dateStr >= startDateStr && dateStr <= endDateStr;
    });

    // Convert to array format for chart
    return filteredDates.map(dateStr => {
      const data = this.cache.curve[dateStr];
      const date = this._parseDate(dateStr);
      return {
        date: date.getTime(),
        balance: data.balance,
        pnl: data.dayPnL,
        ticker: '', // Could add ticker info if needed
        unrealizedPnL: data.unrealizedPnL
      };
    });
  }
}

export const equityCurveManager = new EquityCurveManager();
export { EquityCurveManager };
