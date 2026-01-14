/**
 * DateRangeFilter - Shared date range filter logic for Journal and Stats pages
 * Based on working journal implementation
 */

import { state } from '../core/state.js';
import { getCurrentWeekday } from '../core/utils.js';
import * as marketHours from '../utils/marketHours.js';

export class DateRangeFilter {
  constructor() {
    this.filters = {
      dateFrom: null,
      dateTo: null
    };
  }

  /**
   * Format date as YYYY-MM-DD using UTC (consistent with EquityCurveManager)
   */
  formatDate(date) {
    return marketHours.formatDate(date);
  }

  /**
   * Get current filter state
   */
  getActiveFilter() {
    return { ...this.filters };
  }

  /**
   * Check if current filter matches Max preset (earliest trade to today)
   * Max is the default state, so it shouldn't count as an active filter
   */
  isMaxPreset() {
    if (!this.filters.dateFrom || !this.filters.dateTo) {
      return false;
    }

    const today = getCurrentWeekday();
    const todayStr = this.formatDate(today);

    // Check if dateTo is today
    if (this.filters.dateTo !== todayStr) {
      return false;
    }

    // Check if dateFrom matches earliest trade date
    const allTrades = state.journal.entries;
    if (allTrades && allTrades.length > 0) {
      const datesWithTrades = allTrades
        .filter(t => t.timestamp)
        .map(t => new Date(t.timestamp));

      if (datesWithTrades.length > 0) {
        let earliestDate = new Date(Math.min(...datesWithTrades));
        const dayOfWeek = earliestDate.getDay();
        if (dayOfWeek === 0) earliestDate.setDate(earliestDate.getDate() - 2);
        else if (dayOfWeek === 6) earliestDate.setDate(earliestDate.getDate() - 1);

        const earliestStr = this.formatDate(earliestDate);
        return this.filters.dateFrom === earliestStr;
      }
    }

    return false;
  }

  /**
   * Set filter dates
   */
  setFilter(dateFrom, dateTo) {
    this.filters.dateFrom = dateFrom;
    this.filters.dateTo = dateTo;
  }

  /**
   * Clear filters (resets to Max)
   */
  clearFilters() {
    this.filters.dateFrom = null;
    this.filters.dateTo = null;
  }

