/**
 * Journal View - Full trade history with filtering and analysis
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatPercent, formatDate } from '../../core/utils.js';
import { trimModal } from '../../components/modals/trimModal.js';
import { viewManager } from '../../components/ui/viewManager.js';
import { dataManager } from '../../core/dataManager.js';
import { priceTracker } from '../../core/priceTracker.js';

class JournalView {
  constructor() {
    this.elements = {};
    this.filters = {
      status: 'all',
      types: ['ep', 'long-term', 'base', 'breakout', 'bounce', 'other'], // Default to all types selected
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

    // Initialize all type checkboxes to be checked (matching "All Types" default state)
    if (this.elements.typeCheckboxes) {
      this.elements.typeCheckboxes.forEach(checkbox => {
        checkbox.checked = true;
      });
    }

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
      journalStatusFilter: document.getElementById('journalStatusFilter'),
      journalTypeFilter: document.getElementById('journalTypeFilter'),

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
      openWizardBtn: document.getElementById('journalNewBtn'),

      // Export buttons
      exportCSV: document.getElementById('journalExportCSV'),

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
    // Open wizard button
    if (this.elements.openWizardBtn) {
      this.elements.openWizardBtn.addEventListener('click', () => {
        wizard.open();
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
      this.elements.journalCount.textContent = trades.length;
    }

    // Update filter displays
    this.updateFilterDisplays();

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

  updateFilterDisplays() {
    // Update status display
    if (this.elements.journalStatusFilter) {
      const statusText = this.filters.status === 'all'
        ? 'All'
        : this.filters.status === 'winners'
        ? 'Winners'
        : this.filters.status === 'losers'
        ? 'Losers'
        : this.filters.status.charAt(0).toUpperCase() + this.filters.status.slice(1);
      this.elements.journalStatusFilter.textContent = `Status: ${statusText}`;
    }

    // Update type display
    if (this.elements.journalTypeFilter) {
      const allTypes = ['ep', 'long-term', 'base', 'breakout', 'bounce', 'other'];
      const typeLabels = {
        'ep': 'EP',
        'long-term': 'Long-term',
        'base': 'Base',
        'breakout': 'Breakout',
        'bounce': 'Bounce',
        'other': 'Other'
      };

      if (this.filters.types.length === allTypes.length) {
        this.elements.journalTypeFilter.textContent = 'Type: All';
      } else if (this.filters.types.length === 0) {
        this.elements.journalTypeFilter.textContent = 'Type: None';
      } else {
        const typeNames = this.filters.types.map(t => typeLabels[t]).join(', ');
        this.elements.journalTypeFilter.textContent = `Type: ${typeNames}`;
      }
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

      // Calculate position size as % of account
      let positionPercent = null;
      if (trade.status === 'open' || trade.status === 'trimmed') {
        const accountSize = state.account.currentSize;
        const positionValue = shares * trade.entry;
        if (accountSize > 0) {
          positionPercent = (positionValue / accountSize) * 100;
        }
      }

      // Check if trade is "free rolled" - realized profit covers remaining risk
      const isTrimmed = trade.status === 'trimmed';
      const realizedPnL = trade.totalRealizedPnL || 0;
      const currentRisk = shares * (trade.entry - trade.stop);

      // Determine display status
      let statusClass = trade.status;
      let statusText = trade.status.charAt(0).toUpperCase() + trade.status.slice(1);

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

      // Determine exit price class
      let exitPriceClass = '';
      if (trade.exitPrice) {
        const priceDiff = trade.exitPrice - trade.entry;
        if (Math.abs(priceDiff) < 0.01) {
          exitPriceClass = ''; // Breakeven - default white
        } else if (priceDiff > 0) {
          exitPriceClass = 'journal-table__pnl--positive'; // Green for profit
        } else {
          exitPriceClass = 'journal-table__pnl--negative'; // Red for loss
        }
      }

      return `
        <tr class="journal-table__row ${shouldAnimate ? 'journal-row--animate' : ''} ${rowBgClass}" data-id="${trade.id}" style="${animationDelay}">
          <td>${formatDate(trade.timestamp)}</td>
          <td><strong>${trade.ticker}</strong></td>
          <td style="color: var(--primary);">${formatCurrency(trade.entry)}</td>
          <td class="${exitPriceClass}">${trade.exitPrice ? formatCurrency(trade.exitPrice) : '—'}</td>
          <td>${sharesDisplay}</td>
          <td>${positionPercent !== null ? `${positionPercent.toFixed(2)}%` : '—'}</td>
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
          <td colspan="10">
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
          <div class="journal-row-details__chart-container" id="chart-${trade.id}">
            <div class="journal-row-details__chart-loading">
              <span>Loading chart...</span>
            </div>
          </div>
        </div>
        <div class="journal-row-details__section">
          <div class="journal-info-box">
            <div class="journal-info-box__section" data-company-summary-section="${trade.id}">
              <div class="journal-info-box__label">Company Summary</div>
              <div class="journal-info-box__content" data-company-summary="${trade.id}">${trade.company?.summary || trade.company?.description || 'Loading company information...'}</div>
            </div>
            <div class="journal-info-box__section">
              <div class="journal-info-box__label">Notes</div>
              <div class="journal-info-box__notes-editable"
                   contenteditable="true"
                   data-trade-id="${trade.id}"
                   data-action="edit-notes-inline">${trade.notes || ''}</div>
              ${trade.thesis?.conviction ? `
              <div class="conviction-container">
                <span class="conviction-label">Conviction:</span>
                <span class="conviction-stars" data-trade-id="${trade.id}" data-conviction="${trade.thesis.conviction}">
                  ${[1, 2, 3, 4, 5].map(star =>
                    `<span class="conviction-star ${star <= trade.thesis.conviction ? 'active' : ''}" data-star="${star}">★</span>`
                  ).join('')}
                </span>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
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
          <button class="btn btn--sm btn--primary" data-action="close" data-id="${trade.id}">
            Edit
          </button>
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

    // Inline notes editing
    this.elements.tableBody.querySelectorAll('[data-action="edit-notes-inline"]').forEach(noteEl => {
      const tradeId = parseInt(noteEl.dataset.tradeId);

      // Auto-convert "- " to bullet point
      noteEl.addEventListener('input', (e) => {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const textNode = range.startContainer;

        // Only work with text nodes
        if (textNode.nodeType !== Node.TEXT_NODE) return;

        const textContent = textNode.textContent;
        const cursorPos = range.startOffset;

        // Check if the text just before cursor is "- "
        if (cursorPos >= 2 && textContent.substring(cursorPos - 2, cursorPos) === '- ') {

          // Get the text before and after the "- "
          const beforeDash = textContent.substring(0, cursorPos - 2);
          const afterDash = textContent.substring(cursorPos);
          const combinedText = beforeDash + afterDash;

          // Create a proper list structure
          const ul = document.createElement('ul');
          const li = document.createElement('li');

          if (combinedText) {
            li.textContent = combinedText;
          } else {
            li.innerHTML = '<br>'; // Empty li needs br for cursor
          }

          ul.appendChild(li);

          // Find the element to replace (text node or its parent)
          const parent = textNode.parentNode;

          // Remove the original content and insert the list
          if (parent === noteEl) {
            // Direct child - replace text node with list
            noteEl.replaceChild(ul, textNode);
          } else {
            // Parent is a div or other element - replace that
            parent.parentNode.replaceChild(ul, parent);
          }

          // Set cursor in the li
          const newRange = document.createRange();
          const newSelection = window.getSelection();

          if (li.firstChild) {
            newRange.setStart(li.firstChild, combinedText.length);
          } else {
            newRange.setStart(li, 0);
          }

          newRange.collapse(true);
          newSelection.removeAllRanges();
          newSelection.addRange(newRange);
        }
      });

      // Save on blur (when user clicks away)
      noteEl.addEventListener('blur', () => {
        // Use innerHTML to preserve formatting like bold, italic, bullets
        const newNotes = noteEl.innerHTML.trim();
        const trade = state.journal.entries.find(t => t.id === tradeId);

        // Only update if notes actually changed
        if (trade && trade.notes !== newNotes) {
          // Update silently without triggering re-render
          const tradeIndex = state.journal.entries.findIndex(t => t.id === tradeId);
          if (tradeIndex !== -1) {
            state.journal.entries[tradeIndex].notes = newNotes;
            state.saveJournal();
          }
        }
      });

      // Keyboard shortcuts
      noteEl.addEventListener('keydown', (e) => {
        // Handle Enter key in lists
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          const selection = window.getSelection();
          if (!selection.rangeCount) return;

          const range = selection.getRangeAt(0);
          let currentNode = range.startContainer;

          // Find if we're inside an li element
          let li = currentNode.nodeType === Node.TEXT_NODE ? currentNode.parentElement : currentNode;
          while (li && li !== noteEl && li.tagName !== 'LI') {
            li = li.parentElement;
          }

          if (li && li.tagName === 'LI') {
            e.preventDefault();

            // Check if current li is empty
            if (li.textContent.trim() === '') {
              // Empty bullet - exit the list
              const ul = li.parentElement;
              const br = document.createElement('br');
              ul.parentNode.insertBefore(br, ul.nextSibling);
              li.remove();

              // If ul is now empty, remove it
              if (ul.children.length === 0) {
                ul.remove();
              }

              // Set cursor after the br
              const newRange = document.createRange();
              const newSelection = window.getSelection();
              newRange.setStartAfter(br);
              newRange.collapse(true);
              newSelection.removeAllRanges();
              newSelection.addRange(newRange);
            } else {
              // Create a new list item
              const newLi = document.createElement('li');
              newLi.innerHTML = '<br>'; // Empty li needs br for cursor
              li.parentElement.insertBefore(newLi, li.nextSibling);

              // Set cursor in the new li
              const newRange = document.createRange();
              const newSelection = window.getSelection();
              newRange.setStart(newLi, 0);
              newRange.collapse(true);
              newSelection.removeAllRanges();
              newSelection.addRange(newRange);
            }
          }
        }

        // Save on Ctrl/Cmd + Enter
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          noteEl.blur();
        }

        // Bold with Ctrl/Cmd + B
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
          e.preventDefault();
          document.execCommand('bold');
        }

        // Italic with Ctrl/Cmd + I
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
          e.preventDefault();
          document.execCommand('italic');
        }

        // Underline with Ctrl/Cmd + U
        if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
          e.preventDefault();
          document.execCommand('underline');
        }
      });
    });

    // Interactive conviction stars
    this.elements.tableBody.querySelectorAll('.conviction-stars').forEach(starsContainer => {
      const tradeId = parseInt(starsContainer.dataset.tradeId);
      const stars = starsContainer.querySelectorAll('.conviction-star');

      // Hover preview
      stars.forEach((star, index) => {
        star.addEventListener('mouseenter', () => {
          stars.forEach((s, i) => {
            s.classList.toggle('hover-preview', i <= index);
          });
        });
      });

      // Reset on mouse leave
      starsContainer.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hover-preview'));
      });

      // Click to update conviction
      stars.forEach((star, index) => {
        star.addEventListener('click', () => {
          const newConviction = index + 1;
          const trade = state.journal.entries.find(t => t.id === tradeId);

          if (trade && trade.thesis && trade.thesis.conviction !== newConviction) {
            // Update silently without triggering re-render
            const tradeIndex = state.journal.entries.findIndex(t => t.id === tradeId);
            if (tradeIndex !== -1) {
              state.journal.entries[tradeIndex].thesis.conviction = newConviction;
              state.saveJournal();

              // Update the UI directly
              stars.forEach((s, i) => {
                s.classList.toggle('active', i < newConviction);
              });
            }
          }
        });
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

    // Load chart and fetch company summary if row is now expanded
    if (this.expandedRows.has(id)) {
      const trade = state.journal.entries.find(t => t.id === id);
      if (trade) {
        this.renderChart(trade);
        this.fetchAndDisplayCompanySummary(trade);
      }
    }
  }

  // Check if we should fetch chart data for a ticker today
  shouldFetchChartData(ticker) {
    const cache = this.getChartCache();
    const today = new Date().toDateString();

    if (cache[ticker] && cache[ticker].date === today && cache[ticker].data) {
      return false; // Already fetched today
    }

    return true; // Need to fetch
  }

  // Get chart cache from localStorage
  getChartCache() {
    try {
      const cache = localStorage.getItem('chartDataCache');
      return cache ? JSON.parse(cache) : {};
    } catch (e) {
      console.error('Error reading chart cache:', e);
      return {};
    }
  }

  // Save chart data to cache
  saveChartData(ticker, data) {
    try {
      const cache = this.getChartCache();
      cache[ticker] = {
        date: new Date().toDateString(),
        data: data,
        timestamp: Date.now()
      };
      localStorage.setItem('chartDataCache', JSON.stringify(cache));
    } catch (e) {
      console.error('Error saving chart cache:', e);
    }
  }

  // Get cached chart data for a ticker
  getCachedChartData(ticker) {
    const cache = this.getChartCache();
    const today = new Date().toDateString();

    if (cache[ticker] && cache[ticker].date === today && cache[ticker].data) {
      return cache[ticker].data;
    }

    return null;
  }

  // Calculate Simple Moving Average
  calculateSMA(data, period) {
    const sma = [];
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1)
        .reduce((acc, candle) => acc + candle.close, 0);
      sma.push({
        time: data[i].time,
        value: sum / period
      });
    }
    return sma;
  }

  async renderChart(trade) {
    const chartContainer = document.getElementById(`chart-${trade.id}`);
    if (!chartContainer) return;

    // Skip if chart already rendered (check if container has chart content)
    if (chartContainer.children.length > 0 && !chartContainer.querySelector('.journal-row-details__chart-loading')) {
      return;
    }

    // Import priceTracker
    const { priceTracker } = await import('../../core/priceTracker.js');

    try {
      let candles;

      // Check if we have cached data for today
      const cachedData = this.getCachedChartData(trade.ticker);

      if (cachedData) {
        console.log(`Using cached chart data for ${trade.ticker}`);
        candles = cachedData;
      } else {
        // Fetch historical candles - 1 year back + 3 months forward
        console.log(`Fetching fresh chart data for ${trade.ticker}`);
        const entryDate = new Date(trade.timestamp);
        candles = await priceTracker.fetchHistoricalCandles(trade.ticker, entryDate);

        // Save to cache
        this.saveChartData(trade.ticker, candles);
      }

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

      // Add 10-day and 20-day Simple Moving Averages
      const sma10Data = this.calculateSMA(candles, 10);
      const sma20Data = this.calculateSMA(candles, 20);

      const sma10Series = chart.addLineSeries({
        color: 'rgba(96, 165, 250, 0.5)', // Blue - reduced glow
        lineWidth: 2,
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
      });

      const sma20Series = chart.addLineSeries({
        color: 'rgba(245, 158, 11, 0.5)', // Orange - reduced glow
        lineWidth: 2,
        priceScaleId: 'right',
        lastValueVisible: false,
        priceLineVisible: false,
      });

      sma10Series.setData(sma10Data);
      sma20Series.setData(sma20Data);

      // Add custom legend in top-left corner
      const legend = document.createElement('div');
      legend.className = 'chart-legend';
      legend.innerHTML = `
        <div class="chart-legend__item">
          <span class="chart-legend__line" style="background: rgba(96, 165, 250, 0.5);"></span>
          <span class="chart-legend__label">10 SMA</span>
        </div>
        <div class="chart-legend__item">
          <span class="chart-legend__line" style="background: rgba(245, 158, 11, 0.5);"></span>
          <span class="chart-legend__label">20 SMA</span>
        </div>
      `;
      chartContainer.appendChild(legend);

      // Add a marker for the entry day
      // Normalize to UTC midnight to match candle timestamps
      const entryDateOnly = trade.timestamp.split('T')[0]; // Get just YYYY-MM-DD
      const entryTimestamp = Math.floor(new Date(entryDateOnly + 'T00:00:00Z').getTime() / 1000);
      const markers = [{
        time: entryTimestamp,
        position: 'belowBar',
        color: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        shape: 'arrowUp',
        text: 'Entry'
      }];

      // Add exit marker if trade is closed or trimmed
      if ((trade.status === 'closed' || trade.status === 'trimmed') && trade.trimHistory && trade.trimHistory.length > 0) {
        // Get the last trim (which is the final exit for closed trades)
        const lastTrim = trade.trimHistory[trade.trimHistory.length - 1];
        const exitDateOnly = lastTrim.date.split('T')[0]; // Get just YYYY-MM-DD
        const exitTimestamp = Math.floor(new Date(exitDateOnly + 'T00:00:00Z').getTime() / 1000);

        const isClose = trade.status === 'closed';
        const exitColor = lastTrim.pnl >= 0
          ? getComputedStyle(document.documentElement).getPropertyValue('--success').trim()
          : getComputedStyle(document.documentElement).getPropertyValue('--danger').trim();

        markers.push({
          time: exitTimestamp,
          position: 'aboveBar',
          color: exitColor,
          shape: 'arrowDown',
          text: isClose ? 'Exit' : 'Trim'
        });
      }

      candleSeries.setMarkers(markers);

      // Set initial visible range
      // For closed trades: show from ~2 months before entry to ~2 weeks after exit
      // For open trades: show from ~2.5 months before entry to ~2 weeks after
      let fromTime, toTime;

      if ((trade.status === 'closed' || trade.status === 'trimmed') && trade.trimHistory && trade.trimHistory.length > 0) {
        // Closed/trimmed trade: show full trade duration
        const lastTrim = trade.trimHistory[trade.trimHistory.length - 1];
        const exitDateOnly = lastTrim.date.split('T')[0];
        const exitTimestamp = Math.floor(new Date(exitDateOnly + 'T00:00:00Z').getTime() / 1000);

        const daysBeforeEntry = 60; // ~2 months
        const daysAfterExit = 15; // ~2 weeks
        fromTime = entryTimestamp - (daysBeforeEntry * 24 * 60 * 60);
        toTime = exitTimestamp + (daysAfterExit * 24 * 60 * 60);
      } else {
        // Open trade: show setup and initial price action
        const daysBeforeEntry = 75; // ~2.5 months
        const daysAfterEntry = 15; // ~2 weeks
        fromTime = entryTimestamp - (daysBeforeEntry * 24 * 60 * 60);
        toTime = entryTimestamp + (daysAfterEntry * 24 * 60 * 60);
      }

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

  async fetchAndDisplayCompanySummary(trade) {
    // If summary or description already exists, no need to fetch
    if (trade.company?.summary || trade.company?.description) {
      return;
    }

    // Find the company summary element for this trade
    const summaryContainer = document.querySelector(`[data-company-summary="${trade.id}"]`);
    const summarySection = document.querySelector(`[data-company-summary-section="${trade.id}"]`);

    if (!summaryContainer) {
      console.log('Company summary container not found for trade', trade.id);
      return;
    }

    // Show loading state
    summaryContainer.textContent = 'Loading company information...';
    summaryContainer.style.fontStyle = 'italic';
    summaryContainer.style.color = 'var(--text-muted)';

    // Fetch company summary from API
    try {
      console.log(`Fetching company summary for ${trade.ticker}...`);

      let cleanSummary = '';

      // First check if Finnhub description exists in company data
      if (trade.company?.description) {
        console.log('Using Finnhub description for summary');
        cleanSummary = trade.company.description.trim();
      } else {
        // If no Finnhub description, try Alpha Vantage
        console.log('No Finnhub description, fetching from Alpha Vantage...');
        const overview = await priceTracker.fetchCompanySummary(trade.ticker);

        if (overview && overview.summary) {
          cleanSummary = overview.summary.trim();
        }
      }

      if (cleanSummary) {
        // Only add summary to existing company data, don't overwrite industry
        // Industry should come from Finnhub (when position was created)
        const tradeIndex = state.journal.entries.findIndex(t => t.id === trade.id);
        if (tradeIndex !== -1) {
          const existingCompany = state.journal.entries[tradeIndex].company || {};

          // Preserve existing industry from Finnhub, only add summary
          state.journal.entries[tradeIndex].company = {
            ...existingCompany,
            summary: cleanSummary
          };
          state.saveJournal();
        }

        // Display the summary
        summaryContainer.textContent = cleanSummary;
        summaryContainer.style.fontStyle = 'normal';
        summaryContainer.style.color = '';
        console.log(`Successfully fetched and saved company summary for ${trade.ticker}`);
      } else {
        // No description available - show company info we do have
        console.log(`No company description available for ${trade.ticker}`);
        const companyInfo = [];
        if (trade.company?.name) companyInfo.push(trade.company.name);
        if (trade.company?.industry) companyInfo.push(trade.company.industry);

        if (companyInfo.length > 0) {
          summaryContainer.textContent = companyInfo.join(' • ');
          summaryContainer.style.fontStyle = 'normal';
          summaryContainer.style.color = '';
        } else {
          summaryContainer.textContent = 'No company information available';
          summaryContainer.style.fontStyle = 'italic';
          summaryContainer.style.color = 'var(--text-muted)';
        }
      }
    } catch (error) {
      console.error('Error fetching company summary:', error);
      // Show company info we have instead of hiding on error
      const companyInfo = [];
      if (trade.company?.name) companyInfo.push(trade.company.name);
      if (trade.company?.industry) companyInfo.push(trade.company.industry);

      if (companyInfo.length > 0) {
        summaryContainer.textContent = companyInfo.join(' • ');
        summaryContainer.style.fontStyle = 'normal';
        summaryContainer.style.color = '';
      } else {
        summaryContainer.textContent = 'Company information unavailable';
        summaryContainer.style.fontStyle = 'italic';
        summaryContainer.style.color = 'var(--text-muted)';
      }
    }
  }
}

export const journalView = new JournalView();
export { JournalView };
