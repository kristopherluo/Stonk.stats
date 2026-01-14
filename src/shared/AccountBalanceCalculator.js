/**
 * Account Balance Calculator - Shared logic for calculating account balance
 *
 * Purpose: Single source of truth for current account balance calculations
 * Used by both stats and positions pages to ensure consistency
 *
 * Features:
 * - Calculate current balance (including unrealized P&L)
 * - Calculate balance at specific historical dates (using EOD prices)
 * - Calculate unrealized P&L for individual trades
 * - Calculate realized P&L from closed trades
 * - Calculate net cash flow
 */

import { state } from '../core/state.js';
import eodCacheManager from '../core/eodCacheManager.js';

class AccountBalanceCalculator {
  /**
   * Calculate current account balance including unrealized P&L
   * @param {Object} options
   * @param {number} options.startingBalance - Initial account size from settings
   * @param {Array} options.allTrades - All trades (open, trimmed, closed)
   * @param {Array} options.cashFlowTransactions - Deposits/withdrawals
   * @param {Object} options.currentPrices - Map of ticker → { price, change, changePercent }
   * @returns {Object} { balance, unrealizedPnL, realizedPnL, cashFlow, realizedBalance }
   */
  calculateCurrentBalance({
    startingBalance,
    allTrades,
    cashFlowTransactions,
    currentPrices
  }) {
    // Calculate total realized P&L from closed trades
    const realizedPnL = this._calculateRealizedPnL(allTrades);

    // Calculate unrealized P&L for open/trimmed positions
    const unrealizedPnL = this._calculateUnrealizedPnL(allTrades, currentPrices);

    // Calculate net cash flow (deposits - withdrawals)
    const cashFlow = this._calculateNetCashFlow(cashFlowTransactions);

    // Realized balance (without unrealized P&L)
    const realizedBalance = startingBalance + realizedPnL + cashFlow;

    // Current balance = starting + realized + unrealized + cash flow
    const balance = realizedBalance + unrealizedPnL;

    return {
      balance,
      realizedBalance,
      unrealizedPnL,
      realizedPnL,
      cashFlow
    };
  }

  /**
   * Calculate balance at a specific historical date
   * Uses EOD prices from cache or provided prices
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @param {Object} options
   * @param {number} options.startingBalance - Initial account size
   * @param {Array} options.allTrades - All trades
   * @param {Array} options.cashFlowTransactions - Cash flow transactions
   * @param {Object} options.eodPrices - Optional: map of ticker → price for this date
   * @returns {Object} { balance, unrealizedPnL, realizedPnL, cashFlow, realizedBalance }
   */
  calculateBalanceAtDate(dateStr, {
    startingBalance,
    allTrades,
    cashFlowTransactions,
    eodPrices = null
  }) {
    // Filter trades to only those relevant for this date
    const tradesOpenOnDate = this._getTradesOpenOnDate(allTrades, dateStr);
    const tradesClosedByDate = this._getTradesClosedByDate(allTrades, dateStr);

    // Calculate realized P&L (trades closed on or before this date)
    const realizedPnL = tradesClosedByDate.reduce((sum, t) => sum + (t.pnl || 0), 0);

    // Calculate cash flow up to this date
    const cashFlow = this._calculateCashFlowUpToDate(cashFlowTransactions, dateStr);

    // Get EOD prices for this date
    let prices = eodPrices;
    if (!prices) {
      // Try to get from EOD cache
      const eodData = eodCacheManager.getEODData(dateStr);
      prices = eodData?.stockPrices || {};
    }

    // Calculate unrealized P&L using EOD prices
    const unrealizedPnL = this._calculateUnrealizedPnLWithPrices(tradesOpenOnDate, prices, dateStr);

    // Realized balance (without unrealized)
    const realizedBalance = startingBalance + realizedPnL + cashFlow;

    // Total balance
    const balance = realizedBalance + unrealizedPnL;

    return {
      balance,
      realizedBalance,
      unrealizedPnL,
      realizedPnL,
      cashFlow
    };
  }

