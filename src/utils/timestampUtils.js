/**
 * Timestamp Utilities - Shared timestamp and date string extraction logic
 *
 * This file consolidates duplicate timestamp handling that was previously
 * duplicated in tradeUtils.js and cashFlowUtils.js
 */

import { formatDate } from './marketHours.js';

/**
 * Extract date string from an object's timestamp property
 * Handles both string and Date timestamps
 * @param {Object} obj - Object with timestamp property
 * @param {string} [timestampField='timestamp'] - Name of the timestamp field
 * @returns {string|null} Date string in 'YYYY-MM-DD' format, or null if no timestamp
 */
export function getDateStringFromTimestamp(obj, timestampField = 'timestamp') {
  const timestamp = obj[timestampField];

  if (!timestamp) return null;

  // If timestamp is already a string in YYYY-MM-DD format, return it
  if (typeof timestamp === 'string' && timestamp.match(/^\d{4}-\d{2}-\d{2}/)) {
    return timestamp.substring(0, 10);
  }

  // Otherwise convert to Date and format
  const date = new Date(timestamp);
  return formatDate(date);
}
