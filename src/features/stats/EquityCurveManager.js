/**
 * EquityCurveManager - REFACTORED to use EOD Cache
 *
 * Key Changes:
 * - Uses EOD cache as primary data source
 * - Only fetches from Twelve Data to fill gaps
 * - Supports waterfall updates for past trade changes
 * - Supports incremental loading with progress reporting
 */

import { state } from '../../core/state.js';
import { sleep } from '../../core/utils.js';
import { historicalPricesBatcher } from './HistoricalPricesBatcher.js';
import eodCacheManager from '../../core/eodCacheManager.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';
import * as marketHours from '../../utils/marketHours.js';
import { priceTracker } from '../../core/priceTracker.js';

class EquityCurveManager {
  constructor() {
    this.equityCurve = null;
    this.isBuilding = false;
  }

  /**
   * Main entry point: Build equity curve for date range
   * Uses EOD cache where available, fills gaps from Twelve Data
   */
  async buildEquityCurve(filterStartDate = null, filterEndDate = null) {
    if (this.isBuilding) {
      console.warn('[EquityCurve] Already building, skipping duplicate request');
      return this.equityCurve;
    }

    this.isBuilding = true;

    try {
      // Determine date range
      const startDate = filterStartDate || this._getEarliestTradeDate();
      const endDate = filterEndDate || marketHours.formatDate(new Date());

      if (!startDate) {
        // No trades yet
        this.equityCurve = {};
        return this.equityCurve;
      }

      // Check for incomplete days and backfill
      await this._backfillIncompleteDays();

      // Check for stale cache BEFORE finding missing days
      // If we have open trades but cached data shows 0 unrealized P&L, cache is stale
      if (state.journal.entries.some(t => t.status === 'open' || t.status === 'trimmed')) {
        const sampleDate = startDate;
        const cachedData = eodCacheManager.getEODData(sampleDate);

        if (cachedData && cachedData.unrealizedPnL === 0) {
          console.warn('[EquityCurve] Stale cache detected, clearing and refetching...');
          localStorage.removeItem('eodCache');
        }
      }

      // Find missing days in EOD cache (after potential cache clear)
      let missingDays = eodCacheManager.findMissingDays(startDate, endDate);

      if (missingDays.length > 0) {
        console.log(`[EquityCurve] Fetching historical prices for ${missingDays.length} days`);
        await this._fillMissingEODData(missingDays);
      }

      // Build equity curve from EOD cache
      this.equityCurve = this._buildCurveFromEODCache(startDate, endDate);

      return this.equityCurve;

    } catch (error) {
      console.error('[EquityCurve] Error building curve:', error);
      this.equityCurve = {};
      return this.equityCurve;
    } finally {
      this.isBuilding = false;
    }
  }

