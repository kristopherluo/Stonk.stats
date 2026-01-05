/**
 * Journal View - Full trade history with filtering and analysis
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatPercent, formatDate } from '../../core/utils.js';
import { trimModal } from '../../components/modals/trimModal.js';
import { viewManager } from '../../components/ui/viewManager.js';
import { dataManager } from '../../core/dataManager.js';

class JournalView {
  constructor() {
    this.elements = {};
    this.filters = {
      status: 'all',
      types: [], // Array of selected type strings
      dateFrom: null,
      dateTo: null
    };
    this.sortColumn = 'date';
    this.sortDirection = 'desc';
    this.expandedRows = new Set();
    this.hasAnimated = false;
  }

  init() {
    this.cacheElements();
    this.bindEvents();

    // Initialize date inputs with gray styling since "All time" is default
    if (this.elements.dateFrom) this.elements.dateFrom.classList.add('preset-value');
    if (this.elements.dateTo) this.elements.dateTo.classList.add('preset-value');

    this.render();

    // Listen for journal changes
    state.on('journalEntryAdded', () => this.render());
    state.on('journalEntryUpdated', () => this.render());
    state.on('journalEntryDeleted', () => this.render());

    // Listen for view changes
    state.on('viewChanged', (data) => {
      // Clear expanded rows when navigating away from journal
      if (data.from === 'journal') {
        this.expandedRows.clear();
      }

      if (data.to === 'journal') {
        this.hasAnimated = false; // Reset animation flag when entering view
        this.render();
      }
    });
  }

  cacheElements() {
    this.elements = {
      // Header
      journalCount: document.getElementById('journalCount'),

      // Summary bar
      dateRange: document.getElementById('journalDateRange'),
      totalPnL: document.getElementById('journalTotalPnL'),
      winRate: document.getElementById('journalWinRate'),
      wins: document.getElementById('journalWins'),
      losses: document.getElementById('journalLosses'),
      avgWin: document.getElementById('journalAvgWin'),
      avgLoss: document.getElementById('journalAvgLoss'),

      // Table
      tableBody: document.getElementById('journalTableBody'),
      tableContainer: document.querySelector('.journal-table-container'),

      // Empty state
      empty: document.getElementById('journalEmpty'),
      goToDashboard: document.getElementById('journalGoToDashboard'),

      // Export buttons
      exportCSV: document.getElementById('journalExportCSV'),
      exportTSV: document.getElementById('journalExportTSV'),

      // Filter dropdown
      filterBtn: document.getElementById('journalFilterBtn'),
      filterPanel: document.getElementById('journalFilterPanel'),
      filterClose: document.getElementById('journalFilterClose'),
      filterBackdrop: document.getElementById('journalFilterBackdrop'),
      filterCount: document.getElementById('journalFilterCount'),
      applyFilters: document.getElementById('journalApplyFilters'),
      clearFilters: document.getElementById('journalClearFilters'),
      statusBtns: document.querySelectorAll('#journalFilterPanel .filter-status-btn'),
      typeCheckboxes: document.querySelectorAll('.journal-type-checkbox'),
      allTypesCheckbox: document.getElementById('journalAllTypesCheckbox'),
      dateFrom: document.getElementById('journalFilterDateFrom'),
      dateTo: document.getElementById('journalFilterDateTo'),
      datePresetBtns: document.querySelectorAll('#journalFilterPanel .filter-preset-btn')
    };
  }

  bindEvents() {
    // Go to dashboard button
    if (this.elements.goToDashboard) {
      this.elements.goToDashboard.addEventListener('click', () => {
        viewManager.navigateTo('dashboard');
      });
    }

    // Filter dropdown
    if (this.elements.filterBtn) {
      this.elements.filterBtn.addEventListener('click', () => this.toggleFilterPanel());
    }

    if (this.elements.filterClose) {
      this.elements.filterClose.addEventListener('click', () => this.closeFilterPanel());
    }

    if (this.elements.applyFilters) {
      this.elements.applyFilters.addEventListener('click', () => this.applyFilters());
    }

    if (this.elements.clearFilters) {
      this.elements.clearFilters.addEventListener('click', () => this.clearAllFilters());
    }

    // Filter backdrop
    if (this.elements.filterBackdrop) {
      this.elements.filterBackdrop.addEventListener('click', () => this.closeFilterPanel());
    }

    // Status buttons
    if (this.elements.statusBtns) {
      this.elements.statusBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this.elements.statusBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }

    // All Types checkbox
    if (this.elements.allTypesCheckbox) {
      this.elements.allTypesCheckbox.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        this.elements.typeCheckboxes?.forEach(checkbox => {
          checkbox.checked = isChecked;
        });
      });
    }

    // Individual type checkboxes - update "All Types" state
    if (this.elements.typeCheckboxes) {
      this.elements.typeCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
          const allChecked = Array.from(this.elements.typeCheckboxes).every(cb => cb.checked);
          const noneChecked = Array.from(this.elements.typeCheckboxes).every(cb => !cb.checked);

          if (this.elements.allTypesCheckbox) {
            this.elements.allTypesCheckbox.checked = allChecked;
            this.elements.allTypesCheckbox.indeterminate = !allChecked && !noneChecked;
          }
        });
      });
    }

    // Date range preset buttons
    if (this.elements.datePresetBtns) {
      this.elements.datePresetBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const range = e.target.dataset.range;
          this.handleDatePreset(range);
        });
      });
    }

    // Date inputs - clear preset selection and styling when manually changed
    if (this.elements.dateFrom) {
      this.elements.dateFrom.addEventListener('change', () => {
        this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
        this.elements.dateFrom?.classList.remove('preset-value');
        this.elements.dateTo?.classList.remove('preset-value');
      });
    }
    if (this.elements.dateTo) {
      this.elements.dateTo.addEventListener('change', () => {
        this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
        this.elements.dateFrom?.classList.remove('preset-value');
        this.elements.dateTo?.classList.remove('preset-value');
      });
    }

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (this.elements.filterPanel?.classList.contains('open')) {
        const isClickInside = this.elements.filterBtn?.contains(e.target) ||
                             this.elements.filterPanel?.contains(e.target);
        if (!isClickInside) {
          this.closeFilterPanel();
        }
      }
    });

    // Export buttons
    if (this.elements.exportCSV) {
      this.elements.exportCSV.addEventListener('click', () => {
        dataManager.exportCSV();
      });
    }
    if (this.elements.exportTSV) {
      this.elements.exportTSV.addEventListener('click', () => {
        dataManager.exportTSV();
      });
    }

    // Table header click for sorting (delegated)
    const table = document.getElementById('journalTable');
    if (table) {
      table.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('th');
        if (th && th.dataset.sort) {
          this.handleSort(th.dataset.sort);
        }
      });
    }
  }

  toggleFilterPanel() {
    const isOpen = this.elements.filterPanel?.classList.contains('open');
    if (isOpen) {
      this.closeFilterPanel();
    } else {
      this.openFilterPanel();
    }
  }

  openFilterPanel() {
    // Restore UI to match current applied filters
    this.syncFilterUIToState();

    this.elements.filterPanel?.classList.add('open');
    this.elements.filterBtn?.classList.add('open');
    this.elements.filterBackdrop?.classList.add('open');
  }

  closeFilterPanel() {
    // Restore UI to last applied state when closing without applying
    this.syncFilterUIToState();

    this.elements.filterPanel?.classList.remove('open');
    this.elements.filterBtn?.classList.remove('open');
    this.elements.filterBackdrop?.classList.remove('open');
  }

  syncFilterUIToState() {
    // Sync status buttons to current filter state
    this.elements.statusBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === this.filters.status);
    });

    // Sync type checkboxes to current filter state
    if (this.filters.types.length === 0) {
      // No types selected
      this.elements.typeCheckboxes?.forEach(checkbox => {
        checkbox.checked = false;
      });
      if (this.elements.allTypesCheckbox) {
        this.elements.allTypesCheckbox.checked = false;
        this.elements.allTypesCheckbox.indeterminate = false;
      }
    } else {
      // Specific types selected
      this.elements.typeCheckboxes?.forEach(checkbox => {
        checkbox.checked = this.filters.types.includes(checkbox.value);
      });

      // Update "All Types" checkbox state
      if (this.elements.allTypesCheckbox && this.elements.typeCheckboxes) {
        const allChecked = Array.from(this.elements.typeCheckboxes).every(cb => cb.checked);
        const noneChecked = Array.from(this.elements.typeCheckboxes).every(cb => !cb.checked);

        this.elements.allTypesCheckbox.checked = allChecked;
        this.elements.allTypesCheckbox.indeterminate = !allChecked && !noneChecked;
      }
    }

    // Sync date range to current filter state
    if (this.elements.dateFrom) {
      this.elements.dateFrom.value = this.filters.dateFrom || '';
    }
    if (this.elements.dateTo) {
      this.elements.dateTo.value = this.filters.dateTo || '';
    }

    // Determine which preset button should be active
    const hasDateFilter = this.filters.dateFrom || this.filters.dateTo;
    if (!hasDateFilter) {
      // "All time" preset
      this.elements.datePresetBtns?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === 'all');
      });
      if (this.elements.dateFrom) this.elements.dateFrom.classList.add('preset-value');
      if (this.elements.dateTo) this.elements.dateTo.classList.add('preset-value');
    } else {
      // Check if it matches a preset
      const today = new Date().toISOString().split('T')[0];
      let matchedPreset = false;

      this.elements.datePresetBtns?.forEach(btn => {
        const range = btn.dataset.range;
        if (range !== 'all') {
          const fromDate = new Date();
          fromDate.setDate(fromDate.getDate() - parseInt(range));
          const expectedFrom = fromDate.toISOString().split('T')[0];

          if (this.filters.dateFrom === expectedFrom && this.filters.dateTo === today) {
            btn.classList.add('active');
            matchedPreset = true;
            if (this.elements.dateFrom) this.elements.dateFrom.classList.add('preset-value');
            if (this.elements.dateTo) this.elements.dateTo.classList.add('preset-value');
          } else {
            btn.classList.remove('active');
          }
        }
      });

      if (!matchedPreset) {
        // Custom date range - no preset active
        this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));
        if (this.elements.dateFrom) this.elements.dateFrom.classList.remove('preset-value');
        if (this.elements.dateTo) this.elements.dateTo.classList.remove('preset-value');
      }
    }
  }

  handleDatePreset(range) {
    // Clear active state from all preset buttons
    this.elements.datePresetBtns?.forEach(btn => btn.classList.remove('active'));

    // Set active state on clicked button
    const clickedBtn = Array.from(this.elements.datePresetBtns || []).find(
      btn => btn.dataset.range === range
    );
    clickedBtn?.classList.add('active');

    if (range === 'all') {
      // Clear date inputs but keep gray styling for empty state
      if (this.elements.dateFrom) {
        this.elements.dateFrom.value = '';
        this.elements.dateFrom.classList.add('preset-value');
      }
      if (this.elements.dateTo) {
        this.elements.dateTo.value = '';
        this.elements.dateTo.classList.add('preset-value');
      }
    } else {
      // Calculate date range
      const today = new Date();
      const fromDate = new Date();
      fromDate.setDate(today.getDate() - parseInt(range));

      // Set date inputs and add preset styling
      if (this.elements.dateFrom) {
        this.elements.dateFrom.value = fromDate.toISOString().split('T')[0];
        this.elements.dateFrom.classList.add('preset-value');
      }
      if (this.elements.dateTo) {
        this.elements.dateTo.value = today.toISOString().split('T')[0];
        this.elements.dateTo.classList.add('preset-value');
      }
    }
  }

  applyFilters() {
    // Get selected status
    const selectedStatus = Array.from(this.elements.statusBtns || [])
      .find(btn => btn.classList.contains('active'))?.dataset.status || 'all';

    // Get selected types
    const selectedTypes = Array.from(this.elements.typeCheckboxes || [])
      .filter(checkbox => checkbox.checked)
      .map(checkbox => checkbox.value);

    // Get date range
    const dateFrom = this.elements.dateFrom?.value || null;
    const dateTo = this.elements.dateTo?.value || null;

    // Update filters
    this.filters.status = selectedStatus;
    this.filters.types = selectedTypes;
    this.filters.dateFrom = dateFrom;
    this.filters.dateTo = dateTo;

    // Update filter count badge
    this.updateFilterCount();

    // Clear expanded rows before re-rendering
    this.expandedRows.clear();

    // Reset animation flag to re-animate rows
    this.hasAnimated = false;

    // Close panel and render
    this.closeFilterPanel();
    this.render();
  }

  clearAllFilters() {
    // Only reset the UI - don't apply until user clicks "Apply"
    this.elements.statusBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === 'all');
    });

    // Uncheck all type checkboxes and "All Types"
    this.elements.typeCheckboxes?.forEach(checkbox => {
      checkbox.checked = false;
    });
    if (this.elements.allTypesCheckbox) {
      this.elements.allTypesCheckbox.checked = false;
      this.elements.allTypesCheckbox.indeterminate = false;
    }

    // Reset date inputs
    if (this.elements.dateFrom) {
      this.elements.dateFrom.value = '';
      this.elements.dateFrom.classList.add('preset-value');
    }
    if (this.elements.dateTo) {
      this.elements.dateTo.value = '';
      this.elements.dateTo.classList.add('preset-value');
    }

    // Reset date preset buttons to "All time"
    this.elements.datePresetBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.range === 'all');
    });
  }

  updateFilterCount() {
    let count = 0;

    // Count status filter (if not "all")
    if (this.filters.status !== 'all') {
      count++;
    }

    // Count type filters
    count += this.filters.types.length;

    // Count date range filter
    if (this.filters.dateFrom || this.filters.dateTo) {
      count++;
    }

    // Update badge
    if (count > 0) {
      this.elements.filterCount.textContent = count;
      this.elements.filterCount.style.display = 'inline-flex';
    } else {
      this.elements.filterCount.style.display = 'none';
    }
  }

  handleSort(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = 'desc';
    }

    // Clear expanded rows before re-rendering
    this.expandedRows.clear();

    this.render();
  }

  getFilteredTrades() {
    let filtered = state.journal.entries;

    // Filter by status
    switch (this.filters.status) {
      case 'open':
        filtered = filtered.filter(t => t.status === 'open');
        break;
      case 'trimmed':
        filtered = filtered.filter(t => t.status === 'trimmed');
        break;
      case 'closed':
        filtered = filtered.filter(t => t.status === 'closed');
        break;
      case 'winners':
        filtered = filtered.filter(t => {
          const pnl = t.totalRealizedPnL ?? t.pnl ?? 0;
          return (t.status === 'closed' || t.status === 'trimmed') && pnl > 0;
        });
        break;
      case 'losers':
        filtered = filtered.filter(t => {
          const pnl = t.totalRealizedPnL ?? t.pnl ?? 0;
          return (t.status === 'closed' || t.status === 'trimmed') && pnl < 0;
        });
        break;
      default:
        break;
    }

    // Filter by types (if any selected)
    if (this.filters.types.length > 0) {
      filtered = filtered.filter(trade => {
        const tradeType = trade.thesis?.setupType;
        return tradeType && this.filters.types.includes(tradeType);
      });
    }

    // Filter by date range
    if (this.filters.dateFrom || this.filters.dateTo) {
      filtered = filtered.filter(trade => {
        const tradeDate = new Date(trade.timestamp);
        const tradeDateOnly = tradeDate.toISOString().split('T')[0]; // YYYY-MM-DD

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

    // Sort
    return this.sortTrades(filtered);
  }

  sortTrades(trades) {
    const direction = this.sortDirection === 'asc' ? 1 : -1;

    return [...trades].sort((a, b) => {
      let aVal, bVal;

      switch (this.sortColumn) {
        case 'date':
          aVal = new Date(a.timestamp).getTime();
          bVal = new Date(b.timestamp).getTime();
          break;
        case 'ticker':
          aVal = a.ticker.toLowerCase();
          bVal = b.ticker.toLowerCase();
          break;
        case 'entry':
          aVal = a.entry;
          bVal = b.entry;
          break;
        case 'pnl':
          aVal = a.totalRealizedPnL ?? a.pnl ?? 0;
          bVal = b.totalRealizedPnL ?? b.pnl ?? 0;
          break;
        default:
          aVal = new Date(a.timestamp).getTime();
          bVal = new Date(b.timestamp).getTime();
      }

      if (aVal < bVal) return -1 * direction;
      if (aVal > bVal) return 1 * direction;
      return 0;
    });
  }

  render() {
    const trades = this.getFilteredTrades();

    // Update count to show filtered trades
    if (this.elements.journalCount) {
      this.elements.journalCount.textContent = `${trades.length} trade${trades.length !== 1 ? 's' : ''}`;
    }

    // Render summary bar with filtered trades
    this.renderSummary(trades);

    // Show empty state or table
    if (trades.length === 0) {
      this.showEmptyState();
    } else {
      this.hideEmptyState();
      this.renderTable(trades);
    }
  }

  renderSummary(filteredTrades = null) {
    // Use filtered trades if provided, otherwise use all trades
    const trades = filteredTrades || state.journal.entries;
    const closedTrades = trades.filter(
      t => t.status === 'closed' || t.status === 'trimmed'
    );

    // Update date range display
    if (this.elements.dateRange) {
      let dateRangeText = 'All time';

      if (this.filters.dateFrom || this.filters.dateTo) {
        const from = this.filters.dateFrom || 'Beginning';
        const to = this.filters.dateTo || 'Today';

        // Format dates nicely
        const formatShortDate = (dateStr) => {
          if (dateStr === 'Beginning' || dateStr === 'Today') return dateStr;
          const date = new Date(dateStr);
          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };

        dateRangeText = `${formatShortDate(from)} - ${formatShortDate(to)}`;
      }

      this.elements.dateRange.textContent = dateRangeText;
    }

    // Total P&L
    const totalPnL = closedTrades.reduce((sum, t) => {
      return sum + (t.totalRealizedPnL ?? t.pnl ?? 0);
    }, 0);

    if (this.elements.totalPnL) {
      const isPositive = totalPnL >= 0;
      this.elements.totalPnL.textContent = `${isPositive ? '+' : ''}${formatCurrency(totalPnL)}`;
      this.elements.totalPnL.className = `journal-summary-bar__value journal-summary-bar__value--lg ${isPositive ? 'journal-summary-bar__value--positive' : 'journal-summary-bar__value--negative'}`;
    }

    // Wins and losses
    const winningTrades = closedTrades.filter(t => (t.totalRealizedPnL ?? t.pnl ?? 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.totalRealizedPnL ?? t.pnl ?? 0) < 0);
    const wins = winningTrades.length;
    const losses = losingTrades.length;
    const total = wins + losses;

    // Win rate
    if (this.elements.winRate) {
      const winRate = total > 0 ? (wins / total) * 100 : null;
      this.elements.winRate.textContent = winRate !== null ? `${winRate.toFixed(1)}%` : '—';
    }

    // Wins count
    if (this.elements.wins) {
      this.elements.wins.textContent = wins.toString();
    }

    // Losses count
    if (this.elements.losses) {
      this.elements.losses.textContent = losses.toString();
    }

    // Average win
    if (this.elements.avgWin) {
      if (wins > 0) {
        const totalWinPnL = winningTrades.reduce((sum, t) => sum + (t.totalRealizedPnL ?? t.pnl ?? 0), 0);
        const avgWin = totalWinPnL / wins;
        this.elements.avgWin.textContent = `+${formatCurrency(avgWin)}`;
        this.elements.avgWin.className = 'journal-summary-bar__value journal-summary-bar__value--positive';
      } else {
        this.elements.avgWin.textContent = '—';
        this.elements.avgWin.className = 'journal-summary-bar__value';
      }
    }

    // Average loss
    if (this.elements.avgLoss) {
      if (losses > 0) {
        const totalLossPnL = losingTrades.reduce((sum, t) => sum + (t.totalRealizedPnL ?? t.pnl ?? 0), 0);
        const avgLoss = totalLossPnL / losses;
        this.elements.avgLoss.textContent = formatCurrency(avgLoss);
        this.elements.avgLoss.className = 'journal-summary-bar__value journal-summary-bar__value--negative';
      } else {
        this.elements.avgLoss.textContent = '—';
        this.elements.avgLoss.className = 'journal-summary-bar__value';
      }
    }
  }

  renderTable(trades) {
    if (!this.elements.tableBody) return;

    // Update sort indicators in headers
    const headers = document.querySelectorAll('.journal-view .journal-table th[data-sort]');
    headers.forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === this.sortColumn) {
        th.classList.add(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });

    const shouldAnimate = !this.hasAnimated;
    this.hasAnimated = true;

    this.elements.tableBody.innerHTML = trades.map((trade, index) => {
      const pnl = trade.totalRealizedPnL ?? trade.pnl ?? 0;
      const hasPnL = trade.status === 'closed' || trade.status === 'trimmed';
      const shares = trade.remainingShares ?? trade.shares;
      const sharesDisplay = trade.originalShares
        ? `${shares}/${trade.originalShares}`
        : shares;

      // Calculate R-multiple
      let rMultiple = null;
      if (hasPnL && trade.riskDollars > 0) {
        rMultiple = pnl / trade.riskDollars;
      }

      // Calculate P&L % based on position cost
      let pnlPercent = null;
      if (hasPnL) {
        const totalShares = trade.originalShares || trade.shares;
        const positionCost = trade.entry * totalShares;
        if (positionCost > 0) {
          pnlPercent = (pnl / positionCost) * 100;
        }
      }

      // Check if trade is "free rolled" - realized profit covers remaining risk
      const isTrimmed = trade.status === 'trimmed';
      const realizedPnL = trade.totalRealizedPnL || 0;
      const currentRisk = shares * (trade.entry - trade.stop);
      const isFreeRoll = isTrimmed && realizedPnL >= (currentRisk - 0.01);

      // Determine display status
      let statusClass = trade.status;
      let statusText = trade.status.charAt(0).toUpperCase() + trade.status.slice(1);
      if (isFreeRoll) {
        statusClass = 'freeroll';
        statusText = 'Free Rolled';
      }

      const isExpanded = this.expandedRows.has(trade.id);
      const animationDelay = shouldAnimate ? `animation-delay: ${index * 40}ms;` : '';

      // Determine row background class for closed trades
      let rowBgClass = '';
      if (trade.status === 'closed') {
        const tradePnL = trade.totalRealizedPnL ?? trade.pnl ?? 0;
        if (tradePnL > 0) {
          rowBgClass = 'journal-row--closed-winner';
        } else if (tradePnL < 0) {
          rowBgClass = 'journal-row--closed-loser';
        }
      }

      return `
        <tr class="journal-table__row ${shouldAnimate ? 'journal-row--animate' : ''} ${rowBgClass}" data-id="${trade.id}" style="${animationDelay}">
          <td>${formatDate(trade.timestamp)}</td>
          <td><strong>${trade.ticker}</strong></td>
          <td>${formatCurrency(trade.entry)}</td>
          <td>${trade.exitPrice ? formatCurrency(trade.exitPrice) : '—'}</td>
          <td>${sharesDisplay}</td>
          <td class="${hasPnL ? (pnl >= 0 ? 'journal-table__pnl--positive' : 'journal-table__pnl--negative') : ''}">
            ${hasPnL ? `${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}` : '—'}
          </td>
          <td class="${hasPnL ? (pnlPercent >= 0 ? 'journal-table__pnl--positive' : 'journal-table__pnl--negative') : ''}">
            ${pnlPercent !== null ? `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%` : '—'}
          </td>
          <td class="${rMultiple !== null ? (rMultiple >= 0 ? 'journal-table__pnl--positive' : 'journal-table__pnl--negative') : ''}">
            ${rMultiple !== null ? (Math.abs(rMultiple) < 0.05 ? '<span class="tag tag--breakeven">BE</span>' : `${rMultiple >= 0 ? '+' : ''}${rMultiple.toFixed(1)}R`) : '—'}
          </td>
          <td>
            <span class="journal-table__status journal-table__status--${statusClass}">
              ${statusText}
            </span>
          </td>
        </tr>
        <tr class="journal-table__row-details ${isExpanded ? 'expanded' : ''}" data-details-id="${trade.id}">
          <td colspan="9">
            ${this.renderRowDetails(trade)}
          </td>
        </tr>
      `;
    }).join('');

    // Bind row actions
    this.bindRowActions();
  }

  renderRowDetails(trade) {
    const isTrimmed = trade.status === 'trimmed';
    const isClosed = trade.status === 'closed';
    const isActive = !isClosed;

    return `
      <div class="journal-row-details">
        <div class="journal-row-details__section journal-row-details__section--chart">
          <div class="journal-row-details__label">
            Price Chart (scroll/zoom to explore ~4 months of history)
            <span class="journal-row-details__chart-ticker">${trade.ticker}</span>
          </div>
          <div class="journal-row-details__chart-container" id="chart-${trade.id}">
            <div class="journal-row-details__chart-loading">
              <span>Loading chart...</span>
            </div>
          </div>
        </div>
        <div class="journal-row-details__section">
          <div class="journal-row-details__label">Notes</div>
          <div class="journal-row-details__notes-container" data-trade-id="${trade.id}">
            <div class="journal-row-details__notes-view">
              <span class="journal-row-details__value">${trade.notes || 'No notes added'}</span>
              <button class="btn btn--xs btn--ghost" data-action="edit-notes" data-id="${trade.id}">Edit</button>
            </div>
            <div class="journal-row-details__notes-edit" style="display: none;">
              <textarea class="journal-row-details__notes-input" rows="3">${trade.notes || ''}</textarea>
              <div class="journal-row-details__notes-actions">
                <button class="btn btn--xs btn--primary" data-action="save-notes" data-id="${trade.id}">Save</button>
                <button class="btn btn--xs btn--ghost" data-action="cancel-notes" data-id="${trade.id}">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        ${trade.thesis ? `
        <div class="journal-row-details__section">
          <div class="journal-row-details__label">Thesis</div>
          <div class="journal-row-details__value">
            ${trade.thesis.setup ? `Setup: ${trade.thesis.setup}` : ''}
            ${trade.thesis.theme ? `<br>Theme: ${trade.thesis.theme}` : ''}
            ${trade.thesis.conviction ? `<br>Conviction: ${'★'.repeat(trade.thesis.conviction)}${'☆'.repeat(5 - trade.thesis.conviction)}` : ''}
          </div>
        </div>
        ` : ''}
        ${trade.trimHistory && trade.trimHistory.length > 0 ? `
        <div class="journal-row-details__section">
          <div class="journal-row-details__label">Trade Log</div>
          <div class="journal-row-details__value journal-row-details__trade-log">
            ${trade.trimHistory.map((trim, index) => {
              const isLastEntry = index === trade.trimHistory.length - 1;
              const isClose = isLastEntry && trade.status === 'closed';
              const actionText = isClose ? 'Closed' : 'Trimmed';
              const statusClass = isClose ? 'closed' : 'trimmed';
              return `<div class="trade-log-entry"><span class="journal-table__status journal-table__status--${statusClass}">${actionText}</span> ${formatDate(trim.date)}: ${trim.shares} shares @ ${formatCurrency(trim.exitPrice)} = <span class="${trim.pnl >= 0 ? 'text-success' : 'text-danger'}">${trim.pnl >= 0 ? '+' : ''}${formatCurrency(trim.pnl)}</span> (${trim.rMultiple >= 0 ? '+' : ''}${trim.rMultiple.toFixed(1)}R)</div>`;
            }).join('')}
          </div>
        </div>
        ` : ''}
        <div class="journal-row-details__actions">
          ${isActive ? `
            <button class="btn btn--sm btn--primary" data-action="close" data-id="${trade.id}">
              Edit
            </button>
          ` : ''}
          <button class="btn btn--sm btn--ghost" data-action="delete" data-id="${trade.id}">Delete</button>
        </div>
      </div>
    `;
  }

  bindRowActions() {
    // Make rows clickable to expand
    this.elements.tableBody.querySelectorAll('.journal-table__row').forEach(row => {
      row.addEventListener('click', (e) => {
        const id = parseInt(row.dataset.id);
        this.toggleRowExpand(id);
      });
      // Add cursor pointer to indicate clickability
      row.style.cursor = 'pointer';
    });

    // Close/Trim buttons (in expanded details)
    this.elements.tableBody.querySelectorAll('[data-action="close"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        trimModal.open(id);
      });
    });

    // Delete buttons (in expanded details)
    this.elements.tableBody.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        if (confirm('Delete this trade?')) {
          state.deleteJournalEntry(id);
        }
      });
    });

    // Edit notes buttons
    this.elements.tableBody.querySelectorAll('[data-action="edit-notes"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        const container = this.elements.tableBody.querySelector(`.journal-row-details__notes-container[data-trade-id="${id}"]`);
        if (container) {
          container.querySelector('.journal-row-details__notes-view').style.display = 'none';
          container.querySelector('.journal-row-details__notes-edit').style.display = 'block';
          container.querySelector('.journal-row-details__notes-input').focus();
        }
      });
    });

    // Save notes buttons
    this.elements.tableBody.querySelectorAll('[data-action="save-notes"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        const container = this.elements.tableBody.querySelector(`.journal-row-details__notes-container[data-trade-id="${id}"]`);
        if (container) {
          const newNotes = container.querySelector('.journal-row-details__notes-input').value;
          state.updateJournalEntry(id, { notes: newNotes });
        }
      });
    });

    // Cancel notes buttons
    this.elements.tableBody.querySelectorAll('[data-action="cancel-notes"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.currentTarget.dataset.id);
        const container = this.elements.tableBody.querySelector(`.journal-row-details__notes-container[data-trade-id="${id}"]`);
        const trade = state.journal.entries.find(t => t.id === id);
        if (container && trade) {
          container.querySelector('.journal-row-details__notes-input').value = trade.notes || '';
          container.querySelector('.journal-row-details__notes-view').style.display = 'flex';
          container.querySelector('.journal-row-details__notes-edit').style.display = 'none';
        }
      });
    });
  }

  toggleRowExpand(id) {
    if (this.expandedRows.has(id)) {
      this.expandedRows.delete(id);
    } else {
      this.expandedRows.add(id);
    }

    // Toggle classes
    const expandBtn = this.elements.tableBody.querySelector(`[data-action="expand"][data-id="${id}"]`);
    const detailsRow = this.elements.tableBody.querySelector(`[data-details-id="${id}"]`);

    if (expandBtn) {
      expandBtn.classList.toggle('expanded', this.expandedRows.has(id));
    }
    if (detailsRow) {
      detailsRow.classList.toggle('expanded', this.expandedRows.has(id));
    }

    // Load chart if row is now expanded
    if (this.expandedRows.has(id)) {
      const trade = state.journal.entries.find(t => t.id === id);
      if (trade) {
        this.renderChart(trade);
      }
    }
  }

  async renderChart(trade) {
    const chartContainer = document.getElementById(`chart-${trade.id}`);
    if (!chartContainer) return;

    // Import priceTracker
    const { priceTracker } = await import('../../core/priceTracker.js');

    try {
      // Fetch historical candles - 1 year back + 3 months forward
      const entryDate = new Date(trade.timestamp);
      const candles = await priceTracker.fetchHistoricalCandles(trade.ticker, entryDate);

      // Clear loading message
      chartContainer.innerHTML = '';

      // Create chart
      const chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth,
        height: 400,
        layout: {
          background: { color: 'transparent' },
          textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
        },
        grid: {
          vertLines: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim() },
          horzLines: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim() },
        },
        timeScale: {
          timeVisible: true,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border-default').trim(),
        },
        rightPriceScale: {
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border-default').trim(),
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        upColor: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
        downColor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
        borderVisible: false,
        wickUpColor: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
        wickDownColor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
        priceScaleId: 'right',
      });

      candleSeries.setData(candles);

      // Add volume histogram
      const volumeSeries = chart.addHistogramSeries({
        color: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      // Configure volume scale to be at bottom 20% of chart
      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });

      // Extract volume data and color based on price movement
      const volumeData = candles.map((candle, index) => {
        const isUp = index === 0 ? true : candle.close >= candle.open;
        return {
          time: candle.time,
          value: candle.volume,
          color: isUp
            ? getComputedStyle(document.documentElement).getPropertyValue('--success').trim() + '80' // Add transparency
            : getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() + '80'
        };
      });

      volumeSeries.setData(volumeData);

      // Add a marker for the entry day
      // Normalize to UTC midnight to match candle timestamps
      const entryDateOnly = trade.timestamp.split('T')[0]; // Get just YYYY-MM-DD
      const entryTimestamp = Math.floor(new Date(entryDateOnly + 'T00:00:00Z').getTime() / 1000);
      const markers = [{
        time: entryTimestamp,
        position: 'belowBar',
        color: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        shape: 'arrowUp',
        text: 'Entry @ ' + formatCurrency(trade.entry)
      }];
      candleSeries.setMarkers(markers);

      // Set initial visible range: ~2.5 months before entry to ~2 weeks after
      // This shows the setup and initial price action after entry
      const daysBeforeEntry = 75; // ~2.5 months
      const daysAfterEntry = 15; // ~2 weeks
      const fromTime = entryTimestamp - (daysBeforeEntry * 24 * 60 * 60);
      const toTime = entryTimestamp + (daysAfterEntry * 24 * 60 * 60);

      chart.timeScale().setVisibleRange({
        from: fromTime,
        to: toTime
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(entries => {
        if (entries.length === 0 || entries[0].target !== chartContainer) return;
        const { width } = entries[0].contentRect;
        chart.applyOptions({ width });
      });
      resizeObserver.observe(chartContainer);

      // Store chart instance to clean up later
      chartContainer._chartInstance = { chart, resizeObserver };
    } catch (error) {
      console.error('Failed to load chart:', error);
      chartContainer.innerHTML = `
        <div class="journal-row-details__chart-error">
          <span>⚠️ ${error.message || 'Failed to load chart'}</span>
          <p class="journal-row-details__chart-error-hint">Unable to fetch historical price data for this ticker</p>
        </div>
      `;
    }
  }

  showEmptyState() {
    if (this.elements.tableContainer) {
      this.elements.tableContainer.style.display = 'none';
    }
    if (this.elements.empty) {
      this.elements.empty.classList.add('journal-empty--visible');
    }
  }

  hideEmptyState() {
    if (this.elements.tableContainer) {
      this.elements.tableContainer.style.display = '';
    }
    if (this.elements.empty) {
      this.elements.empty.classList.remove('journal-empty--visible');
    }
  }
}

export const journalView = new JournalView();
export { JournalView };
