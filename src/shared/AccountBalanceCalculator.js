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
import { calculateRealizedPnL, getTradeRealizedPnL } from '../core/utils/tradeCalculations.js';
import { formatDate } from '../utils/marketHours.js';
import { getCashFlowOnDate, getTransactionDateString, getNetCashFlow, getCashFlowUpToDate } from '../utils/cashFlowUtils.js';
import { getTradesOpenOnDate, getTradeEntryDateString } from '../utils/tradeUtils.js';
import { priceTracker } from '../core/priceTracker.js';
import { generateOptionKeyFromTrade } from '../utils/optionKeyUtils.js';
import { getOpenTrades } from './TradeFilters.js';
import { getAssetMultiplier } from '../utils/assetTypeUtils.js';

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
    // Include totalRealizedPnL for trimmed trades, fallback to pnl for closed trades
    const realizedPnL = tradesClosedByDate.reduce((sum, t) => sum + getTradeRealizedPnL(t), 0);

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

    // For options, multiply by 100 (contract multiplier)
    const multiplier = getAssetMultiplier(trade.assetType);
    const unrealizedPnL = (currentPrice - trade.entry) * shares * multiplier;
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
    return calculateRealizedPnL(allTrades);
  }

  /**
   * Calculate total unrealized P&L for open/trimmed positions
   * @param {Array} allTrades - All trades
   * @param {Object} currentPrices - Map of ticker → { price, ... }
   * @returns {number} Total unrealized P&L
   * @private
   */
  _calculateUnrealizedPnL(allTrades, currentPrices) {
    return getOpenTrades(allTrades)
      .reduce((sum, trade) => {
        let price = null;

        // For options, get price from options cache
        if (trade.assetType === 'options') {
          price = priceTracker.getOptionPrice(
            trade.ticker,
            trade.expirationDate,
            trade.optionType,
            trade.strike
          );
        } else {
          // For stocks, get from currentPrices map
          const priceData = currentPrices[trade.ticker];
          if (priceData) {
            price = priceData.price || priceData; // Handle both object and number
          }
        }

        if (!price) return sum;

        const result = this.calculateTradeUnrealizedPnL(trade, price);
        return sum + result.unrealizedPnL;
      }, 0);
  }

  /**
   * Calculate unrealized P&L using specific prices (for historical dates)
   * @param {Array} trades - Trades open on the date
   * @param {Object} prices - Map of ticker/optionKey → price
   * @param {string} dateStr - Date string for share count
   * @returns {number} Total unrealized P&L
   * @private
   */
  _calculateUnrealizedPnLWithPrices(trades, prices, dateStr) {
    return trades.reduce((sum, trade) => {
      let price;

      if (trade.assetType === 'options') {
        // For options, lookup by unique key: ticker_strike_expiration_type
        const optionKey = generateOptionKeyFromTrade(trade);
        price = prices[optionKey];

        // If no price found, skip (days without logged-in premium storage)
        if (!price) return sum;
      } else {
        // For stocks, lookup by ticker
        price = prices[trade.ticker];
        if (!price) return sum;
      }

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
    return getNetCashFlow(transactions);
  }

  /**
   * Calculate cash flow up to a specific date
   * @param {Array} transactions - Cash flow transactions
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {number} Net cash flow up to date
   * @private
   */
  _calculateCashFlowUpToDate(transactions, dateStr) {
    return getCashFlowUpToDate(transactions, dateStr);
  }

  /**
   * Get trades that were open on a specific date
   * @param {Array} allTrades - All trades
   * @param {string} dateStr - Date in 'YYYY-MM-DD' format
   * @returns {Array} Trades open on date
   * @private
   */
  _getTradesOpenOnDate(allTrades, dateStr) {
    return getTradesOpenOnDate(allTrades, dateStr);
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
    return getCashFlowOnDate(transactions, dateStr);
  }

  /**
   * Get detailed P&L breakdown for display
   * @param {Object} options - Same as calculateCurrentBalance
   * @returns {Object} Detailed breakdown
   */
  getDetailedBreakdown(options) {
    const result = this.calculateCurrentBalance(options);

    // Get open positions breakdown
    const openPositions = getOpenTrades(options.allTrades)
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
   * Converts timestamp to 'YYYY-MM-DD' format using UTC
   * @param {Object} trade - Trade object
   * @returns {string} Date string in 'YYYY-MM-DD' format
   * @private
   */
  _getEntryDateString(trade) {
    return getTradeEntryDateString(trade);
  }

  /**
   * Extract date string from transaction timestamp
   * @param {Object} transaction - Transaction object with timestamp
   * @returns {string|null} Date string in 'YYYY-MM-DD' format
   * @private
   */
  _getTransactionDateString(transaction) {
    return getTransactionDateString(transaction);
  }
}

// Create singleton instance
const accountBalanceCalculator = new AccountBalanceCalculator();

export default accountBalanceCalculator;