  /**
   * Build equity curve incrementally (for initial load with many trades)
   * Loads from most recent to oldest, respects rate limits
   */
  async buildEquityCurveIncremental(onProgress) {

    const endDate = marketHours.formatDate(new Date());
    const startDate = this._getEarliestTradeDate();

    if (!startDate) {
      if (onProgress) onProgress({ progress: 100, complete: true });
      return {};
    }

    // Get all missing days
    const missingDays = eodCacheManager.findMissingDays(startDate, endDate);

    if (missingDays.length === 0) {
      console.log('[EquityCurve] No missing days, using cached data');
      if (onProgress) onProgress({ progress: 100, complete: true });
      return this._buildCurveFromEODCache(startDate, endDate);
    }

    // Split missing days into chunks (5 days at a time)
    const chunkSize = 5;
    const chunks = this._splitIntoChunks(missingDays.reverse(), chunkSize); // Reverse to load recent first

    console.log(`[EquityCurve] Incrementally loading ${missingDays.length} days in ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Fill this chunk
      await this._fillMissingEODData(chunk);

      // Report progress
      const progress = ((i + 1) / chunks.length) * 100;
      console.log(`[EquityCurve] Progress: ${progress.toFixed(0)}% (${i + 1}/${chunks.length} chunks)`);

      if (onProgress) {
        onProgress({
          progress,
          daysLoaded: (i + 1) * chunkSize,
          totalDays: missingDays.length,
          currentChunk: chunk,
          complete: false
        });
      }

      // Throttle to respect rate limits (2 seconds between chunks)
      if (i < chunks.length - 1) {
        await sleep(2000);
      }
    }

    if (onProgress) {
      onProgress({ progress: 100, complete: true });
    }

    // Build final curve
    this.equityCurve = this._buildCurveFromEODCache(startDate, endDate);

    return this.equityCurve;
  }

  /**
   * Waterfall update: Recalculate EOD data from a specific date forward
   * Used when past trades are added/edited/deleted
   */
  async waterfallUpdate(startDate) {
    console.log(`[EquityCurve] Waterfall updating from ${startDate}`);

    const endDate = marketHours.formatDate(new Date());

    // Get all days that need recalculation
    const daysToUpdate = marketHours.getBusinessDaysBetween(startDate, endDate);

    console.log(`[EquityCurve] Updating ${daysToUpdate.length} days`);

    // Check if we have historical prices for all needed tickers
    const tickersByDay = this._getOpenPositionsByDay(daysToUpdate);
    const allTickers = new Set();

    for (const day of daysToUpdate) {
      for (const ticker of tickersByDay[day] || []) {
        allTickers.add(ticker);
      }
    }

    // Check which tickers need fetching
    const tickersToFetch = [];
    for (const ticker of allTickers) {
      const hasAllDates = this._hasHistoricalPricesForRange(ticker, startDate, endDate);
      if (!hasAllDates) {
        tickersToFetch.push(ticker);
      }
    }

    // Fetch missing prices
    if (tickersToFetch.length > 0) {
      console.log(`[EquityCurve] Fetching ${tickersToFetch.length} tickers from Twelve Data`);
      await historicalPricesBatcher.batchFetchPrices(tickersToFetch);
    }

    // Recalculate EOD for each affected day
    for (const day of daysToUpdate) {
      const openTickers = tickersByDay[day] || [];
      const eodData = await this._calculateEODForDay(day, openTickers);

      eodCacheManager.saveEODSnapshot(day, {
        ...eodData,
        source: eodCacheManager.hasEODData(day) ? 'recalculated' : 'twelve_data'
      });
    }

    // Rebuild equity curve from updated cache
    await this.buildEquityCurve();

  }

  /**
   * Invalidate cache for a specific trade (triggers waterfall on next build)
   * This is called when a trade is added/edited/deleted
   */
  invalidateForTrade(trade) {
    const affectedStartDate = this._getTradeAffectedStartDate(trade);

    if (affectedStartDate) {
      console.log(`[EquityCurve] Trade changed, will waterfall update from ${affectedStartDate}`);
      // Mark days as needing recalculation
      eodCacheManager.invalidateDaysFromDate(affectedStartDate);
    }
  }


  /**
   * Invalidate from a specific date forward
   * Used when cash flow or other changes affect historical data
   */
  invalidateFromDate(dateStr) {
    console.log(`[EquityCurve] Invalidating from date: ${dateStr}`);
    eodCacheManager.invalidateDaysFromDate(dateStr);
  }

  /**
   * Get the equity curve data
   */
  getCurve() {
    return this.equityCurve || {};
  }

  /**
   * Get balance for a specific date from curve
   */
  getBalanceOnDate(dateStr) {
    const curve = this.getCurve();
    return curve[dateStr]?.balance || null;
  }


  // =============================================================================
  // PRIVATE METHODS
  // =============================================================================

  /**
   * Build equity curve from EOD cache
   * For today's date, uses current prices instead of cached EOD
   */
  _buildCurveFromEODCache(startDate, endDate) {
    const curve = {};
    const businessDays = marketHours.getBusinessDaysBetween(startDate, endDate);
    const todayStr = marketHours.formatDate(new Date());

    for (const dateStr of businessDays) {
      // Special handling for today: use current prices instead of cached EOD
      if (dateStr === todayStr) {
        // FIX: Check if we have prices before building today's point
        // Skip today if cache is empty (prevents showing artificial cliff drop with $0 unrealized P&L)
        const activeTrades = state.journal.entries.filter(t => t.status === 'open' || t.status === 'trimmed');

        if (activeTrades.length > 0 && priceTracker.cache.size === 0) {
          console.warn('[EquityCurve] Skipping today\'s point - price cache empty for active trades');
          continue; // Skip today, use yesterday's point as latest
        }

        const currentBalance = this._calculateCurrentBalance();

        if (currentBalance !== null) {
          curve[dateStr] = {
            balance: currentBalance.balance,
            realizedBalance: currentBalance.realizedBalance,
            unrealizedPnL: currentBalance.unrealizedPnL,
            dayPnL: accountBalanceCalculator.calculateDayPnL(state.journal.entries, dateStr),
            cashFlow: currentBalance.cashFlow
          };
          continue;
        }
      }

      // For past dates: use EOD cache
      const eodData = eodCacheManager.getEODData(dateStr);

      if (eodData && !eodData.incomplete) {
        curve[dateStr] = {
          balance: eodData.balance,
          realizedBalance: eodData.realizedBalance,
          unrealizedPnL: eodData.unrealizedPnL,
          dayPnL: accountBalanceCalculator.calculateDayPnL(state.journal.entries, dateStr),
          cashFlow: eodData.cashFlow
        };
      } else {
        // Missing or incomplete data - skip this point
        // (This shouldn't happen if _fillMissingEODData worked correctly)
        console.warn(`[EquityCurve] Missing or incomplete EOD data for ${dateStr}`);
      }
    }

    // FIX: Ensure we have at least 2 points for chart rendering
    // If curve is empty or has only 1 point, add starting point
    if (Object.keys(curve).length < 2 && startDate) {
      const startingBalance = state.settings.startingAccountSize;

      // Add starting point if it doesn't exist
      if (!curve[startDate]) {
        curve[startDate] = {
          balance: startingBalance,
          realizedBalance: startingBalance,
          unrealizedPnL: 0,
          dayPnL: 0,
          cashFlow: 0
        };
      }

      // Add today's point if we still need one more
      if (Object.keys(curve).length < 2 && todayStr !== startDate) {
        const currentBalance = this._calculateCurrentBalance();
        if (currentBalance !== null && !curve[todayStr]) {
          curve[todayStr] = {
            balance: currentBalance.balance,
            realizedBalance: currentBalance.realizedBalance,
            unrealizedPnL: currentBalance.unrealizedPnL,
            dayPnL: accountBalanceCalculator.calculateDayPnL(state.journal.entries, todayStr),
            cashFlow: currentBalance.cashFlow
          };
        }
      }
    }

    return curve;
  }

  /**
   * Fill missing EOD data by fetching historical prices from Twelve Data
   */
  async _fillMissingEODData(missingDays) {
    if (missingDays.length === 0) return;

    console.log(`[EquityCurve] Filling ${missingDays.length} missing days`);

    // For each missing day, determine which stocks were open
    const tickersByDay = this._getOpenPositionsByDay(missingDays);

    // Collect unique tickers needed
    const allTickers = new Set();
    for (const day of missingDays) {
      for (const ticker of tickersByDay[day]) {
        allTickers.add(ticker);
      }
    }

    if (allTickers.size === 0) {
      console.log('[EquityCurve] No positions open on missing days, saving balance-only snapshots');

      // Still save EOD data for these days (just with no positions/unrealized P&L)
      for (const day of missingDays) {
        const eodData = await this._calculateEODForDay(day, []);
        eodCacheManager.saveEODSnapshot(day, {
          ...eodData,
          source: 'no_positions'
        });
      }
      return;
    }

    // Check which tickers already have cached prices
    const tickersToFetch = [];
    const startDate = missingDays[0];
    const endDate = missingDays[missingDays.length - 1];

    for (const ticker of allTickers) {
      const hasAllDates = this._hasHistoricalPricesForRange(ticker, startDate, endDate);
      if (!hasAllDates) {
        tickersToFetch.push(ticker);
      }
    }

    // Fetch missing prices from Twelve Data
    if (tickersToFetch.length > 0) {
      console.log(`[EquityCurve] Fetching ${tickersToFetch.length} tickers from Twelve Data`);
      await historicalPricesBatcher.batchFetchPrices(tickersToFetch);
    }

    // Calculate and save EOD data for each missing day
    for (const day of missingDays) {
      const openTickers = tickersByDay[day];
      const eodData = await this._calculateEODForDay(day, openTickers);

      eodCacheManager.saveEODSnapshot(day, {
        ...eodData,
        source: 'twelve_data'
      });
    }
  }

  /**
   * Calculate EOD data for a specific day
   */
  async _calculateEODForDay(dateStr, openTickers) {
    // Get trades open on this day
    const openTrades = this._getTradesOpenOnDate(dateStr);

    // Get EOD prices for each ticker
    const stockPrices = {};
    const missingTickers = [];

    for (const ticker of openTickers) {
      const price = await historicalPricesBatcher.getPriceOnDate(ticker, dateStr);
      if (price) {
        stockPrices[ticker] = price;
      } else {
        // FIX: Track missing tickers to mark snapshot as incomplete
        missingTickers.push(ticker);
        console.warn(`[EquityCurve] Missing price for ${ticker} on ${dateStr}`);
      }
    }

    // Use shared calculator to get balance at this date
    const balanceData = accountBalanceCalculator.calculateBalanceAtDate(dateStr, {
      startingBalance: state.settings.startingAccountSize,
      allTrades: state.journal.entries,
      cashFlowTransactions: state.cashFlow.transactions,
      eodPrices: stockPrices
    });

    // Get day's cash flow
    const dayCashFlow = accountBalanceCalculator.calculateDayCashFlow(
      state.cashFlow.transactions,
      dateStr
    );

    // FIX: Mark as incomplete if any ticker prices are missing
    const incomplete = missingTickers.length > 0;

    return {
      balance: balanceData.balance,
      realizedBalance: balanceData.realizedBalance,
      unrealizedPnL: balanceData.unrealizedPnL,
      stockPrices,
      positionsOwned: openTickers,
      cashFlow: dayCashFlow,
      timestamp: Date.now(),
      incomplete,
      missingTickers
    };
  }

  /**
   * Backfill incomplete days (days that failed to save properly)
   */
  async _backfillIncompleteDays() {
    const incompleteDays = eodCacheManager.getIncompleteDays();

    if (incompleteDays.length === 0) {
      return;
    }

    console.log(`[EquityCurve] Found ${incompleteDays.length} incomplete days, backfilling`);

    const daysToFill = incompleteDays.map(d => d.date);
    await this._fillMissingEODData(daysToFill);
  }

  /**
   * Get open positions grouped by day
   */
  _getOpenPositionsByDay(days) {
    const result = {};

    for (const day of days) {
      const openTrades = this._getTradesOpenOnDate(day);
      result[day] = [...new Set(openTrades.map(t => t.ticker))];
    }

    return result;
  }

  /**
   * Get trades that were open on a specific date
   * Includes trades that closed ON this date (need EOD price for that day)
   */
  _getTradesOpenOnDate(dateStr) {
    return state.journal.entries.filter(trade => {
      const entryDateStr = this._getEntryDateString(trade);
      const enteredBefore = entryDateStr <= dateStr;
      const notClosedYet = !trade.exitDate || trade.exitDate >= dateStr; // >= to include trades closed on this day
      return enteredBefore && notClosedYet;
    });
  }

  /**
   * Check if we have historical prices for a ticker for entire date range
   */
  _hasHistoricalPricesForRange(ticker, startDate, endDate) {
    const cacheData = historicalPricesBatcher.cache[ticker];
    if (!cacheData) return false;

    const businessDays = marketHours.getBusinessDaysBetween(startDate, endDate);

    // Check if we have data for all business days in range
    for (const day of businessDays) {
      if (!cacheData[day]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get the earliest trade date
   */
  _getEarliestTradeDate() {
    const trades = state.journal.entries;
    if (trades.length === 0) return null;

    return trades.reduce((earliest, trade) => {
      const entryDateStr = this._getEntryDateString(trade);
      return !earliest || entryDateStr < earliest ? entryDateStr : earliest;
    }, null);
  }

  /**
   * Get the affected start date for a trade (for waterfall updates)
   */
  _getTradeAffectedStartDate(trade) {
    const dates = [this._getEntryDateString(trade)];

    if (trade.exitDate) {
      dates.push(trade.exitDate);
    }

    if (trade.trimHistory && trade.trimHistory.length > 0) {
      for (const trim of trade.trimHistory) {
        dates.push(trim.date);
      }
    }

    return dates.sort()[0]; // Return earliest date
  }

  /**
   * Split array into chunks
   */
  _splitIntoChunks(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Get entry date string from trade timestamp
   * Converts timestamp to 'YYYY-MM-DD' format
   */
  _getEntryDateString(trade) {
    if (!trade.timestamp) return null;

    // If timestamp is already a string in YYYY-MM-DD format, return it
    if (typeof trade.timestamp === 'string' && trade.timestamp.match(/^\d{4}-\d{2}-\d{2}/)) {
      return trade.timestamp.substring(0, 10);
    }

    // Otherwise convert to Date and format
    const date = new Date(trade.timestamp);
    return marketHours.formatDate(date);
  }

  /**
   * Calculate current balance using live prices from priceTracker
   * Used for today's equity curve data point
   */
  _calculateCurrentBalance() {
    try {
      // Get current prices from priceTracker
      const currentPrices = priceTracker.getPricesAsObject();

      // Use shared account balance calculator with current prices
      const result = accountBalanceCalculator.calculateCurrentBalance({
        startingBalance: state.settings.startingAccountSize,
        allTrades: state.journal.entries,
        cashFlowTransactions: state.cashFlow.transactions,
        currentPrices
      });

      return {
        balance: result.balance,
        realizedBalance: result.realizedBalance,
        unrealizedPnL: result.unrealizedPnL,
        cashFlow: result.cashFlow
      };
    } catch (error) {
      console.error('[EquityCurve] Error calculating current balance:', error);
      return null;
    }
  }
}

// Create singleton instance
const equityCurveManager = new EquityCurveManager();

export { equityCurveManager, EquityCurveManager };
