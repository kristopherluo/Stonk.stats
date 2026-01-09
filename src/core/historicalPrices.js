/**
 * Historical Prices - Fetch and cache historical stock prices for equity curve
 */

class HistoricalPrices {
  constructor() {
    this.cache = {}; // { ticker: { 'YYYY-MM-DD': { open, high, low, close } } }
    this.loadCache();
    this.apiKey = null;
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  /**
   * Get historical price for a ticker on a specific date
   * Returns cached value if available, otherwise fetches from API
   */
  async getPrice(ticker, date) {
    if (!ticker || !date) return null;

    const dateStr = this.formatDate(date);

    // Check cache first
    if (this.cache[ticker] && this.cache[ticker][dateStr]) {
      return this.cache[ticker][dateStr].close;
    }

    // If not in cache, we need to fetch
    // For now, return null - fetching happens in batch
    return null;
  }

  /**
   * Fetch historical prices for a ticker
   * Uses Twelve Data TIME_SERIES endpoint
   */
  async fetchHistoricalPrices(ticker, outputSize = 'compact') {
    if (!this.apiKey) {
      console.warn('No Twelve Data API key set for historical prices');
      return null;
    }

    try {
      // Twelve Data API endpoint - outputsize: 5000 for max data
      const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=5000&apikey=${this.apiKey}`;

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

      // Parse and cache - Twelve Data format
      const prices = {};
      for (const item of data.values) {
        const date = item.datetime; // YYYY-MM-DD format
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
   * Batch fetch historical prices for multiple tickers
   * Respects API rate limits by adding delays
   */
  async batchFetchPrices(tickers, onProgress = null) {
    const results = {};
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < tickers.length; i++) {
      const ticker = tickers[i];

      if (onProgress) {
        onProgress({ current: i + 1, total: tickers.length, ticker });
      }

      // Check if we already have recent data (within last 7 days)
      if (this.hasRecentData(ticker)) {
        console.log(`Using cached data for ${ticker}`);
        results[ticker] = this.cache[ticker];
        continue;
      }

      const prices = await this.fetchHistoricalPrices(ticker);
      results[ticker] = prices;

      // Add delay between requests to respect rate limits (25 calls/day = ~1 per 3.5s to be safe)
      // Using 2 second delay to be conservative
      if (i < tickers.length - 1) {
        await delay(2000);
      }
    }

    return results;
  }

  /**
   * Check if we have recent data for a ticker (within last 2 days)
   */
  hasRecentData(ticker) {
    if (!this.cache[ticker]) return false;

    const dates = Object.keys(this.cache[ticker]);
    if (dates.length === 0) return false;

    // Get most recent date in cache
    const mostRecent = dates.sort().reverse()[0];
    const mostRecentDate = new Date(mostRecent);
    const today = new Date();
    const daysDiff = Math.floor((today - mostRecentDate) / (1000 * 60 * 60 * 24));

    // Use 2-day threshold to ensure we fetch fresh data more frequently
    // This is important for equity curve accuracy
    return daysDiff <= 2;
  }

  /**
   * Get price for a ticker on a specific date
   * If exact date not found, finds nearest previous trading day
   */
  getPriceOnDate(ticker, date) {
    if (!this.cache[ticker]) return null;

    const dateStr = this.formatDate(date);

    // Try exact match first
    if (this.cache[ticker][dateStr]) {
      return this.cache[ticker][dateStr].close;
    }

    // If not found, look for nearest previous trading day (up to 7 days back)
    const targetDate = new Date(dateStr);
    for (let i = 1; i <= 7; i++) {
      const prevDate = new Date(targetDate);
      prevDate.setDate(prevDate.getDate() - i);
      const prevDateStr = this.formatDate(prevDate);

      if (this.cache[ticker][prevDateStr]) {
        return this.cache[ticker][prevDateStr].close;
      }
    }

    return null;
  }

  /**
   * Calculate unrealized P&L for an open position on a specific date
   */
  calculateUnrealizedPnL(trade, date) {
    const price = this.getPriceOnDate(trade.ticker, date);
    if (!price) return 0;

    const shares = trade.shares || 0;
    const entry = trade.entry || 0;

    return (price - entry) * shares;
  }

  /**
   * Format date to YYYY-MM-DD string
   */
  formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Load cache from localStorage
   */
  loadCache() {
    try {
      const saved = localStorage.getItem('historicalPriceCache');
      if (saved) {
        this.cache = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load historical price cache:', error);
      this.cache = {};
    }
  }

  /**
   * Save cache to localStorage
   */
  saveCache() {
    try {
      localStorage.setItem('historicalPriceCache', JSON.stringify(this.cache));
    } catch (error) {
      console.error('Failed to save historical price cache:', error);
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
}

export const historicalPrices = new HistoricalPrices();
export { HistoricalPrices };
