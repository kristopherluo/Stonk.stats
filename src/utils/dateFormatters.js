/**
 * Centralized date formatting utilities
 * All date string inputs should be in YYYY-MM-DD format
 */

/**
 * Parse YYYY-MM-DD string to Date object (avoids UTC timezone issues)
 */
export function parseYMDString(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format date as "Dec 12, 2025"
 */
export function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const date = parseYMDString(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format date as "12/12/2025"
 */
export function formatDateNumeric(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${month}/${day}/${year}`;
}

/**
 * Format date range for display
 * Handles special strings like "Beginning" and "Today"
 */
export function formatDateRange(fromStr, toStr) {
  const formatWithSpecial = (str) => {
    if (!str || str === 'Beginning' || str === 'Today') return str;
    return formatDateLong(str);
  };

  const from = formatWithSpecial(fromStr) || 'Beginning';
  const to = formatWithSpecial(toStr) || 'Today';

  if (!fromStr && !toStr) return 'All time';
  return `${from} - ${to}`;
}
