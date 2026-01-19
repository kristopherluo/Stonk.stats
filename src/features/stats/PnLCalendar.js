/**
 * PnLCalendar - Monthly calendar showing daily P&L
 * Displays total balance change (including unrealized P&L) for each trading day
 */

import { state } from '../../core/state.js';
import { equityCurveManager } from './EquityCurveManager.js';
import eodCacheManager from '../../core/eodCacheManager.js';
import * as marketHours from '../../utils/marketHours.js';

class PnLCalendar {
  constructor(options = {}) {
    // Configuration
    this.containerId = options.containerId || 'pnlCalendar';
    this.onDayClick = options.onDayClick || null;
    this.showWeekends = options.showWeekends ?? true;

    // State
    this.currentYear = null;
    this.currentMonth = null; // 0-11
    this.selectedDate = null; // Currently selected date
    this.monthData = new Map(); // dateStr -> { pnl, tradesCount, balance }
    this.isCalculating = false;
    this.pickerOpen = false;

    // DOM elements
    this.elements = {};
  }

  /**
   * Initialize the calendar
   * Sets up DOM references and event listeners
   */
  async init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`[PnLCalendar] Container with id "${this.containerId}" not found`);
      return;
    }

    // Set to current month
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth();

    // Initial render
    await this.render();

    // Auto-select today's date (even if weekend)
    this._autoSelectToday();
  }

  /**
   * Auto-select today's date (including weekends)
   * @private
   */
  _autoSelectToday() {
    const today = new Date();
    const dateStr = marketHours.formatDate(today);

    // Trigger day click to show trades for today
    setTimeout(() => {
      this.handleDayClick(dateStr);
    }, 100);
  }

  /**
   * Set the displayed month
   * @param {number} year - Full year (e.g., 2026)
   * @param {number} month - Month index (0-11)
   */
  setMonth(year, month) {
    this.currentYear = year;
    this.currentMonth = month;
    this.render();
  }

  /**
   * Refresh the calendar (recalculate and re-render)
   * Called when trade data changes or equity curve updates
   */
  refresh() {
    this.render();
  }

  /**
   * Main render method
   * Calculates month data and builds the calendar grid
   */
  async render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Show loading state
    container.innerHTML = '<div class="pnl-calendar__loading">Loading...</div>';

    // Calculate P&L data for the month
    await this.calculateMonthData();

    // Build and render the calendar grid
    this._buildCalendarGrid();
  }

  /**
   * Calculate P&L data for all days in the current month
   * Reads directly from EOD cache to avoid conflicts with stats page date filters
   */
  async calculateMonthData() {
    if (this.isCalculating) return;
    this.isCalculating = true;

    try {
      this.monthData.clear();

      // Get all days in the current month
      const daysInMonth = this._getDaysInMonth();

      // Get starting account size for calculating first day
      const startingAccountSize = state.settings?.startingAccountSize || 0;

      // Calculate P&L for each day
      for (const day of daysInMonth) {
        if (!day.isCurrentMonth) continue;

        const dateStr = marketHours.formatDate(day.date);
        const prevDate = this._getPreviousBusinessDay(day.date);
        const prevDateStr = prevDate ? marketHours.formatDate(prevDate) : null;

        // Get balance for this day from EOD cache (not equity curve manager)
        // This ensures we get unfiltered data regardless of stats page date filter
        const eodData = eodCacheManager.getEODData(dateStr);
        if (!eodData || eodData.incomplete) {
          continue;
        }

        const balance = eodData.balance;
        const cashFlow = eodData.cashFlow || 0;

        // Get previous day balance
        let prevBalance;
        if (!prevDateStr) {
          // First trading day - use starting account size
          prevBalance = startingAccountSize;
        } else {
          const prevEodData = eodCacheManager.getEODData(prevDateStr);
          if (prevEodData && !prevEodData.incomplete) {
            prevBalance = prevEodData.balance;
          } else {
            prevBalance = startingAccountSize;
          }
        }

        // Calculate daily P&L: balance change minus cash flow
        const dailyPnL = balance - prevBalance - cashFlow;

        // Store in monthData
        this.monthData.set(dateStr, {
          pnl: dailyPnL,
          balance: balance,
          cashFlow: cashFlow
        });
      }
    } catch (error) {
      console.error('[PnLCalendar] Error calculating month data:', error);
    } finally {
      this.isCalculating = false;
    }
  }

  /**
   * Build the calendar grid DOM structure
   * @private
   */
  _buildCalendarGrid() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Clear container
    container.innerHTML = '';

    // Create calendar HTML
    const calendarHTML = `
      <div class="pnl-calendar__header">
        <button class="pnl-calendar__nav-btn pnl-calendar__nav-btn--prev" data-action="prev-month" title="Previous month">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="pnl-calendar__month-display">
          <span class="pnl-calendar__month-text">${this._getMonthName(this.currentMonth)} ${this.currentYear}</span>
          <button class="pnl-calendar__month-picker-btn" data-action="open-picker" title="Select month/year">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
        <div class="pnl-calendar__header-right">
          <button class="pnl-calendar__today-btn" data-action="today" title="Go to current month">Today</button>
          <button class="pnl-calendar__nav-btn pnl-calendar__nav-btn--next" data-action="next-month" title="Next month">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>
      <div class="pnl-calendar__grid">
        ${this._buildWeekdayHeaders()}
        ${this._buildDayCells()}
      </div>
    `;

    container.innerHTML = calendarHTML;

    // Attach event listeners
    this._attachEventListeners();
  }

  /**
   * Build weekday header row
   * @private
   */
  _buildWeekdayHeaders() {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Weekly P&L'];
    return weekdays.map(day =>
      `<div class="pnl-calendar__weekday">${day}</div>`
    ).join('');
  }

  /**
   * Build day cells for the calendar
   * @private
   */
  _buildDayCells() {
    const days = this._getDaysInMonth();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = marketHours.formatDate(today);

    return days.map((day, index) => {
      const dateStr = marketHours.formatDate(day.date);
      const dayData = this.monthData.get(dateStr);
      const isToday = dateStr === todayStr;
      const dayCompare = new Date(day.date);
      dayCompare.setHours(0, 0, 0, 0);
      const isFuture = dayCompare > today;
      const isWeekend = day.isWeekend;
      const isSaturday = day.date.getDay() === 6;

      // For Saturday cells, calculate weekly P&L
      let pnlValue = dayData ? dayData.pnl : null;
      if (isSaturday) {
        pnlValue = this._calculateWeeklyPnL(day.date, index, days);
      }

      // Build CSS classes
      const classes = ['pnl-calendar__cell'];
      if (!day.isCurrentMonth) classes.push('pnl-calendar__cell--other-month');
      if (isToday) classes.push('pnl-calendar__cell--today');
      if (isFuture) classes.push('pnl-calendar__cell--future');
      if (isWeekend) classes.push('pnl-calendar__cell--weekend');

      // Add P&L color class
      if (pnlValue !== null && pnlValue !== undefined) {
        if (pnlValue > 0) {
          classes.push('pnl-calendar__cell--positive');
        } else if (pnlValue < 0) {
          classes.push('pnl-calendar__cell--negative');
        } else {
          classes.push('pnl-calendar__cell--neutral');
        }
      }

      // Format P&L value
      const pnlDisplay = pnlValue !== null && pnlValue !== undefined ? this._formatPnL(pnlValue) : '';

      // Build tooltip with detailed information
      let tooltipText = '';
      if (dayData && !isSaturday) {
        const parts = [];

        // Add P&L line
        if (pnlValue !== null && pnlValue !== undefined) {
          const pnlFormatted = pnlValue >= 0 ? `+$${Math.abs(pnlValue).toFixed(2)}` : `-$${Math.abs(pnlValue).toFixed(2)}`;
          parts.push(`Trading P&L: ${pnlFormatted}`);
        }

        // Add cash flow line if non-zero
        if (dayData.cashFlow && Math.abs(dayData.cashFlow) >= 0.01) {
          const cashFlowFormatted = dayData.cashFlow >= 0 ? `+$${Math.abs(dayData.cashFlow).toFixed(2)}` : `-$${Math.abs(dayData.cashFlow).toFixed(2)}`;
          const cashFlowLabel = dayData.cashFlow >= 0 ? 'Deposit' : 'Withdrawal';
          parts.push(`${cashFlowLabel}: ${cashFlowFormatted}`);
        }

        // Add balance line
        if (dayData.balance !== null && dayData.balance !== undefined) {
          parts.push(`Balance: $${dayData.balance.toFixed(2)}`);
        }

        tooltipText = parts.join(' | ');
      } else if (isSaturday && pnlValue !== null) {
        // Weekly P&L tooltip
        const pnlFormatted = pnlValue >= 0 ? `+$${Math.abs(pnlValue).toFixed(2)}` : `-$${Math.abs(pnlValue).toFixed(2)}`;
        tooltipText = `Weekly P&L: ${pnlFormatted}`;
      }

      return `
        <div class="${classes.join(' ')}" data-date="${dateStr}"${tooltipText ? ` title="${tooltipText}"` : ''}>
          <span class="pnl-calendar__day-number">${day.date.getDate()}</span>
          ${pnlDisplay ? `<span class="pnl-calendar__day-pnl">${pnlDisplay}</span>` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Calculate weekly P&L total for a given Saturday
   * Sums P&L from Monday through Friday of the week (trading days only)
   * @private
   * @param {Date} saturdayDate - The Saturday date
   * @param {number} saturdayIndex - Index of Saturday in days array
   * @param {Array} days - Array of all day objects
   * @returns {number|null} - Total weekly P&L or null if no data
   */
  _calculateWeeklyPnL(saturdayDate, saturdayIndex, days) {
    let weeklyTotal = 0;
    let hasData = false;

    // Calculate Monday through Friday (5 days before Saturday to 1 day before Saturday)
    // We'll iterate backwards from Friday (1 day before Saturday) to Monday (5 days before)
    for (let i = 1; i <= 5; i++) {
      const dayIndex = saturdayIndex - i;
      if (dayIndex < 0) continue; // Skip if we're before the start of the array

      const day = days[dayIndex];
      const dateStr = marketHours.formatDate(day.date);
      const dayData = this.monthData.get(dateStr);

      if (dayData && dayData.pnl !== null && dayData.pnl !== undefined) {
        weeklyTotal += dayData.pnl;
        hasData = true;
      }
    }

    return hasData ? weeklyTotal : null;
  }

  /**
   * Attach event listeners to calendar elements
   * @private
   */
  _attachEventListeners() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Navigation buttons
    const prevBtn = container.querySelector('[data-action="prev-month"]');
    const nextBtn = container.querySelector('[data-action="next-month"]');
    const todayBtn = container.querySelector('[data-action="today"]');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.handlePrevMonth());
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.handleNextMonth());
    }
    if (todayBtn) {
      todayBtn.addEventListener('click', () => this.handleToday());
    }

    // Month picker button
    const pickerBtn = container.querySelector('[data-action="open-picker"]');
    if (pickerBtn) {
      pickerBtn.addEventListener('click', () => this.handleMonthPicker());
    }

    // Day cells
    const cells = container.querySelectorAll('.pnl-calendar__cell');
    cells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        const dateStr = cell.dataset.date;
        if (dateStr && !cell.classList.contains('pnl-calendar__cell--future')) {
          this.handleDayClick(dateStr);
        }
      });
    });
  }

  /**
   * Handle previous month navigation
   */
  handlePrevMonth() {
    if (this.currentMonth === 0) {
      this.currentYear--;
      this.currentMonth = 11;
    } else {
      this.currentMonth--;
    }
    this.render();
  }

  /**
   * Handle next month navigation
   */
  handleNextMonth() {
    if (this.currentMonth === 11) {
      this.currentYear++;
      this.currentMonth = 0;
    } else {
      this.currentMonth++;
    }
    this.render();
  }

  /**
   * Handle today button click - jump to current month
   */
  handleToday() {
    const today = new Date();
    this.currentYear = today.getFullYear();
    this.currentMonth = today.getMonth();
    this.render();

    // Select today's date after rendering
    const dateStr = marketHours.formatDate(today);
    setTimeout(() => {
      this.handleDayClick(dateStr);
    }, 100);
  }

  /**
   * Handle month/year picker button click
   * Toggles the month/year picker dropdown
   */
  handleMonthPicker() {
    this.pickerOpen = !this.pickerOpen;

    if (this.pickerOpen) {
      this._showMonthPicker();
    } else {
      this._hideMonthPicker();
    }
  }

  /**
   * Show the month/year picker dropdown
   * @private
   */
  _showMonthPicker() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Remove existing picker if any
    const existingPicker = document.querySelector('.pnl-calendar__picker');
    if (existingPicker) {
      existingPicker.remove();
    }

    // Create picker dropdown
    const picker = document.createElement('div');
    picker.className = 'pnl-calendar__picker';

    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear - 5; y <= currentYear + 1; y++) {
      years.push(y);
    }

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    picker.innerHTML = `
      <div class="pnl-calendar__picker-content">
        <div class="pnl-calendar__picker-section">
          <label class="pnl-calendar__picker-label">Month</label>
          <div class="pnl-calendar__picker-months">
            ${months.map((month, idx) => `
              <button class="pnl-calendar__picker-month ${idx === this.currentMonth ? 'active' : ''}" data-month="${idx}">
                ${month.slice(0, 3)}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="pnl-calendar__picker-section">
          <label class="pnl-calendar__picker-label">Year</label>
          <div class="pnl-calendar__picker-years">
            ${years.map(year => `
              <button class="pnl-calendar__picker-year ${year === this.currentYear ? 'active' : ''}" data-year="${year}">
                ${year}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Attach to calendar header
    const header = container.querySelector('.pnl-calendar__header');
    if (header) {
      header.style.position = 'relative';
      header.appendChild(picker);
    }

    // Add event listeners
    picker.querySelectorAll('.pnl-calendar__picker-month').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const month = parseInt(btn.dataset.month);
        this.currentMonth = month;
        this._hideMonthPicker();
        this.render();
      });
    });

    picker.querySelectorAll('.pnl-calendar__picker-year').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const year = parseInt(btn.dataset.year);
        this.currentYear = year;
        this._hideMonthPicker();
        this.render();
      });
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', this._handlePickerOutsideClick.bind(this), { once: true });
    }, 0);
  }

  /**
   * Hide the month/year picker dropdown
   * @private
   */
  _hideMonthPicker() {
    const picker = document.querySelector('.pnl-calendar__picker');
    if (picker) {
      picker.remove();
    }
    this.pickerOpen = false;
  }

  /**
   * Handle clicks outside the picker to close it
   * @private
   */
  _handlePickerOutsideClick(e) {
    const picker = document.querySelector('.pnl-calendar__picker');
    const pickerBtn = document.querySelector('[data-action="open-picker"]');

    if (picker && !picker.contains(e.target) && !pickerBtn.contains(e.target)) {
      this._hideMonthPicker();
    }
  }

  /**
   * Handle day click
   * For Saturday (weekly P&L), displays trades for the entire week
   * For other days, displays trades for that day only
   * @param {string} dateStr - Date string in YYYY-MM-DD format
   */
  handleDayClick(dateStr) {
    const date = marketHours.parseDate(dateStr);
    const isSaturday = date.getDay() === 6;

    if (this.onDayClick) {
      if (isSaturday) {
        // Calculate week range (Sunday through Saturday)
        const weekRange = this._getWeekRange(date);
        this.onDayClick(dateStr, weekRange);
      } else {
        // Single day
        this.onDayClick(dateStr, null);
      }
    }

    // Update selected date in state
    this.selectedDate = dateStr;

    // Highlight selected day
    this._updateSelectedDay(dateStr);
  }

  /**
   * Get the week's date range (Monday through Friday) for a given Saturday
   * @private
   * @param {Date} saturdayDate - The Saturday date
   * @returns {Object} - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
   */
  _getWeekRange(saturdayDate) {
    // Get Monday (5 days before Saturday)
    const monday = new Date(saturdayDate);
    monday.setDate(monday.getDate() - 5);

    // Get Friday (1 day before Saturday)
    const friday = new Date(saturdayDate);
    friday.setDate(friday.getDate() - 1);

    return {
      from: marketHours.formatDate(monday),
      to: marketHours.formatDate(friday)
    };
  }

  /**
   * Update visual indication of selected day
   * @private
   */
  _updateSelectedDay(dateStr) {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Remove previous selection
    const prevSelected = container.querySelector('.pnl-calendar__cell--selected');
    if (prevSelected) {
      prevSelected.classList.remove('pnl-calendar__cell--selected');
    }

    // Add selection to new day
    const newSelected = container.querySelector(`[data-date="${dateStr}"]`);
    if (newSelected && !newSelected.classList.contains('pnl-calendar__cell--future')) {
      newSelected.classList.add('pnl-calendar__cell--selected');
    }
  }

  /**
   * Get all days to display in the calendar grid
   * Includes leading/trailing days from adjacent months for complete weeks
   * @private
   */
  _getDaysInMonth() {
    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);

    const days = [];

    // Add leading days from previous month
    const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday
    if (firstDayOfWeek > 0) {
      const prevMonthLastDay = new Date(this.currentYear, this.currentMonth, 0);
      const prevMonthDays = prevMonthLastDay.getDate();
      for (let i = firstDayOfWeek - 1; i >= 0; i--) {
        const date = new Date(this.currentYear, this.currentMonth - 1, prevMonthDays - i);
        days.push({
          date,
          isCurrentMonth: false,
          isWeekend: date.getDay() === 0 || date.getDay() === 6
        });
      }
    }

    // Add days from current month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(this.currentYear, this.currentMonth, day);
      days.push({
        date,
        isCurrentMonth: true,
        isWeekend: date.getDay() === 0 || date.getDay() === 6
      });
    }

    // Add trailing days from next month to complete the week
    const lastDayOfWeek = lastDay.getDay();
    if (lastDayOfWeek < 6) {
      for (let i = 1; i <= 6 - lastDayOfWeek; i++) {
        const date = new Date(this.currentYear, this.currentMonth + 1, i);
        days.push({
          date,
          isCurrentMonth: false,
          isWeekend: date.getDay() === 0 || date.getDay() === 6
        });
      }
    }

    return days;
  }

  /**
   * Get previous business day (skips weekends)
   * @private
   */
  _getPreviousBusinessDay(date) {
    const prevDate = new Date(date);
    prevDate.setDate(prevDate.getDate() - 1);

    // Skip weekends
    while (prevDate.getDay() === 0 || prevDate.getDay() === 6) {
      prevDate.setDate(prevDate.getDate() - 1);
    }

    return prevDate;
  }

  /**
   * Format P&L value for display
   * @private
   */
  _formatPnL(pnl) {
    if (pnl === null || pnl === undefined || isNaN(pnl)) {
      return '';
    }

    const absValue = Math.abs(pnl);
    const sign = pnl >= 0 ? '+' : '-';

    // Use abbreviated format for large values
    if (absValue >= 10000) {
      return `${sign}$${(absValue / 1000).toFixed(1)}K`;
    } else if (absValue >= 1000) {
      return `${sign}$${(absValue / 1000).toFixed(2)}K`;
    } else {
      return `${sign}$${absValue.toFixed(0)}`;
    }
  }

  /**
   * Get month name from month index
   * @private
   */
  _getMonthName(monthIndex) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[monthIndex];
  }
}

// Export singleton instance
export const pnlCalendar = new PnLCalendar();
