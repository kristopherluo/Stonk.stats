/**
 * Positions View - Full-fledged open positions manager
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatPercent } from '../../core/utils.js';
import { trimModal } from '../../components/modals/trimModal.js';
import { wizard } from '../../components/modals/wizard.js';
import { viewManager } from '../../components/ui/viewManager.js';
import { priceTracker } from '../../core/priceTracker.js';
import { showToast } from '../../components/ui/ui.js';
import { sharedMetrics } from '../../shared/SharedMetrics.js';
import { FilterPopup } from '../../shared/FilterPopup.js';
import accountBalanceCalculator from '../../shared/AccountBalanceCalculator.js';

class PositionsView {
  constructor() {
    this.elements = {};
    this.filters = {
      status: 'all',
      types: ['ep', 'long-term', 'base', 'breakout', 'bounce', 'other'] // Default to all types selected
    };
    this.filterPopup = null; // Shared filter popup component
    this.autoRefreshInterval = null;
    this.hasAnimated = false;
    this.isRendering = false; // Guard against overlapping renders
  }

  init() {
    this.cacheElements();

    // Initialize shared filter popup
    this.filterPopup = new FilterPopup({
      elements: {
        filterBtn: this.elements.filterBtn,
        filterPanel: this.elements.filterPanel,
        filterBackdrop: this.elements.filterBackdrop,
        filterClose: this.elements.filterClose,
        applyBtn: this.elements.applyFilters,
        resetBtn: this.elements.selectAllTypes,
        filterCount: this.elements.filterCount
      },
      onOpen: () => this.syncFilterUIToState(),
      onApply: () => this.applyFilters(),
      onReset: () => this.selectAllTypes()
    });

    this.bindEvents();

    // Initialize all type checkboxes to be checked (matching "All Types" default state)
    if (this.elements.typeCheckboxes) {
      this.elements.typeCheckboxes.forEach(checkbox => {
        checkbox.checked = true;
      });
    }

    // Only render if view is already active (page refresh case)
    // Otherwise, viewChanged event will trigger the initial render
    const positionsView = document.getElementById('positionsView');
    if (positionsView && positionsView.classList.contains('view--active')) {
      this.render();
    }

    // Listen for journal changes
    state.on('journalEntryAdded', () => this.render());
    state.on('journalEntryUpdated', () => this.render());
    state.on('journalEntryDeleted', () => this.render());

    // Listen for view changes
    state.on('viewChanged', (data) => {
      // Clear grid when leaving positions to prevent stale cards from showing
      if (data.from === 'positions') {
        if (this.elements.grid) {
          this.elements.grid.innerHTML = '';
        }
        this.stopAutoRefresh();
      }

      if (data.to === 'positions') {
        this.hasAnimated = false; // Reset animation flag when entering view
        setTimeout(() => {
          this.render();
        }, 100); // Wait for viewManager animation to complete
        this.startAutoRefresh(true); // Pass true to skip immediate refresh
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
      positionsStatusFilter: document.getElementById('positionsStatusFilter'),
      positionsTypeFilter: document.getElementById('positionsTypeFilter'),

      // Risk bar
      riskBar: document.getElementById('positionsRiskBar'),
      openRisk: document.getElementById('positionsOpenRisk'),
      openPnL: document.getElementById('positionsOpenPnL'),
      riskLevel: document.getElementById('positionsRiskLevel'),
      riskLevelTooltip: document.getElementById('riskLevelTooltip'),
      refreshPricesBtn: document.getElementById('refreshPositionsPricesBtn'),
      newPositionBtn: document.getElementById('positionsNewBtn'),

      // Grid
      grid: document.getElementById('positionsGrid'),

      // Empty state
      empty: document.getElementById('positionsEmpty'),
      emptyTitle: document.getElementById('positionsEmptyTitle'),
      emptyText: document.getElementById('positionsEmptyText'),
      openWizardBtn: document.getElementById('positionsNewBtn2'),

      // Filter dropdown
      filterBtn: document.getElementById('positionsFilterBtn'),
      filterPanel: document.getElementById('positionsFilterPanel'),
      filterBackdrop: document.getElementById('positionsFilterBackdrop'),
      filterClose: document.getElementById('positionsFilterClose'),
      filterCount: document.getElementById('positionsFilterCount'),
      applyFilters: document.getElementById('positionsApplyFilters'),
      selectAllTypes: document.getElementById('positionsSelectAllTypes'),
      statusBtns: document.querySelectorAll('#positionsFilterPanel .filter-status-btn'),
      typeAllCheckbox: document.getElementById('filterTypeAll'),
      typeCheckboxes: document.querySelectorAll('#positionsFilterPanel input[type="checkbox"]:not(#filterTypeAll)')
    };
  }

  bindEvents() {
    // Open wizard button
    if (this.elements.openWizardBtn) {
      this.elements.openWizardBtn.addEventListener('click', () => {
        wizard.open();
      });
    }

    // Refresh prices button
    if (this.elements.refreshPricesBtn) {
      this.elements.refreshPricesBtn.addEventListener('click', async () => {
        await this.refreshPrices();
      });
    }

    // New Position button - opens wizard
    if (this.elements.newPositionBtn) {
      this.elements.newPositionBtn.addEventListener('click', () => {
        wizard.open();
      });
    }

    // Note: Filter popup open/close/apply/reset now handled by shared FilterPopup component

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

    // Note: Click outside to close handled by shared FilterPopup component
  }

  // Note: toggleFilterPanel, openFilterPanel, closeFilterPanel now handled by shared FilterPopup component

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

    // Render (FilterPopup handles closing)
    this.render();
  }

  selectAllTypes() {
    // Reset status to "all"
    this.elements.statusBtns?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === 'all');
    });

    // Check all type checkboxes (changed from unchecking to checking)
    this.elements.typeCheckboxes?.forEach(checkbox => {
      checkbox.checked = true;
    });
    // Check the "All Types" checkbox
    if (this.elements.typeAllCheckbox) {
      this.elements.typeAllCheckbox.checked = true;
      this.elements.typeAllCheckbox.indeterminate = false;
    }
  }

  updateFilterCount() {
    let count = 0;

    // Count status filter (if not "all")
    if (this.filters.status !== 'all') {
      count++;
    }

    // Count type filters (only if not all types are selected)
    // Get total number of available types
    const totalTypes = this.elements.typeCheckboxes?.length || 0;
    const selectedTypes = this.filters.types.length;

    // Only count as a filter if not all types are selected (all types = default state)
    if (selectedTypes > 0 && selectedTypes < totalTypes) {
      count += selectedTypes;
    }

    // Update badge using shared FilterPopup
    this.filterPopup.updateFilterCount(count);
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
        // Show trades without a type, or trades matching the selected types
        return !tradeType || this.filters.types.includes(tradeType);
      });
    }

    return positions;
  }

  async render() {
    // Guard against overlapping renders
    if (this.isRendering) {
      return;
    }
    this.isRendering = true;

    // Capture animation flag IMMEDIATELY to prevent race conditions
    const shouldAnimate = !this.hasAnimated;
    if (shouldAnimate) {
      this.hasAnimated = true;
    }

    try {
      const positions = this.getFilteredPositions();

      // Update count to show filtered positions
      if (this.elements.positionsCount) {
        this.elements.positionsCount.textContent = positions.length;
      }

      // Update filter displays
      this.updateFilterDisplays();

      // Render risk bar with filtered positions
      this.renderRiskBar(positions);

      // Show empty state or grid
      if (positions.length === 0) {
        this.showEmptyState();
      } else {
        this.hideEmptyState();
        await this.renderGrid(positions, shouldAnimate);
      }
    } finally {
      this.isRendering = false;
    }
  }

  updateFilterDisplays() {
    // Update status display
    if (this.elements.positionsStatusFilter) {
      const statusText = this.filters.status === 'all'
        ? 'All'
        : this.filters.status.charAt(0).toUpperCase() + this.filters.status.slice(1);
      this.elements.positionsStatusFilter.textContent = `Status: ${statusText}`;
    }

    // Update type display
    if (this.elements.positionsTypeFilter) {
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
        this.elements.positionsTypeFilter.textContent = 'Type: All';
      } else if (this.filters.types.length === 0) {
        this.elements.positionsTypeFilter.textContent = 'Type: None';
      } else {
        const typeNames = this.filters.types.map(t => typeLabels[t]).join(', ');
        this.elements.positionsTypeFilter.textContent = `Type: ${typeNames}`;
      }
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
      if (this.elements.riskLevelTooltip) {
        this.elements.riskLevelTooltip.textContent = 'No open positions - 100% cash';
      }
      return;
    }

    // Calculate NET risk using SharedMetrics (same calculation as Stats page!)
    const totalRisk = sharedMetrics.getOpenRisk();

    // Calculate total unrealized P&L using centralized calculator
    const currentPrices = priceTracker.getPricesAsObject();
    const balanceData = accountBalanceCalculator.calculateCurrentBalance({
      startingBalance: state.settings.startingAccountSize,
      allTrades: state.journal.entries,
      cashFlowTransactions: state.cashFlow.transactions,
      currentPrices
    });
    const totalPnL = balanceData.unrealizedPnL;

    const riskPercent = (totalRisk / state.account.currentSize) * 100;

    // Determine risk level
    let level = 'LOW';
    let levelClass = '';
    let tooltip = 'Portfolio risk under 0.5% - conservative position sizing';
    if (riskPercent > 2) {
      level = 'HIGH';
      levelClass = 'risk-high';
      tooltip = 'Portfolio risk above 2% - significant capital at risk';
    } else if (riskPercent > 0.5) {
      level = 'MEDIUM';
      levelClass = 'risk-medium';
      tooltip = 'Portfolio risk between 0.5% and 2% - moderate exposure';
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
    if (this.elements.riskLevelTooltip) {
      this.elements.riskLevelTooltip.textContent = tooltip;
    }
  }

  async renderGrid(positions, shouldAnimate) {
    if (!this.elements.grid) return;

    // Fetch all company data upfront with rate limiting
    const companyDataMap = new Map();

    // Get unique tickers to avoid duplicate fetches
    const uniqueTickers = [...new Set(positions.map(t => t.ticker))];

    // Fetch with rate limiting (200ms delay between requests to avoid API limits)
    for (const ticker of uniqueTickers) {
      let data = await priceTracker.getCachedCompanyData(ticker);

      // If we have data but it's missing industry (only has summary from Alpha Vantage),
      // fetch the full profile from Finnhub
      if (data && !data.industry) {
        const profile = await priceTracker.fetchCompanyProfile(ticker);
        if (profile) {
          data = profile;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit delay
      } else if (!data) {
        // No data at all, try to fetch profile
        const profile = await priceTracker.fetchCompanyProfile(ticker);
        if (profile) {
          data = profile;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit delay
      }

      if (data && data.industry) {
        companyDataMap.set(ticker, data);
      }
    }

    this.elements.grid.innerHTML = positions.map(trade => {
      const isOptions = trade.assetType === 'options';
      const shares = trade.remainingShares ?? trade.shares;
      const riskPerShare = trade.entry - trade.stop;

      // For options, multiply by 100 (contract multiplier)
      const multiplier = isOptions ? 100 : 1;
      const grossRisk = shares * riskPerShare * multiplier;

      const isTrimmed = trade.status === 'trimmed';
      const realizedPnL = trade.totalRealizedPnL || 0;

      // For trimmed trades, calculate NET risk (remaining risk - realized profit)
      // For all trades, clamp to 0 minimum (stop above entry = no risk)
      const netRisk = isTrimmed ? Math.max(0, grossRisk - realizedPnL) : Math.max(0, grossRisk);
      const riskPercent = (netRisk / state.account.currentSize) * 100;

      // Get price data from tracker
      const pnlData = isOptions
        ? priceTracker.calculateOptionsUnrealizedPnL(trade)
        : priceTracker.calculateUnrealizedPnL(trade);

      // Determine status
      let statusClass = trade.status;
      let statusText = isTrimmed ? 'Trimmed' : 'Open';

      // Get trade metadata
      const setupType = trade.thesis?.setupType;

      // Get company data from the Map we fetched earlier
      const companyData = companyDataMap.get(trade.ticker);
      const companyName = companyData?.name;
      const industry = companyData?.industry;

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

      // Handle options display
      let optionDetailsHTML = '';
      let quantityHTML = '';

      if (isOptions) {
        // Format option details: "5C Jan 16, 2026"
        const strike = trade.strike || 0;
        const optionSymbol = trade.optionType === 'put' ? 'P' : 'C';
        let formattedExp = '';
        let daysUntilExpHTML = '';

        if (trade.expirationDate) {
          const expDate = new Date(trade.expirationDate + 'T00:00:00');
          formattedExp = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

          // Calculate days until expiration
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysUntil = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

          // Determine urgency styling
          let urgencyClass = 'option-expiry--safe';
          let urgencyText = 'safe';
          let badgeText = `${daysUntil}d`;

          if (daysUntil < 0) {
            urgencyClass = 'option-expiry--expired';
            urgencyText = 'option has expired';
            badgeText = 'Expired';
          } else if (daysUntil === 0) {
            urgencyClass = 'option-expiry--urgent';
            urgencyText = 'expires today';
          } else if (daysUntil === 1) {
            urgencyClass = 'option-expiry--urgent';
            urgencyText = 'expires tomorrow';
          } else if (daysUntil < 7) {
            urgencyClass = 'option-expiry--urgent';
            urgencyText = 'urgent';
          } else if (daysUntil < 14) {
            urgencyClass = 'option-expiry--warning';
            urgencyText = 'approaching';
          }

          daysUntilExpHTML = `<span class="position-card__expiry-badge ${urgencyClass}" title="${urgencyText}">${badgeText}</span>`;
        }

        const optionDetails = `${strike}${optionSymbol} ${formattedExp}`;

        // For options, shares field contains the actual contract count
        const contracts = shares;
        const originalContracts = trade.originalShares || contracts;

        optionDetailsHTML = `<div style="display: flex; align-items: center; gap: var(--space-2);"><span class="position-card__option-details">${optionDetails}</span>${daysUntilExpHTML}</div>`;
        quantityHTML = `<span class="position-card__contracts">${isTrimmed ? `${contracts} of ${originalContracts}` : contracts} contracts</span>`;
      } else {
        // Stock display
        quantityHTML = `<span class="position-card__shares">${isTrimmed ? `${shares} of ${trade.originalShares}` : shares} shares</span>`;
      }

      // Format setup type with proper capitalization
      const typeLabels = {
        'ep': 'EP',
        'long-term': 'Long-term',
        'base': 'Base',
        'breakout': 'Breakout',
        'bounce': 'Bounce',
        'other': 'Other'
      };
      const formattedSetupType = setupType ? (typeLabels[setupType] || setupType.replace(/\b\w/g, l => l.toUpperCase())) : '';

      return `
        <div class="position-card ${shouldAnimate ? 'position-card--animate' : ''} ${isTrimmed ? 'position-card--trimmed' : ''} ${isOptions ? 'position-card--options' : ''}" data-id="${trade.id}">
          <div class="position-card__header" style="display: grid; grid-template-columns: auto 1fr; gap: var(--space-2); row-gap: 2px; align-items: start;">
            <span class="position-card__ticker" style="grid-column: 1; grid-row: 1;">${trade.ticker}</span>
            <div style="grid-column: 2; grid-row: 1 / span ${isOptions ? '3' : '2'}; display: flex; align-items: flex-start; align-content: flex-start; gap: var(--space-2); flex-wrap: wrap; justify-content: flex-end;">
              ${industry ? `<span class="position-card__badge position-card__badge--industry" style="white-space: nowrap;">${industry}</span>` : ''}
              ${formattedSetupType ? `<span class="position-card__badge position-card__badge--type" style="white-space: nowrap;">${formattedSetupType}</span>` : ''}
              <span class="position-card__badge position-card__badge--${statusClass}" style="white-space: nowrap;">
                ${statusText}
              </span>
            </div>
            ${isOptions ? `
              <div style="grid-column: 1; grid-row: 2; display: flex; align-items: center;">
                ${optionDetailsHTML}
              </div>
              <div style="grid-column: 1; grid-row: 3;">
                ${quantityHTML}
              </div>
            ` : `
              <div style="grid-column: 1; grid-row: 2;">
                ${quantityHTML}
              </div>
            `}
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
              <span class="position-card__detail-value" style="color: var(--warning); white-space: nowrap;">${formatCurrency(pnlData.currentPrice)} <span style="font-size: var(--text-xs); color: var(--text-muted); font-weight: normal;">${pnlData.currentPrice >= targetPrice ? 'target reached' : 'nearing target'}</span></span>
              <span class="position-card__detail-value" style="color: var(--warning); text-align: right; white-space: nowrap;">${formatCurrency(targetPrice)}</span>
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
            <div class="position-card__risk-row position-card__unrealized">
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
        </div>
      `;
    }).join('');

    // Bind action buttons
    this.bindCardActions();
  }

  bindCardActions() {
    // Make entire card clickable to open manage modal
    this.elements.grid.querySelectorAll('.position-card').forEach(card => {
      card.style.cursor = 'pointer';
      card.addEventListener('click', (e) => {
        const id = parseInt(card.dataset.id);
        trimModal.open(id);
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
      // Hide the wizard button when they already have positions
      if (this.elements.openWizardBtn) {
        this.elements.openWizardBtn.style.display = 'none';
      }
    } else {
      // User has no positions at all
      if (this.elements.emptyTitle) {
        this.elements.emptyTitle.textContent = 'No Active Positions';
      }
      if (this.elements.emptyText) {
        this.elements.emptyText.textContent = 'You\'re currently all cash. Click below to log a new trade.';
      }
      // Show the wizard button
      if (this.elements.openWizardBtn) {
        this.elements.openWizardBtn.style.display = '';
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
      // Fetch stock prices
      const results = await priceTracker.refreshAllActivePrices();

      // Fetch options prices if API key is configured
      let optionsResults = { success: [], failed: [] };
      if (priceTracker.optionsApiKey) {
        const activeTrades = state.journal.entries.filter(
          e => (e.status === 'open' || e.status === 'trimmed') && e.assetType === 'options'
        );
        if (activeTrades.length > 0) {
          optionsResults = await priceTracker.refreshOptionsPrices(activeTrades);
        }
      }

      const totalSuccess = results.success.length + optionsResults.success.length;
      const totalFailed = results.failed.length + optionsResults.failed.length;

      if (totalSuccess > 0) {
        // Only show toast for manual refresh
        if (!isAutoRefresh) {
          const stockMsg = results.success.length > 0 ? `${results.success.length} stock${results.success.length > 1 ? 's' : ''}` : '';
          const optionsMsg = optionsResults.success.length > 0 ? `${optionsResults.success.length} option${optionsResults.success.length > 1 ? 's' : ''}` : '';
          const separator = stockMsg && optionsMsg ? ' and ' : '';
          showToast(`✅ Updated ${stockMsg}${separator}${optionsMsg}`, 'success');
        }

        // Render will be triggered by the 'pricesUpdated' event
        state.emit('pricesUpdated', { stocks: results, options: optionsResults });
      }

      if (totalFailed > 0) {
        console.error('Failed to fetch some prices:', { stocks: results.failed, options: optionsResults.failed });
        if (!isAutoRefresh) {
          showToast(`Failed to fetch ${totalFailed} price${totalFailed > 1 ? 's' : ''}`, 'warning');
        }
      }
    } catch (error) {
      console.error('Price refresh error:', error);
      if (!isAutoRefresh) {
        showToast('Failed to fetch prices: ' + error.message, 'error');
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

  startAutoRefresh(skipImmediate = false) {
    // Clear any existing interval
    this.stopAutoRefresh();

    // Refresh immediately on start (unless skipped for animation purposes)
    if (!skipImmediate && (priceTracker.apiKey || priceTracker.optionsApiKey)) {
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
