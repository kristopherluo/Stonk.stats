/**
 * Stats Chart - Canvas-based equity curve chart
 */

import { state } from '../../core/state.js';
import { stats } from './stats.js';

class EquityChart {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.emptyState = null;
    this.dpr = window.devicePixelRatio || 1;

    // Chart colors
    this.colors = {
      line: '#3b82f6',      // Primary blue
      fill: 'rgba(59, 130, 246, 0.1)',
      fillEnd: 'rgba(59, 130, 246, 0)',
      profit: '#22c55e',     // Success green
      loss: '#ef4444',       // Danger red
      grid: 'rgba(255, 255, 255, 0.05)',
      text: '#64748b',       // Muted text
      axis: '#2a3545'        // Border subtle
    };

    // Light theme colors (applied via CSS custom properties check)
    this.lightColors = {
      line: '#2563eb',
      fill: 'rgba(37, 99, 235, 0.08)',
      fillEnd: 'rgba(37, 99, 235, 0)',
      profit: '#16a34a',
      loss: '#dc2626',
      grid: 'rgba(0, 0, 0, 0.03)',
      text: '#64748b',
      axis: '#e2e8f0'
    };
  }

  init() {
    this.canvas = document.getElementById('equityChartCanvas');
    this.container = document.getElementById('equityChartContainer');
    this.emptyState = document.getElementById('equityChartEmpty');

    if (!this.canvas || !this.container) {
      console.warn('EquityChart: Required elements not found');
      return;
    }

    this.ctx = this.canvas.getContext('2d');
    this.resize();

    // Handle resize
    window.addEventListener('resize', () => this.resize());

    // Listen for view changes to render
    state.on('viewChanged', (data) => {
      if (data.to === 'stats') {
        // Wait for view animation to complete (200ms show + 300ms animation + buffer)
        setTimeout(() => {
          this.resize();
        }, 550);
      }
    });

    // Listen for journal changes
    state.on('journalEntryAdded', () => this.render());
    state.on('journalEntryUpdated', () => this.render());
    state.on('journalEntryDeleted', () => this.render());

    // Listen for stats updates (e.g., filter changes)
    state.on('statsUpdated', () => this.render());
  }

  resize() {
    if (!this.canvas || !this.container) return;

    const rect = this.container.getBoundingClientRect();

    // Skip if container has no dimensions (e.g., view not visible)
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    // Setting canvas width/height resets the context, so reapply transformations
    this.ctx.scale(this.dpr, this.dpr);

    this.render();
  }

  getColors() {
    // Check if light theme
    const isLight = document.documentElement.dataset.theme === 'light';
    return isLight ? this.lightColors : this.colors;
  }

  async render() {
    if (!this.ctx || !this.canvas) return;

    const data = await stats.buildEquityCurve();
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;

    // Skip render if canvas hasn't been properly sized yet
    if (width === 0 || height === 0) {
      return;
    }

    const colors = this.getColors();

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    // Check for empty state
    if (data.length < 2) {
      this.showEmptyState(true);
      return;
    }
    this.showEmptyState(false);

    // Chart padding
    const padding = {
      top: 20,
      right: 20,
      bottom: 30,
      left: 60
    };

    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate min/max for scaling
    const values = data.map(d => d.balance);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;

    // Add 10% padding to range
    const paddedMin = minValue - valueRange * 0.1;
    const paddedMax = maxValue + valueRange * 0.1;
    const paddedRange = paddedMax - paddedMin;

    // X scale (time)
    const dates = data.map(d => d.date);
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    const scaleX = (date) => padding.left + ((date - minDate) / dateRange) * chartWidth;
    const scaleY = (value) => padding.top + chartHeight - ((value - paddedMin) / paddedRange) * chartHeight;

    // Draw grid lines
    this.drawGrid(padding, chartWidth, chartHeight, paddedMin, paddedMax, colors);

    // Draw fill gradient
    this.drawFill(data, scaleX, scaleY, padding, chartHeight, colors);

    // Draw line
    this.drawLine(data, scaleX, scaleY, colors);

    // Draw Y-axis labels
    this.drawYAxisLabels(padding, chartHeight, paddedMin, paddedMax, colors);

    // Draw X-axis labels
    this.drawXAxisLabels(data, scaleX, padding, chartWidth, chartHeight, colors);
  }

  drawGrid(padding, chartWidth, chartHeight, minValue, maxValue, colors) {
    this.ctx.strokeStyle = colors.grid;
    this.ctx.lineWidth = 1;

    // Horizontal grid lines (5 lines)
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(padding.left, y);
      this.ctx.lineTo(padding.left + chartWidth, y);
      this.ctx.stroke();
    }
  }

  drawFill(data, scaleX, scaleY, padding, chartHeight, colors) {
    if (data.length < 2) return;

    const gradient = this.ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
    gradient.addColorStop(0, colors.fill);
    gradient.addColorStop(1, colors.fillEnd);

    this.ctx.beginPath();
    this.ctx.moveTo(scaleX(data[0].date), scaleY(data[0].balance));

    for (let i = 1; i < data.length; i++) {
      this.ctx.lineTo(scaleX(data[i].date), scaleY(data[i].balance));
    }

    // Close the path along the bottom
    this.ctx.lineTo(scaleX(data[data.length - 1].date), padding.top + chartHeight);
    this.ctx.lineTo(scaleX(data[0].date), padding.top + chartHeight);
    this.ctx.closePath();

    this.ctx.fillStyle = gradient;
    this.ctx.fill();
  }

  drawLine(data, scaleX, scaleY, colors) {
    if (data.length < 2) return;

    this.ctx.strokeStyle = colors.line;
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';

    this.ctx.beginPath();
    this.ctx.moveTo(scaleX(data[0].date), scaleY(data[0].balance));

    for (let i = 1; i < data.length; i++) {
      this.ctx.lineTo(scaleX(data[i].date), scaleY(data[i].balance));
    }

    this.ctx.stroke();
  }

  drawPoints(data, scaleX, scaleY, colors) {
    // Skip first point (starting balance)
    for (let i = 1; i < data.length; i++) {
      const point = data[i];
      const x = scaleX(point.date);
      const y = scaleY(point.balance);
      const isProfit = point.pnl >= 0;

      // Draw circle
      this.ctx.beginPath();
      this.ctx.arc(x, y, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = isProfit ? colors.profit : colors.loss;
      this.ctx.fill();

      // White border
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
    }
  }

  drawYAxisLabels(padding, chartHeight, minValue, maxValue, colors) {
    this.ctx.fillStyle = colors.text;
    this.ctx.font = '11px Inter, sans-serif';
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';

    const valueRange = maxValue - minValue;
    const step = valueRange / 4;

    for (let i = 0; i <= 4; i++) {
      const value = maxValue - step * i;
      const y = padding.top + (chartHeight / 4) * i;
      const label = this.formatCurrency(value);
      this.ctx.fillText(label, padding.left - 8, y);
    }
  }

  drawXAxisLabels(data, scaleX, padding, chartWidth, chartHeight, colors) {
    if (data.length < 2) return;

    this.ctx.fillStyle = colors.text;
    this.ctx.font = '11px Inter, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';

    const y = padding.top + chartHeight + 8;

    // Determine how many labels to show based on available width
    const labelWidth = 80; // Approximate width needed per label
    const maxLabels = Math.max(2, Math.floor(chartWidth / labelWidth));
    const labelCount = Math.min(maxLabels, data.length);

    // Calculate step size
    const step = Math.max(1, Math.ceil((data.length - 1) / (labelCount - 1)));

    // Build indices to show, filtering out duplicate dates
    const indicesToShow = [];
    const shownDates = new Set();

    // Always show first
    indicesToShow.push(0);
    shownDates.add(this.formatDate(data[0].date));

    // Add intermediate labels
    for (let i = step; i < data.length - 1; i += step) {
      const dateLabel = this.formatDate(data[i].date);
      if (!shownDates.has(dateLabel)) {
        indicesToShow.push(i);
        shownDates.add(dateLabel);
      }
    }

    // Always show last if different from previous
    const lastIndex = data.length - 1;
    const lastDateLabel = this.formatDate(data[lastIndex].date);
    if (!shownDates.has(lastDateLabel)) {
      const previousIndex = indicesToShow[indicesToShow.length - 1];
      // Only add if far enough, otherwise replace previous
      if (lastIndex - previousIndex >= step * 0.6) {
        indicesToShow.push(lastIndex);
      } else {
        indicesToShow[indicesToShow.length - 1] = lastIndex;
      }
    }

    // Draw labels
    indicesToShow.forEach(index => {
      const point = data[index];
      const x = scaleX(point.date);
      const label = this.formatDate(point.date);
      this.ctx.fillText(label, x, y);
    });
  }

  formatDate(timestamp) {
    const date = new Date(timestamp);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear();

    // Show month/day for recent dates, month/year for older ones
    const now = new Date();
    const yearDiff = now.getFullYear() - year;

    if (yearDiff > 0) {
      return `${month} ${year}`;
    }
    return `${month} ${day}`;
  }

  formatCurrency(value) {
    if (Math.abs(value) >= 1000000) {
      return '$' + (value / 1000000).toFixed(1) + 'M';
    } else if (Math.abs(value) >= 1000) {
      return '$' + (value / 1000).toFixed(1) + 'k';
    }
    return '$' + value.toFixed(0);
  }

  showEmptyState(show) {
    if (this.emptyState) {
      this.emptyState.style.display = show ? 'flex' : 'none';
    }
    if (this.canvas) {
      this.canvas.style.display = show ? 'none' : 'block';
    }
  }
}

export const equityChart = new EquityChart();
export { EquityChart };
