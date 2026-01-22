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
import { isOpenTrade } from '../../shared/TradeFilters.js';
import { historicalPricesBatcher } from './HistoricalPricesBatcher.js';

export class StatsCalculator {
  /**
   * Calculate current account balance (includes unrealized P&L)
   * Always uses ALL trades, not filtered
   * ALWAYS uses live prices to ensure accuracy (never trust cached EOD for today)
   */
  calculateCurrentAccount() {
    // Always calculate with live prices for current account
    // EOD cache may have stale option prices, so we always use fresh data
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
   * CENTRALIZED: Get balance for any date (single source of truth)
   * For today: uses live prices
   * For historical dates: uses EOD cache
   *
   * This is the ONLY method that should decide whether to use live vs cached data.
   * All components (EquityCurveManager, PnLCalendar, etc) should call this method.
   *
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {number|null} Balance or null if unavailable
   */
  getBalanceForDate(dateStr) {
    const todayStr = formatDate(getCurrentWeekday());

    // For today, always use live calculation
    if (dateStr === todayStr) {
      return this.calculateCurrentAccount();
    }

    // For historical dates, try EOD cache first
    const eodData = eodCacheManager.getEODData(dateStr);
    if (eodData && !eodData.incomplete) {
      return eodData.balance;
    }

    // If no cache data, return null (caller should handle)
    return null;
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
   * Calculate Average Win/Loss Ratio (also called Reward/Risk Ratio)
   * Returns the ratio of average winning trade to average losing trade
   * A ratio of 2.0 means average win is 2x the average loss
   * Returns null if no wins or no losses
   */
  calculateAvgWinLossRatio(trades) {
    const closedTrades = trades.filter(e => e.status === 'closed' || e.status === 'trimmed');

    if (closedTrades.length === 0) return null;

    const wins = closedTrades.filter(t => getTradeRealizedPnL(t) > 0);
    const losses = closedTrades.filter(t => getTradeRealizedPnL(t) < 0);

    if (wins.length === 0 || losses.length === 0) return null;

    const totalWins = wins.reduce((sum, t) => sum + getTradeRealizedPnL(t), 0);
    const totalLosses = losses.reduce((sum, t) => sum + getTradeRealizedPnL(t), 0);

    const avgWin = totalWins / wins.length;
    const avgLoss = Math.abs(totalLosses / losses.length);

    if (avgLoss === 0) return null;
    return avgWin / avgLoss;
  }

  /**
   * Calculate Trade Expectancy (expected profit/loss per trade)
   * Formula: (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
   * Returns the expected dollar amount each trade should make/lose
   * Returns null if no closed trades
   */
  calculateTradeExpectancy(trades) {
    const closedTrades = trades.filter(e => e.status === 'closed' || e.status === 'trimmed');

    if (closedTrades.length === 0) return null;

    const wins = closedTrades.filter(t => getTradeRealizedPnL(t) > 0);
    const losses = closedTrades.filter(t => getTradeRealizedPnL(t) < 0);
    const breakeven = closedTrades.filter(t => getTradeRealizedPnL(t) === 0);

    const totalTrades = closedTrades.length;
    const winRate = wins.length / totalTrades;
    const lossRate = losses.length / totalTrades;

    const totalWins = wins.reduce((sum, t) => sum + getTradeRealizedPnL(t), 0);
    const totalLosses = losses.reduce((sum, t) => sum + getTradeRealizedPnL(t), 0);

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    // Expectancy = (Win% × Avg Win) + (Loss% × Avg Loss)
    // Note: avgLoss is already negative, so we add it
    const expectancy = (winRate * avgWin) + (lossRate * avgLoss);

    return expectancy;
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
  async calculatePnL(dateFrom, dateTo) {
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
        startBalance = await this._calculateBalanceAtDate(dayBeforeStr);
      }

      startDateStr = dayBeforeStr;
    }

    // Determine end balance using centralized method
    const endDateStr = dateTo || formatDate(getCurrentWeekday());

    // Use centralized balance provider (single source of truth)
    let endBalance = this.getBalanceForDate(endDateStr);

    // If no cached data for historical date, fall back to manual calculation
    if (endBalance === null) {
      endBalance = await this._calculateBalanceAtDate(endDateStr);
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
  async _calculateBalanceAtDate(dateStr) {
    const todayStr = formatDate(getCurrentWeekday());
    const isToday = dateStr === todayStr;

    let prices;
    if (isToday) {
      // For today, use current live prices from priceTracker
      prices = priceTracker.getPricesAsObject();
    } else {
      // For historical dates, fetch historical closing prices
      prices = {};

      // Get all unique tickers from trades that were open on this date
      const targetDate = this._parseDate(dateStr);
      const allTrades = state.journal.entries;

      const openOnDate = allTrades.filter(trade => {
        const entryDate = new Date(trade.timestamp);
        entryDate.setHours(0, 0, 0, 0);

        // Must be entered before or on this date
        if (entryDate > targetDate) return false;

        // If closed, must close after this date
        if (trade.exitDate) {
          const closeDate = new Date(trade.exitDate);
          closeDate.setHours(0, 0, 0, 0);
          if (closeDate <= targetDate) return false;
        }

        return true;
      });

      const tickers = [...new Set(openOnDate.map(t => t.ticker).filter(Boolean))];

      // Fetch historical prices for each ticker
      for (const ticker of tickers) {
        const price = await historicalPricesBatcher.getPriceOnDate(ticker, dateStr);
        if (price) {
          prices[ticker] = price;
        }
      }
    }

    // Use accountBalanceCalculator to properly calculate balance with the prices
    const balanceData = accountBalanceCalculator.calculateBalanceAtDate(dateStr, {
      startingBalance: state.settings.startingAccountSize,
      allTrades: state.journal.entries,
      cashFlowTransactions: state.cashFlow.transactions,
      eodPrices: prices
    });

    return balanceData.balance;
  }


  /**
   * Parse YYYY-MM-DD to Date
   */
  _parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
}
