/**
 * SharedMetrics - Calculations used across multiple pages
 * Stores results in state.metrics to avoid duplicate calculations
 */

import { state } from '../core/state.js';
import { getOpenTrades } from './TradeFilters.js';

class SharedMetrics {
  constructor() {
    // Initialize metrics in state if not already there
    if (!state.state.metrics) {
      state.state.metrics = {
        openRisk: 0,
        lastCalculated: null
      };
    }
  }

  /**
   * Calculate total open risk from all open/trimmed positions
   * Uses NET risk calculation (same as positions page)
   * Stores result in state.metrics.openRisk
   */
  calculateOpenRisk() {
    const allEntries = state.journal.entries;
    const allOpenTrades = getOpenTrades(allEntries);

    const totalOpenRisk = allOpenTrades.reduce((sum, t) => {
      const shares = t.remainingShares ?? t.shares;
      const riskPerShare = t.entry - t.stop;
      const grossRisk = shares * riskPerShare;

      // For trimmed trades, subtract realized profit (net risk can't go below 0)
      // For all trades, clamp to 0 minimum (stop above entry = no risk)
      const realizedPnL = t.totalRealizedPnL || 0;
      const isTrimmed = t.status === 'trimmed';
      const netRisk = isTrimmed ? Math.max(0, grossRisk - realizedPnL) : Math.max(0, grossRisk);

      return sum + netRisk;
    }, 0);

    // Store in state
    state.state.metrics.openRisk = totalOpenRisk;
    state.state.metrics.lastCalculated = Date.now();

    // Emit event so other components can react
    state.emit('metricsUpdated', state.state.metrics);

    return totalOpenRisk;
  }

  /**
   * Get current open risk value
   * Returns cached value if recently calculated, otherwise recalculates
   */
  getOpenRisk() {
    // Check if we have a recent calculation (within last 5 seconds)
    const now = Date.now();
    const lastCalc = state.state.metrics?.lastCalculated || 0;

    if (now - lastCalc < 5000 && state.state.metrics?.openRisk !== undefined) {
      return state.state.metrics.openRisk;
    }

    // Recalculate
    return this.calculateOpenRisk();
  }

  /**
   * Force recalculation of all shared metrics
   * Call this when trades are added/updated/deleted
   */
  recalculateAll() {
    this.calculateOpenRisk();
  }
}

export const sharedMetrics = new SharedMetrics();
export { SharedMetrics };
