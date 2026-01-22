/**
 * Price Tracker - Fetches real-time stock prices from Finnhub API
 * UPDATED: Uses trading day logic for cache expiry (9:30am EST boundary)
 */

import { state } from './state.js';
import { sleep } from './utils.js';
import * as marketHours from '../utils/marketHours.js';
import { storage } from '../utils/storage.js';
import { compressText, decompressText } from '../utils/compression.js';
import { validateAndMigrate, addSchemaVersion } from '../utils/migrations.js';
import { STORAGE_LIMITS, CACHE_KEYS, OPTIONS_CONTRACT_MULTIPLIER, TIME_CONSTANTS } from '../constants/index.js';
import { createLogger } from '../utils/logger.js';
import { getOpenTrades } from '../shared/TradeFilters.js';
import accountBalanceCalculator from '../shared/AccountBalanceCalculator.js';

const logger = createLogger('PriceTracker');
const CACHE_KEY = CACHE_KEYS.PRICE_CACHE;
const OPTIONS_CACHE_KEY = CACHE_KEYS.OPTIONS_PRICE_CACHE;
const SUMMARY_CACHE_KEY = CACHE_KEYS.SUMMARY_CACHE;
const MAX_SUMMARY_CACHE = STORAGE_LIMITS.SUMMARY_CACHE_MAX_ITEMS;

