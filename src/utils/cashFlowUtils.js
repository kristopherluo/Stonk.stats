/**
 * Cash Flow Utilities - Shared cash flow calculation functions
 *
 * This file consolidates duplicate cash flow logic that was previously
 * scattered across AccountBalanceCalculator and StatsCalculator
 */

import { getDateStringFromTimestamp } from './timestampUtils.js';

/**
 * Extract date string from transaction timestamp
 * Handles both string and Date timestamps
 * @param {Object} transaction - Transaction object with timestamp property
 * @returns {string|null} Date string in 'YYYY-MM-DD' format, or null if no timestamp
 */
export function getTransactionDateString(transaction) {
  return getDateStringFromTimestamp(transaction, 'timestamp');
}

/**
 * Calculate total net cash flow from all transactions
 * @param {Array} transactions - Array of cash flow transactions
 * @returns {number} Net cash flow (deposits - withdrawals)
 */
export function getNetCashFlow(transactions) {
  if (!transactions || transactions.length === 0) return 0;

  return transactions.reduce((sum, txn) => {
    return sum + (txn.type === 'deposit' ? txn.amount : -txn.amount);
  }, 0);
}

/**
 * Calculate cumulative cash flow up to and including a specific date
 * @param {Array} transactions - Array of cash flow transactions
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {number} Net cash flow up to this date (inclusive)
 */
export function getCashFlowUpToDate(transactions, dateStr) {
  if (!transactions || transactions.length === 0) return 0;

  return transactions
    .filter(txn => {
      const txnDateStr = getTransactionDateString(txn);
      return txnDateStr && txnDateStr <= dateStr;
    })
    .reduce((sum, txn) => {
      return sum + (txn.type === 'deposit' ? txn.amount : -txn.amount);
    }, 0);
}

/**
 * Calculate cash flow for a specific date only
 * @param {Array} transactions - Array of cash flow transactions
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {number} Net cash flow on this specific date
 */
export function getCashFlowOnDate(transactions, dateStr) {
  if (!transactions || transactions.length === 0) return 0;

  return transactions
    .filter(txn => {
      const txnDateStr = getTransactionDateString(txn);
      return txnDateStr === dateStr;
    })
    .reduce((sum, txn) => {
      return sum + (txn.type === 'deposit' ? txn.amount : -txn.amount);
    }, 0);
}

/**
 * Calculate cash flow for a date range (inclusive)
 * @param {Array} transactions - Array of cash flow transactions
 * @param {string} startDate - Start date in 'YYYY-MM-DD' format
 * @param {string} endDate - End date in 'YYYY-MM-DD' format
 * @returns {number} Net cash flow in the date range
 */
export function getCashFlowInRange(transactions, startDate, endDate) {
  if (!transactions || transactions.length === 0) return 0;

  return transactions
    .filter(txn => {
      const txnDateStr = getTransactionDateString(txn);
      return txnDateStr && txnDateStr >= startDate && txnDateStr <= endDate;
    })
    .reduce((sum, txn) => {
      return sum + (txn.type === 'deposit' ? txn.amount : -txn.amount);
    }, 0);
}

/**
 * Get all transactions on a specific date
 * @param {Array} transactions - Array of cash flow transactions
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {Array} Array of transactions on that date
 */
export function getTransactionsOnDate(transactions, dateStr) {
  if (!transactions || transactions.length === 0) return [];

  return transactions.filter(txn => {
    const txnDateStr = getTransactionDateString(txn);
    return txnDateStr === dateStr;
  });
}

/**
 * Get all transactions up to and including a specific date
 * @param {Array} transactions - Array of cash flow transactions
 * @param {string} dateStr - Date string in 'YYYY-MM-DD' format
 * @returns {Array} Array of transactions up to that date
 */
export function getTransactionsUpToDate(transactions, dateStr) {
  if (!transactions || transactions.length === 0) return [];

  return transactions.filter(txn => {
    const txnDateStr = getTransactionDateString(txn);
    return txnDateStr && txnDateStr <= dateStr;
  });
}
