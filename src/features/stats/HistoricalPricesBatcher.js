/**
 * Historical Prices Batcher - Fetch and cache historical stock prices with batching
 * IMPROVED: Batches up to 8 tickers per API call for ~75% faster fetching
 */

import { formatDate } from '../../utils/marketHours.js';
import { sleep } from '../../core/utils.js';
import { storage } from '../../utils/storage.js';

class HistoricalPricesBatcher {
  constructor() {
    this.cache = {}; // { ticker: { 'YYYY-MM-DD': { open, high, low, close } } }
    this.initialized = false;
    this.apiKey = null;
    this.BATCH_SIZE = 8; // Twelve Data free tier supports up to 8 symbols per call
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
      console.warn('No Twelve Data API key set for historical prices');
      return null;
    }

    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=${outputSize}&apikey=${this.apiKey}`;

      const response = await fetch(url);
      const data = await response.json();

      // Check for API errors
      if (data.status === 'error') {
        console.error('Twelve Data error:', data.message);
        return null;
      }

      if (!data.values || !Array.isArray(data.values)) {
        console.warn('No time series data for', ticker);
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
      this.saveCache();

      return prices;
    } catch (error) {
      console.error('Failed to fetch historical prices for', ticker, error);
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
      console.warn('No Twelve Data API key set for historical prices');
      return null;
    }

    if (tickers.length === 0) return {};

    try {
      // Join tickers with commas (max 8 for free tier)
      const symbols = tickers.slice(0, this.BATCH_SIZE).join(',');
      const url = `https://api.twelvedata.com/time_series?symbol=${symbols}&interval=1day&outputsize=${outputSize}&apikey=${this.apiKey}`;

      const response = await fetch(url);

      // Check HTTP status
      if (!response.ok) {
        console.error(`[Prices] HTTP ${response.status} ${response.statusText} - API request failed`);
        return {};
      }

      const data = await response.json();

      // Check for API-level errors (rate limiting, authentication, etc.)
      if (data.code && data.message) {
        console.error(`[Prices] Twelve Data API error (${data.code}): ${data.message}`);
        return {};
      }

      // Handle batch response
      const results = {};

      if (tickers.length === 1) {
        // Single ticker response format
        if (data.status === 'error') {
          console.error(`[Prices] Twelve Data error: ${data.message}`, data.code ? `(${data.code})` : '');
          return results;
        }

        if (data.values && Array.isArray(data.values)) {
          const ticker = tickers[0];
          const prices = {};

          console.log(`[Prices] ${ticker}: received ${data.values.length} data points`);
          if (data.values.length > 0) {
            console.log(`[Prices] ${ticker}: sample API response:`, data.values[0]);
          }

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

          console.log(`[Prices] ${ticker}: stored ${Object.keys(prices).length} days, sample stored data:`, prices[data.values[0].datetime]);

          if (!this.cache[ticker]) {
            this.cache[ticker] = {};
          }
          Object.assign(this.cache[ticker], prices);
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
              console.error(`[Prices] ${ticker}: API returned empty response (possible rate limit or API issue)`);
            } else if (data.status === 'error') {
              console.error(`[Prices] ${ticker}: ${data.message}${data.code ? ` (${data.code})` : ''}`);
            } else {
              console.error(`[Prices] ${ticker}: Not returned by API (invalid symbol, unsupported exchange, or not included in your API plan)`);
            }
            continue;
          }