  /**
   * Calculate unrealized P&L for a single trade
   * @param {Object} trade - Trade object
   * @param {number} currentPrice - Current/EOD price
   * @param {string} [dateStr] - Optional: date for share count calculation (for trimmed trades)
   * @returns {Object} { unrealizedPnL, unrealizedPercent, shares, currentPrice, entry }
   */
  calculateTradeUnrealizedPnL(trade, currentPrice, dateStr = null) {
    if (!currentPrice || trade.status === 'closed') {
      return {
        unrealizedPnL: 0,
        unrealizedPercent: 0,
        shares: 0,
        currentPrice,
        entry: trade.entry
      };
    }

    // Determine shares held
    let shares = trade.shares;

    if (trade.status === 'trimmed') {
      if (dateStr) {
        // For historical calculations, need to figure out shares on this date
        shares = this._getSharesOnDate(trade, dateStr);
      } else {
        // For current calculations
        shares = trade.remainingShares || trade.shares;
      }
    }

    const unrealizedPnL = (currentPrice - trade.entry) * shares;
    const unrealizedPercent = ((currentPrice - trade.entry) / trade.entry) * 100;

    return {
      unrealizedPnL,
      unrealizedPercent,
      shares,
      currentPrice,
      entry: trade.entry
    };
  }

  /**
   * Calculate total realized P&L from all closed trades and trimmed positions
   * @param {Array} allTrades - All trades
   * @returns {number} Total realized P&L
   * @private
   */
  _calculateRealizedPnL(allTrades) {
    return allTrades.reduce((sum, t) => {
      if (t.status === 'closed') {
        // Fully closed trade
        return sum + (t.pnl || 0);
      } else if (t.status === 'trimmed') {
        // Trimmed trade - use totalRealizedPnL which includes all trim profits
        return sum + (t.totalRealizedPnL || 0);
      }
      return sum;
    }, 0);
  }

  /**
   * Calculate total unrealized P&L for open/trimmed positions
   * @param {Array} allTrades - All trades
   * @param {Object} currentPrices - Map of ticker → { price, ... }
   * @returns {number} Total unrealized P&L
   * @private
   */
  _calculateUnrealizedPnL(allTrades, currentPrices) {
    return allTrades
      .filter(t => t.status === 'open' || t.status === 'trimmed')
      .reduce((sum, trade) => {
        const priceData = currentPrices[trade.ticker];
        if (!priceData) return sum;

        const price = priceData.price || priceData; // Handle both object and number
        const result = this.calculateTradeUnrealizedPnL(trade, price);
        return sum + result.unrealizedPnL;
      }, 0);
  }

  /**
   * Calculate unrealized P&L using specific prices (for historical dates)
   * @param {Array} trades - Trades open on the date
   * @param {Object} prices - Map of ticker → price
   * @param {string} dateStr - Date string for share count
   * @returns {number} Total unrealized P&L
   * @private
   */
  _calculateUnrealizedPnLWithPrices(trades, prices, dateStr) {
    return trades.reduce((sum, trade) => {
      const price = prices[trade.ticker];
      if (!price) return sum;

      const result = this.calculateTradeUnrealizedPnL(trade, price, dateStr);
      return sum + result.unrealizedPnL;
    }, 0);
  }

  /**
   * Calculate net cash flow (deposits - withdrawals)
   * @param {Array} transactions - Cash flow transactions
   * @returns {number} Net cash flow
   * @private
   */
  _calculateNetCashFlow(transactions) {
    return transactions.reduce((sum, txn) => {
      return sum + (txn.type === 'deposit' ? txn.amount : -txn.amount);
    }, 0);
  }

  /**
   * Calculate cash flow up to a specific date
   * @param {Array} transactions - Cash flow transactions
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {number} Net cash flow up to date
   * @private
   */
  _calculateCashFlowUpToDate(transactions, dateStr) {
    return transactions
      .filter(txn => txn.date <= dateStr)
      .reduce((sum, txn) => {
        return sum + (txn.type === 'deposit' ? txn.amount : -txn.amount);
      }, 0);
  }

