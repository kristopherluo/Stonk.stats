/**
 * Historical Prices Batcher - Fetch and cache historical stock prices with batching
 * IMPROVED: Batches up to 8 tickers per API call for ~75% faster fetching
 */

import { formatDate } from '../../utils/marketHours.js';
import { sleep } from '../../core/utils.js';
import { storage } from '../../utils/storage.js';
import { state } from '../../core/state.js';
import { validateAndMigrate, addSchemaVersion } from '../../utils/migrations.js';
import { createLogger } from '../../utils/logger.js';
import { getOpenTrades } from '../../shared/TradeFilters.js';

const logger = createLogger('HistoricalPricesBatcher');

class HistoricalPricesBatcher {
  constructor() {
    this.cache = {}; // { ticker: { 'YYYY-MM-DD': { open, high, low, close } } }
    this.metadata = {}; // { ticker: { fetchedAt: timestamp } }
    this.initialized = false;
    this.apiKey = null;
  }

  /**
   * Get batch size from settings (configurable for different API tiers)
   * @returns {number} Batch size (default 8 for free tier)
   */
  get batchSize() {
    return state.settings.twelveDataBatchSize || 8;
  }

  /**
   * Initialize cache (async)
   */
  async init() {
    if (!this.initialized) {
      await this.loadCache();
      this.initialized = true;
    }
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Get historical price for a ticker on a specific date
   */
  async getPrice(ticker, date) {
    if (!ticker || !date) return null;

    const dateStr = formatDate(date);

    // Check cache first
    if (this.cache[ticker] && this.cache[ticker][dateStr]) {
      return this.cache[ticker][dateStr].close;
    }

    return null;
  }

  /**
   * Fetch historical prices for a single ticker
   * @param {string} ticker - Ticker symbol
   * @param {number} outputSize - Number of days to fetch (default 90)
   */
  async fetchHistoricalPrices(ticker, outputSize = 90) {
    if (!this.apiKey) {
      logger.warn('No Twelve Data API key set for historical prices');
      return null;
    }

    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=${outputSize}&apikey=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      // Check for API errors
      if (data.status === 'error') {
        logger.error('Twelve Data error:', data.message);
        return null;
      }

      if (!data.values || !Array.isArray(data.values)) {
        logger.warn('No time series data for', ticker);
        return null;
      }

      // Parse and cache
      const prices = {};
      for (const item of data.values) {
        const date = item.datetime;
        prices[date] = {
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close)
        };
      }

      // Update cache
      if (!this.cache[ticker]) {
        this.cache[ticker] = {};
      }
      Object.assign(this.cache[ticker], prices);

      // Update metadata with fetchedAt timestamp
      if (!this.metadata[ticker]) {
        this.metadata[ticker] = {};
      }
      this.metadata[ticker].fetchedAt = Date.now();

      this.saveCache();

      return prices;
    } catch (error) {
      logger.error('Failed to fetch historical prices for', ticker, error);
      return null;
    }
  }

  /**
   * Fetch historical prices for multiple tickers in a single batch request
   * Twelve Data supports comma-separated symbols
   * @param {Array<string>} tickers - Tickers to fetch
   * @param {number} outputSize - Number of days to fetch (default 90)
   */
  async fetchBatchHistoricalPrices(tickers, outputSize = 90) {
    if (!this.apiKey) {
      logger.warn('No Twelve Data API key set for historical prices');
      return null;
    }

    if (tickers.length === 0) return {};

    try {
      // Join tickers with commas (max 8 for free tier)
      const symbols = tickers.slice(0, this.batchSize).join(',');
      const url = `https://api.twelvedata.com/time_series?symbol=${symbols}&interval=1day&outputsize=${outputSize}&apikey=${this.apiKey}`;

      const response = await fetch(url);

      // Check HTTP status
      if (!response.ok) {
        logger.error(`[Prices] HTTP ${response.status} ${response.statusText} - API request failed`);
        return {};
      }

      const data = await response.json();

      // Check for API-level errors (rate limiting, authentication, etc.)
      if (data.code && data.message) {
        logger.error(`[Prices] Twelve Data API error (${data.code}): ${data.message}`);
        return {};
      }

      // Handle batch response
      const results = {};

      if (tickers.length === 1) {
        // Single ticker response format
        if (data.status === 'error') {
          logger.error(`[Prices] Twelve Data error: ${data.message}`, data.code ? `(${data.code})` : '');
          return results;
        }

        if (data.values && Array.isArray(data.values)) {
          const ticker = tickers[0];
          const prices = {};

          for (const item of data.values) {
            const date = item.datetime;
            prices[date] = {
              open: parseFloat(item.open),
              high: parseFloat(item.high),
              low: parseFloat(item.low),
              close: parseFloat(item.close),
              volume: parseInt(item.volume) || 0
            };
          }

          if (!this.cache[ticker]) {
            this.cache[ticker] = {};
          }
          Object.assign(this.cache[ticker], prices);

          // Update metadata with fetchedAt timestamp
          if (!this.metadata[ticker]) {
            this.metadata[ticker] = {};
          }
          this.metadata[ticker].fetchedAt = Date.now();

          results[ticker] = prices;
        }
      } else {
        // Multiple tickers response format (object with ticker keys)
        for (const ticker of tickers) {
          const tickerData = data[ticker];

          if (!tickerData) {
            // Ticker not in response - determine why
            const allKeys = Object.keys(data);
            if (allKeys.length === 0) {
              logger.error(`[Prices] ${ticker}: API returned empty response (possible rate limit or API issue)`);
            } else if (data.status === 'error') {
              logger.error(`[Prices] ${ticker}: ${data.message}${data.code ? ` (${data.code})` : ''}`);
            } else {
              logger.error(`[Prices] ${ticker}: Not returned by API (invalid symbol, unsupported exchange, or not included in your API plan)`);
            }
            continue;
          }

          if (tickerData.status === 'error') {
            logger.error(`[Prices] ${ticker}: ${tickerData.message}${tickerData.code ? ` (${tickerData.code})` : ''}`);
            continue;
          }

          if (tickerData.values && Array.isArray(tickerData.values)) {
            const prices = {};

            for (const item of tickerData.values) {
              const date = item.datetime;
              prices[date] = {
                open: parseFloat(item.open),
                high: parseFloat(item.high),
                low: parseFloat(item.low),
                close: parseFloat(item.close),
                volume: parseInt(item.volume) || 0
              };
            }

            if (!this.cache[ticker]) {
              this.cache[ticker] = {};
            }
            Object.assign(this.cache[ticker], prices);

            // Update metadata with fetchedAt timestamp
            if (!this.metadata[ticker]) {
              this.metadata[ticker] = {};
            }
            this.metadata[ticker].fetchedAt = Date.now();

            results[ticker] = prices;
          }
        }
      }

      // Log summary of what was fetched
      this.saveCache();
      return results;
    } catch (error) {
      logger.error('Failed to fetch batch historical prices:', error);
      return {};
    }
  }

  /**
   * Batch fetch historical prices for multiple tickers
   * IMPROVED: Groups tickers into batches of 8 for fewer API calls
   * Uses dynamic outputsize based on oldest trade date to minimize data fetching
   * @param {Array<string>} tickers - Tickers to fetch
   * @param {Function} onProgress - Progress callback
   * @param {Object} tickerDates - Map of ticker -> oldest trade date (YYYY-MM-DD)
   */
  async batchFetchPrices(tickers, onProgress = null, tickerDates = null) {
    const results = {};

    // Filter out tickers that already have cached data
    const tickersToFetch = [];
    const tickersUsingCache = [];
    for (const ticker of tickers) {
      // If tickerDates is provided, check if cache covers the needed range
      let hasSufficientCache = false;
      if (tickerDates && tickerDates[ticker]) {
        hasSufficientCache = this.hasSufficientDataForDate(ticker, tickerDates[ticker]);
      } else {
        hasSufficientCache = this.hasRecentData(ticker);
      }

      if (hasSufficientCache) {
        results[ticker] = this.cache[ticker];
        tickersUsingCache.push(ticker);
      } else {
        tickersToFetch.push(ticker);
      }
    }

    if (tickersToFetch.length === 0) {
      return results;
    }

    // Calculate dynamic outputsize based on oldest trade date
    let outputSize = 30; // Minimum 30 days
    if (tickerDates) {
      const today = new Date();
      for (const ticker of tickersToFetch) {
        if (tickerDates[ticker]) {
          const tradeDate = new Date(tickerDates[ticker]);
          const daysAgo = Math.ceil((today - tradeDate) / (1000 * 60 * 60 * 24));
          outputSize = Math.max(outputSize, daysAgo + 10); // +10 day buffer
        }
      }
    }
    outputSize = Math.min(outputSize, 500); // Cap at 500 days max

    // Group into batches of batchSize
    const batches = [];
    for (let i = 0; i < tickersToFetch.length; i += this.batchSize) {
      batches.push(tickersToFetch.slice(i, i + this.batchSize));
    }

    // Fetch each batch with delay between batches
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      if (onProgress) {
        onProgress({
          current: i * this.batchSize + batch.length,
          total: tickersToFetch.length,
          ticker: batch.join(', ')
        });
      }

      const batchResults = await this.fetchBatchHistoricalPrices(batch, outputSize);
      Object.assign(results, batchResults);

      // Add delay between batches (2 seconds to be safe with rate limits)
      if (i < batches.length - 1) {
        await sleep(2000);
      }
    }

    return results;
  }

  /**
   * Check if we have historical data for a ticker
   * Uses fetchedAt timestamp to determine freshness (more reliable than data dates)
   */
  hasRecentData(ticker) {
    if (!this.cache[ticker]) return false;

    const dates = Object.keys(this.cache[ticker]);
    if (dates.length === 0) return false;

    // Check fetchedAt timestamp if available (preferred method)
    if (this.metadata[ticker]?.fetchedAt) {
      const daysSinceFetch = (Date.now() - this.metadata[ticker].fetchedAt) / (1000 * 60 * 60 * 24);
      // If fetched within the last 7 days, consider it recent
      return daysSinceFetch <= 7;
    }

    // Fallback to checking data dates (for backward compatibility with old cache)
    const mostRecentDate = dates.sort().reverse()[0]; // Get latest date
    const daysSinceUpdate = (new Date() - new Date(mostRecentDate)) / (1000 * 60 * 60 * 24);

    // If most recent cached data is older than 7 days, refetch
    return daysSinceUpdate <= 7;
  }

  /**
   * Check if we have sufficient historical data for a ticker starting from a specific date
   * @param {string} ticker - Stock ticker
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @returns {boolean} True if cache covers from startDate to recent
   */
  hasSufficientDataForDate(ticker, startDate) {
    if (!this.cache[ticker]) return false;

    const dates = Object.keys(this.cache[ticker]).sort();
    if (dates.length === 0) return false;

    const earliestCached = dates[0];
    const latestCached = dates[dates.length - 1];

    // Check if earliest cached date is on or before the start date we need
    const coversStartDate = earliestCached <= startDate;

    // Check if latest cached date is recent (within last 7 days)
    const daysSinceUpdate = (new Date() - new Date(latestCached)) / (1000 * 60 * 60 * 24);
    const isRecent = daysSinceUpdate <= 7;

    return coversStartDate && isRecent;
  }

  /**
   * Get price for a ticker on a specific date
   * If exact date not found, finds nearest previous trading day
   */
  getPriceOnDate(ticker, date) {
    if (!this.cache[ticker]) return null;

    const dateStr = typeof date === 'string' ? date : formatDate(date);

    // Try exact match first
    if (this.cache[ticker][dateStr]) {
      return this.cache[ticker][dateStr].close;
    }

    // If not found, look for nearest previous trading day (up to 7 days back)
    const targetDate = new Date(dateStr);
    for (let i = 1; i <= 7; i++) {
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - i);
      const prevDateStr = formatDate(prevDate);

      if (this.cache[ticker][prevDateStr]) {
        return this.cache[ticker][prevDateStr].close;
      }
    }

    return null;
  }


  /**
   * Load cache from IndexedDB with schema migration support
   */
  async loadCache() {
    try {
      const saved = await storage.getItem('historicalPriceCache');
      if (saved) {
        // Validate and migrate if needed
        const migrated = validateAndMigrate('historicalPriceCache', saved);

        // Handle both old format (just prices) and new format (with __metadata)
        if (migrated.__metadata) {
          this.metadata = migrated.__metadata;
          delete migrated.__metadata; // Remove metadata from cache object
          delete migrated.__schemaVersion; // Remove version marker
          this.cache = migrated;
        } else {
          // Old format without metadata
          this.cache = migrated;
          this.metadata = {};
        }
      }
    } catch (error) {
      logger.error('Failed to load historical price cache:', error);
      this.cache = {};
      this.metadata = {};
    }
  }

  /**
   * Save cache to IndexedDB
   * Proactively cleans up if approaching quota (80%), then handles quota errors reactively
   */
  async saveCache() {
    // Proactive cleanup: Check if approaching 80% quota before saving
    try {
      const approachingQuota = await storage.isApproachingQuota();
      if (approachingQuota) {
        logger.warn('[HistoricalPrices] Storage at 80% capacity, running proactive cleanup...');

        const { state } = await import('../../core/state.js');
        const today = new Date();
        const cutoffDate = new Date(today);
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const cutoffDateStr = formatDate(cutoffDate);
        const removedCount = this.cleanupPricesOlderThan(cutoffDateStr, state.journal.entries);

        if (removedCount > 0) {
          logger.debug(`[HistoricalPrices] Proactive cleanup: removed ${removedCount} old data points`);
        }
      }
    } catch (quotaCheckError) {
      logger.warn('[HistoricalPrices] Could not check quota, proceeding with save:', quotaCheckError);
    }

    // Attempt to save
    try {
      // Combine cache and metadata for storage, add schema version
      const dataToSave = addSchemaVersion('historicalPriceCache', {
        ...this.cache,
        __metadata: this.metadata
      });
      await storage.setItem('historicalPriceCache', dataToSave);
    } catch (error) {
      // Reactive cleanup: If quota exceeded despite proactive check, clean up and retry
      if (error.name === 'QuotaExceededError') {
        logger.warn('[HistoricalPrices] Storage quota exceeded, emergency cleanup...');

        // Import state to get trades for cleanup
        import('../../core/state.js').then(({ state }) => {
          // Use new 30-day hot window cleanup
          const today = new Date();
          const cutoffDate = new Date(today);
          cutoffDate.setDate(cutoffDate.getDate() - 30);
          const cutoffDateStr = formatDate(cutoffDate);
          const removedCount = this.cleanupPricesOlderThan(cutoffDateStr, state.journal.entries);

          if (removedCount > 0) {
            logger.debug(`[HistoricalPrices] Emergency: removed ${removedCount} old data points, retrying save...`);
            const dataToSave = addSchemaVersion('historicalPriceCache', {
              ...this.cache,
              __metadata: this.metadata
            });
            storage.setItem('historicalPriceCache', dataToSave).then(() => {
              logger.debug('[HistoricalPrices] Cache saved successfully after emergency cleanup');
            }).catch(retryError => {
              logger.error('[HistoricalPrices] Still cannot save cache after cleanup:', retryError);
              // Last resort: clear entire cache
              logger.warn('[HistoricalPrices] Clearing entire historical price cache...');
              this.cache = {};
              this.metadata = {};
              storage.removeItem('historicalPriceCache');
            });
          } else {
            // No old data to remove, cache is just too large
            logger.error('[HistoricalPrices] No old data to clean up, cache size is too large');
            // Clear entire cache as last resort
            logger.warn('[HistoricalPrices] Clearing entire historical price cache...');
            this.cache = {};
            this.metadata = {};
            storage.removeItem('historicalPriceCache');
          }
        }).catch(err => {
          logger.error('[HistoricalPrices] Error during emergency cleanup:', err);
        });
      } else {
        logger.error('Failed to save historical price cache:', error);
      }
    }
  }

  /**
   * Clear cache for a specific ticker or all tickers
   */
  clearCache(ticker = null) {
    if (ticker) {
      delete this.cache[ticker];
      delete this.metadata[ticker];
    } else {
      this.cache = {};
      this.metadata = {};
    }
    this.saveCache();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const tickers = Object.keys(this.cache);
    const totalDays = tickers.reduce((sum, ticker) => {
      return sum + Object.keys(this.cache[ticker]).length;
    }, 0);

    return {
      tickers: tickers.length,
      totalDataPoints: totalDays,
      tickerList: tickers
    };
  }


  /**
   * Clean up prices older than cutoff date (30-day hot window)
   * Keeps prices for:
   * 1. All dates within the hot window (last 30 days)
   * 2. Any ticker with open/trimmed positions (regardless of age)
   * Deletes everything else to save storage
   * @param {string} cutoffDate - Date in 'YYYY-MM-DD' format (30 days ago)
   * @param {Array} allTrades - All trades from journal
   * @returns {number} Number of data points removed
   */
  cleanupPricesOlderThan(cutoffDate, allTrades = []) {
    // Get tickers with open/trimmed positions - keep ALL their prices
    const activeTickers = new Set(
      getOpenTrades(allTrades)
        .map(t => t.ticker)
    );

    let removedCount = 0;

    // For each ticker in cache
    for (const ticker in this.cache) {
      // If ticker has active positions, skip cleanup for this ticker
      if (activeTickers.has(ticker)) {
        continue;
      }

      // Otherwise, delete prices older than cutoff date
      const dates = Object.keys(this.cache[ticker]);
      for (const date of dates) {
        if (date < cutoffDate) {
          delete this.cache[ticker][date];
          removedCount++;
        }
      }

      // If ticker has no prices left, remove it entirely
      if (Object.keys(this.cache[ticker]).length === 0) {
        delete this.cache[ticker];
      }
    }

    if (removedCount > 0) {
      logger.debug(`[HistoricalPrices] Hot window cleanup: removed ${removedCount} old price data points`);
      logger.debug(`[HistoricalPrices] Kept full price history for ${activeTickers.size} active tickers:`, Array.from(activeTickers).join(', '));
      this.saveCache();
    }

    return removedCount;
  }

  /**
   * Fetch missing historical prices for a specific trade
   * Used when editing/adding old trades (outside 30-day hot window)
   * @param {Object} trade - Trade object with ticker and timestamp
   * @returns {Promise<boolean>} True if prices fetched successfully
   */
  async fetchMissingPricesForTrade(trade) {
    if (!trade || !trade.ticker) {
      logger.warn('[HistoricalPrices] Cannot fetch prices - invalid trade');
      return false;
    }

    // Check if we already have recent data for this ticker
    if (this.hasRecentData(trade.ticker)) {
      logger.debug(`[HistoricalPrices] Using cached data for ${trade.ticker}`);
      return true;
    }

    logger.debug(`[HistoricalPrices] Fetching historical data for ${trade.ticker} (on-demand)...`);

    try {
      const prices = await this.fetchHistoricalPrices(trade.ticker);
      return prices !== null;
    } catch (error) {
      logger.error(`[HistoricalPrices] Failed to fetch prices for ${trade.ticker}:`, error);
      return false;
    }
  }

  /**
   * Batch fetch missing prices for multiple trades
   * Used when editing/adding multiple old trades at once
   * @param {Array} trades - Array of trade objects
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise<Object>} Map of ticker -> success/failure
   */
  async fetchMissingPricesForTrades(trades, onProgress = null) {
    if (!trades || trades.length === 0) return {};

    // Get unique tickers that need fetching
    const tickersToFetch = [...new Set(trades.map(t => t.ticker))]
      .filter(ticker => !this.hasRecentData(ticker));

    if (tickersToFetch.length === 0) {
      logger.debug('[HistoricalPrices] All trades already have cached prices');
      return {};
    }

    logger.debug(`[HistoricalPrices] Fetching historical data for ${tickersToFetch.length} tickers (on-demand)...`);

    // Use existing batch fetch logic
    const results = await this.batchFetchPrices(tickersToFetch, onProgress);

    return results;
  }
}

export const historicalPricesBatcher = new HistoricalPricesBatcher();
export { HistoricalPricesBatcher };