  /**
   * Sync filter UI to current state
   * Properly detects which preset button should be active
   */
  syncFilterUIToState(elements, datePresetBtns) {
    // Sync date range to current filter state
    if (elements.dateFrom) {
      elements.dateFrom.value = this.filters.dateFrom || '';
    }
    if (elements.dateTo) {
      elements.dateTo.value = this.filters.dateTo || '';
    }

    // Determine which preset button should be active
    const hasDateFilter = this.filters.dateFrom || this.filters.dateTo;
    if (!hasDateFilter) {
      // No dates set - default to max
      datePresetBtns?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === 'max');
      });
    } else {
      let matchedPreset = null;
      const today = getCurrentWeekday();
      const todayStr = this.formatDate(today);

      // Check if it matches Max preset (using shared logic)
      if (this.isMaxPreset()) {
        matchedPreset = 'max';
      }

      // Check YTD preset
      if (!matchedPreset) {
        const jan1 = new Date(today.getFullYear(), 0, 1);
        // Adjust jan1 to next weekday if it's a weekend
        const jan1DayOfWeek = jan1.getDay();
        if (jan1DayOfWeek === 0) {
          jan1.setDate(jan1.getDate() + 1);
        } else if (jan1DayOfWeek === 6) {
          jan1.setDate(jan1.getDate() + 2);
        }

        const jan1Str = this.formatDate(jan1);
        if (this.filters.dateFrom === jan1Str && this.filters.dateTo === todayStr) {
          matchedPreset = 'ytd';
        }
      }

      // Check numeric ranges if Max didn't match
      if (!matchedPreset) {
        datePresetBtns?.forEach(btn => {
          const range = btn.dataset.range;
          if (range !== 'all' && range !== 'max' && range !== 'ytd' && !isNaN(parseInt(range))) {
            const fromDate = new Date(today);
            fromDate.setDate(today.getDate() - parseInt(range));
            const fromDayOfWeek = fromDate.getDay();
            if (fromDayOfWeek === 0) fromDate.setDate(fromDate.getDate() - 2);
            else if (fromDayOfWeek === 6) fromDate.setDate(fromDate.getDate() - 1);

            const expectedFrom = this.formatDate(fromDate);

            if (this.filters.dateFrom === expectedFrom && this.filters.dateTo === todayStr) {
              matchedPreset = range;
            }
          }
        });
      }

      // Update button active states
      datePresetBtns?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === matchedPreset);
      });

      // Add/remove preset-value class
      if (matchedPreset) {
        elements.dateFrom?.classList.add('preset-value');
        elements.dateTo?.classList.add('preset-value');
      } else {
        elements.dateFrom?.classList.remove('preset-value');
        elements.dateTo?.classList.remove('preset-value');
      }
    }
  }

  /**
   * Handle date preset selection
   * Returns calculated dates { dateFrom, dateTo } as YYYY-MM-DD strings
   */
  handleDatePreset(range) {
    if (range === 'max') {
      // Max: from earliest trade to today
      const today = getCurrentWeekday();
      const allTrades = state.journal.entries;

      // Find earliest trade date
      let earliestDate = today;
      if (allTrades && allTrades.length > 0) {
        const datesWithTrades = allTrades
          .filter(t => t.timestamp)
          .map(t => new Date(t.timestamp));

        if (datesWithTrades.length > 0) {
          earliestDate = new Date(Math.min(...datesWithTrades));
          // Adjust to previous weekday if weekend
          const dayOfWeek = earliestDate.getDay();
          if (dayOfWeek === 0) earliestDate.setDate(earliestDate.getDate() - 2);
          else if (dayOfWeek === 6) earliestDate.setDate(earliestDate.getDate() - 1);
        }
      }

      return {
        dateFrom: this.formatDate(earliestDate),
        dateTo: this.formatDate(today)
      };
    } else if (range === 'ytd') {
      // Year to date - from Jan 1 of current year to today (adjusted to weekday)
      const today = getCurrentWeekday();
      const fromDate = new Date(today.getFullYear(), 0, 1);

      // Adjust fromDate to next weekday if it's a weekend
      const fromDayOfWeek = fromDate.getDay();
      if (fromDayOfWeek === 0) {
        fromDate.setDate(fromDate.getDate() + 1);
      } else if (fromDayOfWeek === 6) {
        fromDate.setDate(fromDate.getDate() + 2);
      }

      // Don't go back before earliest trade
      const allTrades = state.journal.entries;
      if (allTrades && allTrades.length > 0) {
        const datesWithTrades = allTrades
          .filter(t => t.timestamp)
          .map(t => new Date(t.timestamp));

        if (datesWithTrades.length > 0) {
          const earliestDate = new Date(Math.min(...datesWithTrades));
          if (fromDate < earliestDate) {
            fromDate.setTime(earliestDate.getTime());
            // Adjust to previous weekday if weekend
            const dayOfWeek = fromDate.getDay();
            if (dayOfWeek === 0) fromDate.setDate(fromDate.getDate() - 2);
            else if (dayOfWeek === 6) fromDate.setDate(fromDate.getDate() - 1);
          }
        }
      }

      return {
        dateFrom: this.formatDate(fromDate),
        dateTo: this.formatDate(today)
      };
    } else {
      // Calculate date range based on number of days
      const today = getCurrentWeekday();
      const fromDate = new Date(today);
      fromDate.setDate(today.getDate() - parseInt(range));

      // Adjust fromDate to previous weekday if it's a weekend
      const fromDayOfWeek = fromDate.getDay();
      if (fromDayOfWeek === 0) {
        fromDate.setDate(fromDate.getDate() - 2);
      } else if (fromDayOfWeek === 6) {
        fromDate.setDate(fromDate.getDate() - 1);
      }

      // Don't go back before earliest trade
      const allTrades = state.journal.entries;
      if (allTrades && allTrades.length > 0) {
        const datesWithTrades = allTrades
          .filter(t => t.timestamp)
          .map(t => new Date(t.timestamp));

        if (datesWithTrades.length > 0) {
          const earliestDate = new Date(Math.min(...datesWithTrades));
          if (fromDate < earliestDate) {
            fromDate.setTime(earliestDate.getTime());
            // Adjust to previous weekday if weekend
            const dayOfWeek = fromDate.getDay();
            if (dayOfWeek === 0) fromDate.setDate(fromDate.getDate() - 2);
            else if (dayOfWeek === 6) fromDate.setDate(fromDate.getDate() - 1);
          }
        }
      }

      return {
        dateFrom: this.formatDate(fromDate),
        dateTo: this.formatDate(today)
      };
    }
  }

  /**
   * Get filtered trades based on current date range
   */
  getFilteredTrades(allTrades) {
    let filtered = allTrades;

    // Filter by date range
    if (this.filters.dateFrom || this.filters.dateTo) {
      filtered = filtered.filter(trade => {
        const tradeDate = new Date(trade.timestamp);
        const tradeDateOnly = this.formatDate(tradeDate);

        let inRange = true;

        if (this.filters.dateFrom) {
          inRange = inRange && tradeDateOnly >= this.filters.dateFrom;
        }

        if (this.filters.dateTo) {
          inRange = inRange && tradeDateOnly <= this.filters.dateTo;
        }

        return inRange;
      });
    }

    return filtered;
  }
}
