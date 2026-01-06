/**
 * Positions View - Full-fledged open positions manager
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatPercent } from '../../core/utils.js';
import { trimModal } from '../../components/modals/trimModal.js';
import { viewManager } from '../../components/ui/viewManager.js';
import { priceTracker } from '../../core/priceTracker.js';
import { showToast } from '../../components/ui/ui.js';

class PositionsView {
  constructor() {
    this.elements = {};
    this.filters = {
      status: 'all',
      types: [] // Array of selected type strings
    };
    this.autoRefreshInterval = null;
    this.hasAnimated = false;
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.render();

    // Listen for journal changes
    state.on('journalEntryAdded', () => this.render());
    state.on('journalEntryUpdated', () => this.render());
    state.on('journalEntryDeleted', () => this.render());

    // Listen for view changes
    state.on('viewChanged', (data) => {
      if (data.to === 'positions') {
        this.hasAnimated = false; // Reset animation flag when entering view
        this.render();
        this.startAutoRefresh();
      } else {
        this.stopAutoRefresh();
      }
    });

    // Listen for price updates
    state.on('pricesUpdated', () => this.render());

    // Start auto-refresh if we're on positions page
    if (state.ui.currentView === 'positions') {
      this.startAutoRefresh();
    }
  }

  cacheElements() {
    this.elements = {
      // Header
      positionsCount: document.getElementById('positionsCount'),

      // Risk bar
      riskBar: document.getElementById('positionsRiskBar'),
      openRisk: document.getElementById('positionsOpenRisk'),
      openPnL: document.getElementById('positionsOpenPnL'),
      riskLevel: document.getElementById('positionsRiskLevel'),
      refreshPricesBtn: document.getElementById('refreshPositionsPricesBtn'),

      // Grid
      grid: document.getElementById('positionsGrid'),

      // Empty state
      empty: document.getElementById('positionsEmpty'),
      emptyTitle: document.getElementById('positionsEmptyTitle'),
      emptyText: document.getElementById('positionsEmptyText'),
      goToDashboard: document.getElementById('positionsGoToDashboard'),

      // Filter dropdown
      filterBtn: document.getElementById('positionsFilterBtn'),
      filterPanel: document.getElementById('positionsFilterPanel'),
      filterBackdrop: document.getElementById('positionsFilterBackdrop'),
      filterClose: document.getElementById('positionsFilterClose'),
      filterCount: document.getElementById('positionsFilterCount'),
      applyFilters: document.getElementById('positionsApplyFilters'),
      clearFilters: document.getElementById('positionsClearFilters'),
      statusBtns: document.querySelectorAll('#positionsFilterPanel .filter-status-btn'),
      typeAllCheckbox: document.getElementById('filterTypeAll'),
      typeCheckboxes: document.querySelectorAll('#positionsFilterPanel input[type="checkbox"]:not(#filterTypeAll)')
    };
  }

  bindEvents() {
    // Go to dashboard button
    if (this.elements.goToDashboard) {
      this.elements.goToDashboard.addEventListener('click', () => {
        viewManager.navigateTo('dashboard');
      });
    }

    // Refresh prices button
    if (this.elements.refreshPricesBtn) {
      this.elements.refreshPricesBtn.addEventListener('click', async () => {
        await this.refreshPrices();
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

    // Close panel when clicking backdrop
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

    // Type filter "All Types" checkbox logic (master checkbox)
    if (this.elements.typeAllCheckbox) {
      this.elements.typeAllCheckbox.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        // Check/uncheck all specific type checkboxes
        this.elements.typeCheckboxes?.forEach(checkbox => {
          checkbox.checked = isChecked;
        });
      });
    }

    // Specific type checkboxes - update "All Types" state
    this.elements.typeCheckboxes?.forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const allChecked = Array.from(this.elements.typeCheckboxes || []).every(cb => cb.checked);
        const noneChecked = Array.from(this.elements.typeCheckboxes || []).every(cb => !cb.checked);

        if (this.elements.typeAllCheckbox) {
          this.elements.typeAllCheckbox.checked = allChecked;
          this.elements.typeAllCheckbox.indeterminate = !allChecked && !noneChecked;
        }
      });
    });

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
      // No types selected - uncheck everything
      this.elements.typeCheckboxes?.forEach(checkbox => {
        checkbox.checked = false;
      });
      if (this.elements.typeAllCheckbox) {
        this.elements.typeAllCheckbox.checked = false;
        this.elements.typeAllCheckbox.indeterminate = false;
      }
    } else {
      // Specific types selected
      this.elements.typeCheckboxes?.forEach(checkbox => {
        checkbox.checked = this.filters.types.includes(checkbox.value);
      });

      // Update "All Types" checkbox state
      if (this.elements.typeAllCheckbox && this.elements.typeCheckboxes) {
        const allChecked = Array.from(this.elements.typeCheckboxes).every(cb => cb.checked);
        const noneChecked = Array.from(this.elements.typeCheckboxes).every(cb => !cb.checked);

        this.elements.typeAllCheckbox.checked = allChecked;
        this.elements.typeAllCheckbox.indeterminate = !allChecked && !noneChecked;
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

    // Update filters
    this.filters.status = selectedStatus;
    this.filters.types = selectedTypes;

    // Update filter count badge
    this.updateFilterCount();

    // Reset animation flag to re-animate filtered cards
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

    // Uncheck all type checkboxes including "All Types"
    this.elements.typeCheckboxes?.forEach(checkbox => {
      checkbox.checked = false;
    });
    if (this.elements.typeAllCheckbox) {
      this.elements.typeAllCheckbox.checked = false;
      this.elements.typeAllCheckbox.indeterminate = false;
    }
  }

  updateFilterCount() {
    let count = 0;

    // Count status filter (if not "all")
    if (this.filters.status !== 'all') {
      count++;
    }

    // Count type filters
    count += this.filters.types.length;

    // Update badge
    if (count > 0) {
      this.elements.filterCount.textContent = count;
      this.elements.filterCount.style.display = 'inline-flex';
    } else {
      this.elements.filterCount.style.display = 'none';
    }
  }

  getFilteredPositions() {
    let positions = state.journal.entries.filter(
      e => e.status === 'open' || e.status === 'trimmed'
    );

    // Filter by status
    if (this.filters.status === 'open') {
      positions = positions.filter(t => t.status === 'open');
    } else if (this.filters.status === 'trimmed') {
      positions = positions.filter(t => t.status === 'trimmed');
    }

    // Filter by types (if any selected)
    if (this.filters.types.length > 0) {
      positions = positions.filter(trade => {
        const tradeType = trade.thesis?.setupType;
        return tradeType && this.filters.types.includes(tradeType);
      });
    }

    return positions;
  }

  render() {
    const positions = this.getFilteredPositions();

    // Update count to show filtered positions
    if (this.elements.positionsCount) {
      this.elements.positionsCount.textContent = `${positions.length} position${positions.length !== 1 ? 's' : ''}`;
    }

    // Render risk bar with filtered positions
    this.renderRiskBar(positions);

    // Show empty state or grid
    if (positions.length === 0) {
      this.showEmptyState();
    } else {
      this.hideEmptyState();
      this.renderGrid(positions);
    }
  }

  renderRiskBar(activeTrades) {
    // Use filtered positions if provided, otherwise fall back to all active trades
    if (!activeTrades) {
      activeTrades = state.journal.entries.filter(
        e => e.status === 'open' || e.status === 'trimmed'
      );
    }

    if (activeTrades.length === 0) {
      if (this.elements.openRisk) {
        this.elements.openRisk.textContent = '$0.00';
      }
      if (this.elements.openPnL) {
        this.elements.openPnL.textContent = '$0.00';
        this.elements.openPnL.className = 'positions-risk-bar__value positions-risk-bar__value--pnl';
      }
      if (this.elements.riskLevel) {
        this.elements.riskLevel.textContent = 'CASH';
        this.elements.riskLevel.className = 'positions-risk-bar__value positions-risk-bar__value--indicator';
        // Reset any inline styles
        this.elements.riskLevel.style.display = 'inline-block';
      }
      return;
    }

    // Calculate NET risk (remaining risk minus realized profit for trimmed trades)
    const totalRisk = activeTrades.reduce((sum, t) => {
      const shares = t.remainingShares ?? t.shares;
      const riskPerShare = t.entry - t.stop;
      const grossRisk = shares * riskPerShare;

      // For trimmed trades, subtract realized profit (net risk can't go below 0)
      const realizedPnL = t.totalRealizedPnL || 0;
      const isTrimmed = t.status === 'trimmed';
      const netRisk = isTrimmed ? Math.max(0, grossRisk - realizedPnL) : grossRisk;

      return sum + netRisk;
    }, 0);

    // Calculate total unrealized P&L
    const pnlData = priceTracker.calculateTotalUnrealizedPnL(activeTrades);
    const totalPnL = pnlData.totalPnL;

    const riskPercent = (totalRisk / state.account.currentSize) * 100;

    // Determine risk level
    let level = 'LOW';
    let levelClass = '';
    if (riskPercent > 2) {
      level = 'HIGH';
      levelClass = 'risk-high';
    } else if (riskPercent > 0.5) {
      level = 'MEDIUM';
      levelClass = 'risk-medium';
    }

    if (this.elements.openRisk) {
      this.elements.openRisk.textContent = `${formatCurrency(totalRisk)} (${formatPercent(riskPercent)})`;
      this.elements.openRisk.className = 'positions-risk-bar__value text-danger';
    }

    // Update Open P&L
    if (this.elements.openPnL) {
      const pnlClass = totalPnL >= 0 ? 'text-success' : 'text-danger';
      const pnlSign = totalPnL >= 0 ? '+' : '';
      this.elements.openPnL.textContent = `${pnlSign}${formatCurrency(totalPnL)}`;
      this.elements.openPnL.className = `positions-risk-bar__value positions-risk-bar__value--pnl ${pnlClass}`;
    }

    if (this.elements.riskLevel) {
      this.elements.riskLevel.textContent = level;
      this.elements.riskLevel.className = `positions-risk-bar__value positions-risk-bar__value--indicator ${levelClass}`;
    }
  }

  renderGrid(positions) {
    if (!this.elements.grid) return;

    const shouldAnimate = !this.hasAnimated;
    this.hasAnimated = true;

    this.elements.grid.innerHTML = positions.map(trade => {
      const shares = trade.remainingShares ?? trade.shares;
      const riskPerShare = trade.entry - trade.stop;
      const grossRisk = shares * riskPerShare;
      const isTrimmed = trade.status === 'trimmed';
      const realizedPnL = trade.totalRealizedPnL || 0;

      // For trimmed trades, calculate NET risk (remaining risk - realized profit)
      const netRisk = isTrimmed ? Math.max(0, grossRisk - realizedPnL) : grossRisk;
      const riskPercent = (netRisk / state.account.currentSize) * 100;

      // Check if trade is "free rolled" - realized profit covers remaining risk
      const isFreeRoll = isTrimmed && realizedPnL >= (grossRisk - 0.01);

      // Get price data from tracker
      const pnlData = priceTracker.calculateUnrealizedPnL(trade);

      // Determine status
      let statusClass = trade.status;
      let statusText = 'Open';
      if (isFreeRoll) {
        statusClass = 'freeroll';
        statusText = 'Free Rolled';
      } else if (isTrimmed) {
        statusText = 'Trimmed';
      }

      // Get trade metadata
      const setupType = trade.thesis?.setupType;
      const companyName = trade.company?.name;
      const industry = trade.company?.industry;

      // Determine target and label
      const originalStop = trade.originalStop ?? trade.stop;
      const riskAmount = trade.entry - originalStop;

      // Use trade.target if set, otherwise default to 5R
      const targetPrice = trade.target || (trade.entry + (riskAmount * 5));

      // Calculate which R-multiple this target represents (if any)
      let targetLabel = 'Target';
      for (let r = 1; r <= 5; r++) {
        const rTarget = trade.entry + (riskAmount * r);
        if (Math.abs(targetPrice - rTarget) < 0.01) { // Within 1 cent
          targetLabel = `${r}R Target`;
          break;
        }
      }

      return `
        <div class="position-card ${shouldAnimate ? 'position-card--animate' : ''} ${isTrimmed ? 'position-card--trimmed' : ''}" data-id="${trade.id}">
          <div class="position-card__header" style="flex-direction: column; align-items: flex-start;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: var(--space-1);">
              <span class="position-card__ticker">${trade.ticker}</span>
              <div class="position-card__badges" style="flex-wrap: nowrap;">
                ${industry ? `<span class="position-card__badge position-card__badge--industry">${industry}</span>` : ''}
                ${setupType ? `<span class="position-card__badge position-card__badge--type">${setupType.replace(/\b\w/g, l => l.toUpperCase())}</span>` : ''}
                <span class="position-card__badge position-card__badge--${statusClass}">
                  ${statusText}
                </span>
              </div>
            </div>
            <span class="position-card__shares">${isTrimmed ? `${shares} of ${trade.originalShares}` : shares} shares</span>
          </div>

          <div class="position-card__details">
            <div class="position-card__detail">
              <span class="position-card__detail-label">Entry</span>
              <span class="position-card__detail-value" style="color: var(--primary);">${formatCurrency(trade.entry)}</span>
            </div>
            <div class="position-card__detail">
              <span class="position-card__detail-label">Stop</span>
              <span class="position-card__detail-value" style="color: var(--danger);">${formatCurrency(trade.stop)}</span>
            </div>
            ${pnlData && pnlData.currentPrice >= (targetPrice * 0.95) ? `
            <div class="position-card__detail">
              <span class="position-card__detail-label">Current</span>
            </div>
            <div class="position-card__detail">
              <span class="position-card__detail-label">${targetLabel}</span>
            </div>
            <div style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); outline: 2px solid var(--warning); outline-offset: 2px; border-radius: 4px; padding: 2px 4px; margin-top: -6px;">
              <span class="position-card__detail-value" style="color: var(--warning);">${formatCurrency(pnlData.currentPrice)} <span style="font-size: var(--text-xs); color: var(--text-muted); font-weight: normal;">${pnlData.currentPrice >= targetPrice ? 'target reached' : 'nearing target'}</span></span>
              <span class="position-card__detail-value" style="color: var(--warning);">${formatCurrency(targetPrice)}</span>
            </div>
            ` : pnlData ? `
            <div class="position-card__detail">
              <span class="position-card__detail-label">Current</span>
              <span class="position-card__detail-value">${formatCurrency(pnlData.currentPrice)}</span>
            </div>
            <div class="position-card__detail">
              <span class="position-card__detail-label">${targetLabel}</span>
              <span class="position-card__detail-value" style="color: var(--warning);">${formatCurrency(targetPrice)}</span>
            </div>
            ` : `
            <div class="position-card__detail">
              <span class="position-card__detail-label">${targetLabel}</span>
              <span class="position-card__detail-value" style="color: var(--warning);">${formatCurrency(targetPrice)}</span>
            </div>
            `}
          </div>

          <div class="position-card__risk">
            <div class="position-card__risk-row">
              <span class="position-card__risk-label">Open Risk</span>
              <span class="position-card__risk-value">${formatCurrency(netRisk)} (${formatPercent(riskPercent)})</span>
            </div>
            ${pnlData ? `
            <div class="position-card__risk-row">
              <span class="position-card__risk-label">Unrealized P&L</span>
              <span class="position-card__risk-value ${pnlData.unrealizedPnL >= 0 ? 'text-success' : 'text-danger'}">${pnlData.unrealizedPnL >= 0 ? '+' : ''}${formatCurrency(pnlData.unrealizedPnL)} (${pnlData.unrealizedPercent >= 0 ? '+' : ''}${formatPercent(pnlData.unrealizedPercent)})</span>
            </div>
            ` : ''}
            ${isTrimmed ? `
            <div class="position-card__risk-row position-card__realized">
              <span class="position-card__risk-label">Realized P&L</span>
              <span class="position-card__risk-value position-card__realized-value ${realizedPnL >= 0 ? '' : 'text-danger'}">${realizedPnL >= 0 ? '+' : ''}${formatCurrency(realizedPnL)}</span>
            </div>
            ` : ''}
          </div>

          <div class="position-card__actions">
            <button class="position-card__btn position-card__btn--primary" data-action="close" data-id="${trade.id}">
              Edit
            </button>
            <button class="position-card__btn position-card__btn--danger" data-action="delete" data-id="${trade.id}">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind action buttons
    this.bindCardActions();
  }

  bindCardActions() {
    // Close/Trim buttons
    this.elements.grid.querySelectorAll('[data-action="close"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        trimModal.open(id);
      });
    });

    // Delete buttons
    this.elements.grid.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm('Delete this trade?')) {
          state.deleteJournalEntry(id);
        }
      });
    });
  }

  showEmptyState() {
    if (this.elements.grid) {
      this.elements.grid.style.display = 'none';
    }

    // Check if there are any active positions at all
    const allActivePositions = state.journal.entries.filter(
      e => e.status === 'open' || e.status === 'trimmed'
    );
    const hasActivePositions = allActivePositions.length > 0;

    // Update empty state message based on context
    if (hasActivePositions) {
      // User has positions but none match the current filter
      if (this.elements.emptyTitle) {
        this.elements.emptyTitle.textContent =
          this.filters.status === 'trimmed' ? 'No Trimmed Positions' :
          this.filters.status === 'open' ? 'No Open Positions' :
          'No Positions';
      }
      if (this.elements.emptyText) {
        this.elements.emptyText.textContent =
          this.filters.status === 'trimmed' ? 'You don\'t have any trimmed positions yet.' :
          this.filters.status === 'open' ? 'You don\'t have any open positions.' :
          'No positions match this filter.';
      }
      // Hide the "Go to Dashboard" button when they already have positions
      if (this.elements.goToDashboard) {
        this.elements.goToDashboard.style.display = 'none';
      }
    } else {
      // User has no positions at all
      if (this.elements.emptyTitle) {
        this.elements.emptyTitle.textContent = 'No Active Positions';
      }
      if (this.elements.emptyText) {
        this.elements.emptyText.textContent = 'You\'re currently all cash. Head to the Dashboard to log a new trade.';
      }
      // Show the "Go to Dashboard" button
      if (this.elements.goToDashboard) {
        this.elements.goToDashboard.style.display = '';
      }
    }

    if (this.elements.empty) {
      this.elements.empty.classList.add('positions-empty--visible');
    }
  }

  hideEmptyState() {
    if (this.elements.grid) {
      this.elements.grid.style.display = '';
    }
    if (this.elements.empty) {
      this.elements.empty.classList.remove('positions-empty--visible');
    }
  }

  async refreshPrices(isAutoRefresh = false) {
    if (!priceTracker.apiKey) {
      if (!isAutoRefresh) {
        showToast('⚠️ Please add your Finnhub API key in Settings first', 'error');
      }
      return;
    }

    const btn = this.elements.refreshPricesBtn;

    // Show loading state on button if manual refresh
    if (!isAutoRefresh && btn) {
      btn.disabled = true;
      btn.classList.add('loading');
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.style.animation = 'spin 1s linear infinite';
      }
    }

    try {
      const results = await priceTracker.refreshAllActivePrices();

      if (results.success.length > 0) {
        // Only show toast for manual refresh
        if (!isAutoRefresh) {
          showToast(`✅ Updated ${results.success.length} stock price${results.success.length > 1 ? 's' : ''}`, 'success');
        }

        // Render will be triggered by the 'pricesUpdated' event
        state.emit('pricesUpdated', results);
      }

      if (results.failed.length > 0) {
        console.error('Failed to fetch some prices:', results.failed);
        if (!isAutoRefresh) {
          showToast(`⚠️ Failed to fetch ${results.failed.length} price${results.failed.length > 1 ? 's' : ''}`, 'warning');
        }
      }
    } catch (error) {
      console.error('Price refresh error:', error);
      if (!isAutoRefresh) {
        showToast('❌ Failed to fetch prices: ' + error.message, 'error');
      }
    } finally {
      // Re-enable button if manual refresh
      if (!isAutoRefresh && btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
        const svg = btn.querySelector('svg');
        if (svg) {
          svg.style.animation = '';
        }
      }
    }
  }

  startAutoRefresh() {
    // Clear any existing interval
    this.stopAutoRefresh();

    // Refresh immediately on start
    if (priceTracker.apiKey) {
      this.refreshPrices(true);
    }

    // Set up 1-minute auto-refresh
    this.autoRefreshInterval = setInterval(() => {
      this.refreshPrices(true);
    }, 60000); // 60 seconds
  }

  stopAutoRefresh() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
  }
}

export const positionsView = new PositionsView();
export { PositionsView };