  /**
   * Get trades that were open on a specific date
   * @param {Array} allTrades - All trades
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {Array} Trades open on date
   * @private
   */
  _getTradesOpenOnDate(allTrades, dateStr) {
    return allTrades.filter(trade => {
      const entryDateStr = this._getEntryDateString(trade);
      const enteredBefore = entryDateStr <= dateStr;
      const notClosedYet = !trade.exitDate || trade.exitDate > dateStr;
      return enteredBefore && notClosedYet;
    });
  }

  /**
   * Get trades that were closed on or before a specific date
   * @param {Array} allTrades - All trades
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {Array} Trades closed by date
   * @private
   */
  _getTradesClosedByDate(allTrades, dateStr) {
    return allTrades.filter(trade => {
      return trade.exitDate && trade.exitDate <= dateStr;
    });
  }

  /**
   * Get the number of shares held on a specific date (accounts for trims)
   * @param {Object} trade - Trade object
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {number} Shares held on date
   * @private
   */
  _getSharesOnDate(trade, dateStr) {
    if (trade.status === 'closed') {
      return 0;
    }

    if (trade.status === 'open' || !trade.trimHistory || trade.trimHistory.length === 0) {
      return trade.shares;
    }

    // For trimmed trades, calculate shares based on trim history
    let shares = trade.shares;

    for (const trim of trade.trimHistory || []) {
      if (trim.date <= dateStr) {
        shares -= (trim.sharesSold || trim.shares);
      }
    }

    return Math.max(0, shares);
  }

  /**
   * Calculate P&L from trades closed on a specific date
   * @param {Array} allTrades - All trades
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {number} P&L from trades closed on this date
   */
  calculateDayPnL(allTrades, dateStr) {
    return allTrades
      .filter(t => t.exitDate === dateStr)
      .reduce((sum, t) => sum + (t.pnl || 0), 0);
  }

  /**
   * Calculate cash flow for a specific date
   * @param {Array} transactions - Cash flow transactions
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {number} Net cash flow on this date
   */
  calculateDayCashFlow(transactions, dateStr) {
    return transactions
      .filter(t => t.date === dateStr)
      .reduce((sum, t) => sum + (t.type === 'deposit' ? t.amount : -t.amount), 0);
  }

  /**
   * Get detailed P&L breakdown for display
   * @param {Object} options - Same as calculateCurrentBalance
   * @returns {Object} Detailed breakdown
   */
  getDetailedBreakdown(options) {
    const result = this.calculateCurrentBalance(options);

    // Get open positions breakdown
    const openPositions = options.allTrades
      .filter(t => t.status === 'open' || t.status === 'trimmed')
      .map(trade => {
        const priceData = options.currentPrices[trade.ticker];
        const price = priceData?.price || priceData;

        if (!price) {
          return null;
        }

        const pnlData = this.calculateTradeUnrealizedPnL(trade, price);

        return {
          ticker: trade.ticker,
          status: trade.status,
          entry: trade.entry,
          currentPrice: price,
          shares: pnlData.shares,
          unrealizedPnL: pnlData.unrealizedPnL,
          unrealizedPercent: pnlData.unrealizedPercent
        };
      })
      .filter(Boolean);

    return {
      ...result,
      openPositions,
      totalValue: result.balance,
      percentReturn: ((result.balance - options.startingBalance) / options.startingBalance) * 100
    };
  }

  /**
   * Get entry date string from trade timestamp
   * Converts timestamp to 'YYYY-MM-DD' format
   * @param {Object} trade - Trade object
   * @returns {string} Date string in 'YYYY-MM-DD' format
   * @private
   */
  _getEntryDateString(trade) {
    if (!trade.timestamp) return null;

    // If timestamp is already a string in YYYY-MM-DD format, return it
    if (typeof trade.timestamp === 'string' && trade.timestamp.match(/^\d{4}-\d{2}-\d{2}/)) {
      return trade.timestamp.substring(0, 10);
    }

    // Otherwise convert to Date and format
    const date = new Date(trade.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

// Create singleton instance
const accountBalanceCalculator = new AccountBalanceCalculator();

export default accountBalanceCalculator;
