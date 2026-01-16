/**
 * TrimModal - Handles partial position exits (trimming trades)
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatNumber, initFlatpickr, getCurrentWeekday } from '../../core/utils.js';
import { formatDate } from '../../utils/marketHours.js';
import { showToast } from '../ui/ui.js';

class TrimModal {
  constructor() {
    this.elements = {};
    this.currentTrade = null;
    this.selectedR = 5;
    this.selectedTrimPercent = 100;
    this.isEditMode = false;
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.disableWeekends();
  }

  disableWeekends() {
    // Disable weekends on date inputs
    initFlatpickr(this.elements.dateInput);
    initFlatpickr(this.elements.entryDateInput);
  }

  cacheElements() {
    this.elements = {
      modal: document.getElementById('trimModal'),
      overlay: document.getElementById('trimModalOverlay'),
      closeBtn: document.getElementById('closeTrimModalBtn'),
      cancelBtn: document.getElementById('cancelTrimBtn'),
      confirmBtn: document.getElementById('confirmTrimBtn'),
      deleteBtn: document.getElementById('deleteTrimTradeBtn'),
      ticker: document.getElementById('trimModalTicker'),
      entryPrice: document.getElementById('trimEntryPrice'),
      originalStop: document.getElementById('trimOriginalStop'),
      stopLoss: document.getElementById('trimStopLoss'),
      riskPerShare: document.getElementById('trimRiskPerShare'),
      remainingShares: document.getElementById('trimRemainingShares'),
      exitPrice: document.getElementById('trimExitPrice'),
      rDisplay: document.getElementById('trimRDisplay'),
      exitPriceError: document.getElementById('trimExitPriceError'),
      sharesInput: document.getElementById('trimSharesInput'),
      sharesLabel: document.querySelector('label[for="trimSharesInput"]'),
      percentDisplay: document.getElementById('trimPercentDisplay'),
      sharesError: document.getElementById('trimSharesError'),
      dateInput: document.getElementById('trimDate'),
      newStop: document.getElementById('trimNewStop'),
      newStopError: document.getElementById('trimNewStopError'),
      profitPerShare: document.getElementById('trimProfitPerShare'),
      profitPerShareLabel: document.querySelector('.trim-preview__label'),
      totalPnL: document.getElementById('trimTotalPnL'),
      preview: document.getElementById('trimPreview'),
      onlyMoveStopCheckbox: document.getElementById('onlyMoveStopCheckbox'),
      onlyChangeTargetCheckbox: document.getElementById('onlyChangeTargetCheckbox'),
      newStopOptional: document.getElementById('newStopOptional'),
      editPositionDetailsBtn: document.getElementById('editPositionDetailsBtn'),
      entryPriceInput: document.getElementById('trimEntryPriceInput'),
      entryPriceEdit: document.getElementById('trimEntryPriceEdit'),
      originalStopInput: document.getElementById('trimOriginalStopInput'),
      originalStopEdit: document.getElementById('trimOriginalStopEdit'),
      entryDateDisplay: document.getElementById('trimEntryDate'),
      entryDateInput: document.getElementById('trimEntryDateInput'),
      entryDateEdit: document.getElementById('trimEntryDateEdit'),
      targetDisplay: document.getElementById('trimTarget'),
      targetInput: document.getElementById('trimTargetInput'),
      targetEdit: document.getElementById('trimTargetEdit'),
      entryPriceError: document.getElementById('trimEntryPriceError'),
      originalStopError: document.getElementById('trimOriginalStopError'),
      targetError: document.getElementById('trimTargetError'),
      strikeRow: document.getElementById('trimStrikeRow'),
      strikeDisplay: document.getElementById('trimStrike'),
      strikeInput: document.getElementById('trimStrikeInput'),
      strikeEdit: document.getElementById('trimStrikeEdit'),
      strikeError: document.getElementById('trimStrikeError'),
      expirationRow: document.getElementById('trimExpirationRow'),
      expirationDisplay: document.getElementById('trimExpiration'),
      expirationInput: document.getElementById('trimExpirationInput'),
      expirationEdit: document.getElementById('trimExpirationEdit'),
      expirationError: document.getElementById('trimExpirationError')
    };

    // Cache sections for show/hide (done after modal is in DOM)
    this.sections = {};
  }

  cacheSections() {
    // Cache sections dynamically since they need to be in DOM
    const trimSections = Array.from(this.elements.modal?.querySelectorAll('.trim-section') || []);

    // Find section containing R-multiple buttons
    this.sections.rMultiple = trimSections.find(section =>
      section.querySelector('[data-r]')
    );

    // Find section containing trim percentage buttons
    this.sections.trimPercent = trimSections.find(section =>
      section.querySelector('[data-trim]')
    );

    // Find section containing close date
    this.sections.closeDate = trimSections.find(section =>
      section.querySelector('#trimDate')
    );

    // Shares display is inside trim percentage section
    this.sections.sharesDisplay = this.elements.modal?.querySelector('.trim-shares-display');

    // Find section containing new stop
    this.sections.newStop = trimSections.find(section =>
      section.querySelector('#trimNewStop')
    );
  }

  bindEvents() {
    this.elements.closeBtn?.addEventListener('click', () => this.close());
    this.elements.cancelBtn?.addEventListener('click', () => this.close());
    this.elements.overlay?.addEventListener('click', () => this.close());

    // Delete trade button
    this.elements.deleteBtn?.addEventListener('click', () => {
      if (this.currentTrade && window.deleteTrade) {
        window.deleteTrade(this.currentTrade.id);
        this.close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });

    this.elements.modal?.querySelectorAll('[data-r]').forEach(btn => {
      btn.addEventListener('click', (e) => this.selectR(e));
    });

    this.elements.modal?.querySelectorAll('[data-trim]').forEach(btn => {
      btn.addEventListener('click', (e) => this.selectTrimPercent(e));
    });

    this.elements.sharesInput?.addEventListener('input', (e) => this.sanitizeSharesInput(e));
    this.elements.exitPrice?.addEventListener('input', (e) => this.sanitizeExitPriceInput(e));
    this.elements.newStop?.addEventListener('input', (e) => this.sanitizeNewStopInput(e));
    this.elements.entryPriceInput?.addEventListener('input', (e) => this.sanitizeEntryPriceInput(e));
    this.elements.originalStopInput?.addEventListener('input', (e) => this.sanitizeOriginalStopInput(e));
    this.elements.targetInput?.addEventListener('input', (e) => this.sanitizeTargetInput(e));
    this.elements.confirmBtn?.addEventListener('click', () => this.confirm());
    this.elements.onlyMoveStopCheckbox?.addEventListener('change', () => this.handleOnlyMoveStopToggle());
    this.elements.onlyChangeTargetCheckbox?.addEventListener('change', () => this.handleOnlyChangeTargetToggle());
    this.elements.editPositionDetailsBtn?.addEventListener('click', () => this.handleEditPositionDetailsToggle());
  }

  setDefaultDate() {
    if (this.elements.dateInput) {
      const today = getCurrentWeekday();
      const dateString = formatDate(today);

      this.elements.dateInput.value = dateString;

      // If Flatpickr is initialized on this input, update it too
      if (this.elements.dateInput._flatpickr) {
        this.elements.dateInput._flatpickr.setDate(dateString, false);
      }
    }
  }

  open(tradeId) {
    const trade = state.journal.entries.find(e => e.id === tradeId);
    if (!trade) {
      showToast('Trade not found', 'error');
      return;
    }

    this.currentTrade = trade;

    if (trade.originalShares === undefined || trade.originalShares === null) {
      trade.originalShares = trade.shares;
      trade.remainingShares = trade.shares;
      trade.trimHistory = [];
      trade.totalRealizedPnL = 0;
    }

    // Update labels based on asset type
    const isOptions = trade.assetType === 'options';
    if (this.elements.sharesLabel) {
      this.elements.sharesLabel.textContent = isOptions ? 'Contracts' : 'Shares';
    }
    if (this.elements.profitPerShareLabel) {
      this.elements.profitPerShareLabel.textContent = isOptions ? 'Profit per Contract' : 'Profit per Share';
    }

    // Show/hide options fields
    if (this.elements.strikeRow) {
      this.elements.strikeRow.style.display = isOptions ? 'flex' : 'none';
    }
    if (this.elements.expirationRow) {
      this.elements.expirationRow.style.display = isOptions ? 'flex' : 'none';
    }

    this.populateTradeData(trade);
    this.selectedR = 5;
    this.selectedTrimPercent = 100;
    this.setDefaultDate();

    // Cache sections (needs to be done after modal is in DOM)
    this.cacheSections();

    // Reset "Only move stop" checkbox
    if (this.elements.onlyMoveStopCheckbox) {
      this.elements.onlyMoveStopCheckbox.checked = false;
    }

    // Reset "Only change target" checkbox
    if (this.elements.onlyChangeTargetCheckbox) {
      this.elements.onlyChangeTargetCheckbox.checked = false;
    }

    // Reset edit mode
    this.isEditMode = false;
    if (this.elements.editPositionDetailsBtn) {
      this.elements.editPositionDetailsBtn.textContent = 'Edit position details';
    }

    this.showAllSections();
    this.showDisplayValues();

    this.elements.modal?.querySelectorAll('[data-r]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.r) === this.selectedR);
    });
    this.elements.modal?.querySelectorAll('[data-trim]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.trim) === this.selectedTrimPercent);
    });

    this.calculateExitPrice();
    this.calculateShares();
    this.calculatePreview();

    this.elements.modal?.classList.add('open');
    this.elements.overlay?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.elements.modal?.classList.remove('open');
    this.elements.overlay?.classList.remove('open');
    document.body.style.overflow = '';
    this.currentTrade = null;
  }

  isOpen() {
    return this.elements.modal?.classList.contains('open') ?? false;
  }

  populateTradeData(trade) {
    const remainingShares = trade.remainingShares ?? trade.shares;
    const originalStop = trade.originalStop ?? trade.stop;
    const currentStop = trade.currentStop ?? trade.stop;
    const riskPerShare = trade.entry - originalStop;

    if (this.elements.ticker) this.elements.ticker.textContent = trade.ticker;
    if (this.elements.entryPrice) this.elements.entryPrice.textContent = formatCurrency(trade.entry);
    if (this.elements.originalStop) this.elements.originalStop.textContent = formatCurrency(originalStop);
    if (this.elements.stopLoss) this.elements.stopLoss.textContent = formatCurrency(currentStop);
    if (this.elements.riskPerShare) this.elements.riskPerShare.textContent = formatCurrency(riskPerShare);
    if (this.elements.remainingShares) this.elements.remainingShares.textContent = formatNumber(remainingShares);

    // Populate entry date display and input
    let entryDate = null;
    if (trade.timestamp) {
      entryDate = new Date(trade.timestamp);
    } else if (trade.date) {
      // Fallback to date field if timestamp doesn't exist
      entryDate = new Date(trade.date);
    } else {
      // Last resort: use current date
      entryDate = new Date();
    }

    const formattedDate = entryDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    if (this.elements.entryDateDisplay) {
      this.elements.entryDateDisplay.textContent = formattedDate;
    }

    if (this.elements.entryDateInput) {
      // Format for date input (YYYY-MM-DD)
      const dateString = entryDate.toISOString().split('T')[0];
      this.elements.entryDateInput.value = dateString;

      // If Flatpickr is initialized on this input, update it
      if (this.elements.entryDateInput._flatpickr) {
        this.elements.entryDateInput._flatpickr.setDate(dateString, false);
      }
    }

    // Populate edit input fields
    if (this.elements.entryPriceInput) this.elements.entryPriceInput.value = trade.entry.toFixed(2);
    if (this.elements.originalStopInput) this.elements.originalStopInput.value = originalStop.toFixed(2);

    // Populate target display and input
    // Use trade.target if set, otherwise default to 5R (match position card logic)
    const targetPrice = trade.target || (trade.entry + (riskPerShare * 5));
    if (this.elements.targetDisplay) {
      this.elements.targetDisplay.textContent = formatCurrency(targetPrice);
    }
    if (this.elements.targetInput) {
      this.elements.targetInput.value = targetPrice.toFixed(2);
    }

    // Populate strike and expiration for options
    if (trade.assetType === 'options') {
      if (this.elements.strikeDisplay) {
        this.elements.strikeDisplay.textContent = trade.strike ? formatCurrency(trade.strike) : '$0.00';
      }
      if (this.elements.strikeInput) {
        this.elements.strikeInput.value = trade.strike ? trade.strike.toFixed(2) : '';
      }

      if (this.elements.expirationDisplay && trade.expirationDate) {
        const expDate = new Date(trade.expirationDate + 'T00:00:00');
        const formattedExp = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        this.elements.expirationDisplay.textContent = formattedExp;
      }
      if (this.elements.expirationInput && trade.expirationDate) {
        this.elements.expirationInput.value = trade.expirationDate;
      }
    }

    // Clear new stop input
    if (this.elements.newStop) this.elements.newStop.value = '';
  }

  selectR(e) {
    const btn = e.target.closest('[data-r]');
    if (!btn) return;

    this.selectedR = parseInt(btn.dataset.r);
    this.elements.modal?.querySelectorAll('[data-r]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    this.calculateExitPrice();
    this.calculatePreview();
  }

  setTrimPercent(percent) {
    this.selectedTrimPercent = percent;

    // Update trim preset button states
    this.elements.modal?.querySelectorAll('[data-trim]').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.trim) === percent);
    });

    // Update shares input and percentage display
    this.calculateShares();
  }

  selectTrimPercent(e) {
    const btn = e.target.closest('[data-trim]');
    if (!btn) return;

    this.selectedTrimPercent = parseInt(btn.dataset.trim);
    this.elements.modal?.querySelectorAll('[data-trim]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    this.calculateShares();
    this.calculatePreview();
  }

  handleManualExitPrice() {
    const exitPrice = parseFloat(this.elements.exitPrice?.value);
    if (!this.currentTrade || isNaN(exitPrice)) return;

    // Use originalStop for R-multiple calculation
    const originalStop = this.currentTrade.originalStop ?? this.currentTrade.stop;
    const riskPerShare = this.currentTrade.entry - originalStop;
    const rMultiple = riskPerShare !== 0 ? (exitPrice - this.currentTrade.entry) / riskPerShare : 0;

    if (this.elements.rDisplay) {
      this.elements.rDisplay.textContent = `(${rMultiple.toFixed(1)}R)`;
      this.elements.rDisplay.classList.toggle('negative', rMultiple < 0);
    }

    // Check if exit price matches any R-multiple button
    let matchingRButton = null;
    this.elements.modal?.querySelectorAll('[data-r]').forEach(btn => {
      const r = parseInt(btn.dataset.r);
      const expectedPrice = this.currentTrade.entry + (r * riskPerShare);
      // Match if within 0.01 of expected price
      if (Math.abs(exitPrice - expectedPrice) < 0.01) {
        matchingRButton = btn;
        this.selectedR = r;
      }
    });

    // Update button states
    this.elements.modal?.querySelectorAll('[data-r]').forEach(btn => {
      btn.classList.toggle('active', btn === matchingRButton);
    });

    this.calculatePreview();
  }

  calculateShares() {
    if (!this.currentTrade) return;

    const remainingShares = this.currentTrade.remainingShares ?? this.currentTrade.shares;
    const sharesToClose = Math.ceil(remainingShares * (this.selectedTrimPercent / 100));

    if (this.elements.sharesInput) {
      this.elements.sharesInput.value = sharesToClose;
    }

    if (this.elements.percentDisplay) {
      const actualPercent = Math.round((sharesToClose / remainingShares) * 100);
      this.elements.percentDisplay.textContent = `(${actualPercent}%)`;
    }
  }

  handleManualShares() {
    const shares = parseInt(this.elements.sharesInput?.value);
    if (!this.currentTrade || isNaN(shares) || shares <= 0) return;

    const remainingShares = this.currentTrade.remainingShares ?? this.currentTrade.shares;
    const percent = (shares / remainingShares) * 100;

    // Update percentage display (no decimals)
    if (this.elements.percentDisplay) {
      this.elements.percentDisplay.textContent = `(${Math.round(percent)}%)`;
    }

    // Check if shares match any preset percentage button
    let matchingButton = null;
    this.elements.modal?.querySelectorAll('[data-trim]').forEach(btn => {
      const presetPercent = parseInt(btn.dataset.trim);
      const expectedShares = Math.ceil(remainingShares * (presetPercent / 100));
      if (shares === expectedShares) {
        matchingButton = btn;
        this.selectedTrimPercent = presetPercent;
      }
    });

    // Update button states
    this.elements.modal?.querySelectorAll('[data-trim]').forEach(btn => {
      btn.classList.toggle('active', btn === matchingButton);
    });

    // If no match, store the custom percentage
    if (!matchingButton) {
      this.selectedTrimPercent = percent;
    }

    this.calculatePreview();
  }

  calculateExitPrice() {
    if (!this.currentTrade) return;

    // Use originalStop for R-multiple calculation
    const originalStop = this.currentTrade.originalStop ?? this.currentTrade.stop;
    const riskPerShare = this.currentTrade.entry - originalStop;
    const exitPrice = this.currentTrade.entry + (this.selectedR * riskPerShare);

    if (this.elements.exitPrice) this.elements.exitPrice.value = exitPrice.toFixed(2);
    if (this.elements.rDisplay) {
      this.elements.rDisplay.textContent = `(${this.selectedR}R)`;
      this.elements.rDisplay.classList.remove('negative');
    }
  }

  calculatePreview() {
    if (!this.currentTrade) return;

    const exitPrice = parseFloat(this.elements.exitPrice?.value) || 0;
    const remainingShares = this.currentTrade.remainingShares ?? this.currentTrade.shares;

    // Get shares from input, or calculate from percentage if input is empty
    let sharesToClose;
    if (this.elements.sharesInput?.value) {
      sharesToClose = parseInt(this.elements.sharesInput.value) || 0;
    } else {
      sharesToClose = Math.ceil(remainingShares * (this.selectedTrimPercent / 100));
    }

    const sharesRemaining = remainingShares - sharesToClose;

    const profitPerShare = exitPrice - this.currentTrade.entry;
    const totalPnL = profitPerShare * sharesToClose;
    const isProfit = totalPnL >= 0;

    if (this.elements.profitPerShare) {
      this.elements.profitPerShare.textContent = `${isProfit ? '+' : ''}${formatCurrency(profitPerShare)}`;
      this.elements.profitPerShare.className = `trim-preview__value ${isProfit ? 'text-success' : 'text-danger'}`;
    }
    if (this.elements.totalPnL) {
      this.elements.totalPnL.textContent = `${isProfit ? '+' : ''}${formatCurrency(totalPnL)}`;
      this.elements.totalPnL.className = `trim-preview__value ${isProfit ? 'text-success' : 'text-danger'}`;
    }
    if (this.elements.preview) this.elements.preview.classList.toggle('negative', !isProfit);

    // Update confirm button text based on full close vs trim
    if (this.elements.confirmBtn) {
      const isFullClose = sharesRemaining === 0;
      this.elements.confirmBtn.textContent = isFullClose ? 'Confirm Close' : 'Confirm Trim';
    }
  }

  handleOnlyMoveStopToggle() {
    const isChecked = this.elements.onlyMoveStopCheckbox?.checked;

    if (isChecked) {
      this.hideClosingFields();
      // Update button text
      if (this.elements.confirmBtn) {
        this.elements.confirmBtn.textContent = 'Confirm Move Stop';
      }
      // Hide "(optional)" text since new stop is required
      if (this.elements.newStopOptional) {
        this.elements.newStopOptional.style.display = 'none';
      }
    } else {
      this.showAllSections();
      // Recalculate preview to restore button text
      this.calculatePreview();
      // Show "(optional)" text
      if (this.elements.newStopOptional) {
        this.elements.newStopOptional.style.display = '';
      }
    }
  }

  handleOnlyChangeTargetToggle() {
    const isChecked = this.elements.onlyChangeTargetCheckbox?.checked;

    if (isChecked) {
      // Hide trim percentage, close date, new stop, shares display, and P&L preview
      // Keep R-multiple and exit price visible for target selection
      if (this.sections.trimPercent) {
        this.sections.trimPercent.style.display = 'none';
      }
      if (this.sections.closeDate) {
        this.sections.closeDate.style.display = 'none';
      }
      if (this.sections.newStop) {
        this.sections.newStop.style.display = 'none';
      }
      if (this.elements.preview) {
        this.elements.preview.style.display = 'none';
      }

      // Update button text
      if (this.elements.confirmBtn) {
        this.elements.confirmBtn.textContent = 'Confirm Target Change';
      }
    } else {
      this.showAllSections();
      // Recalculate preview to restore button text
      this.calculatePreview();
    }
  }

  hideClosingFields() {
    // Hide R-Multiple section
    if (this.sections.rMultiple) {
      this.sections.rMultiple.style.display = 'none';
    }

    // Hide Trim Percentage section
    if (this.sections.trimPercent) {
      this.sections.trimPercent.style.display = 'none';
    }

    // Hide Close Date section
    if (this.sections.closeDate) {
      this.sections.closeDate.style.display = 'none';
    }

    // Hide shares display
    if (this.sections.sharesDisplay) {
      this.sections.sharesDisplay.style.display = 'none';
    }

    // Hide P&L preview
    if (this.elements.preview) {
      this.elements.preview.style.display = 'none';
    }
  }

  showAllSections() {
    // Show R-Multiple section
    if (this.sections.rMultiple) {
      this.sections.rMultiple.style.display = '';
    }

    // Show Trim Percentage section
    if (this.sections.trimPercent) {
      this.sections.trimPercent.style.display = '';
    }

    // Show Close Date section
    if (this.sections.closeDate) {
      this.sections.closeDate.style.display = '';
    }

    // Show New Stop section
    if (this.sections.newStop) {
      this.sections.newStop.style.display = '';
    }

    // Show shares display
    if (this.sections.sharesDisplay) {
      this.sections.sharesDisplay.style.display = '';
    }

    // Show P&L preview
    if (this.elements.preview) {
      this.elements.preview.style.display = '';
    }
  }

  showDisplayValues() {
    // Show display values, hide input fields
    const displayElements = this.elements.modal?.querySelectorAll('.trim-summary__value--display');
    displayElements?.forEach(el => el.style.display = '');

    const editElements = this.elements.modal?.querySelectorAll('.trim-summary__value--edit');
    editElements?.forEach(el => el.style.display = 'none');
  }

  showEditInputs() {
    // Hide display values, show input fields
    const displayElements = this.elements.modal?.querySelectorAll('.trim-summary__value--display');
    displayElements?.forEach(el => el.style.display = 'none');

    const editElements = this.elements.modal?.querySelectorAll('.trim-summary__value--edit');
    editElements?.forEach(el => el.style.display = '');
  }

  handleEditPositionDetailsToggle() {
    // Toggle edit mode
    this.isEditMode = !this.isEditMode;

    // Clear all errors when toggling modes
    this.clearInputError(this.elements.entryPriceInput, this.elements.entryPriceError);
    this.clearInputError(this.elements.originalStopInput, this.elements.originalStopError);
    this.clearInputError(this.elements.targetInput, this.elements.targetError);
    this.clearInputError(this.elements.exitPrice, this.elements.exitPriceError);
    this.clearInputError(this.elements.sharesInput, this.elements.sharesError);
    this.clearInputError(this.elements.newStop, this.elements.newStopError);

    if (this.isEditMode) {
      // Edit mode: Show inputs, hide all trim/close sections
      this.showEditInputs();
      this.hideClosingFields();

      // Also hide the "new stop" section
      const newStopSection = this.elements.modal?.querySelector('.trim-section:has(#trimNewStop)');
      if (newStopSection) {
        newStopSection.style.display = 'none';
      }

      // Update buttons
      if (this.elements.editPositionDetailsBtn) {
        this.elements.editPositionDetailsBtn.textContent = 'Cancel';
      }
      if (this.elements.confirmBtn) {
        this.elements.confirmBtn.textContent = 'Confirm';
      }
    } else {
      // Normal mode: Show display values, show all sections
      this.showDisplayValues();

      // Check if "only move stop" is checked - if so, keep fields hidden
      const isOnlyMoveStop = this.elements.onlyMoveStopCheckbox?.checked;
      if (isOnlyMoveStop) {
        this.hideClosingFields();
        // Update button text for "only move stop" mode
        if (this.elements.confirmBtn) {
          this.elements.confirmBtn.textContent = 'Confirm Move Stop';
        }
        // Hide "(optional)" text since new stop is required
        if (this.elements.newStopOptional) {
          this.elements.newStopOptional.style.display = 'none';
        }
      } else {
        this.showAllSections();
        // Recalculate preview to restore button text
        this.calculatePreview();
      }

      // Show the "new stop" section
      const newStopSection = this.elements.modal?.querySelector('.trim-section:has(#trimNewStop)');
      if (newStopSection) {
        newStopSection.style.display = '';
      }

      // Update buttons
      if (this.elements.editPositionDetailsBtn) {
        this.elements.editPositionDetailsBtn.textContent = 'Edit position details';
      }
    }
  }

  confirm() {
    if (!this.currentTrade) return;

    // Check if "Edit position details" mode is active
    if (this.isEditMode) {
      // Clear all errors first
      this.clearInputError(this.elements.entryPriceInput, this.elements.entryPriceError);
      this.clearInputError(this.elements.originalStopInput, this.elements.originalStopError);
      this.clearInputError(this.elements.targetInput, this.elements.targetError);
      this.clearInputError(this.elements.strikeInput, this.elements.strikeError);
      this.clearInputError(this.elements.expirationInput, this.elements.expirationError);

      // Edit position details mode - update entry, original stop, and target
      const newEntry = parseFloat(this.elements.entryPriceInput?.value);
      const newOriginalStop = parseFloat(this.elements.originalStopInput?.value);
      const newEntryDate = this.elements.entryDateInput?.value;
      const newTarget = parseFloat(this.elements.targetInput?.value);
      const newStrike = this.currentTrade.assetType === 'options' ? parseFloat(this.elements.strikeInput?.value) : null;
      const newExpiration = this.currentTrade.assetType === 'options' ? this.elements.expirationInput?.value : null;

      if (isNaN(newEntry) || newEntry <= 0) {
        this.showInputError(
          this.elements.entryPriceInput,
          this.elements.entryPriceError,
          'Entry price must be greater than 0'
        );
        return;
      }

      if (isNaN(newOriginalStop) || newOriginalStop <= 0) {
        this.showInputError(
          this.elements.originalStopInput,
          this.elements.originalStopError,
          'Original stop must be greater than 0'
        );
        return;
      }

      if (!newEntryDate) {
        showToast('Please enter a valid entry date', 'error');
        return;
      }

      // Target is optional, but if provided must be valid
      if (this.elements.targetInput?.value && (isNaN(newTarget) || newTarget <= 0)) {
        this.showInputError(
          this.elements.targetInput,
          this.elements.targetError,
          'Target price must be greater than 0'
        );
        return;
      }

      // Ensure target is greater than entry
      if (this.elements.targetInput?.value && !isNaN(newTarget) && newTarget <= newEntry) {
        this.showInputError(
          this.elements.targetInput,
          this.elements.targetError,
          'Target price must be greater than entry price'
        );
        return;
      }

      // Validate options fields
      if (this.currentTrade.assetType === 'options') {
        if (isNaN(newStrike) || newStrike <= 0) {
          this.showInputError(
            this.elements.strikeInput,
            this.elements.strikeError,
            'Strike price must be greater than 0'
          );
          return;
        }

        if (!newExpiration) {
          this.showInputError(
            this.elements.expirationInput,
            this.elements.expirationError,
            'Expiration date is required'
          );
          return;
        }

        // Validate expiration is on or after trade date
        const tradeDate = new Date(newEntryDate + 'T00:00:00');
        const expirationDate = new Date(newExpiration + 'T00:00:00');
        if (expirationDate < tradeDate) {
          this.showInputError(
            this.elements.expirationInput,
            this.elements.expirationError,
            'Expiration date cannot be before trade date'
          );
          return;
        }
      }

      const oldEntry = this.currentTrade.entry;
      const oldOriginalStop = this.currentTrade.originalStop ?? this.currentTrade.stop;

      // Build updates object
      const updates = {
        entry: newEntry,
        originalStop: newOriginalStop,
        timestamp: new Date(newEntryDate + 'T12:00:00').toISOString()
      };

      // Add target if provided
      if (!isNaN(newTarget) && newTarget > 0) {
        updates.target = newTarget;
      }

      // Add options fields if options trade
      if (this.currentTrade.assetType === 'options') {
        updates.strike = newStrike;
        updates.expirationDate = newExpiration;
      }

      // If there's existing trim history, recalculate P&L for each trim
      if (this.currentTrade.trimHistory && this.currentTrade.trimHistory.length > 0) {
        const updatedTrimHistory = this.currentTrade.trimHistory.map(trim => {
          // Recalculate P&L based on new entry (with options multiplier)
          const multiplier = this.currentTrade.assetType === 'options' ? 100 : 1;
          const newPnl = (trim.exitPrice - newEntry) * trim.shares * multiplier;
          // Recalculate R-multiple based on new original stop
          const newRiskPerShare = newEntry - newOriginalStop;
          const newRMultiple = newRiskPerShare !== 0 ? (trim.exitPrice - newEntry) / newRiskPerShare : 0;

          return {
            ...trim,
            pnl: newPnl,
            rMultiple: newRMultiple
          };
        });

        updates.trimHistory = updatedTrimHistory;

        // Recalculate total realized P&L
        const newTotalRealizedPnL = updatedTrimHistory.reduce((sum, trim) => sum + trim.pnl, 0);
        updates.totalRealizedPnL = newTotalRealizedPnL;

        // If position is closed, update the final P&L
        if (this.currentTrade.status === 'closed') {
          updates.pnl = newTotalRealizedPnL;
        }
      }

      // Update the trade
      state.updateJournalEntry(this.currentTrade.id, updates);

      // Trade update triggers cache invalidation, emit event with computed value
      state.emit('accountSizeChanged', state.currentSize);

      showToast(
        `✅ ${this.currentTrade.ticker} position details updated`,
        'success'
      );

      this.close();
      return;
    }

    // Check if "Only move stop" mode is active
    const isOnlyMoveStop = this.elements.onlyMoveStopCheckbox?.checked;

    if (isOnlyMoveStop) {
      // Only move stop mode - no shares closed
      const newStopValue = parseFloat(this.elements.newStop?.value);
      if (isNaN(newStopValue) || newStopValue <= 0) {
        showToast('Enter a new stop', 'error');
        return;
      }

      // Update only the stop, no trimming
      const updates = {
        currentStop: newStopValue,
        stop: newStopValue
      };

      state.updateJournalEntry(this.currentTrade.id, updates);
      showToast(`${this.currentTrade.ticker} stop moved to ${formatCurrency(newStopValue)}`, 'success');
      this.close();
      return;
    }

    // Check if "Only change target" mode is active
    const isOnlyChangeTarget = this.elements.onlyChangeTargetCheckbox?.checked;

    if (isOnlyChangeTarget) {
      // Only change target mode - update target without closing shares
      const exitPrice = parseFloat(this.elements.exitPrice?.value);
      if (isNaN(exitPrice) || exitPrice <= 0) {
        this.showInputError(
          this.elements.exitPrice,
          this.elements.exitPriceError,
          'Exit price must be a valid number greater than 0'
        );
        return;
      }

      // Update only the target
      const updates = {
        target: exitPrice
      };

      state.updateJournalEntry(this.currentTrade.id, updates);
      showToast(`${this.currentTrade.ticker} target updated to ${formatCurrency(exitPrice)}`, 'success');
      this.close();
      return;
    }

    // Normal trim/close mode
    const exitPrice = parseFloat(this.elements.exitPrice?.value);
    if (isNaN(exitPrice) || exitPrice <= 0) {
      this.showInputError(
        this.elements.exitPrice,
        this.elements.exitPriceError,
        'Exit price must be a valid number greater than 0'
      );
      return;
    }

    const remainingShares = this.currentTrade.remainingShares ?? this.currentTrade.shares;

    // Get shares from input, or calculate from percentage if input is empty
    let sharesToClose;
    if (this.elements.sharesInput?.value) {
      sharesToClose = parseInt(this.elements.sharesInput.value) || 0;
    } else {
      sharesToClose = Math.ceil(remainingShares * (this.selectedTrimPercent / 100));
    }

    if (sharesToClose <= 0) {
      showToast('No shares to close', 'error');
      return;
    }

    const sharesAfterTrim = remainingShares - sharesToClose;
    // Use originalStop for R-multiple calculation
    const originalStop = this.currentTrade.originalStop ?? this.currentTrade.stop;
    const riskPerShare = this.currentTrade.entry - originalStop;
    const rMultiple = riskPerShare !== 0 ? (exitPrice - this.currentTrade.entry) / riskPerShare : 0;

    // For options, multiply by 100 (contract multiplier)
    const multiplier = this.currentTrade.assetType === 'options' ? 100 : 1;
    const pnl = (exitPrice - this.currentTrade.entry) * sharesToClose * multiplier;

    const closeDate = this.elements.dateInput?.value
      ? new Date(this.elements.dateInput.value + 'T12:00:00').toISOString()
      : new Date().toISOString();

    // Calculate actual percentage trimmed based on shares
    const actualPercentTrimmed = (sharesToClose / remainingShares) * 100;

    const trimEvent = {
      id: Date.now(),
      date: closeDate,
      shares: sharesToClose,
      exitPrice: exitPrice,
      rMultiple: rMultiple,
      pnl: pnl,
      percentTrimmed: Math.round(actualPercentTrimmed)
    };

    if (!this.currentTrade.trimHistory) this.currentTrade.trimHistory = [];

    const isFullClose = sharesAfterTrim === 0;
    const newStatus = isFullClose ? 'closed' : 'trimmed';
    const existingPnL = this.currentTrade.totalRealizedPnL || 0;
    const newTotalPnL = existingPnL + pnl;

    const updates = {
      originalShares: this.currentTrade.originalShares ?? this.currentTrade.shares,
      originalStop: this.currentTrade.originalStop ?? this.currentTrade.stop,
      remainingShares: sharesAfterTrim,
      status: newStatus,
      trimHistory: [...this.currentTrade.trimHistory, trimEvent],
      totalRealizedPnL: newTotalPnL
    };

    // Update current stop if new stop provided
    const newStopValue = parseFloat(this.elements.newStop?.value);
    if (!isNaN(newStopValue) && newStopValue > 0) {
      updates.currentStop = newStopValue;
      updates.stop = newStopValue; // Also update main stop for compatibility
    }

    if (isFullClose) {
      updates.exitPrice = exitPrice;
      updates.exitDate = closeDate;
      updates.pnl = newTotalPnL;
    }

    state.updateJournalEntry(this.currentTrade.id, updates);

    // Trade update triggers cache invalidation, emit event with computed value
    state.emit('accountSizeChanged', state.currentSize);

    const actionText = isFullClose ? 'closed' : `trimmed ${Math.round(actualPercentTrimmed)}%`;
    showToast(
      `${this.currentTrade.ticker} ${actionText}: ${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`,
      pnl >= 0 ? 'success' : 'warning'
    );

    this.close();
  }

  showInputError(inputElement, errorElement, message) {
    // Add error class to input
    if (inputElement) {
      inputElement.classList.add('input--error');
    }

    // Show error message
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('input-error--visible');
    }

    // Focus the input
    if (inputElement) {
      inputElement.focus();
    }
  }

  clearInputError(inputElement, errorElement) {
    // Remove error class from input
    if (inputElement) {
      inputElement.classList.remove('input--error');
    }

    // Hide error message
    if (errorElement) {
      errorElement.classList.remove('input-error--visible');
      errorElement.textContent = '';
    }
  }

  sanitizeDecimalInput(e) {
    const input = e.target;
    let value = input.value;

    // Allow only numbers and one decimal point
    // Remove any character that's not a digit or decimal point
    value = value.replace(/[^\d.]/g, '');

    // Allow only one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }

    // Update input value with sanitized version
    input.value = value;
  }

  sanitizeExitPriceInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.exitPrice, this.elements.exitPriceError);

    // Validate exit price if value is provided
    const value = this.elements.exitPrice?.value.trim();
    if (value) {
      const exitPrice = parseFloat(value);
      if (!isNaN(exitPrice) && exitPrice <= 0) {
        this.showInputError(
          this.elements.exitPrice,
          this.elements.exitPriceError,
          'Exit price must be greater than 0'
        );
        return; // Don't call handler if there's an error
      }
    }

    // Call the manual exit price handler
    this.handleManualExitPrice();
  }

  sanitizeNewStopInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.newStop, this.elements.newStopError);

    // Validate new stop if value is provided
    const value = this.elements.newStop?.value.trim();
    if (value) {
      const newStop = parseFloat(value);
      if (!isNaN(newStop) && newStop <= 0) {
        this.showInputError(
          this.elements.newStop,
          this.elements.newStopError,
          'New stop must be greater than 0'
        );
      }
    }
  }

  sanitizeEntryPriceInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.entryPriceInput, this.elements.entryPriceError);

    // Validate entry price if value is provided
    const value = this.elements.entryPriceInput?.value.trim();
    if (value) {
      const entryPrice = parseFloat(value);
      if (!isNaN(entryPrice) && entryPrice <= 0) {
        this.showInputError(
          this.elements.entryPriceInput,
          this.elements.entryPriceError,
          'Entry price must be greater than 0'
        );
      }
    }
  }

  sanitizeOriginalStopInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.originalStopInput, this.elements.originalStopError);

    // Validate original stop if value is provided
    const value = this.elements.originalStopInput?.value.trim();
    if (value) {
      const originalStop = parseFloat(value);
      if (!isNaN(originalStop) && originalStop <= 0) {
        this.showInputError(
          this.elements.originalStopInput,
          this.elements.originalStopError,
          'Original stop must be greater than 0'
        );
      }
    }
  }

  sanitizeTargetInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.targetInput, this.elements.targetError);

    // Validate target if value is provided
    const value = this.elements.targetInput?.value.trim();
    if (value) {
      const target = parseFloat(value);

      // Check if target > 0
      if (!isNaN(target) && target <= 0) {
        this.showInputError(
          this.elements.targetInput,
          this.elements.targetError,
          'Target price must be greater than 0'
        );
        return;
      }

      // Check if target > entry price
      const entryValue = this.elements.entryPriceInput?.value.trim();
      if (entryValue) {
        const entryPrice = parseFloat(entryValue);
        if (!isNaN(target) && !isNaN(entryPrice) && target <= entryPrice) {
          this.showInputError(
            this.elements.targetInput,
            this.elements.targetError,
            'Target price must be greater than entry price'
          );
        }
      }
    }
  }

  sanitizeSharesInput(e) {
    const input = e.target;
    let value = input.value;

    // Allow only integers (no decimals)
    // Remove any character that's not a digit
    value = value.replace(/[^\d]/g, '');

    // Update input value with sanitized version
    input.value = value;

    // Clear any existing error first
    this.clearInputError(this.elements.sharesInput, this.elements.sharesError);

    // Validate shares if value is provided
    if (this.currentTrade && value) {
      const shares = parseInt(value);
      const remainingShares = this.currentTrade.remainingShares ?? this.currentTrade.shares;

      // Check if shares is greater than 0
      if (!isNaN(shares) && shares <= 0) {
        this.showInputError(
          this.elements.sharesInput,
          this.elements.sharesError,
          'Shares must be greater than 0'
        );
        return; // Don't call handleManualShares if there's an error
      }

      // Check if shares exceed remaining shares
      if (!isNaN(shares) && shares > remainingShares) {
        this.showInputError(
          this.elements.sharesInput,
          this.elements.sharesError,
          `Exceeds ${remainingShares} remaining share(s)`
        );
        return; // Don't call handleManualShares if there's an error
      }
    }

    // Call the manual shares handler
    this.handleManualShares();
  }

}

export const trimModal = new TrimModal();
