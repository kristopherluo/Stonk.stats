/**
 * StatsCalculator - Pure calculation logic for all stats metrics
 * No DOM dependencies, fully testable
 */

import { state } from '../../core/state.js';
import { priceTracker } from '../../core/priceTracker.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';
import { calculateRealizedPnL, getTradeRealizedPnL } from '../../core/utils/tradeCalculations.js';
import { formatDate } from '../../utils/marketHours.js';

export class StatsCalculator {
  /**
   * Calculate current account balance (includes unrealized P&L from open positions)
   * Used by header and Settings - always uses live prices for accuracy
   */
  calculateCurrentAccount() {
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
   * Calculate realized P&L from closed/trimmed trades
   */
  calculateRealizedPnL(trades) {
    return calculateRealizedPnL(trades);
  }

  /**
   * Core method: Calculate all closed trade metrics in one pass
   * This eliminates redundant filtering and calculations
   * @private
   */
  _getClosedTradeMetrics(trades) {
    const closedTrades = trades.filter(e => e.status === 'closed' || e.status === 'trimmed');

    if (closedTrades.length === 0) {
      return {
        closedTrades: [],
        wins: [],
        losses: [],
        totalWins: 0,
        totalLosses: 0,
        winRate: null,
        winsCount: 0,
        lossesCount: 0
      };
    }

    const wins = [];
    const losses = [];
    let totalWins = 0;
    let totalLosses = 0;

    for (const trade of closedTrades) {
      const pnl = getTradeRealizedPnL(trade);
      if (pnl > 0) {
        wins.push(trade);
        totalWins += pnl;
      } else {
        losses.push(trade);
        totalLosses += pnl;
      }
    }

    return {
      closedTrades,
      wins,
      losses,
      totalWins,
      totalLosses,
      winRate: (wins.length / closedTrades.length) * 100,
      winsCount: wins.length,
      lossesCount: losses.length
    };
  }

  /**
   * Calculate win rate from closed trades
   */
  calculateWinRate(trades) {
    return this._getClosedTradeMetrics(trades).winRate;
  }

  /**
   * Calculate wins and losses count
   */
  calculateWinsLosses(trades) {
    const metrics = this._getClosedTradeMetrics(trades);
    return {
      wins: metrics.winsCount,
      losses: metrics.lossesCount,
      total: metrics.closedTrades.length
    };
  }

  /**
   * Calculate Average Win/Loss Ratio (Payoff Ratio)
   * Returns the ratio of average winning trade to average losing trade
   */
  calculateAvgWinLossRatio(trades) {
    const metrics = this._getClosedTradeMetrics(trades);

    if (metrics.wins.length === 0 || metrics.losses.length === 0) {
      return null;
    }

    const avgWin = metrics.totalWins / metrics.wins.length;
    const avgLoss = Math.abs(metrics.totalLosses / metrics.losses.length);

    return avgLoss === 0 ? null : avgWin / avgLoss;
  }

  /**
   * Calculate Profit Factor
   * Formula: Total Gross Profit / Total Gross Loss
   * > 1.0 = Profitable, < 1.0 = Losing money
   */
  calculateProfitFactor(trades) {
    const metrics = this._getClosedTradeMetrics(trades);

    if (metrics.wins.length === 0 || metrics.losses.length === 0) {
      return null;
    }

    const totalLossesAbs = Math.abs(metrics.totalLosses);
    return totalLossesAbs === 0 ? null : metrics.totalWins / totalLossesAbs;
  }

  /**
   * Calculate Trade Expectancy (expected profit/loss per trade)
   * Formula: (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
   */
  calculateTradeExpectancy(trades) {
    const metrics = this._getClosedTradeMetrics(trades);

    if (metrics.closedTrades.length === 0) {
      return null;
    }

    const totalTrades = metrics.closedTrades.length;
    const winRate = metrics.winsCount / totalTrades;
    const lossRate = metrics.lossesCount / totalTrades;

    const avgWin = metrics.winsCount > 0 ? metrics.totalWins / metrics.winsCount : 0;
    const avgLoss = metrics.lossesCount > 0 ? metrics.totalLosses / metrics.lossesCount : 0;

    return (winRate * avgWin) + (lossRate * avgLoss);
  }

  /**
   * Calculate net cash flow within date range
   * Returns { net, deposits, withdrawals } for efficiency
   */
  calculateCashFlowBreakdown(dateFrom, dateTo) {
    const cashFlowTransactions = state.cashFlow?.transactions || [];

    if (!dateFrom && !dateTo) {
      // No filter - calculate for all transactions
      const deposits = cashFlowTransactions
        .filter(tx => tx.type === 'deposit')
        .reduce((sum, tx) => sum + tx.amount, 0);

      const withdrawals = cashFlowTransactions
        .filter(tx => tx.type === 'withdrawal')
        .reduce((sum, tx) => sum + tx.amount, 0);

      return {
        net: state.getCashFlowNet(),
        deposits,
        withdrawals
      };
    }

    // Filter transactions by date range
    let deposits = 0;
    let withdrawals = 0;

    for (const tx of cashFlowTransactions) {
      const txDate = new Date(tx.timestamp);
      txDate.setHours(0, 0, 0, 0);
      const txDateStr = formatDate(txDate);

      let inRange = true;
      if (dateFrom && txDateStr < dateFrom) inRange = false;
      if (dateTo && txDateStr > dateTo) inRange = false;

      if (inRange) {
        if (tx.type === 'deposit') {
          deposits += tx.amount;
        } else {
          withdrawals += tx.amount;
        }
      }
    }

    return {
      net: deposits - withdrawals,
      deposits,
      withdrawals
    };
  }

  /**
   * Calculate net cash flow within date range (backwards compatibility)
   */
  calculateNetCashFlow(dateFrom, dateTo) {
    return this.calculateCashFlowBreakdown(dateFrom, dateTo).net;
  }

}