export const priceTracker = {
  apiKey: null,
  optionsApiKey: null,
  cache: new Map(),
  optionsCache: new Map(),
  decompressedSummariesCache: new Map(), // In-memory cache for decompressed summaries
  lastFetchDate: null,
  _fetchInProgress: false,
  _fetchPromise: null,
  _optionsRotationIndex: 0, // Track which options positions to fetch next

  async init() {
    // Load API key from IndexedDB
    this.apiKey = (await storage.getItem('finnhubApiKey')) || '';
    this.optionsApiKey = (await storage.getItem('optionsPriceApiKey')) || '';

    // Load price cache from IndexedDB
    await this.loadCache();
  },

  async loadCache() {
    try {
      // Load stock prices cache with migration support
      const cached = await storage.getItem(CACHE_KEY);
      if (cached) {
        const migrated = validateAndMigrate('riskCalcPriceCache', cached);
        const { prices, date, tradingDay } = migrated;
        this.lastFetchDate = new Date(date);

        // Check if cache is still valid (same trading day)
        // A trading day runs from 9:30am EST to next 9:30am EST
        const currentTradingDay = marketHours.getTradingDay();
        if (tradingDay && tradingDay === currentTradingDay) {
          this.cache = new Map(Object.entries(prices));
        }
      }

      // Load options prices cache with migration support
      const optionsCached = await storage.getItem(OPTIONS_CACHE_KEY);
      if (optionsCached) {
        const migrated = validateAndMigrate('optionsPriceCache', optionsCached);
        const { prices, tradingDay } = migrated;

        // Check if cache is still valid (same trading day)
        const currentTradingDay = marketHours.getTradingDay();
        if (tradingDay && tradingDay === currentTradingDay) {
          this.optionsCache = new Map(Object.entries(prices));
          logger.debug(`[PriceTracker] Loaded ${this.optionsCache.size} options prices from cache`);
        }
      }
    } catch (e) {
      logger.error('Failed to load price cache:', e);
    }
  },

  async saveCache() {
    try {
      const prices = Object.fromEntries(this.cache);
      const now = new Date();
      const dataToSave = addSchemaVersion('riskCalcPriceCache', {
        prices,
        date: now.toISOString(),
        tradingDay: marketHours.getTradingDay(now) // Store trading day for proper expiry
      });
      await storage.setItem(CACHE_KEY, dataToSave);
    } catch (e) {
      logger.error('Failed to save price cache:', e);
    }
  },

  async saveOptionsCache() {
    try {
      const prices = Object.fromEntries(this.optionsCache);
      const now = new Date();
      const dataToSave = addSchemaVersion('optionsPriceCache', {
        prices,
        date: now.toISOString(),
        tradingDay: marketHours.getTradingDay(now) // Store trading day for proper expiry
      });
      await storage.setItem(OPTIONS_CACHE_KEY, dataToSave);
      logger.debug(`[PriceTracker] Saved ${this.optionsCache.size} options prices to cache`);
    } catch (e) {
      logger.error('Failed to save options price cache:', e);
    }
  },

  async fetchPrice(ticker) {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${ticker.toUpperCase()}&token=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Check if ticker is invalid (Finnhub returns 0 for all values when ticker doesn't exist)
      if (data.c === 0 && data.pc === 0) {
        throw new Error(`Invalid ticker symbol: ${ticker.toUpperCase()}`);
      }

      // Finnhub returns: c (current), h (high), l (low), o (open), pc (previous close)
      // Use previous close when market is closed to avoid after-hours prices
      const isMarketOpen = marketHours.isMarketOpen();
      const priceToUse = isMarketOpen ? data.c : data.pc;

      return {
        ticker: ticker.toUpperCase(),
        price: priceToUse,
        change: data.d,
        changePercent: data.dp,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Failed to fetch price for ${ticker}:`, error);
      throw error;
    }
  },

  /**
   * Fetch company profile from Finnhub API
   * Returns: { name, industry, country }
   */
  // Helper to convert text to title case
  toTitleCase(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  },

  // Get cached company data
  async getCachedCompanyData(ticker) {
    try {
      const cache = await storage.getItem('companyDataCache');
      if (!cache) return null;

      const data = cache[ticker.toUpperCase()];

      if (data && data.cachedAt) {
        // Cache expires after 30 days
        const age = Date.now() - data.cachedAt;
        const thirtyDays = TIME_CONSTANTS.THIRTY_DAYS_MS;

        if (age < thirtyDays) {
          return data;
        }
      }

      return null;
    } catch (e) {
      logger.error('Error reading company data cache:', e);
      return null;
    }
  },

  // Save company data to cache
  async saveCompanyDataToCache(ticker, data) {
    try {
      const cache = await storage.getItem('companyDataCache');
      const parsed = cache || {};

      parsed[ticker.toUpperCase()] = {
        ...data,
        cachedAt: Date.now()
      };

      await storage.setItem('companyDataCache', parsed);
    } catch (e) {
      logger.error('Error saving company data cache:', e);
    }
  },

  async fetchCompanyProfile(ticker) {
    if (!this.apiKey) {
      return null; // Silently return null if no API key
    }

    // Check cache first - but only use it if it has industry data (full Finnhub profile)
    // Cached data might only have summary (from Alpha Vantage) without industry
    const cached = await this.getCachedCompanyData(ticker);
    if (cached && cached.industry) {
      return cached;
    }

    try {
      const response = await fetch(
        `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker.toUpperCase()}&token=${this.apiKey}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      // Finnhub returns empty object if ticker not found
      if (!data || Object.keys(data).length === 0 || !data.name) {
        return null;
      }

      // Finnhub returns: name, finnhubIndustry, country, weburl, logo, etc.
      // Check if there's a description field (not documented but might exist)
      // Normalize industry to title case
      const profile = {
        ticker: ticker.toUpperCase(),
        name: data.name || '',
        industry: this.toTitleCase(data.finnhubIndustry || ''),
        country: data.country || '',
        weburl: data.weburl || '',
        logo: data.logo || '',
        // Check for any description-like fields
        description: data.description || data.longBusinessSummary || ''
      };

      // Cache the data
      await this.saveCompanyDataToCache(ticker, profile);

      return profile;
    } catch (error) {
      logger.error(`[Company Profile] ❌ Failed to fetch profile for ${ticker}:`, error);
      return null;
    }
  },

  /**
   * Get cached company summary (decompressed)
   * Returns: { summary, name, sector, industry } or null
   * Uses in-memory cache for decompressed summaries to avoid repeated decompression
   */
  async getCachedSummary(ticker) {
    try {
      const upperTicker = ticker.toUpperCase();

      // Check in-memory cache first (already decompressed)
      if (this.decompressedSummariesCache.has(upperTicker)) {
        const cached = this.decompressedSummariesCache.get(upperTicker);
        // Verify it's not expired
        const age = Date.now() - cached.cachedAt;
        const thirtyDays = TIME_CONSTANTS.THIRTY_DAYS_MS;
        if (age < thirtyDays) {
          return cached;
        }
        // Expired, remove from memory cache
        this.decompressedSummariesCache.delete(upperTicker);
      }

      // Not in memory, check IndexedDB
      const cache = await storage.getItem(SUMMARY_CACHE_KEY);
      if (!cache || !cache.summaries) return null;

      const entry = cache.summaries[upperTicker];
      if (!entry) return null;

      // Check if cache is expired (30 days)
      const age = Date.now() - entry.cachedAt;
      const thirtyDays = TIME_CONSTANTS.THIRTY_DAYS_MS;
      if (age >= thirtyDays) {
        return null;
      }

      // Decompress summary
      const decompressed = {
        ...entry,
        summary: decompressText(entry.summary)
      };

      // Cache decompressed version in memory for future accesses
      this.decompressedSummariesCache.set(upperTicker, decompressed);

      return decompressed;
    } catch (e) {
      logger.error('[Summary Cache] Error reading cache:', e);
      return null;
    }
  },

  /**
   * Save company summary to cache (compressed, LRU eviction)
   * Keeps only 30 most recent summaries
   */
  async saveSummaryToCache(ticker, summaryData) {
    try {
      const cache = await storage.getItem(SUMMARY_CACHE_KEY) || { summaries: {}, accessOrder: [] };

      // Compress the summary text (often 1000+ chars)
      const compressed = {
        ticker: ticker.toUpperCase(),
        name: summaryData.name,
        sector: summaryData.sector,
        industry: summaryData.industry,
        summary: compressText(summaryData.summary),
        cachedAt: Date.now()
      };

      // Update summaries
      cache.summaries[ticker.toUpperCase()] = compressed;

      // Update access order (most recent at end)
      cache.accessOrder = cache.accessOrder.filter(t => t !== ticker.toUpperCase());
      cache.accessOrder.push(ticker.toUpperCase());

      // Evict oldest if over limit
      if (cache.accessOrder.length > MAX_SUMMARY_CACHE) {
        const toRemove = cache.accessOrder.shift(); // Remove oldest
        delete cache.summaries[toRemove];
      }

      await storage.setItem(SUMMARY_CACHE_KEY, cache);
    } catch (e) {
      logger.error('[Summary Cache] Error saving cache:', e);
    }
  },

  /**
   * Fetch company summary/description from Alpha Vantage
   * Returns: { summary: string, name: string, sector: string, industry: string }
   */
  async fetchCompanySummary(ticker) {
    // Check cache first
    const cached = await this.getCachedSummary(ticker);
    if (cached) {
      return cached;
    }

    const alphaVantageKey = await storage.getItem('alphaVantageApiKey');

    if (!alphaVantageKey) {
      throw new Error('Alpha Vantage API key not configured. Add it in Settings to fetch company summaries.');
    }

    const summary = await this.fetchCompanySummaryFromAlphaVantage(ticker, alphaVantageKey);

    // Cache the result
    await this.saveSummaryToCache(ticker, summary);

    return summary;
  },

  async fetchCompanySummaryFromAlphaVantage(ticker, apiKey) {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker.toUpperCase()}&apikey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch company overview from Alpha Vantage (${response.status})`);
    }

    const data = await response.json();

    // Check for API errors
    if (data.Note) {
      throw new Error('Alpha Vantage API rate limit reached. Free tier: 25 calls/day, 5 calls/minute.');
    }

    if (data['Error Message']) {
      throw new Error('Invalid ticker or no data available from Alpha Vantage');
    }

    if (!data.Name) {
      throw new Error('No company overview data available from Alpha Vantage');
    }

    // Alpha Vantage returns: Name, Description, Sector, Industry, etc.
    return {
      ticker: ticker.toUpperCase(),
      name: data.Name || '',
      sector: data.Sector || '',
      industry: data.Industry || '',
      summary: data.Description || ''
    };
  },

  async fetchPrices(tickers) {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured. Add it in Settings.');
    }

    const results = {
      success: [],
      failed: []
    };

    // Fetch prices sequentially to respect rate limits (60/min is generous)
    for (const ticker of tickers) {
      try {
        const priceData = await this.fetchPrice(ticker);
        this.cache.set(ticker.toUpperCase(), priceData);
        results.success.push(priceData);

        // Small delay to be respectful of API (not strictly necessary with 60/min limit)
        await sleep(100);
      } catch (error) {
        results.failed.push({ ticker, error: error.message });
      }
    }

    // Save cache after fetching all prices
    this.lastFetchDate = new Date();
    await this.saveCache();

    return results;
  },

  async refreshAllActivePrices() {
    // Only refresh prices during market hours to avoid after-hours contamination
    if (!marketHours.isMarketOpen()) {
      logger.debug('[PriceTracker] Market closed, skipping price refresh');
      return { success: [], failed: [] };
    }

    const trades = state.journal.entries;
    const activeTrades = getOpenTrades(trades);
    const tickers = [...new Set(activeTrades.map(t => t.ticker).filter(Boolean))];

    if (tickers.length === 0) {
      return { success: [], failed: [] };
    }

    return await this.fetchPrices(tickers);
  },

  /**
   * Fetch active prices with race condition guard
   * Deduplicates concurrent requests by returning same promise
   */
  async fetchActivePrices() {
    // Return existing fetch if already in progress
    if (this._fetchInProgress) {
      return this._fetchPromise;
    }

    this._fetchInProgress = true;
    this._fetchPromise = this.refreshAllActivePrices().finally(() => {
      this._fetchInProgress = false;
      this._fetchPromise = null;
    });

    return this._fetchPromise;
  },

  getPrice(ticker) {
    if (!ticker) return null;
    return this.cache.get(ticker.toUpperCase());
  },

  /**
   * Convert price cache Map to plain object
   * Useful for passing to calculators that expect object format
   * @returns {Object} Object with ticker → price data mappings
   */
  getPricesAsObject() {
    return Object.fromEntries(this.cache);
  },

  calculateUnrealizedPnL(trade) {
    const priceData = this.getPrice(trade.ticker);
    if (!priceData) return null;

    const currentPrice = priceData.price;
    const result = accountBalanceCalculator.calculateTradeUnrealizedPnL(trade, currentPrice);

    // Include priceData for backwards compatibility
    return {
      ...result,
      priceData
    };
  },

  async setApiKey(key) {
    this.apiKey = key;
    await storage.setItem('finnhubApiKey', key);
  },

  getLastFetchTime() {
    return this.lastFetchDate;
  },

  /**
   * Fetch historical daily candle data for a stock using Twelve Data API
   * Fetches 1 year before entry + 3 months after (or today, whichever is sooner)
   * @param {string} ticker - Stock ticker symbol
   * @param {Date} entryDate - Entry date
   * @param {number} daysBack - Days before entry (default 365)
   * @param {number} daysForward - Days after entry (default 90)
   * @returns {Promise<Array>} Array of candle data {time, open, high, low, close}
   */
  async fetchHistoricalCandles(ticker, entryDate, daysBack = 365, daysForward = 90) {
    const twelveDataKey = await storage.getItem('twelveDataApiKey');
    if (!twelveDataKey) {
      throw new Error('Twelve Data API key not configured. Add it in Settings to view charts.');
    }

    return await this.fetchHistoricalCandlesFromTwelveData(ticker, entryDate, daysBack, twelveDataKey);
  },

  async fetchHistoricalCandlesFromTwelveData(ticker, entryDate, daysBack, apiKey) {
    const entryDateObj = new Date(entryDate);
    const fromDate = new Date(entryDateObj);
    fromDate.setDate(fromDate.getDate() - daysBack);

    // Twelve Data uses outputsize parameter (max 5000 for free tier)
    // We'll request enough days to cover our range
    const outputsize = Math.min(daysBack + 90, 5000);

    const url = `https://api.twelvedata.com/time_series?symbol=${ticker.toUpperCase()}&interval=1day&outputsize=${outputsize}&apikey=${apiKey}&format=JSON`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch data (${response.status})`);
    }

    const data = await response.json();

    // Check for errors
    if (data.status === 'error') {
      throw new Error(data.message || 'Twelve Data API error');
    }

    if (!data.values || data.values.length === 0) {
      throw new Error('No data available for this ticker from Twelve Data');
    }

    // Convert Twelve Data format to our candle format
    // Twelve Data returns: {datetime, open, high, low, close, volume}
    const candles = data.values
      .map(item => {
        const date = new Date(item.datetime);
        return {
          time: Math.floor(date.getTime() / 1000),
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close),
          volume: parseFloat(item.volume || 0)
        };
      })
      .sort((a, b) => a.time - b.time); // Sort oldest to newest

    return candles;
  },

  /**
   * Format option contract for Polygon.io API
   * Format: O:TICKER{YYMMDD}{C/P}{STRIKE*1000}
   * Example: O:AAPL250117C00150000 (AAPL $150 Call expiring Jan 17, 2025)
   */
  formatOptionSymbol(ticker, expirationDate, optionType, strike) {
    // Parse expiration date (YYYY-MM-DD format)
    const date = new Date(expirationDate + 'T00:00:00');
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    // Format: YYMMDD
    const dateStr = `${year}${month}${day}`;

    // Option type: C or P
    const typeStr = optionType === 'call' ? 'C' : 'P';

    // Strike price: multiply by 1000 and pad to 8 digits
    const strikeStr = Math.round(strike * 1000).toString().padStart(8, '0');

    return `O:${ticker.toUpperCase()}${dateStr}${typeStr}${strikeStr}`;
  },

  /**
   * Fetch current price for an options contract from Polygon.io
   * Uses previous day's close (free tier) or snapshot (paid tier)
   */
  async fetchOptionPrice(ticker, expirationDate, optionType, strike) {
    if (!this.optionsApiKey) {
      return null;
    }

    const symbol = this.formatOptionSymbol(ticker, expirationDate, optionType, strike);

    try {
      // Try previous day's aggregate first (available on free tier)
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${this.optionsApiKey}`
      );

      if (!response.ok) {
        logger.error(`Polygon API error for ${symbol}: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.status === 'OK' && data.results && data.results.length > 0) {
        const result = data.results[0];
        return {
          price: result.c, // Close price from previous day
          timestamp: result.t
        };
      }

      return null;
    } catch (error) {
      logger.error(`Error fetching option price for ${symbol}:`, error);
      return null;
    }
  },

  /**
   * Refresh options prices with rotation strategy
   * Fetches up to 5 options per call to respect Polygon's 5 calls/min limit
   */
  async refreshOptionsPrices(optionsTrades) {
    if (!this.optionsApiKey || !optionsTrades || optionsTrades.length === 0) {
      return { success: [], failed: [] };
    }

    const results = {
      success: [],
      failed: []
    };

    // Determine which 5 positions to fetch this rotation
    const totalPositions = optionsTrades.length;
    const batchSize = Math.min(5, totalPositions);

    // Calculate start index for this batch using rotation
    const startIndex = this._optionsRotationIndex % totalPositions;
    const tradesToFetch = [];

    // Get up to 5 trades, wrapping around if needed
    for (let i = 0; i < batchSize; i++) {
      const index = (startIndex + i) % totalPositions;
      tradesToFetch.push(optionsTrades[index]);
    }

    // Update rotation index for next call
    this._optionsRotationIndex = (startIndex + batchSize) % totalPositions;

    // Fetch prices for selected trades
    for (const trade of tradesToFetch) {
      try {
        const priceData = await this.fetchOptionPrice(
          trade.ticker,
          trade.expirationDate,
          trade.optionType,
          trade.strike
        );

        if (priceData) {
          // Cache the price
          const cacheKey = `${trade.ticker}-${trade.expirationDate}-${trade.optionType}-${trade.strike}`;
          this.optionsCache.set(cacheKey, {
            price: priceData.price,
            timestamp: Date.now()
          });

          results.success.push(trade.ticker);
        } else {
          results.failed.push(trade.ticker);
        }

        // Small delay between requests to be respectful
        await sleep(200);
      } catch (error) {
        logger.error(`Error fetching price for ${trade.ticker} option:`, error);
        results.failed.push(trade.ticker);
      }
    }

    // Save options cache to IndexedDB after fetching
    if (results.success.length > 0) {
      await this.saveOptionsCache();
    }

    return results;
  },

  /**
   * Get cached option price
   */
  getOptionPrice(ticker, expirationDate, optionType, strike) {
    const cacheKey = `${ticker}-${expirationDate}-${optionType}-${strike}`;
    const cached = this.optionsCache.get(cacheKey);

    if (cached) {
      return cached.price;
    }

    return null;
  },

  /**
   * Calculate unrealized P&L for an options trade
   */
  calculateOptionsUnrealizedPnL(trade) {
    const currentPrice = this.getOptionPrice(
      trade.ticker,
      trade.expirationDate,
      trade.optionType,
      trade.strike
    );

    if (!currentPrice) {
      return null;
    }

    // Delegate to AccountBalanceCalculator for consistent calculation logic
    return accountBalanceCalculator.calculateTradeUnrealizedPnL(trade, currentPrice);
  }
};
