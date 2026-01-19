/**
 * StatsCalculator - Pure calculation logic for all stats metrics
 * No DOM dependencies, fully testable
 */

import { state } from '../../core/state.js';
import { priceTracker } from '../../core/priceTracker.js';
import { equityCurveManager } from './EquityCurveManager.js';
import { getPreviousBusinessDay, getCurrentWeekday } from '../../core/utils.js';
import { formatDate } from '../../utils/marketHours.js';
import eodCacheManager from '../../core/eodCacheManager.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';
import { calculateRealizedPnL, getTradeRealizedPnL } from '../../core/utils/tradeCalculations.js';

export class StatsCalculator {
  /**
   * Calculate current account balance (includes unrealized P&L)
   * Always uses ALL trades, not filtered
   * NOW USES SHARED CALCULATOR
   */
  calculateCurrentAccount() {
    // Check if we have today's complete EOD snapshot (after market close)
    const todayStr = formatDate(getCurrentWeekday());
    const eodData = eodCacheManager.getEODData(todayStr);

    if (eodData && !eodData.incomplete) {
      return eodData.balance;
    }

    // Fallback: Calculate with live prices (during market hours before EOD saved)
    const currentPrices = priceTracker.getPricesAsObject();

    const result = accountBalanceCalculator.calculateCurrentBalance({
      startingBalance: state.settings.startingAccountSize,
      allTrades: state.journal.entries,
      cashFlowTransactions: state.cashFlow.transactions,
      currentPrices
    });

    return result.balance;
  }

  /**
   * Calculate realized P&L from closed/trimmed trades within date range
   */
  calculateRealizedPnL(trades) {
    return calculateRealizedPnL(trades);
  }

  /**
   * Calculate win rate from closed trades
   * Returns percentage or null if no trades
   */
  calculateWinRate(trades) {
    const closedTrades = trades.filter(e => e.status === 'closed' || e.status === 'trimmed');

    if (closedTrades.length === 0) return null;

    const wins = closedTrades.filter(t => getTradeRealizedPnL(t) > 0);
    return (wins.length / closedTrades.length) * 100;
  }

  /**
   * Calculate wins and losses count
   * Breakeven trades (P&L = 0) are counted as losses for win rate purposes
   */
  calculateWinsLosses(trades) {
    const closedTrades = trades.filter(e => e.status === 'closed' || e.status === 'trimmed');

    const wins = closedTrades.filter(t => getTradeRealizedPnL(t) > 0);
    const losses = closedTrades.filter(t => getTradeRealizedPnL(t) <= 0);

    return {
      wins: wins.length,
      losses: losses.length,
      total: closedTrades.length
    };
  }

  /**
   * Calculate Sharpe ratio from closed trades
   * Returns null if less than 2 trades or stdDev is 0
   */
  calculateSharpeRatio(trades) {
    const closedTrades = trades.filter(e => e.status === 'closed' || e.status === 'trimmed');

    if (closedTrades.length < 2) return null;

    // Get returns as percentages
    const returns = closedTrades.map(t => {
      const pnl = t.totalRealizedPnL ?? t.pnl ?? 0;
      const positionSize = t.positionSize || 1;
      return (pnl / positionSize) * 100;
    });

    // Mean return
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Standard deviation
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Sharpe ratio (simplified, no risk-free rate)
    if (stdDev === 0) return null;
    return mean / stdDev;
  }

  /**
   * Calculate net cash flow within date range
   */
  calculateNetCashFlow(dateFrom, dateTo) {
    const cashFlowTransactions = state.cashFlow?.transactions || [];

    if (!dateFrom && !dateTo) {
      // No filter - return all time cash flow
      return state.getCashFlowNet();
    }

    // Filter transactions by date range
    return cashFlowTransactions
      .filter(tx => {
        const txDate = new Date(tx.timestamp);
        txDate.setHours(0, 0, 0, 0);
        const txDateStr = formatDate(txDate);

        // Check if transaction date is within range
        let inRange = true;
        if (dateFrom) {
          inRange = inRange && txDateStr >= dateFrom;
        }
        if (dateTo) {
          inRange = inRange && txDateStr <= dateTo;
        }

        return inRange;
      })
      .reduce((sum, tx) => sum + (tx.type === 'deposit' ? tx.amount : -tx.amount), 0);
  }

