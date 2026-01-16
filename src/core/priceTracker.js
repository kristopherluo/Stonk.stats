/**
 * Price Tracker - Fetches real-time stock prices from Finnhub API
 * UPDATED: Uses trading day logic for cache expiry (9:30am EST boundary)
 */

import { state } from './state.js';
import { sleep } from './utils.js';
import * as marketHours from '../utils/marketHours.js';
import { storage } from '../utils/storage.js';
import { compressText, decompressText } from '../utils/compression.js';

const CACHE_KEY = 'riskCalcPriceCache';
const SUMMARY_CACHE_KEY = 'companySummaryCache';
const MAX_SUMMARY_CACHE = 30; // Keep only 30 most recent summaries

export const priceTracker = {
  apiKey: null,
  cache: new Map(),
  lastFetchDate: null,
  _fetchInProgress: false,
  _fetchPromise: null,

  async init() {
    // Load API key from IndexedDB
    this.apiKey = (await storage.getItem('finnhubApiKey')) || '';

    // Load price cache from IndexedDB
    await this.loadCache();
  },

  async loadCache() {
    try {
      const cached = await storage.getItem('riskCalcPriceCache');
      if (cached) {
        const { prices, date, tradingDay } = cached;
        this.lastFetchDate = new Date(date);

        // Check if cache is still valid (same trading day)
        // A trading day runs from 9:30am EST to next 9:30am EST
        const currentTradingDay = marketHours.getTradingDay();
        if (tradingDay && tradingDay === currentTradingDay) {
          this.cache = new Map(Object.entries(prices));
        }
      }
    } catch (e) {
      console.error('Failed to load price cache:', e);
    }
  },

  async saveCache() {
    try {
      const prices = Object.fromEntries(this.cache);
      const now = new Date();
      await storage.setItem('riskCalcPriceCache', {
        prices,
        date: now.toISOString(),
        tradingDay: marketHours.getTradingDay(now) // Store trading day for proper expiry
      });
    } catch (e) {
      console.error('Failed to save price cache:', e);
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
      return {
        ticker: ticker.toUpperCase(),
        price: data.c,
        change: data.d,
        changePercent: data.dp,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`Failed to fetch price for ${ticker}:`, error);
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
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;

        if (age < thirtyDays) {
          return data;
        }
      }

      return null;
    } catch (e) {
      console.error('Error reading company data cache:', e);
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
      console.error('Error saving company data cache:', e);
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
      console.log(`[Company Profile] ✓ Using cached data for ${ticker}`);
      return cached;
    }

    if (cached && !cached.industry) {
      console.log(`[Company Profile] Cached data for ${ticker} missing industry, fetching full profile...`);
    } else {
      console.log(`[Company Profile] Fetching from API for ${ticker}...`);
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

      console.log(`[Company Profile] ✓ Fetched data for ${ticker}, industry: ${profile.industry}`);

      // Cache the data
      await this.saveCompanyDataToCache(ticker, profile);
      console.log(`[Company Profile] ✓ Saved to cache for ${ticker}`);

      return profile;
    } catch (error) {
      console.error(`[Company Profile] ❌ Failed to fetch profile for ${ticker}:`, error);
      return null;
    }
  },

  /**
   * Get cached company summary (decompressed)
   * Returns: { summary, name, sector, industry } or null
   */
  async getCachedSummary(ticker) {
    try {
      const cache = await storage.getItem(SUMMARY_CACHE_KEY);
      if (!cache || !cache.summaries) return null;

      const entry = cache.summaries[ticker.toUpperCase()];
      if (!entry) return null;

      // Check if cache is expired (30 days)
      const age = Date.now() - entry.cachedAt;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (age >= thirtyDays) {
        console.log(`[Summary Cache] ${ticker}: expired (${Math.round(age / (24 * 60 * 60 * 1000))} days old)`);
        return null;
      }

      // Decompress summary
      const decompressed = {
        ...entry,
        summary: decompressText(entry.summary)
      };

      console.log(`[Summary Cache] ✓ Hit for ${ticker} (age: ${Math.round(age / (24 * 60 * 60 * 1000))} days)`);
      return decompressed;
    } catch (e) {
      console.error('[Summary Cache] Error reading cache:', e);
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
        console.log(`[Summary Cache] Evicted ${toRemove} (LRU)`);
      }

      await storage.setItem(SUMMARY_CACHE_KEY, cache);
      console.log(`[Summary Cache] ✓ Saved ${ticker} (${cache.accessOrder.length}/${MAX_SUMMARY_CACHE} cached)`);
    } catch (e) {
      console.error('[Summary Cache] Error saving cache:', e);
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

    console.log(`[Summary Cache] Miss for ${ticker}, fetching from API...`);
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

    console.log(`[Alpha Vantage] Response for ${ticker}:`, data);

    // Check for API errors
    if (data.Note) {
      throw new Error('Alpha Vantage API rate limit reached. Free tier: 25 calls/day, 5 calls/minute.');
    }

    if (data['Error Message']) {
      throw new Error('Invalid ticker or no data available from Alpha Vantage');
    }

    if (!data.Name) {
      console.warn(`[Alpha Vantage] No Name field in response for ${ticker}. Response keys:`, Object.keys(data));
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
    const trades = state.journal.entries;
    const activeTrades = trades.filter(t => t.status === 'open' || t.status === 'trimmed');
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
    const shares = trade.remainingShares || trade.shares;
    const entry = trade.entry;

    const unrealizedPnL = (currentPrice - entry) * shares;
    const unrealizedPercent = ((currentPrice - entry) / entry) * 100;

    return {
      currentPrice,
      unrealizedPnL,
      unrealizedPercent,
      shares,
      entry,
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
  }
};
