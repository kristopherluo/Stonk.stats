/**
 * Trade Utilities - Shared trade date logic and comparison functions
 *
 * This file consolidates duplicate trade date logic that was previously
 * scattered across EquityCurveManager, AccountBalanceCalculator, and stats.js
 */

import { getDateStringFromTimestamp } from './timestampUtils.js';

/**
 * Get entry date string from a trade's timestamp
 * Handles both string and Date timestamps
 * @param {Object} trade - Trade object with timestamp property
 * @returns {string|null} Date string in 'YYYY-MM-DD' format, or null if no timestamp
 */
export function getTradeEntryDateString(trade) {
  return getDateStringFromTimestamp(trade, 'timestamp');
}

/**
 * Check if a trade is open on a specific date
 * A trade is "open" on a date if:
 * - Entry date is on or before that date
 * - Exit date is AFTER that date (or no exit date)
 *
 * Note: Uses `>` for exitDate comparison (not `>=`)
 * If a trade exits on a date, it's considered "closed" for that date
 * because we have the actual exit price, not EOD price
 *
 * @param {Object} trade - Trade object with timestamp and optional exitDate
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {boolean} True if trade is open on the specified date
 */
export function isTradeOpenOnDate(trade, dateStr) {
  const entryDate = getTradeEntryDateString(trade);
  if (!entryDate) return false;

  const enteredBefore = entryDate <= dateStr;
  const notClosedYet = !trade.exitDate || trade.exitDate > dateStr; // > to exclude close date

  return enteredBefore && notClosedYet;
}

/**
 * Get all trades that are open on a specific date
 * @param {Array} trades - Array of trade objects
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {Array} Array of trades open on that date
 */
export function getTradesOpenOnDate(trades, dateStr) {
  return trades.filter(trade => isTradeOpenOnDate(trade, dateStr));
}

/**
 * Get the earliest entry date from an array of trades
 * @param {Array} trades - Array of trade objects
 * @returns {string|null} Earliest date string in 'YYYY-MM-DD' format, or null if no trades
 */
export function getEarliestTradeDate(trades) {
  if (!trades || trades.length === 0) return null;

  return trades.reduce((earliest, trade) => {
    const entryDateStr = getTradeEntryDateString(trade);
    if (!entryDateStr) return earliest;
    return !earliest || entryDateStr < earliest ? entryDateStr : earliest;
  }, null);
}

/**
 * Get all unique tickers from trades that are open on a specific date
 * @param {Array} trades - Array of trade objects
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {Array<string>} Array of unique ticker symbols
 */
export function getTickersOpenOnDate(trades, dateStr) {
  const openTrades = getTradesOpenOnDate(trades, dateStr);
  const tickers = openTrades.map(trade => trade.ticker);
  return [...new Set(tickers)]; // Remove duplicates
}
