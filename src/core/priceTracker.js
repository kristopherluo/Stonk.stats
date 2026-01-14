/**
 * Price Tracker - Fetches real-time stock prices from Finnhub API
 * UPDATED: Uses trading day logic for cache expiry (9:30am EST boundary)
 */

import { state } from './state.js';
import * as marketHours from '../utils/marketHours.js';

const CACHE_KEY = 'riskCalcPriceCache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours (legacy, now uses trading day)

export const priceTracker = {
  apiKey: null,
  cache: new Map(),
  lastFetchDate: null,
  _fetchInProgress: false,
  _fetchPromise: null,

  init() {
    // Load API key from settings
    this.apiKey = localStorage.getItem('finnhubApiKey') || '';

    // Load price cache from localStorage
    this.loadCache();
  },

  loadCache() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { prices, date, tradingDay } = JSON.parse(cached);
        this.lastFetchDate = new Date(date);

        // Check if cache is still valid (same trading day)
        // A trading day runs from 9:30am EST to next 9:30am EST
        const currentTradingDay = marketHours.getTradingDay();
        if (tradingDay && tradingDay === currentTradingDay) {
          this.cache = new Map(Object.entries(prices));
        } else {
          // Legacy: fall back to calendar day check for old cache format
          if (this.isSameDay(this.lastFetchDate, new Date())) {
            this.cache = new Map(Object.entries(prices));
          }
        }
      }
    } catch (e) {
      console.error('Failed to load price cache:', e);
    }
  },

  saveCache() {
    try {
      const prices = Object.fromEntries(this.cache);
      const now = new Date();
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        prices,
        date: now.toISOString(),
        tradingDay: marketHours.getTradingDay(now) // Store trading day for proper expiry
      }));
    } catch (e) {
      console.error('Failed to save price cache:', e);
    }
  },

  isSameDay(date1, date2) {
    // Legacy method - kept for backwards compatibility
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  },

  needsRefresh() {
    // Prices are always "current" for the current trading day
    // No need to refresh if we're still in the same trading day
    return false; // Let the auto-refresh interval handle refreshing
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
  getCachedCompanyData(ticker) {
    try {
      const cache = localStorage.getItem('companyDataCache');
      if (!cache) return null;

      const parsed = JSON.parse(cache);
      const data = parsed[ticker.toUpperCase()];

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
  saveCompanyDataToCache(ticker, data) {
    try {
      const cache = localStorage.getItem('companyDataCache');
      const parsed = cache ? JSON.parse(cache) : {};

      parsed[ticker.toUpperCase()] = {
        ...data,
        cachedAt: Date.now()
      };

      localStorage.setItem('companyDataCache', JSON.stringify(parsed));
    } catch (e) {
      console.error('Error saving company data cache:', e);
    }
  },

  async fetchCompanyProfile(ticker) {
    if (!this.apiKey) {
      return null; // Silently return null if no API key
    }

    // Check cache first
    const cached = this.getCachedCompanyData(ticker);
    if (cached) {
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
      this.saveCompanyDataToCache(ticker, profile);

      return profile;
    } catch (error) {
      console.error(`[Company Profile] ❌ Failed to fetch profile for ${ticker}:`, error);
      return null;
    }
  },

  /**
   * Fetch company summary/description from Alpha Vantage
   * Returns: { summary: string, name: string, sector: string, industry: string }
   */
  async fetchCompanySummary(ticker) {
    const alphaVantageKey = localStorage.getItem('alphaVantageApiKey');

    if (!alphaVantageKey) {
      throw new Error('Alpha Vantage API key not configured. Add it in Settings to fetch company summaries.');
    }

    return await this.fetchCompanySummaryFromAlphaVantage(ticker, alphaVantageKey);
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

  async fetchCompanySummaryFromTwelveData(ticker, apiKey) {
    const url = `https://api.twelvedata.com/profile?symbol=${ticker.toUpperCase()}&apikey=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch company profile (${response.status})`);
    }

    const data = await response.json();

    // Check for errors
    if (data.status === 'error') {
      throw new Error(data.message || 'Twelve Data API error');
    }

    if (!data.name) {
      throw new Error('No company profile data available');
    }

    // Twelve Data returns: name, sector, industry, description, etc.
    return {
      ticker: ticker.toUpperCase(),
      name: data.name || '',
      sector: data.sector || '',
      industry: data.industry || '',
      summary: data.description || ''
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
        await this.sleep(100);
      } catch (error) {
        results.failed.push({ ticker, error: error.message });
      }
    }

    // Save cache after fetching all prices
    this.lastFetchDate = new Date();
    this.saveCache();

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

  getCachedPrice(ticker) {
    return this.getPrice(ticker);
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

  calculateTotalUnrealizedPnL(activeTrades = null) {
    // Use provided trades if given, otherwise get all active trades
    if (!activeTrades) {
      const trades = state.journal.entries;
      activeTrades = trades.filter(t => t.status === 'open' || t.status === 'trimmed');
    }

    let totalPnL = 0;
    let tradeCount = 0;

    for (const trade of activeTrades) {
      const pnl = this.calculateUnrealizedPnL(trade);
      if (pnl) {
        totalPnL += pnl.unrealizedPnL;
        tradeCount++;
      }
    }

    return {
      totalPnL,
      tradeCount,
      percentOfAccount: (totalPnL / state.account.currentSize) * 100
    };
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  setApiKey(key) {
    this.apiKey = key;
    localStorage.setItem('finnhubApiKey', key);
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
    const twelveDataKey = localStorage.getItem('twelveDataApiKey');
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
