/**
 * TrimModal - Handles partial position exits (trimming trades)
 */

import { state } from '../../core/state.js';
import { formatCurrency, formatNumber, initFlatpickr, getCurrentWeekday } from '../../core/utils.js';
import { formatDate } from '../../utils/marketHours.js';
import { showToast } from '../ui/ui.js';
import { getAssetMultiplier } from '../../utils/assetTypeUtils.js';

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
    // Expiration date: Match log trade popup - disable weekends, allow past/future dates
    if (this.elements.expirationInput) {
      initFlatpickr(this.elements.expirationInput, {
        minDate: null,  // Allow past dates
        maxDate: null   // Allow future dates
        // Keep default disable option (weekends disabled)
      });
    }
  }

  cacheElements() {
    this.elements = {
      modal: document.getElementById('trimModal'),
      overlay: document.getElementById('trimModalOverlay'),
      closeBtn: document.getElementById('closeTrimModalBtn'),
      cancelBtn: document.getElementById('cancelTrimBtn'),
      confirmBtn: document.getElementById('confirmTrimBtn'),
      deleteBtn: document.getElementById('deleteTrimTradeBtn'),
      modalSpacer: document.getElementById('trimModalSpacer'),
      modalSpacerRight: document.getElementById('trimModalSpacerRight'),
      ticker: document.getElementById('trimModalTicker'),
      entryPrice: document.getElementById('trimEntryPrice'),
      originalStop: document.getElementById('trimOriginalStop'),
      stopLoss: document.getElementById('trimStopLoss'),
      stopLossInput: document.getElementById('trimStopLossInput'),
      stopLossEdit: document.getElementById('trimStopLossEdit'),
      stopLossError: document.getElementById('trimStopLossError'),
      remainingShares: document.getElementById('trimRemainingShares'),
      remainingSharesRow: document.getElementById('trimRemainingSharesRow'),
      exitPrice: document.getElementById('trimExitPrice'),
      rDisplay: document.getElementById('trimRDisplay'),
      exitPriceError: document.getElementById('trimExitPriceError'),
      sharesInput: document.getElementById('trimSharesInput'),
      sharesLabel: document.querySelector('label[for="trimSharesInput"]'),
      percentDisplay: document.getElementById('trimPercentDisplay'),
      sharesError: document.getElementById('trimSharesError'),
      dateInput: document.getElementById('trimDate'),
      totalPnL: document.getElementById('trimTotalPnL'),
      preview: document.getElementById('trimPreview'),
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
      targetRow: document.getElementById('trimTargetRow'),
      trimSummary: document.querySelector('.trim-summary'),
      modalContent: document.querySelector('#trimModal .modal__content'),
      modalFooter: document.querySelector('#trimModal .modal__footer'),
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
  }

  bindEvents() {
    this.elements.closeBtn?.addEventListener('click', () => this.close());
    this.elements.cancelBtn?.addEventListener('click', () => this.handleCancel());
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
    this.elements.entryPriceInput?.addEventListener('input', (e) => this.sanitizeEntryPriceInput(e));
    this.elements.originalStopInput?.addEventListener('input', (e) => this.sanitizeOriginalStopInput(e));
    this.elements.stopLossInput?.addEventListener('input', (e) => this.sanitizeStopLossInput(e));
    this.elements.targetInput?.addEventListener('input', (e) => this.sanitizeTargetInput(e));
    this.elements.strikeInput?.addEventListener('input', (e) => this.sanitizeStrikeInput(e));
    this.elements.expirationInput?.addEventListener('change', () => this.validateExpirationDate());
    this.elements.entryDateInput?.addEventListener('change', () => this.validateExpirationDate());
    this.elements.confirmBtn?.addEventListener('click', () => this.confirm());
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

    // Reset edit mode
    this.isEditMode = false;
    if (this.elements.editPositionDetailsBtn) {
      this.elements.editPositionDetailsBtn.textContent = 'Edit position details';
    }

    // In normal mode, hide Cancel button and left spacer, show Delete button and right spacer
    if (this.elements.cancelBtn) {
      this.elements.cancelBtn.style.display = 'none';
    }
    if (this.elements.modalSpacer) {
      this.elements.modalSpacer.style.display = 'none';
    }
    if (this.elements.deleteBtn) {
      this.elements.deleteBtn.style.display = '';
    }
    if (this.elements.modalSpacerRight) {
      this.elements.modalSpacerRight.style.display = '';
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
    // If in edit mode, exit it first to restore UI state
    if (this.isEditMode) {
      this.isEditMode = false;

      // Restore all UI elements
      this.showDisplayValues();
      this.showAllSections();

      if (this.elements.remainingSharesRow) {
        this.elements.remainingSharesRow.style.display = '';
      }

      if (this.elements.targetRow) {
        this.elements.targetRow.style.paddingBottom = '';
        this.elements.targetRow.style.marginBottom = '';
      }

      if (this.elements.trimSummary) {
        this.elements.trimSummary.style.paddingBottom = '40px';
      }

      if (this.elements.modalContent) {
        this.elements.modalContent.style.paddingBottom = '';
      }
      if (this.elements.modalFooter) {
        this.elements.modalFooter.style.paddingTop = '';
      }

      if (this.elements.editPositionDetailsBtn) {
        this.elements.editPositionDetailsBtn.style.display = '';
      }
      if (this.elements.deleteBtn) {
        this.elements.deleteBtn.style.display = '';
      }
    }

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
    if (this.elements.stopLossInput) this.elements.stopLossInput.value = currentStop.toFixed(2);

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
        // Use Flatpickr's setDate method to properly populate the date picker
        if (this.elements.expirationInput._flatpickr) {
          this.elements.expirationInput._flatpickr.setDate(trade.expirationDate, false);
        } else {
          this.elements.expirationInput.value = trade.expirationDate;
        }
      }
    }
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

    // For options, multiply by 100 (contract multiplier)
    const multiplier = getAssetMultiplier(this.currentTrade.assetType);
    const profitPerShare = (exitPrice - this.currentTrade.entry) * multiplier;
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

  handleCancel() {
    // If in edit mode, exit edit mode instead of closing modal
    if (this.isEditMode) {
      this.handleEditPositionDetailsToggle();
    } else {
      this.close();
    }
  }

  handleEditPositionDetailsToggle() {
    // Toggle edit mode
    this.isEditMode = !this.isEditMode;

    // Clear all errors when toggling modes
    this.clearInputError(this.elements.entryPriceInput, this.elements.entryPriceError);
    this.clearInputError(this.elements.originalStopInput, this.elements.originalStopError);
    this.clearInputError(this.elements.stopLossInput, this.elements.stopLossError);
    this.clearInputError(this.elements.targetInput, this.elements.targetError);
    this.clearInputError(this.elements.strikeInput, this.elements.strikeError);
    this.clearInputError(this.elements.expirationInput, this.elements.expirationError);
    this.clearInputError(this.elements.exitPrice, this.elements.exitPriceError);
    this.clearInputError(this.elements.sharesInput, this.elements.sharesError);

    if (this.isEditMode) {
      // Edit mode: Ensure inputs have current trade values before showing them
      if (this.currentTrade) {
        this.populateTradeData(this.currentTrade);
      }

      // Show inputs, hide all trim/close sections
      this.showEditInputs();
      this.hideClosingFields();

      // Hide remaining shares row in edit mode
      if (this.elements.remainingSharesRow) {
        this.elements.remainingSharesRow.style.display = 'none';
      }

      // Reduce bottom padding on target row in edit mode to match top
      if (this.elements.targetRow) {
        this.elements.targetRow.style.paddingBottom = '0';
        this.elements.targetRow.style.marginBottom = '-0.5rem';
      }

      // Match container bottom padding to top padding in edit mode
      if (this.elements.trimSummary) {
        this.elements.trimSummary.style.paddingBottom = '24px';
      }

      // Reduce spacing between content and footer in edit mode (1/4 of original)
      if (this.elements.modalContent) {
        this.elements.modalContent.style.paddingBottom = '4px';
      }
      if (this.elements.modalFooter) {
        this.elements.modalFooter.style.paddingTop = '4px';
      }

      // Hide Edit position details button and Delete Trade button in edit mode
      if (this.elements.editPositionDetailsBtn) {
        this.elements.editPositionDetailsBtn.style.display = 'none';
      }
      if (this.elements.deleteBtn) {
        this.elements.deleteBtn.style.display = 'none';
      }

      // Show Cancel button and left spacer in edit mode, hide right spacer
      if (this.elements.cancelBtn) {
        this.elements.cancelBtn.style.display = '';
      }
      if (this.elements.modalSpacer) {
        this.elements.modalSpacer.style.display = '';
      }
      if (this.elements.modalSpacerRight) {
        this.elements.modalSpacerRight.style.display = 'none';
      }

      // Update confirm button
      if (this.elements.confirmBtn) {
        this.elements.confirmBtn.textContent = 'Confirm';
      }
    } else {
      // Normal mode: Reset input values to original trade values before hiding
      if (this.currentTrade) {
        this.populateTradeData(this.currentTrade);
      }

      // Show display values, show all sections
      this.showDisplayValues();
      this.showAllSections();

      // Show remaining shares row
      if (this.elements.remainingSharesRow) {
        this.elements.remainingSharesRow.style.display = '';
      }

      // Restore bottom padding on target row
      if (this.elements.targetRow) {
        this.elements.targetRow.style.paddingBottom = '';
        this.elements.targetRow.style.marginBottom = '';
      }

      // Restore container bottom padding
      if (this.elements.trimSummary) {
        this.elements.trimSummary.style.paddingBottom = '40px';
      }

      // Restore spacing between content and footer
      if (this.elements.modalContent) {
        this.elements.modalContent.style.paddingBottom = '';
      }
      if (this.elements.modalFooter) {
        this.elements.modalFooter.style.paddingTop = '';
      }

      // Show Edit position details button and Delete Trade button
      if (this.elements.editPositionDetailsBtn) {
        this.elements.editPositionDetailsBtn.style.display = '';
      }
      if (this.elements.deleteBtn) {
        this.elements.deleteBtn.style.display = '';
      }

      // Hide Cancel button and left spacer in normal mode, show right spacer
      if (this.elements.cancelBtn) {
        this.elements.cancelBtn.style.display = 'none';
      }
      if (this.elements.modalSpacer) {
        this.elements.modalSpacer.style.display = 'none';
      }
      if (this.elements.modalSpacerRight) {
        this.elements.modalSpacerRight.style.display = '';
      }

      // Recalculate preview to restore button text
      this.calculatePreview();
    }
  }

  confirm() {
    if (!this.currentTrade) return;

    // Check if "Edit position details" mode is active
    if (this.isEditMode) {
      // Clear all errors first
      this.clearInputError(this.elements.entryPriceInput, this.elements.entryPriceError);
      this.clearInputError(this.elements.originalStopInput, this.elements.originalStopError);
      this.clearInputError(this.elements.stopLossInput, this.elements.stopLossError);
      this.clearInputError(this.elements.targetInput, this.elements.targetError);
      this.clearInputError(this.elements.strikeInput, this.elements.strikeError);
      this.clearInputError(this.elements.expirationInput, this.elements.expirationError);

      // Edit position details mode - update entry, original stop, current stop, and target
      const newEntry = parseFloat(this.elements.entryPriceInput?.value);
      const newOriginalStop = parseFloat(this.elements.originalStopInput?.value);
      const newCurrentStop = parseFloat(this.elements.stopLossInput?.value);
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

      if (isNaN(newCurrentStop) || newCurrentStop <= 0) {
        this.showInputError(
          this.elements.stopLossInput,
          this.elements.stopLossError,
          'Current stop must be greater than 0'
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
        currentStop: newCurrentStop,
        stop: newCurrentStop,
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
          const multiplier = getAssetMultiplier(this.currentTrade.assetType);
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
    const multiplier = getAssetMultiplier(this.currentTrade.assetType);
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

  sanitizeStopLossInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.stopLossInput, this.elements.stopLossError);

    // Validate current stop if value is provided
    const value = this.elements.stopLossInput?.value.trim();
    if (value) {
      const currentStop = parseFloat(value);
      if (!isNaN(currentStop) && currentStop <= 0) {
        this.showInputError(
          this.elements.stopLossInput,
          this.elements.stopLossError,
          'Current stop must be greater than 0'
        );
      }
    }
  }

  validateExpirationDate() {
    // Clear any existing error
    this.clearInputError(this.elements.expirationInput, this.elements.expirationError);

    // Only validate if both entry date and expiration date are set
    const entryDate = this.elements.entryDateInput?.value;
    const expirationDate = this.elements.expirationInput?.value;

    if (!entryDate || !expirationDate) return;

    // Compare dates (both are in YYYY-MM-DD format)
    const tDate = new Date(entryDate + 'T00:00:00');
    const expDate = new Date(expirationDate + 'T00:00:00');

    if (expDate < tDate) {
      this.showInputError(
        this.elements.expirationInput,
        this.elements.expirationError,
        'Expiration date cannot be before trade date'
      );
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

  sanitizeStrikeInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.strikeInput, this.elements.strikeError);

    // Validate strike price if value is provided
    const value = this.elements.strikeInput?.value.trim();
    if (value) {
      const strikePrice = parseFloat(value);
      if (!isNaN(strikePrice) && strikePrice <= 0) {
        this.showInputError(
          this.elements.strikeInput,
          this.elements.strikeError,
          'Strike price must be greater than 0'
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
