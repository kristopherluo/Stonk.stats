/**
 * Journal - Trade logging and management
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatPercent, formatDate, createTimestampFromDateInput } from '../../core/utils.js';
import { showToast } from '../../components/ui/ui.js';
import { trimModal } from '../../components/modals/trimModal.js';
import { dataManager } from '../../core/dataManager.js';
import { wizard } from '../../components/modals/wizard.js';
import { confetti } from '../../components/ui/confetti.js';
import { viewManager } from '../../components/ui/viewManager.js';
import { priceTracker } from '../../core/priceTracker.js';

class Journal {
  constructor() {
    this.elements = {};
    this.hasAnimated = false;
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.initNotesEditor();
    this.render();

    // Listen for state changes
    state.on('journalEntryAdded', () => this.render());
    state.on('journalEntryUpdated', () => this.render());
    state.on('journalEntryDeleted', () => this.render());

    // Listen for calculation results to enable/disable log button
    state.on('resultsRendered', (results) => {
      this.updateLogButtonState(results);
    });

    // Initial button state check
    this.updateLogButtonState(state.results);

    // Listen for wizard setting changes to show/hide hint
    state.on('journalMetaSettingsChanged', () => {
      this.updateWizardHint();
    });

    // Initial wizard hint state
    this.updateWizardHint();

    // Listen for view changes to reset animation
    state.on('viewChanged', (data) => {
      if (data.to === 'positions') {
        this.hasAnimated = false;
      }
    });
  }

  initNotesEditor() {
    // Auto-convert "- " to bullet points (same as wizard notes)
    if (!this.elements.tradeNotes) return;

    this.elements.tradeNotes.addEventListener('input', (e) => {
      const selection = window.getSelection();
      if (!selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;

      // Only work with text nodes
      if (textNode.nodeType !== Node.TEXT_NODE) return;

      const textContent = textNode.textContent;
      const cursorPos = range.startOffset;

      // Check if the text just before cursor is "- " (support both regular space and &nbsp;)
      if (cursorPos >= 2) {
        const substringToCheck = textContent.substring(cursorPos - 2, cursorPos);
        const isDash = substringToCheck[0] === '-';
        const isSpace = substringToCheck[1] === ' ' || substringToCheck[1] === '\u00A0'; // Regular space or &nbsp;

        if (isDash && isSpace) {
        const beforeDash = textContent.substring(0, cursorPos - 2);
        const afterDash = textContent.substring(cursorPos);
        const combinedText = beforeDash + afterDash;

        // Create a proper list structure
        const ul = document.createElement('ul');
        const li = document.createElement('li');

        if (combinedText) {
          li.textContent = combinedText;
        } else {
          li.innerHTML = '<br>';
        }

        ul.appendChild(li);

        // Replace content with list
        const parent = textNode.parentNode;
        if (parent === this.elements.tradeNotes) {
          this.elements.tradeNotes.replaceChild(ul, textNode);
        } else {
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
      }
    });
  }

  cacheElements() {
    this.elements = {
      // Log trade
      tradeNotes: document.getElementById('tradeNotes'),
      logTradeBtn: document.getElementById('logTradeBtn'),
      wizardHint: document.getElementById('wizardHint'),

      // Active trades
      activeTrades: document.getElementById('activeTrades'),
      activeTradeCount: document.getElementById('activeTradeCount'),
      riskSummary: document.getElementById('riskSummary'),
      viewPositionsBtn: document.getElementById('viewPositionsBtn'),

      // Modal
      journalModal: document.getElementById('journalModal'),
      journalModalOverlay: document.getElementById('journalModalOverlay'),
      closeJournalBtn: document.getElementById('closeJournalBtn'),
      viewJournalBtn: document.getElementById('viewJournalBtn'),
      journalTableBody: document.getElementById('journalTableBody'),
      journalSummaryText: document.getElementById('journalSummaryText'),

      // Export buttons (journal panel)
      exportCSVBtn: document.getElementById('exportCSVBtn'),
      exportTSVBtn: document.getElementById('exportTSVBtn'),
      exportPDFBtn: document.getElementById('exportPDFBtn'),

      // Export buttons (journal modal)
      journalCopyCSV: document.getElementById('journalCopyCSV'),
      journalDownload: document.getElementById('journalDownload')
    };
  }

  bindEvents() {
    // Log trade button
    if (this.elements.logTradeBtn) {
      this.elements.logTradeBtn.addEventListener('click', (e) => {
        // Shift+Click bypasses wizard even if enabled
        const skipWizard = e.shiftKey;
        this.logTrade(skipWizard);
      });
    }

    // Navigate to Journal view (replaces modal)
    if (this.elements.viewJournalBtn) {
      this.elements.viewJournalBtn.addEventListener('click', () => {
        viewManager.navigateTo('journal');
      });
    }

    // Navigate to Positions view
    if (this.elements.viewPositionsBtn) {
      this.elements.viewPositionsBtn.addEventListener('click', () => {
        viewManager.navigateTo('positions');
      });
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.renderTable(e.target.dataset.filter);
      });
    });

    // Export buttons (journal panel)
    if (this.elements.exportCSVBtn) {
      this.elements.exportCSVBtn.addEventListener('click', () => dataManager.exportCSV());
    }
    if (this.elements.exportTSVBtn) {
      this.elements.exportTSVBtn.addEventListener('click', () => dataManager.exportTSV());
    }
    if (this.elements.exportPDFBtn) {
      this.elements.exportPDFBtn.addEventListener('click', () => {
        showToast('📄 PDF export coming soon. Use CSV for now.', 'warning');
      });
    }

    // Export buttons (journal modal)
    if (this.elements.journalCopyCSV) {
      this.elements.journalCopyCSV.addEventListener('click', () => dataManager.copyCSV());
    }
    if (this.elements.journalDownload) {
      this.elements.journalDownload.addEventListener('click', () => dataManager.exportCSV());
    }

    // Make close/delete functions globally available
    window.closeTrade = (id) => this.closeTrade(id);
    window.deleteTrade = (id) => this.deleteTrade(id);
  }

  async logTrade(skipWizard = false) {
    const results = state.results;
    const trade = state.trade;

    if (!results.shares || results.shares === 0) {
      showToast('⚠️ Enter a valid trade to log', 'warning');
      return;
    }

    // Validate ticker and fetch company data if API key is configured
    let companyData = null;
    if (priceTracker.apiKey && trade.ticker) {
      try {
        // Show loading toast
        showToast('🔍 Validating ticker...', 'info');

        // Fetch price to validate ticker and company profile in parallel
        const [priceData, profileData] = await Promise.all([
          priceTracker.fetchPrice(trade.ticker),
          priceTracker.fetchCompanyProfile(trade.ticker)
        ]);

        companyData = profileData;
        if (companyData) {
          console.log('[Journal] ✅ Company data fetched:', companyData);
        } else {
          console.log('[Journal] ⚠️ No company data available for this ticker');
        }
      } catch (error) {
        // If error contains "Invalid ticker", show specific error
        if (error.message.includes('Invalid ticker')) {
          showToast(`❌ ${error.message}`, 'error');
        } else {
          showToast(`❌ Failed to validate ticker: ${error.message}`, 'error');
        }
        return;
      }
    }

    // Check if wizard is enabled and should be used
    const wizardEnabled = state.journalMeta.settings.wizardEnabled || false;

    if (wizardEnabled && !skipWizard) {
      // Store company data in state for wizard to use
      if (companyData) {
        state.tempCompanyData = companyData;
      }
      // Open wizard instead of directly logging
      wizard.open();
      return;
    }

    // Get custom trade date from calculator
    const tradeDateInput = document.getElementById('tradeDate');
    const timestamp = createTimestampFromDateInput(tradeDateInput?.value);

    // Direct logging (wizard disabled or shift+click bypass)
    const entry = {
      timestamp, // Custom timestamp based on trade date
      ticker: trade.ticker || 'UNKNOWN',
      entry: trade.entry,
      stop: trade.stop,
      originalStop: trade.stop,
      currentStop: trade.stop,
      target: trade.target,
      shares: results.shares,
      positionSize: results.positionSize,
      riskDollars: results.riskDollars,
      riskPercent: state.account.riskPercent,
      stopDistance: results.stopDistance,
      notes: this.elements.tradeNotes?.innerHTML.trim() || '',
      status: 'open',
      exitPrice: null,
      exitDate: null,
      pnl: null,
      thesis: null,
      wizardComplete: false,
      wizardSkipped: [],
      company: companyData // Store company data in entry
    };

    const newEntry = state.addJournalEntry(entry);

    // Update progress
    const progress = state.journalMeta.achievements.progress;
    progress.totalTrades++;

    if (entry.notes) {
      progress.tradesWithNotes++;
    }

    // Update streak
    state.updateStreak();

    // Save progress
    state.saveJournalMeta();

    // Emit tradeLogged event for achievements
    state.emit('tradeLogged', {
      entry: newEntry,
      wizardComplete: false,
      thesis: null
    });

    // Trigger confetti if celebrations enabled
    if (state.journalMeta.settings.celebrationsEnabled) {
      state.emit('triggerConfetti');
    }

    // Clear notes
    if (this.elements.tradeNotes) {
      this.elements.tradeNotes.innerHTML = '';
    }

    showToast(`✅ ${entry.ticker} trade logged!`, 'success');

    // Disable button after logging (will re-enable when new calculation happens)
    this.updateLogButtonState({ shares: 0 });
  }

  updateLogButtonState(results) {
    if (!this.elements.logTradeBtn) return;

    const hasValidResults = results && results.shares > 0;

    if (hasValidResults) {
      this.elements.logTradeBtn.removeAttribute('disabled');
    } else {
      this.elements.logTradeBtn.setAttribute('disabled', 'disabled');
    }
  }

  updateWizardHint() {
    if (!this.elements.wizardHint) return;

    const wizardEnabled = state.journalMeta.settings.wizardEnabled || false;
    this.elements.wizardHint.style.display = wizardEnabled ? '' : 'none';
  }

  closeTrade(id) {
    // Open trim modal instead of browser prompt
    trimModal.open(id);
  }

  deleteTrade(id) {
    if (!confirm('Delete this trade?')) return;

    const deleted = state.deleteJournalEntry(id);
    if (deleted) {
      showToast('🗑️ Trade deleted', 'success');
    }
  }

  render() {
    this.renderActiveTrades();
    this.renderRiskSummary();
  }

  renderActiveTrades() {
    // Include both open and trimmed trades (they still have positions)
    const activeTrades = state.journal.entries.filter(e => e.status === 'open' || e.status === 'trimmed');

    if (this.elements.activeTradeCount) {
      this.elements.activeTradeCount.textContent = `${activeTrades.length} active`;
    }

    if (!this.elements.activeTrades) return;

    if (activeTrades.length === 0) {
      this.elements.activeTrades.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__icon">🧘</span>
          <span class="empty-state__text">No active trades</span>
          <span class="empty-state__hint">Log a trade to see it here</span>
        </div>
      `;
      return;
    }

    const shouldAnimate = !this.hasAnimated;
    this.hasAnimated = true;

    this.elements.activeTrades.innerHTML = activeTrades.slice(0, 5).map(trade => {
      const shares = trade.remainingShares ?? trade.shares;
      const riskPerShare = trade.entry - trade.stop;
      const currentRisk = shares * riskPerShare;
      const isTrimmed = trade.status === 'trimmed';
      const realizedPnL = trade.totalRealizedPnL || 0;
      const target5R = trade.entry + (5 * riskPerShare);

      // For trimmed trades, calculate NET risk (remaining risk - realized profit)
      // Net risk can't go below 0
      const netRisk = isTrimmed ? Math.max(0, currentRisk - realizedPnL) : currentRisk;

      // Calculate risk percentage and color based on net risk
      const riskPercent = (netRisk / state.account.currentSize) * 100;
      let riskColorClass = 'text-success'; // green for < 0.5%
      if (riskPercent >= 2) {
        riskColorClass = 'text-danger'; // red for 2%+
      } else if (riskPercent >= 1) {
        riskColorClass = 'text-warning'; // yellow for 1%-2%
      } else if (riskPercent >= 0.5) {
        riskColorClass = 'text-warning'; // yellow for 0.5%-1%
      }

      // Determine status badge
      let statusClass, statusText;
      if (isTrimmed) {
        statusClass = 'trimmed';
        statusText = 'Trimmed';
      } else {
        statusClass = 'active';
        statusText = 'Open';
      }

      return `
        <div class="trade-card ${shouldAnimate ? 'trade-card--animate' : ''}" data-id="${trade.id}">
          <div class="trade-card__header">
            <div class="trade-card__header-left">
              <span class="trade-card__ticker">${trade.ticker}</span>
              <span class="trade-card__shares">${shares} shares${isTrimmed ? ` (${trade.originalShares} orig)` : ''}</span>
            </div>
            <span class="status-badge status-badge--${statusClass}">${statusText}</span>
          </div>
          <div class="trade-card__details">
            <div class="trade-card__detail">
              <span class="trade-card__label">Entry</span>
              <span class="trade-card__value text-primary">${formatCurrency(trade.entry)}</span>
            </div>
            <div class="trade-card__detail">
              <span class="trade-card__label">Stop</span>
              <span class="trade-card__value text-danger">${formatCurrency(trade.stop)}</span>
            </div>
            <div class="trade-card__detail">
              <span class="trade-card__label">5R Target</span>
              <span class="trade-card__value text-warning">${formatCurrency(target5R)}</span>
            </div>
            <div class="trade-card__detail">
              <span class="trade-card__label">Risk</span>
              <span class="trade-card__value text-danger">${formatCurrency(netRisk)}</span>
            </div>
            ${isTrimmed ? `
            <div class="trade-card__detail">
              <span class="trade-card__label">Realized</span>
              <span class="trade-card__value ${realizedPnL >= 0 ? 'text-success' : 'text-danger'}">${realizedPnL >= 0 ? '+' : ''}${formatCurrency(realizedPnL)}</span>
            </div>
            ` : ''}
          </div>
          <div class="trade-card__actions">
            <button class="btn btn--sm btn--secondary" onclick="closeTrade(${trade.id})">${isTrimmed ? 'Trim More' : 'Manage'}</button>
            <button class="btn btn--sm btn--secondary btn--danger-outline" onclick="deleteTrade(${trade.id})">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderRiskSummary() {
    if (!this.elements.riskSummary) return;

    // Include both open and trimmed trades (they still have positions at risk)
    const activeTrades = state.journal.entries.filter(e => e.status === 'open' || e.status === 'trimmed');

    // Show CASH status when no active trades
    if (activeTrades.length === 0) {
      this.elements.riskSummary.innerHTML = `
        <span class="risk-summary__label">Status:</span>
        <span class="risk-summary__indicator risk-summary__indicator--low">CASH</span>
      `;
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
    const riskPercent = (totalRisk / state.account.currentSize) * 100;

    let level = 'low';
    if (riskPercent > 2) level = 'high';
    else if (riskPercent > 0.5) level = 'medium';

    this.elements.riskSummary.innerHTML = `
      <span class="risk-summary__label">Open Risk:</span>
      <span class="risk-summary__value" style="color: var(--danger);">${formatCurrency(totalRisk)}</span>
      <span class="risk-summary__indicator risk-summary__indicator--${level}">${level.toUpperCase()}</span>
    `;
  }

  openModal() {
    this.elements.journalModal?.classList.add('open');
    this.elements.journalModalOverlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
    state.setUI('journalOpen', true);
    this.renderTable();
  }

  closeModal() {
    this.elements.journalModal?.classList.remove('open');
    this.elements.journalModalOverlay?.classList.remove('open');
    document.body.style.overflow = '';
    state.setUI('journalOpen', false);
  }

  renderTable(filter = 'all') {
    if (!this.elements.journalTableBody) return;

    const trades = state.getFilteredEntries(filter);

    if (trades.length === 0) {
      this.elements.journalTableBody.innerHTML = `
        <tr class="journal-empty">
          <td colspan="9">No trades ${filter !== 'all' ? 'with status "' + filter + '"' : 'logged yet'}</td>
        </tr>
      `;
      if (this.elements.journalSummaryText) {
        this.elements.journalSummaryText.textContent = '0 trades';
      }
      return;
    }

    this.elements.journalTableBody.innerHTML = trades.map(trade => {
      const date = formatDate(trade.timestamp);
      const isTrimmed = trade.status === 'trimmed';
      const isClosed = trade.status === 'closed';

      // Use totalRealizedPnL for trimmed/closed trades, fallback to pnl for legacy
      const pnlValue = trade.totalRealizedPnL ?? trade.pnl;
      const pnlDisplay = pnlValue !== null && pnlValue !== undefined
        ? `<span class="${pnlValue >= 0 ? 'text-success' : 'text-danger'}">${pnlValue >= 0 ? '+' : ''}${formatCurrency(pnlValue)}</span>`
        : '—';

      // Show remaining shares for trimmed trades
      const sharesDisplay = isTrimmed
        ? `${trade.remainingShares}/${trade.originalShares}`
        : trade.shares;

      return `
        <tr data-id="${trade.id}">
          <td>${date}</td>
          <td>${trade.ticker}</td>
          <td>${formatCurrency(trade.entry)}</td>
          <td>${formatCurrency(trade.stop)}</td>
          <td>${sharesDisplay}</td>
          <td>${formatCurrency(trade.riskDollars)}</td>
          <td><span class="status-badge status-badge--${trade.status}">${trade.status}</span></td>
          <td>${pnlDisplay}</td>
          <td>
            <button class="btn btn--ghost btn--sm" onclick="deleteTrade(${trade.id})">×</button>
          </td>
        </tr>
      `;
    }).join('');

    // Summary - use totalRealizedPnL for accurate counting
    const getPnL = (t) => t.totalRealizedPnL ?? t.pnl ?? 0;
    const wins = trades.filter(t => getPnL(t) > 0).length;
    const losses = trades.filter(t => getPnL(t) < 0).length;
    const open = trades.filter(t => t.status === 'open').length;
    const trimmed = trades.filter(t => t.status === 'trimmed').length;
    const totalPnL = trades.reduce((sum, t) => sum + getPnL(t), 0);

    if (this.elements.journalSummaryText) {
      const activeCount = open + trimmed;
      const parts = [];

      // Trade count
      parts.push(`${trades.length} trade${trades.length !== 1 ? 's' : ''}`);

      // Build stats string - only show non-zero values
      const statParts = [];
      if (wins > 0) statParts.push(`${wins} win${wins !== 1 ? 's' : ''}`);
      if (losses > 0) statParts.push(`${losses} loss${losses !== 1 ? 'es' : ''}`);
      if (activeCount > 0) statParts.push(`${activeCount} open`);

      if (statParts.length > 0) {
        parts.push(statParts.join(', '));
      }

      // P&L (only if there are closed trades)
      if (wins > 0 || losses > 0) {
        parts.push(`${totalPnL >= 0 ? '+' : ''}${formatCurrency(totalPnL)}`);
      }

      this.elements.journalSummaryText.textContent = parts.join(' · ');
    }
  }
}

export const journal = new Journal();
export { Journal };
