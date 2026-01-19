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
import { sleep, getCurrentWeekday } from '../../core/utils.js';
import { historicalPricesBatcher } from './HistoricalPricesBatcher.js';
import eodCacheManager from '../../core/eodCacheManager.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';
import * as marketHours from '../../utils/marketHours.js';
import { priceTracker } from '../../core/priceTracker.js';
import { getTradesOpenOnDate, getTradeEntryDateString } from '../../utils/tradeUtils.js';

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
      const endDate = filterEndDate || marketHours.formatDate(getCurrentWeekday());

      if (!startDate) {
        // No trades yet
        this.equityCurve = {};
        return this.equityCurve;
      }

      // Check for incomplete days and backfill
      await this._backfillIncompleteDays();

      // Check for stale cache BEFORE finding missing days
      // If we have open trades but cached data shows 0 unrealized P&L AND no positions owned, cache is stale
      if (state.journal.entries.some(t => t.status === 'open' || t.status === 'trimmed')) {
        const sampleDate = startDate;
        const cachedData = eodCacheManager.getEODData(sampleDate);

        // Only consider cache stale if BOTH conditions are true:
        // 1. unrealizedPnL is 0 (could be legitimate break-even)
        // 2. positionsOwned is empty (definitely wrong if we have open trades)
        if (cachedData && cachedData.unrealizedPnL === 0 && (!cachedData.positionsOwned || cachedData.positionsOwned.length === 0)) {
          console.warn('[EquityCurve] Stale cache detected (no positions but have open trades), clearing and refetching...');
          localStorage.removeItem('eodCache');
        }
      }

      // Find missing days in EOD cache (after potential cache clear)
      let missingDays = eodCacheManager.findMissingDays(startDate, endDate);

      if (missingDays.length > 0) {
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

    const endDate = marketHours.formatDate(getCurrentWeekday());
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

    const endDate = marketHours.formatDate(getCurrentWeekday());

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
      const tickerDates = this._getOldestTradeDates(tickersToFetch);
      await historicalPricesBatcher.batchFetchPrices(tickersToFetch, null, tickerDates);
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
    const todayStr = marketHours.formatDate(getCurrentWeekday());

    for (const dateStr of businessDays) {
      const point = this._getCurvePointForDate(dateStr, todayStr);
      if (point) {
        curve[dateStr] = point;
      }
    }

    // Ensure minimum 2 points for chart rendering
    this._ensureMinimumCurvePoints(curve, startDate, todayStr);

    return curve;
  }

  /**
   * Get curve point for a specific date
   * Returns null if data unavailable
   */
  _getCurvePointForDate(dateStr, todayStr) {
    // Check if EOD data exists for this date (including today after market close)
    const eodData = eodCacheManager.getEODData(dateStr);
    if (eodData && !eodData.incomplete) {
      // Use EOD cache data (works for both past dates and today after market close)
      return this._createCurvePoint(
        eodData.balance,
        eodData.realizedBalance,
        eodData.unrealizedPnL,
        eodData.cashFlow,
        dateStr
      );
    }

    // Today (or date) without EOD data: use current/live prices
    if (dateStr === todayStr) {
      // Skip if we have active trades but no price data (prevents $0 unrealized P&L)
      const activeTrades = state.journal.entries.filter(t => t.status === 'open' || t.status === 'trimmed');
      if (activeTrades.length > 0 && priceTracker.cache.size === 0) {
        return null;
      }

      const currentBalance = this._calculateCurrentBalance();
      if (!currentBalance) return null;

      return this._createCurvePoint(
        currentBalance.balance,
        currentBalance.realizedBalance,
        currentBalance.unrealizedPnL,
        currentBalance.cashFlow,
        dateStr
      );
    }

    // Past date without EOD data: skip
    return null;
  }

  /**
   * Create a curve point object
   */
  _createCurvePoint(balance, realizedBalance, unrealizedPnL, cashFlow, dateStr) {
    return {
      balance,
      realizedBalance,
      unrealizedPnL,
      dayPnL: accountBalanceCalculator.calculateDayPnL(state.journal.entries, dateStr),
      cashFlow
    };
  }

  /**
   * Ensure curve has at least 2 points for chart rendering
   * Adds synthetic points if needed
   */
  _ensureMinimumCurvePoints(curve, startDate, todayStr) {
    if (Object.keys(curve).length >= 2) return;

    const startingBalance = state.settings.startingAccountSize;

    // Add starting point
    if (!curve[startDate]) {
      curve[startDate] = this._createCurvePoint(startingBalance, startingBalance, 0, 0, startDate);
    }

    // Add second point if still needed
    if (Object.keys(curve).length < 2) {
      const secondDate = this._getSecondPointDate(startDate, todayStr);
      const currentBalance = this._calculateCurrentBalance();

      if (currentBalance && secondDate === todayStr) {
        curve[secondDate] = this._createCurvePoint(
          currentBalance.balance,
          currentBalance.realizedBalance,
          currentBalance.unrealizedPnL,
          currentBalance.cashFlow,
          secondDate
        );
      } else {
        // Fallback: use starting balance for second point
        curve[secondDate] = this._createCurvePoint(startingBalance, startingBalance, 0, 0, secondDate);
      }
    }
  }

  /**
   * Determine the date for the second curve point
   */
  _getSecondPointDate(startDate, todayStr) {
    // If first trade is today, use today for second point
    if (startDate === todayStr) {
      return todayStr;
    }

    // Otherwise use next business day after start
    const nextDay = new Date(startDate);
    nextDay.setDate(nextDay.getDate() + 1);
    return marketHours.formatDate(nextDay);
  }

  /**
   * Fill missing EOD data by fetching historical prices from Twelve Data
   * @param {Array<string>} missingDays - Array of date strings to fill
   * @param {Object} incompleteDaysData - Optional map of date -> { missingTickers, existingData }
   *                                      For incomplete day retries, only fetches specific missing tickers
   */
  async _fillMissingEODData(missingDays, incompleteDaysData = null) {
    if (missingDays.length === 0) return;

    const isIncompleteRetry = incompleteDaysData !== null;
    console.log(`[EquityCurve] Filling ${missingDays.length} ${isIncompleteRetry ? 'incomplete' : 'missing'} days`);

    // For each missing day, determine which stocks were open
    const tickersByDay = this._getOpenPositionsByDay(missingDays);

    // Collect unique tickers needed
    const allTickers = new Set();

    if (isIncompleteRetry) {
      // For incomplete retries, only fetch the specific missing tickers
      for (const day of missingDays) {
        const dayData = incompleteDaysData[day];
        if (dayData && dayData.missingTickers) {
          for (const ticker of dayData.missingTickers) {
            allTickers.add(ticker);
          }
        }
      }
      console.log(`[EquityCurve] Incomplete retry: only fetching ${allTickers.size} missing tickers`);
    } else {
      // For new missing days, fetch all tickers
      for (const day of missingDays) {
        for (const ticker of tickersByDay[day]) {
          allTickers.add(ticker);
        }
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
      const tickerDates = this._getOldestTradeDates(tickersToFetch);
      await historicalPricesBatcher.batchFetchPrices(tickersToFetch, null, tickerDates);
    }

    // ATOMIC SAVE: Calculate all days in memory first, then save all at once
    const tempEODData = {};

    for (const day of missingDays) {
      const openTickers = tickersByDay[day];
      const eodData = await this._calculateEODForDay(day, openTickers);

      // For incomplete retries, preserve and increment retry count
      let retryCount = 0;
      if (isIncompleteRetry && incompleteDaysData[day]?.existingData) {
        retryCount = (incompleteDaysData[day].existingData.retryCount || 0) + 1;
      }

      // Store in temporary object instead of saving immediately
      tempEODData[day] = {
        ...eodData,
        source: isIncompleteRetry ? 'twelve_data_retry' : 'twelve_data',
        retryCount
      };
    }

    // Only after ALL days are calculated successfully, save them all at once
    for (const day in tempEODData) {
      eodCacheManager.saveEODSnapshot(day, tempEODData[day]);
    }

    console.log(`[EquityCurve] Atomic save: saved ${Object.keys(tempEODData).length} days to cache`);

    // Emit event so header/settings can recalculate with new EOD data
    state.emit('eodDataSaved', { days: Object.keys(tempEODData) });
  }

  /**
   * Calculate EOD data for a specific day
   */
  async _calculateEODForDay(dateStr, openTickers) {
    // Get trades open on this day
    const openTrades = this._getTradesOpenOnDate(dateStr);

    // Check if this is today (to fetch live option prices)
    const todayStr = marketHours.formatDate(getCurrentWeekday());
    const isToday = dateStr === todayStr;

    // Get EOD prices for each position
    // For stocks: Use ticker as key, fetch historical price
    // For options: Use unique key, only fetch if today (can't get historical premiums)
    const prices = {};
    const missingTickers = [];

    // Build a map of trades by ticker for option lookup
    const tradesByTicker = {};
    for (const trade of openTrades) {
      if (!tradesByTicker[trade.ticker]) {
        tradesByTicker[trade.ticker] = [];
      }
      tradesByTicker[trade.ticker].push(trade);
    }

    // Fetch prices for each ticker
    for (const ticker of openTickers) {
      const tradesForTicker = tradesByTicker[ticker] || [];

      // Check if this ticker has any options
      const hasOptions = tradesForTicker.some(t => t.assetType === 'options');

      if (hasOptions) {
        // Handle options
        for (const trade of tradesForTicker) {
          if (trade.assetType === 'options') {
            // Create unique key for this option contract
            const optionKey = `${trade.ticker}_${trade.strike}_${trade.expirationDate}_${trade.optionType}`;

            if (isToday) {
              // Fetch live option premium
              const premium = priceTracker.getOptionPrice(
                trade.ticker,
                trade.expirationDate,
                trade.optionType,
                trade.strike
              );

              if (premium) {
                prices[optionKey] = premium;
              }
              // Note: Don't mark as incomplete if option price missing - this is expected
            }
            // For past dates, don't fetch (can't get historical option premiums)
            // Just skip - unrealized P&L will be 0 for days without stored premiums
          } else {
            // Regular stock position with same ticker as an option
            const price = await historicalPricesBatcher.getPriceOnDate(ticker, dateStr);
            if (price) {
              prices[ticker] = price;
            } else {
              missingTickers.push(ticker);
              console.warn(`[EquityCurve] Missing price for ${ticker} on ${dateStr}`);
            }
          }
        }
      } else {
        // All trades for this ticker are stocks - fetch historical price
        const price = await historicalPricesBatcher.getPriceOnDate(ticker, dateStr);
        if (price) {
          prices[ticker] = price;
        } else {
          missingTickers.push(ticker);
          console.warn(`[EquityCurve] Missing price for ${ticker} on ${dateStr}`);
        }
      }
    }

    // Use shared calculator to get balance at this date
    const balanceData = accountBalanceCalculator.calculateBalanceAtDate(dateStr, {
      startingBalance: state.settings.startingAccountSize,
      allTrades: state.journal.entries,
      cashFlowTransactions: state.cashFlow.transactions,
      eodPrices: prices
    });

    // Get day's cash flow
    const dayCashFlow = accountBalanceCalculator.calculateDayCashFlow(
      state.cashFlow.transactions,
      dateStr
    );

    // Mark as incomplete if any STOCK ticker prices are missing
    // Options without prices are expected for historical dates
    const incomplete = missingTickers.length > 0;

    // Get existing retry count to increment if still incomplete
    const existingData = eodCacheManager.getEODData(dateStr);
    const currentRetryCount = existingData?.retryCount || 0;

    return {
      balance: balanceData.balance,
      realizedBalance: balanceData.realizedBalance,
      unrealizedPnL: balanceData.unrealizedPnL,
      stockPrices: prices,
      positionsOwned: openTickers,
      cashFlow: dayCashFlow,
      timestamp: Date.now(),
      incomplete,
      missingTickers,
      retryCount: incomplete ? currentRetryCount + 1 : 0
    };
  }

  /**
   * Backfill incomplete days (days that failed to save properly)
   * Days that have been retried MAX_RETRIES times are skipped to prevent infinite loops
   * OPTIMIZED: Only fetches the specific missing tickers for each incomplete day
   */
  async _backfillIncompleteDays() {
    const incompleteDays = eodCacheManager.getIncompleteDays();

    if (incompleteDays.length === 0) {
      return;
    }

    // Filter out days that have exceeded retry limit
    const MAX_RETRIES = 3;
    const daysToRetry = incompleteDays.filter(d =>
      (d.data.retryCount || 0) < MAX_RETRIES
    );

    if (daysToRetry.length === 0) {
      const skippedCount = incompleteDays.length;
      console.log(`[EquityCurve] ${skippedCount} incomplete days skipped (exceeded ${MAX_RETRIES} retry limit)`);
      return;
    }

    const skippedCount = incompleteDays.length - daysToRetry.length;
    if (skippedCount > 0) {
      console.log(`[EquityCurve] Retrying ${daysToRetry.length} incomplete days (skipped ${skippedCount} with too many retries)`);
    } else {
      console.log(`[EquityCurve] Found ${incompleteDays.length} incomplete days, backfilling`);
    }

    // Process each incomplete day individually with its specific missing tickers
    for (const incompleteDay of daysToRetry) {
      const { date, data } = incompleteDay;
      const missingTickers = data.missingTickers || [];

      if (missingTickers.length === 0) {
        console.warn(`[EquityCurve] Incomplete day ${date} has no missingTickers list, skipping`);
        continue;
      }

      console.log(`[EquityCurve] Retrying ${date} with ${missingTickers.length} missing tickers:`, missingTickers.join(', '));

      // Fetch only the missing tickers for this specific day
      await this._fillMissingEODData([date], { [date]: { missingTickers, existingData: data } });
    }
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
   * Trades that close ON this date are considered "closed" (we have exit price, not EOD price)
   */
  _getTradesOpenOnDate(dateStr) {
    return getTradesOpenOnDate(state.journal.entries, dateStr);
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
   * Get oldest trade date for each ticker (for dynamic historical price fetching)
   */
  _getOldestTradeDates(tickers) {
    const result = {};
    const trades = state.journal.entries;

    for (const ticker of tickers) {
      const tickerTrades = trades.filter(t => t.ticker === ticker);
      if (tickerTrades.length === 0) {
        result[ticker] = null;
        continue;
      }

      const oldestDate = tickerTrades.reduce((oldest, trade) => {
        const entryDate = this._getEntryDateString(trade);
        return !oldest || entryDate < oldest ? entryDate : oldest;
      }, null);

      result[ticker] = oldestDate;
    }

    return result;
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
    return getTradeEntryDateString(trade);
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