          if (tickerData.status === 'error') {
            console.error(`[Prices] ${ticker}: ${tickerData.message}${tickerData.code ? ` (${tickerData.code})` : ''}`);
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
            results[ticker] = prices;
          }
        }
      }

      // Log summary of what was fetched
      const successTickers = Object.keys(results);
      const failedTickers = tickers.filter(t => !results[t]);

      if (failedTickers.length > 0) {
        console.warn(`[Prices] Batch complete: ${successTickers.length}/${tickers.length} tickers fetched. Failed: ${failedTickers.join(', ')}`);
      } else if (successTickers.length > 0) {
        console.log(`[Prices] Batch complete: successfully fetched ${successTickers.length} tickers`);
      }

      this.saveCache();
      return results;
    } catch (error) {
      console.error('Failed to fetch batch historical prices:', error);
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

    if (tickersUsingCache.length > 0) {
      console.log(`[Prices] Using cached data for ${tickersUsingCache.length} tickers:`, tickersUsingCache.join(', '));
    }

    if (tickersToFetch.length === 0) {
      console.log('[Prices] All tickers using cache - no API calls needed');
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
          console.log(`[Prices] ${ticker}: need data from ${tickerDates[ticker]} (${daysAgo} days ago)`);
          outputSize = Math.max(outputSize, daysAgo + 10); // +10 day buffer
        }
      }
    }
    outputSize = Math.min(outputSize, 500); // Cap at 500 days max
    console.log(`[Prices] Fetching with outputSize: ${outputSize}`);

    console.log(`[Prices] Fetching new data for ${tickersToFetch.length} tickers (${outputSize} days):`, tickersToFetch.join(', '));

    // Group into batches of BATCH_SIZE
    const batches = [];
    for (let i = 0; i < tickersToFetch.length; i += this.BATCH_SIZE) {
      batches.push(tickersToFetch.slice(i, i + this.BATCH_SIZE));
    }

    // Fetch each batch with delay between batches
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      if (onProgress) {
        onProgress({
          current: i * this.BATCH_SIZE + batch.length,
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
   * Historical prices don't expire - once cached, they're always valid
   */
  hasRecentData(ticker) {
    if (!this.cache[ticker]) return false;

    const dates = Object.keys(this.cache[ticker]);
    if (dates.length === 0) return false;

    // Check if cache has data from within the last 7 days
    // This ensures we refetch if cache is stale
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

    console.log(`[Prices] ${ticker}: cache check - need from ${startDate}, have ${earliestCached} to ${latestCached}, covers: ${coversStartDate}, recent: ${isRecent}`);

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
   * Load cache from IndexedDB
   */
  async loadCache() {
    try {
      const saved = await storage.getItem('historicalPriceCache');
      if (saved) {
        this.cache = saved;
      }
    } catch (error) {
      console.error('Failed to load historical price cache:', error);
      this.cache = {};
    }
  }

  /**
   * Save cache to IndexedDB
   * Automatically cleans up old data if quota exceeded
   */
  async saveCache() {
    try {
      await storage.setItem('historicalPriceCache', this.cache);
    } catch (error) {
      // If quota exceeded, clean up old data and retry
      if (error.name === 'QuotaExceededError') {
        console.warn('[HistoricalPrices] Storage quota exceeded, cleaning up old data...');

        // Import state to get trades for cleanup
        import('../../core/state.js').then(({ state }) => {
          // Use new 30-day hot window cleanup
          const today = new Date();
          const cutoffDate = new Date(today);
          cutoffDate.setDate(cutoffDate.getDate() - 30);
          const cutoffDateStr = formatDate(cutoffDate);
          const removedCount = this.cleanupPricesOlderThan(cutoffDateStr, state.journal.entries);

          if (removedCount > 0) {
            console.log(`[HistoricalPrices] Removed ${removedCount} old data points, retrying save...`);
            storage.setItem('historicalPriceCache', this.cache).then(() => {
              console.log('[HistoricalPrices] Cache saved successfully after cleanup');
            }).catch(retryError => {
              console.error('[HistoricalPrices] Still cannot save cache after cleanup:', retryError);
              // Last resort: clear entire cache
              console.warn('[HistoricalPrices] Clearing entire historical price cache...');
              this.cache = {};
              storage.removeItem('historicalPriceCache');
            });
          } else {
            // No old data to remove, cache is just too large
            console.error('[HistoricalPrices] No old data to clean up, cache size is too large');
            // Clear entire cache as last resort
            console.warn('[HistoricalPrices] Clearing entire historical price cache...');
            this.cache = {};
            storage.removeItem('historicalPriceCache');
          }
        }).catch(err => {
          console.error('[HistoricalPrices] Error during cleanup:', err);
        });
      } else {
        console.error('Failed to save historical price cache:', error);
      }
    }
  }

  /**
   * Clear cache for a specific ticker or all tickers
   */
  clearCache(ticker = null) {
    if (ticker) {
      delete this.cache[ticker];
    } else {
      this.cache = {};
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
      allTrades
        .filter(t => t.status === 'open' || t.status === 'trimmed')
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
      console.log(`[HistoricalPrices] Hot window cleanup: removed ${removedCount} old price data points`);
      console.log(`[HistoricalPrices] Kept full price history for ${activeTickers.size} active tickers:`, Array.from(activeTickers).join(', '));
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
      console.warn('[HistoricalPrices] Cannot fetch prices - invalid trade');
      return false;
    }

    // Check if we already have recent data for this ticker
    if (this.hasRecentData(trade.ticker)) {
      console.log(`[HistoricalPrices] Using cached data for ${trade.ticker}`);
      return true;
    }

    console.log(`[HistoricalPrices] Fetching historical data for ${trade.ticker} (on-demand)...`);

    try {
      const prices = await this.fetchHistoricalPrices(trade.ticker);
      return prices !== null;
    } catch (error) {
      console.error(`[HistoricalPrices] Failed to fetch prices for ${trade.ticker}:`, error);
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
      console.log('[HistoricalPrices] All trades already have cached prices');
      return {};
    }

    console.log(`[HistoricalPrices] Fetching historical data for ${tickersToFetch.length} tickers (on-demand)...`);

    // Use existing batch fetch logic
    const results = await this.batchFetchPrices(tickersToFetch, onProgress);

    return results;
  }
}

export const historicalPricesBatcher = new HistoricalPricesBatcher();
export { HistoricalPricesBatcher };
