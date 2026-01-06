/**
 * Price Tracker - Fetches real-time stock prices from Finnhub API
 */

import { state } from './state.js';

const CACHE_KEY = 'riskCalcPriceCache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export const priceTracker = {
  apiKey: null,
  cache: new Map(),
  lastFetchDate: null,

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
        const { prices, date } = JSON.parse(cached);
        this.lastFetchDate = new Date(date);

        // Check if cache is still valid (same day)
        if (this.isSameDay(this.lastFetchDate, new Date())) {
          this.cache = new Map(Object.entries(prices));
        }
      }
    } catch (e) {
      console.error('Failed to load price cache:', e);
    }
  },

  saveCache() {
    try {
      const prices = Object.fromEntries(this.cache);
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        prices,
        date: new Date().toISOString()
      }));
    } catch (e) {
      console.error('Failed to save price cache:', e);
    }
  },

  isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  },

  needsRefresh() {
    if (!this.lastFetchDate) return true;
    return !this.isSameDay(this.lastFetchDate, new Date());
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
          console.log(`[Company Profile] Using cached data for ${ticker}`);
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
      console.log('[Company Profile] No API key configured');
      return null; // Silently return null if no API key
    }

    // Check cache first
    const cached = this.getCachedCompanyData(ticker);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[Company Profile] Fetching profile for ${ticker}...`);
      const response = await fetch(
        `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker.toUpperCase()}&token=${this.apiKey}`
      );

      if (!response.ok) {
        console.log(`[Company Profile] API request failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log(`[Company Profile] Response for ${ticker}:`, data);

      // Finnhub returns empty object if ticker not found
      if (!data || Object.keys(data).length === 0 || !data.name) {
        console.log(`[Company Profile] No data found for ${ticker}`);
        return null;
      }

      // Finnhub returns: name, finnhubIndustry, country, etc.
      // Normalize industry to title case
      const profile = {
        ticker: ticker.toUpperCase(),
        name: data.name || '',
        industry: this.toTitleCase(data.finnhubIndustry || ''),
        country: data.country || ''
      };

      console.log(`[Company Profile] ✅ Successfully fetched profile for ${ticker}:`, profile);

      // Cache the data
      this.saveCompanyDataToCache(ticker, profile);

      return profile;
    } catch (error) {
      console.error(`[Company Profile] ❌ Failed to fetch profile for ${ticker}:`, error);
      return null;
    }
  },

  /**
   * Fetch company summary/description from Alpha Vantage API
   * Returns: { summary: string, name: string, sector: string, industry: string }
   */
  async fetchCompanySummary(ticker) {
    const apiKey = localStorage.getItem('alphaVantageApiKey') || 'demo';

    try {
      console.log(`[Company Summary] Fetching overview for ${ticker}...`);
      const response = await fetch(
        `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker.toUpperCase()}&apikey=${apiKey}`
      );

      if (!response.ok) {
        console.log(`[Company Summary] API request failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log(`[Company Summary] Response for ${ticker}:`, data);

      // Check for API errors
      if (data['Error Message'] || data['Note'] || data['Information']) {
        console.log(`[Company Summary] API error or rate limit for ${ticker}`);
        return null;
      }

      // Alpha Vantage returns empty object if ticker not found
      if (!data || Object.keys(data).length === 0 || !data.Symbol) {
        console.log(`[Company Summary] No data found for ${ticker}`);
        return null;
      }

      const overview = {
        ticker: ticker.toUpperCase(),
        name: data.Name || '',
        sector: data.Sector || '',
        industry: data.Industry || '',
        summary: data.Description || ''
      };

      console.log(`[Company Summary] ✅ Successfully fetched overview for ${ticker}`);
      return overview;
    } catch (error) {
      console.error(`[Company Summary] ❌ Failed to fetch overview for ${ticker}:`, error);
      return null;
    }
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
   * Fetch historical daily candle data for a stock using Alpha Vantage API
   * Fetches 1 year before entry + 3 months after (or today, whichever is sooner)
   * @param {string} ticker - Stock ticker symbol
   * @param {Date} entryDate - Entry date
   * @param {number} daysBack - Days before entry (default 365)
   * @param {number} daysForward - Days after entry (default 90)
   * @returns {Promise<Array>} Array of candle data {time, open, high, low, close}
   */
  async fetchHistoricalCandles(ticker, entryDate, daysBack = 365, daysForward = 90) {
    // Use Alpha Vantage API key if available, otherwise use demo key (limited to IBM, AAPL, MSFT, etc.)
    const apiKey = localStorage.getItem('alphaVantageApiKey') || 'demo';

    try {
      // Use compact outputsize (100 most recent data points = ~4-5 months)
      // Note: outputsize=full is a premium feature
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker.toUpperCase()}&apikey=${apiKey}&outputsize=compact`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch data (${response.status})`);
      }

      const data = await response.json();

      console.log('Alpha Vantage API Response:', data);

      // Check for API errors
      if (data['Error Message']) {
        throw new Error('Invalid ticker symbol');
      }

      if (data['Note']) {
        throw new Error('API rate limit reached. Please add your own Alpha Vantage API key in Settings (free at alphavantage.co)');
      }

      if (data['Information']) {
        throw new Error('API rate limit: ' + data['Information']);
      }

      if (!data['Time Series (Daily)']) {
        console.error('Unexpected API response format:', Object.keys(data));
        throw new Error('No historical data available. API response: ' + Object.keys(data).join(', '));
      }

      const timeSeries = data['Time Series (Daily)'];
      const candles = [];

      // Calculate date range: 1 year before entry to 3 months after (or today)
      const entryDateObj = new Date(entryDate);
      const fromDate = new Date(entryDateObj);
      fromDate.setDate(fromDate.getDate() - daysBack);

      const toDate = new Date(entryDateObj);
      toDate.setDate(toDate.getDate() + daysForward);

      // Don't fetch future data beyond today
      const today = new Date();
      if (toDate > today) {
        toDate.setTime(today.getTime());
      }

      console.log('Fetching chart data:', {
        ticker,
        entryDate: entryDateObj.toISOString(),
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        availableDates: Object.keys(timeSeries).length
      });

      // Parse and filter data - convert all to UTC for comparison
      for (const [dateStr, values] of Object.entries(timeSeries)) {
        const date = new Date(dateStr + 'T00:00:00Z');

        // Only include dates in our range (compare as UTC)
        if (date >= fromDate && date <= toDate) {
          const timestamp = Math.floor(date.getTime() / 1000);
          candles.push({
            time: timestamp,
            open: parseFloat(values['1. open']),
            high: parseFloat(values['2. high']),
            low: parseFloat(values['3. low']),
            close: parseFloat(values['4. close']),
            volume: parseFloat(values['5. volume'])
          });
        }
      }

      // Sort by time (oldest to newest)
      candles.sort((a, b) => a.time - b.time);

      console.log('Filtered candles:', candles.length);

      if (candles.length === 0) {
        throw new Error(`No data found between ${fromDate.toISOString().split('T')[0]} and ${toDate.toISOString().split('T')[0]}`);
      }

      return candles;
    } catch (error) {
      console.error('Failed to fetch historical candles:', error);
      throw error;
    }
  }
};