  /**
   * Calculate P&L using equity curve
   * This is the NEW simplified approach using equity curve as source of truth
   */
  calculatePnL(dateFrom, dateTo) {
    const allEntries = state.journal.entries;
    const startingAccountSize = state.settings.startingAccountSize;

    // Get all entry dates to determine earliest trade date
    const allEntryDates = allEntries
      .filter(e => e.timestamp)
      .map(e => new Date(e.timestamp));

    if (allEntryDates.length === 0) {
      const mostRecentWeekday = getCurrentWeekday();
      return {
        pnl: 0,
        startingBalance: startingAccountSize,
        endingBalance: startingAccountSize,
        startDateStr: formatDate(mostRecentWeekday)
      };
    }

    const earliestTradeDate = new Date(Math.min(...allEntryDates.map(d => d.getTime())));
    earliestTradeDate.setHours(0, 0, 0, 0);
    const earliestTradeDateStr = formatDate(earliestTradeDate);

    // Determine start balance and date
    let startBalance;
    let startDateStr;

    if (!dateFrom || dateFrom === earliestTradeDateStr) {
      // Starting from earliest trade or no filter - use starting account size
      startBalance = startingAccountSize;
      startDateStr = earliestTradeDateStr;
    } else {
      // Starting from after earliest trade - get balance from day before start date
      const startDate = this._parseDate(dateFrom);
      const dayBefore = getPreviousBusinessDay(startDate);
      const dayBeforeStr = formatDate(dayBefore);

      // Get balance from equity curve
      startBalance = equityCurveManager.getBalanceOnDate(dayBeforeStr);

      // If not in curve yet, fall back to manual calculation
      if (startBalance === null) {
        startBalance = this._calculateBalanceAtDate(dayBeforeStr);
      }

      startDateStr = dayBeforeStr;
    }

    // Determine end balance
    let endBalance;
    const endDateStr = dateTo || formatDate(getCurrentWeekday());

    // Get balance from equity curve
    endBalance = equityCurveManager.getBalanceOnDate(endDateStr);

    // If not in curve yet, fall back to current account for today
    if (endBalance === null) {
      endBalance = this.calculateCurrentAccount();
    }

    // Calculate net cash flow in range
    const netCashFlowInRange = this.calculateNetCashFlow(dateFrom, dateTo);

    // Calculate P&L (excluding cash flow)
    const pnl = endBalance - startBalance - netCashFlowInRange;

    return {
      pnl: pnl,
      startingBalance: startBalance,
      endingBalance: endBalance,
      startDateStr: startDateStr
    };
  }

  /**
   * Fallback: Calculate balance at a specific date (used when curve not available)
   */
  _calculateBalanceAtDate(dateStr) {
    const allEntries = state.journal.entries;
    const startingBalance = state.settings.startingAccountSize;
    const targetDate = this._parseDate(dateStr);
    targetDate.setHours(23, 59, 59, 999);

    // Get closed trades before or on this date
    const closedTradesBeforeDate = allEntries
      .filter(e => e.status === 'closed' || e.status === 'trimmed')
      .filter(e => {
        if (!e.exitDate) return false;
        const closeDate = new Date(e.exitDate);
        closeDate.setHours(0, 0, 0, 0);
        return closeDate <= targetDate;
      });

    const realizedPnL = closedTradesBeforeDate.reduce((sum, t) => sum + getTradeRealizedPnL(t), 0);

    // Get cash flow before or on this date
    const cashFlowBeforeDate = (state.cashFlow?.transactions || [])
      .filter(tx => {
        const txDate = new Date(tx.timestamp);
        txDate.setHours(0, 0, 0, 0);
        return txDate <= targetDate;
      })
      .reduce((sum, tx) => sum + (tx.type === 'deposit' ? tx.amount : -tx.amount), 0);

    // Get unrealized P&L on this date (simplified - uses current prices as fallback)
    const openTrades = allEntries.filter(e => {
      const entryDate = new Date(e.timestamp);
      entryDate.setHours(0, 0, 0, 0);

      // Must be entered before or on this date
      if (entryDate > targetDate) return false;

      // If closed, must close after this date (not on or before)
      if (e.status === 'closed' && e.exitDate) {
        const closeDate = new Date(e.exitDate);
        closeDate.setHours(0, 0, 0, 0);
        if (closeDate < targetDate) return false;
      }

      return e.status === 'open' || e.status === 'trimmed';
    });

    // Calculate unrealized P&L for open trades (simplified fallback)
    let unrealizedPnL = 0;
    for (const trade of openTrades) {
      const pnl = priceTracker.calculateUnrealizedPnL(trade);
      if (pnl) {
        unrealizedPnL += pnl.unrealizedPnL;
      }
    }

    return startingBalance + realizedPnL + cashFlowBeforeDate + unrealizedPnL;
  }


  /**
   * Parse YYYY-MM-DD to Date
   */
  _parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
}
