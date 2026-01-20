/**
 * Incremental Stats Calculator - Caching layer for StatsCalculator
 *
 * Instead of recalculating stats over all 12,500 trades every time,
 * this caches results and only recalculates when trades change.
 *
 * Expected improvement: 10x faster stats page load (2-3s → 200-300ms)
 */

import { StatsCalculator } from './StatsCalculator.js';
import { storage } from '../../utils/storage.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('IncrementalStatsCalculator');

class IncrementalStatsCalculator extends StatsCalculator {
  constructor() {
    super();
    this.cache = null;
    this.cacheKey = 'statsCache_v1';
    this.initialized = false;
  }

  /**
   * Initialize the cache from storage
   */
  async init() {
    if (this.initialized) return;

    this.cache = await storage.getItem(this.cacheKey);

    if (!this.cache) {
      this.cache = this._createEmptyCache();
    }

    this.initialized = true;
    logger.debug('Incremental stats calculator initialized');
  }

  /**
   * Create empty cache structure
   */
  _createEmptyCache() {
    return {
      version: 1,
      tradeCount: 0,
      lastUpdated: null,
      tradeChecksum: null,

      // Cached stats (calculated once, reused)
      winRate: null,
      winsLosses: { wins: 0, losses: 0, total: 0 },
      avgWin: null,
      avgLoss: null,
      profitFactor: null,
      expectancy: null,
      largestWin: null,
      largestLoss: null,
      avgHoldTime: null,

      // Closed trades only (for quick filtering)
      closedTradeIds: [],

      // Timestamp
      cachedAt: Date.now()
    };
  }

  /**
   * Calculate checksum of trades (to detect changes)
   * Uses trade count + sum of IDs for lightweight change detection
   */
  _calculateTradeChecksum(trades) {
    if (!trades || trades.length === 0) return '0';

    // Simple checksum: count + concatenated IDs
    const idSum = trades
      .map(t => t.id || '')
      .sort()
      .join(',');

    return `${trades.length}:${idSum}`;
  }

  /**
   * Check if cache is valid for current trades
   */
  _isCacheValid(trades) {
    if (!this.cache || this.cache.tradeCount === 0) return false;

    const currentChecksum = this._calculateTradeChecksum(trades);
    const isValid = this.cache.tradeChecksum === currentChecksum;

    if (!isValid) {
      logger.debug('Cache invalid: trade changes detected');
    }

    return isValid;
  }

  /**
   * Calculate and cache all stats for given trades
   * Only recalculates if trades have changed
   */
  async calculateAndCacheStats(trades) {
    // Check if cache is valid
    if (this._isCacheValid(trades)) {
      logger.debug('Using cached stats (no trade changes)');
      return this.cache;
    }

    logger.debug(`Recalculating stats for ${trades.length} trades...`);
    const startTime = Date.now();

    // Filter closed trades once (used by many calculations)
    const closedTrades = trades.filter(t => t.status === 'closed' || t.status === 'trimmed');

    // Calculate all stats using parent class methods
    const winRate = super.calculateWinRate(trades);
    const winsLosses = super.calculateWinsLosses(trades);
    const avgWin = super.calculateAverageWin(trades);
    const avgLoss = super.calculateAverageLoss(trades);
    const profitFactor = super.calculateProfitFactor(trades);
    const expectancy = super.calculateExpectancy(trades);
    const largestWin = super.calculateLargestWin(trades);
    const largestLoss = super.calculateLargestLoss(trades);
    const avgHoldTime = super.calculateAvgHoldTime(trades);

    // Update cache
    this.cache = {
      version: 1,
      tradeCount: trades.length,
      lastUpdated: Date.now(),
      tradeChecksum: this._calculateTradeChecksum(trades),

      winRate,
      winsLosses,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      largestWin,
      largestLoss,
      avgHoldTime,

      closedTradeIds: closedTrades.map(t => t.id),
      cachedAt: Date.now()
    };

    // Save to storage (async, don't wait)
    this._saveCache();

    const elapsed = Date.now() - startTime;
    logger.info(`Stats calculated and cached in ${elapsed}ms`);

    return this.cache;
  }

  /**
   * Save cache to storage
   */
  async _saveCache() {
    try {
      await storage.setItem(this.cacheKey, this.cache);
    } catch (e) {
      logger.error('Failed to save stats cache:', e);
    }
  }

  /**
   * Invalidate cache (force recalculation on next request)
   */
  async invalidateCache() {
    logger.debug('Invalidating stats cache');
    this.cache = this._createEmptyCache();
    await this._saveCache();
  }

  /**
   * Get cached stats without recalculating
   * Returns null if cache is invalid
   */
  getCachedStats() {
    return this.cache && this.cache.tradeCount > 0 ? this.cache : null;
  }

  /**
   * Override parent methods to use cache when available
   */
  calculateWinRate(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.winRate;
    }
    return super.calculateWinRate(trades);
  }

  calculateWinsLosses(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.winsLosses;
    }
    return super.calculateWinsLosses(trades);
  }

  calculateAverageWin(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.avgWin;
    }
    return super.calculateAverageWin(trades);
  }

  calculateAverageLoss(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.avgLoss;
    }
    return super.calculateAverageLoss(trades);
  }

  calculateProfitFactor(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.profitFactor;
    }
    return super.calculateProfitFactor(trades);
  }

  calculateExpectancy(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.expectancy;
    }
    return super.calculateExpectancy(trades);
  }

  calculateLargestWin(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.largestWin;
    }
    return super.calculateLargestWin(trades);
  }

  calculateLargestLoss(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.largestLoss;
    }
    return super.calculateLargestLoss(trades);
  }

  calculateAvgHoldTime(trades) {
    if (this._isCacheValid(trades)) {
      return this.cache.avgHoldTime;
    }
    return super.calculateAvgHoldTime(trades);
  }
}

// Export singleton instance
export const incrementalStatsCalculator = new IncrementalStatsCalculator();
