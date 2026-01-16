/**
 * Trade Wizard - Guided trade logging with thesis prompts
 */

import { state } from '../../core/state.js';
import { showToast } from '../ui/ui.js';
import { formatCurrency, formatNumber, formatPercent, formatDate, createTimestampFromDateInput, initFlatpickr, getCurrentWeekday, restrictToNumberInput } from '../../core/utils.js';
import { formatDate as formatDateYMD } from '../../utils/marketHours.js';
import { priceTracker } from '../../core/priceTracker.js';

class TradeWizard {
  constructor() {
    this.elements = {};
    this.currentStep = 1;
    this.totalSteps = 3;
    this.skippedSteps = [];
    this.updatingProgrammatically = false;

    // Thesis data collected during wizard
    this.thesis = {
      setupType: null,
      theme: null,
      conviction: null
    };

    this.notes = '';
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.setupNumberRestrictions();
    this.initNotesEditor();
    this.disableWeekends();
  }

  setupNumberRestrictions() {
    // Restrict numeric inputs to numbers and decimals only
    restrictToNumberInput(this.elements.wizardEntryPrice, true);
    restrictToNumberInput(this.elements.wizardStopLoss, true);
    restrictToNumberInput(this.elements.wizardStrikePrice, true);
    restrictToNumberInput(this.elements.wizardShares, false); // Integer only
    restrictToNumberInput(this.elements.wizardRiskDollar, true);
    restrictToNumberInput(this.elements.wizardTargetPrice, true);
  }

  disableWeekends() {
    // Initialize trade date with default to current weekday (or last Friday if weekend)
    const today = getCurrentWeekday();
    const dateString = formatDateYMD(today);

    initFlatpickr(this.elements.wizardTradeDate, {
      defaultDate: dateString
    });

    // Explicitly set the date to ensure it shows in the visible field
    if (this.elements.wizardTradeDate?._flatpickr) {
      this.elements.wizardTradeDate._flatpickr.setDate(dateString, false);
    }

    // Initialize expiration date - allow past dates, but disable weekends
    if (this.elements.wizardExpirationDate) {
      initFlatpickr(this.elements.wizardExpirationDate, {
        minDate: null,  // Allow past dates
        maxDate: null   // Allow future dates
        // Keep default disable option (weekends disabled)
      });
    }
  }

  initNotesEditor() {
    // Auto-convert "- " to bullet points (same as journal notes)
    if (!this.elements.notesInput) return;

    this.elements.notesInput.addEventListener('input', (e) => {
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
        if (parent === this.elements.notesInput) {
          this.elements.notesInput.replaceChild(ul, textNode);
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
      // Modal
      modal: document.getElementById('wizardModal'),
      overlay: document.getElementById('wizardModalOverlay'),
      closeBtn: document.getElementById('closeWizardBtn'),

      // Progress
      progressSteps: document.querySelectorAll('.wizard-progress__step'),
      connectors: document.querySelectorAll('.wizard-progress__connector'),

      // Steps
      steps: document.querySelectorAll('.wizard-step'),

      // Step 1 - Trade Details
      wizardTicker: document.getElementById('wizardTicker'),
      wizardTickerStatus: document.getElementById('wizardTickerStatus'),
      assetTypeToggle: document.getElementById('assetTypeToggle'),
      assetTypeButtons: document.querySelectorAll('#assetTypeToggle .toggle-switch__option'),
      wizardEntryPrice: document.getElementById('wizardEntryPrice'),
      wizardStopLoss: document.getElementById('wizardStopLoss'),
      optionsStrikeRow: document.getElementById('optionsStrikeRow'),
      wizardStrikePrice: document.getElementById('wizardStrikePrice'),
      optionTypeToggle: document.getElementById('optionTypeToggle'),
      optionTypeButtons: document.querySelectorAll('#optionTypeToggle .toggle-switch__option'),
      optionsExpirationRow: document.getElementById('optionsExpirationRow'),
      wizardExpirationDate: document.getElementById('wizardExpirationDate'),
      wizardShares: document.getElementById('wizardShares'),
      wizardSharesLabel: document.getElementById('wizardSharesLabel'),
      wizardTargetPrice: document.getElementById('wizardTargetPrice'),
      wizardRMultipleGroup: document.getElementById('wizardRMultipleGroup'),
      wizardRMultipleBtns: document.querySelectorAll('#wizardRMultipleGroup .preset-btn'),
      wizardRiskPercentGroup: document.getElementById('wizardRiskPercentGroup'),
      wizardRiskPercentBtns: document.querySelectorAll('#wizardRiskPercentGroup .preset-btn'),
      wizardRiskDollar: document.getElementById('wizardRiskDollar'),
      wizardRiskPercentDisplay: document.getElementById('wizardRiskPercentDisplay'),
      wizardRDisplay: document.getElementById('wizardRDisplay'),
      wizardTradeDate: document.getElementById('wizardTradeDate'),
      cancel1Btn: document.getElementById('wizardCancel1'),
      next1Btn: document.getElementById('wizardNext1'),

      // Step 1 - Error elements
      wizardTickerError: document.getElementById('wizardTickerError'),
      wizardEntryPriceError: document.getElementById('wizardEntryPriceError'),
      wizardStopLossError: document.getElementById('wizardStopLossError'),
      wizardStrikePriceError: document.getElementById('wizardStrikePriceError'),
      wizardExpirationDateError: document.getElementById('wizardExpirationDateError'),
      wizardSharesError: document.getElementById('wizardSharesError'),
      wizardRiskDollarError: document.getElementById('wizardRiskDollarError'),
      wizardTargetPriceError: document.getElementById('wizardTargetPriceError'),
      wizardTradeDateError: document.getElementById('wizardTradeDateError'),

      // Step 2 - Thesis
      setupBtns: document.querySelectorAll('[data-setup]'),
      themeInput: document.getElementById('wizardTheme'),
      convictionStars: document.querySelectorAll('.wizard-star'),
      notesInput: document.getElementById('wizardNotes'),
      cancel2Btn: document.getElementById('wizardCancel2'),
      back2Btn: document.getElementById('wizardBack2'),
      skip2Btn: document.getElementById('wizardSkip2'),
      next2Btn: document.getElementById('wizardNext2'),

      // Step 2 - Error elements
      wizardSetupTypeError: document.getElementById('wizardSetupTypeError'),

      // Step 3 - Confirmation
      confirmTicker: document.getElementById('wizardConfirmTicker'),
      confirmPosition: document.getElementById('wizardConfirmPosition'),
      confirmOptionRow: document.getElementById('wizardConfirmOptionRow'),
      confirmOption: document.getElementById('wizardConfirmOption'),
      confirmRisk: document.getElementById('wizardConfirmRisk'),
      confirmPositionSize: document.getElementById('wizardConfirmPositionSize'),
      confirmDate: document.getElementById('wizardConfirmDate'),
      confirmSetupRow: document.getElementById('wizardConfirmSetupRow'),
      confirmSetup: document.getElementById('wizardConfirmSetup'),
      confirmThemeRow: document.getElementById('wizardConfirmThemeRow'),
      confirmTheme: document.getElementById('wizardConfirmTheme'),
      cancelBtn: document.getElementById('wizardCancel'),
      back3Btn: document.getElementById('wizardBack3'),
      confirmBtn: document.getElementById('wizardConfirmBtn')
    };
  }

  bindEvents() {
    // Close modal
    this.elements.closeBtn?.addEventListener('click', () => this.close());
    this.elements.overlay?.addEventListener('click', () => this.close());

    // Keyboard
    document.addEventListener('keydown', async (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter' && !e.shiftKey) {
        // Don't trigger next step if user is typing in the notes editor
        const isInNotesEditor = e.target.closest('.wizard-notes-editable');
        if (isInNotesEditor) return;

        e.preventDefault();

        // Validate step 1 before advancing
        if (this.currentStep === 1) {
          if (await this.validateStep1()) {
            this.goToStep(2);
          }
        } else {
          this.nextStep();
        }
      }
    });

    // Step 1 buttons
    this.elements.cancel1Btn?.addEventListener('click', () => this.close());
    this.elements.next1Btn?.addEventListener('click', async () => {
      if (await this.validateStep1()) {
        this.goToStep(2);
      }
    });

    // Asset type toggle (Shares/Options) - click anywhere to toggle
    this.elements.assetTypeToggle?.addEventListener('click', () => {
      // Find currently active button
      const activeBtn = Array.from(this.elements.assetTypeButtons).find(b => b.classList.contains('active'));
      const activeIndex = Array.from(this.elements.assetTypeButtons).indexOf(activeBtn);

      // Toggle to the other option
      const newIndex = activeIndex === 0 ? 1 : 0;
      const newBtn = this.elements.assetTypeButtons[newIndex];

      // Update active state
      this.elements.assetTypeButtons.forEach(b => b.classList.remove('active'));
      newBtn.classList.add('active');

      // Update data-active attribute for sliding animation
      this.elements.assetTypeToggle.setAttribute('data-active', newIndex);

      // Get selected asset type
      const assetType = newBtn.dataset.assetType;

      // Animated transition between shares and options
      this.animateAssetTypeSwitch(assetType);
    });

    // Option type toggle (Call/Put) - click anywhere to toggle
    this.elements.optionTypeToggle?.addEventListener('click', () => {
      // Find currently active button
      const activeBtn = Array.from(this.elements.optionTypeButtons).find(b => b.classList.contains('active'));
      const activeIndex = Array.from(this.elements.optionTypeButtons).indexOf(activeBtn);

      // Toggle to the other option
      const newIndex = activeIndex === 0 ? 1 : 0;
      const newBtn = this.elements.optionTypeButtons[newIndex];

      // Update active state
      this.elements.optionTypeButtons.forEach(b => b.classList.remove('active'));
      newBtn.classList.add('active');

      // Update data-active attribute for sliding animation
      this.elements.optionTypeToggle.setAttribute('data-active', newIndex);
    });
  }

  animateAssetTypeSwitch(assetType) {
    const sharesLabel = this.elements.wizardSharesLabel;
    const strikeRow = this.elements.optionsStrikeRow;
    const expirationRow = this.elements.optionsExpirationRow;

    // Clear all fields except ticker and trade date
    if (this.elements.wizardEntryPrice) this.elements.wizardEntryPrice.value = '';
    if (this.elements.wizardStopLoss) this.elements.wizardStopLoss.value = '';
    if (this.elements.wizardStrikePrice) this.elements.wizardStrikePrice.value = '';
    if (this.elements.wizardExpirationDate) this.elements.wizardExpirationDate.value = '';
    if (this.elements.wizardShares) this.elements.wizardShares.value = '';
    if (this.elements.wizardRiskDollar) this.elements.wizardRiskDollar.value = '';
    if (this.elements.wizardTargetPrice) this.elements.wizardTargetPrice.value = '';

    // Clear all validation errors
    this.clearAllErrors();

    if (assetType === 'options') {
      // Switching to Options mode

      // Just change the text immediately
      sharesLabel.textContent = 'Contracts';

      // Add class for increased spacing in Options mode
      const sharesInputGroup = sharesLabel.closest('.input-group');
      if (sharesInputGroup) {
        sharesInputGroup.classList.add('options-mode');
      }

      // 4. Show fields with display but hidden state
      strikeRow.style.display = 'grid';
      expirationRow.style.display = 'block';

      // Add animation classes
      strikeRow.classList.add('options-field-animating', 'options-field-hidden');
      expirationRow.classList.add('options-field-animating', 'options-field-hidden');

      // Force reflow to ensure hidden state is applied
      void strikeRow.offsetHeight;
      void expirationRow.offsetHeight;

      // 5. Trigger slide down and fade in animation
      requestAnimationFrame(() => {
        strikeRow.classList.remove('options-field-hidden');
        strikeRow.classList.add('options-field-visible');

        setTimeout(() => {
          expirationRow.classList.remove('options-field-hidden');
          expirationRow.classList.add('options-field-visible');
        }, 50); // Slight stagger
      });

      // 6. Clean up after animation completes
      setTimeout(() => {
        strikeRow.classList.remove('options-field-animating', 'options-field-visible');
        expirationRow.classList.remove('options-field-animating', 'options-field-visible');
        strikeRow.style.maxHeight = '';
        strikeRow.style.overflow = '';
        expirationRow.style.maxHeight = '';
        expirationRow.style.overflow = '';
      }, 550);

    } else {
      // Switching to Shares mode

      // Change label in the middle of slide animation (225ms into 450ms animation)
      setTimeout(() => {
        sharesLabel.textContent = 'Shares';

        // Remove options-mode class for reduced spacing
        const sharesInputGroup = sharesLabel.closest('.input-group');
        if (sharesInputGroup) {
          sharesInputGroup.classList.remove('options-mode');
        }
      }, 225);

      // 1. Ensure fields are in visible state and add animation classes
      strikeRow.classList.add('options-field-animating', 'options-field-visible');
      expirationRow.classList.add('options-field-animating', 'options-field-visible');
      strikeRow.classList.remove('options-field-hidden');
      expirationRow.classList.remove('options-field-hidden');

      // Force reflow
      void strikeRow.offsetHeight;
      void expirationRow.offsetHeight;

      // 2. Start slide up and fade out animation
      requestAnimationFrame(() => {
        strikeRow.classList.remove('options-field-visible');
        strikeRow.classList.add('options-field-hidden');

        setTimeout(() => {
          expirationRow.classList.remove('options-field-visible');
          expirationRow.classList.add('options-field-hidden');
        }, 50); // Slight stagger
      });

      // 3. Wait for animation to complete (450ms + buffer)
      setTimeout(() => {
        // Both animations finished, now hide and clean up
        strikeRow.style.display = 'none';
        expirationRow.style.display = 'none';

        // Clean up
        strikeRow.classList.remove('options-field-animating', 'options-field-hidden', 'options-field-visible');
        expirationRow.classList.remove('options-field-animating', 'options-field-hidden', 'options-field-visible');
        strikeRow.style.maxHeight = '';
        strikeRow.style.overflow = '';
        expirationRow.style.maxHeight = '';
        expirationRow.style.overflow = '';
      }, 520); // 450ms animation + 70ms buffer
    }
  }

  initNotesEditor() {
    // Auto-convert "- " to bullet points (same as journal notes)

    // Step 2 buttons
    this.elements.cancel2Btn?.addEventListener('click', () => this.close());
    this.elements.back2Btn?.addEventListener('click', () => this.goToStep(1));
    this.elements.next2Btn?.addEventListener('click', () => {
      if (this.validateStep2()) {
        this.goToStep(3);
      }
    });

    // Step 3 buttons
    this.elements.cancelBtn?.addEventListener('click', () => this.close());
    this.elements.back3Btn?.addEventListener('click', () => this.goToStep(2));
    this.elements.confirmBtn?.addEventListener('click', () => this.confirmTrade());

    // Setup type buttons
    this.elements.setupBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.setupBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.thesis.setupType = btn.dataset.setup;

        // Clear error when a type is selected
        if (this.elements.wizardSetupTypeError) {
          this.elements.wizardSetupTypeError.textContent = '';
          this.elements.wizardSetupTypeError.classList.remove('input-error--visible');
        }
      });
    });

    // Conviction stars
    this.elements.convictionStars?.forEach(star => {
      star.addEventListener('click', () => {
        const level = parseInt(star.dataset.conviction);
        this.thesis.conviction = level;
        this.elements.convictionStars.forEach((s, i) => {
          s.classList.toggle('active', i < level);
        });
      });
    });

    // Ticker input - update state and UI as user types
    this.elements.wizardTicker?.addEventListener('input', () => {
      const ticker = this.elements.wizardTicker.value.toUpperCase();
      this.elements.wizardTicker.value = ticker; // Force uppercase
      // Update state so it persists
      state.updateTrade({ ticker });
    });

    // Ticker blur - validate ticker when user leaves the field
    this.elements.wizardTicker?.addEventListener('blur', async () => {
      await this.validateTickerOnBlur();
    });

    // Entry, stop, shares, target inputs - sanitize and validate as user types
    this.elements.wizardEntryPrice?.addEventListener('input', (e) => this.sanitizeEntryPriceInput(e));
    this.elements.wizardStopLoss?.addEventListener('input', (e) => this.sanitizeStopLossInput(e));
    this.elements.wizardStrikePrice?.addEventListener('input', (e) => this.sanitizeStrikePriceInput(e));
    this.elements.wizardShares?.addEventListener('input', (e) => this.sanitizeSharesInput(e));
    this.elements.wizardTargetPrice?.addEventListener('input', (e) => this.sanitizeTargetPriceInput(e));
    this.elements.wizardRiskDollar?.addEventListener('input', (e) => this.sanitizeRiskDollarInput(e));

    // R-Multiple buttons
    this.elements.wizardRMultipleBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        const rMultiple = parseFloat(btn.dataset.r);

        // Remove active class from all buttons
        this.elements.wizardRMultipleBtns.forEach(b => b.classList.remove('active'));

        // Add active class to clicked button
        btn.classList.add('active');

        this.setTargetFromRMultiple(rMultiple);
      });
    });

    // Risk percent buttons
    this.elements.wizardRiskPercentBtns?.forEach(btn => {
      btn.addEventListener('click', () => {
        const riskPercent = parseFloat(btn.dataset.risk);

        // Remove active class from all buttons
        this.elements.wizardRiskPercentBtns.forEach(b => b.classList.remove('active'));

        // Add active class to clicked button
        btn.classList.add('active');

        this.setSharesFromRiskPercent(riskPercent);
      });
    });

    // Risk dollar input
    this.elements.wizardRiskDollar?.addEventListener('input', () => {
      this.handleCustomRiskDollar();
    });

    // Clear errors on input
    this.elements.wizardTicker?.addEventListener('input', () => {
      this.clearInputError(this.elements.wizardTicker, this.elements.wizardTickerError);
      this.hideTickerStatus(); // Also hide validation status icons
    });
    this.elements.wizardTradeDate?.addEventListener('change', () => {
      this.clearInputError(this.elements.wizardTradeDate, this.elements.wizardTradeDateError);
    });
  }

  isOpen() {
    return this.elements.modal?.classList.contains('open');
  }

  open() {
    if (!this.elements.modal) return;

    // Reset state
    this.currentStep = 1;
    this.skippedSteps = [];
    this.thesis = {
      setupType: null,
      theme: null,
      conviction: null
    };
    this.notes = '';

    // Reset UI
    this.resetForm();
    this.clearAllErrors();

    // Set trade date to today using Flatpickr API
    if (this.elements.wizardTradeDate?._flatpickr) {
      const today = getCurrentWeekday();
      const dateString = formatDateYMD(today);

      this.elements.wizardTradeDate._flatpickr.setDate(dateString, false);
    }

    // Pre-fill from calculator
    this.prefillFromCalculator();

    // Show modal
    this.elements.modal.classList.add('open');
    this.elements.overlay?.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Show step 1
    this.showStep(1);
  }

  close() {
    this.elements.modal?.classList.remove('open');
    this.elements.overlay?.classList.remove('open');
    document.body.style.overflow = '';
    this.resetForm();

    // Clear calculator state so values don't persist when reopening
    state.updateTrade({
      ticker: '',
      entry: null,
      stop: null,
      target: null
    });
    state.updateResults({
      shares: 0,
      positionSize: 0,
      riskDollars: 0
    });
  }

  resetForm() {
    // Reset Step 1 inputs
    if (this.elements.wizardTicker) this.elements.wizardTicker.value = '';
    if (this.elements.wizardEntryPrice) this.elements.wizardEntryPrice.value = '';
    if (this.elements.wizardStopLoss) this.elements.wizardStopLoss.value = '';
    if (this.elements.wizardShares) this.elements.wizardShares.value = '';
    if (this.elements.wizardTargetPrice) this.elements.wizardTargetPrice.value = '';
    // Date will be auto-set in open() method

    // Reset asset type toggle to Shares mode
    if (this.elements.assetTypeButtons) {
      this.elements.assetTypeButtons.forEach(b => b.classList.remove('active'));
      this.elements.assetTypeButtons[0]?.classList.add('active'); // Shares is first
      this.elements.assetTypeToggle?.setAttribute('data-active', '0');
    }

    // Reset label to "Shares"
    if (this.elements.wizardSharesLabel) {
      this.elements.wizardSharesLabel.textContent = 'Shares';
      // Remove options-mode class
      const sharesInputGroup = this.elements.wizardSharesLabel.closest('.input-group');
      if (sharesInputGroup) {
        sharesInputGroup.classList.remove('options-mode');
      }
    }

    // Hide options fields
    if (this.elements.optionsStrikeRow) {
      this.elements.optionsStrikeRow.style.display = 'none';
      this.elements.wizardStrikePrice.value = '';
    }
    if (this.elements.optionsExpirationRow) {
      this.elements.optionsExpirationRow.style.display = 'none';
      this.elements.wizardExpirationDate.value = '';
    }

    // Reset option type toggle to Call
    if (this.elements.optionTypeButtons) {
      this.elements.optionTypeButtons.forEach(b => b.classList.remove('active'));
      this.elements.optionTypeButtons[0]?.classList.add('active'); // Call is first
      this.elements.optionTypeToggle?.setAttribute('data-active', '0');
    }

    // Reset Step 2 buttons
    this.elements.setupBtns?.forEach(b => b.classList.remove('active'));
    this.elements.convictionStars?.forEach(s => s.classList.remove('active'));

    // Reset Step 2 inputs
    if (this.elements.themeInput) this.elements.themeInput.value = '';

    // Reset notes editor
    if (this.elements.notesInput) {
      this.elements.notesInput.innerHTML = '';
    }
    this.notes = '';

    // Reset progress
    this.elements.progressSteps?.forEach(step => {
      step.classList.remove('active', 'completed');
    });
    this.elements.progressSteps?.[0]?.classList.add('active');
  }

  updateTickerHint() {
    // No longer needed with new input structure
  }

  async validateStep1() {
    // Clear all previous errors
    this.clearAllErrors();

    // Get all field values
    const ticker = this.elements.wizardTicker?.value.trim() || '';
    const entryPrice = parseFloat(this.elements.wizardEntryPrice?.value);
    const stopPrice = parseFloat(this.elements.wizardStopLoss?.value);
    const shares = parseInt(this.elements.wizardShares?.value);
    const targetPrice = this.elements.wizardTargetPrice?.value.trim();
    const tradeDate = this.elements.wizardTradeDate?.value;

    // Validate ticker (required)
    if (!ticker) {
      this.showInputError(
        this.elements.wizardTicker,
        this.elements.wizardTickerError,
        'Ticker is required'
      );
      return false;
    }

    // Validate ticker with API if available
    if (priceTracker.apiKey) {
      try {
        await priceTracker.fetchPrice(ticker);
      } catch (error) {
        const errorMsg = error.message.includes('Invalid ticker')
          ? `Invalid ticker: ${ticker}`
          : `Failed to validate ticker: ${error.message}`;
        this.showInputError(
          this.elements.wizardTicker,
          this.elements.wizardTickerError,
          errorMsg
        );
        return false;
      }
    }

    // Validate entry price (required)
    if (!entryPrice || isNaN(entryPrice) || entryPrice <= 0) {
      this.showInputError(
        this.elements.wizardEntryPrice,
        this.elements.wizardEntryPriceError,
        'Entry price must be greater than 0'
      );
      return false;
    }

    // Validate stop loss (required)
    if (!stopPrice || isNaN(stopPrice) || stopPrice <= 0) {
      this.showInputError(
        this.elements.wizardStopLoss,
        this.elements.wizardStopLossError,
        'Stop loss must be greater than 0'
      );
      return false;
    }

    // Determine if in Options mode by checking active toggle button
    const activeAssetTypeBtn = Array.from(this.elements.assetTypeButtons || []).find(b => b.classList.contains('active'));
    const isOptionsMode = activeAssetTypeBtn?.dataset.assetType === 'options';

    // Validate strike price (required for Options mode)
    if (isOptionsMode) {
      const strikePrice = parseFloat(this.elements.wizardStrikePrice?.value);
      if (!strikePrice || isNaN(strikePrice) || strikePrice <= 0) {
        this.showInputError(
          this.elements.wizardStrikePrice,
          this.elements.wizardStrikePriceError,
          'Strike price must be greater than 0'
        );
        return false;
      }

      // Validate expiration date (required for Options mode)
      const expirationDate = this.elements.wizardExpirationDate?.value;
      if (!expirationDate) {
        this.showInputError(
          this.elements.wizardExpirationDate,
          this.elements.wizardExpirationDateError,
          'Expiration date is required'
        );
        return false;
      }

      // Validate expiration date is on or after trade date
      if (expirationDate && tradeDate) {
        const expDate = new Date(expirationDate + 'T00:00:00');
        const tDate = new Date(tradeDate + 'T00:00:00');

        if (expDate < tDate) {
          this.showInputError(
            this.elements.wizardExpirationDate,
            this.elements.wizardExpirationDateError,
            'Expiration date cannot be before trade date'
          );
          return false;
        }
      }
    }

    // Validate shares/contracts (required)
    if (!shares || isNaN(shares) || shares <= 0) {
      const fieldLabel = isOptionsMode ? 'Contracts' : 'Shares';
      this.showInputError(
        this.elements.wizardShares,
        this.elements.wizardSharesError,
        `${fieldLabel} must be greater than 0`
      );
      return false;
    }

    // Validate risk dollar if provided
    const riskDollar = this.elements.wizardRiskDollar?.value.trim();
    if (riskDollar && riskDollar.length > 0) {
      const risk = parseFloat(riskDollar);
      if (isNaN(risk) || risk <= 0) {
        this.showInputError(
          this.elements.wizardRiskDollar,
          this.elements.wizardRiskDollarError,
          'Risk must be greater than 0'
        );
        return false;
      }
    }

    // Validate target price if provided
    if (targetPrice && targetPrice.length > 0) {
      const target = parseFloat(targetPrice);
      if (isNaN(target) || target <= 0) {
        this.showInputError(
          this.elements.wizardTargetPrice,
          this.elements.wizardTargetPriceError,
          'Target price must be greater than 0'
        );
        return false;
      }
      // Ensure target is greater than entry
      if (target <= entryPrice) {
        this.showInputError(
          this.elements.wizardTargetPrice,
          this.elements.wizardTargetPriceError,
          'Target price must be greater than entry price'
        );
        return false;
      }
    }

    // Validate date (required)
    if (!tradeDate) {
      this.showInputError(
        this.elements.wizardTradeDate,
        this.elements.wizardTradeDateError,
        'Trade date is required'
      );
      this.elements.wizardTradeDate?.focus();
      return false;
    }

    return true;
  }

  validateStep2() {
    // Clear previous error
    if (this.elements.wizardSetupTypeError) {
      this.elements.wizardSetupTypeError.textContent = '';
      this.elements.wizardSetupTypeError.classList.remove('input-error--visible');
    }

    // Check if setup type is selected
    if (!this.thesis.setupType) {
      this.showInputError(
        null,
        this.elements.wizardSetupTypeError,
        'Please select a setup type'
      );
      return false;
    }
    return true;
  }

  prefillFromCalculator() {
    const trade = state.trade;
    const results = state.results;
    const account = state.account;

    // Step 1 - Fill input fields from calculator
    if (this.elements.wizardTicker) {
      this.elements.wizardTicker.value = trade.ticker || '';
    }
    if (this.elements.wizardEntryPrice) {
      this.elements.wizardEntryPrice.value = trade.entry || '';
    }
    if (this.elements.wizardStopLoss) {
      this.elements.wizardStopLoss.value = trade.stop || '';
    }
    if (this.elements.wizardShares) {
      this.elements.wizardShares.value = results.shares || '';
    }
    if (this.elements.wizardTargetPrice) {
      this.elements.wizardTargetPrice.value = trade.target || '';
    }

    // Step 2 notes - pre-fill from Quick Note
    const quickNoteEl = document.getElementById('tradeNotes');
    if (this.elements.notesInput && quickNoteEl) {
      const quickNoteContent = quickNoteEl.innerHTML.trim();
      if (quickNoteContent) {
        this.elements.notesInput.innerHTML = quickNoteContent;
      }
    }

    // Step 3 confirmation - will be updated in updateConfirmation()
    if (this.elements.confirmTicker) {
      this.elements.confirmTicker.textContent = trade.ticker || 'No Ticker';
    }
    if (this.elements.confirmPosition) {
      this.elements.confirmPosition.textContent =
        `${formatNumber(results.shares || 0)} shares @ ${formatCurrency(trade.entry || 0)}`;
    }
    if (this.elements.confirmRisk) {
      this.elements.confirmRisk.textContent =
        `${formatCurrency(results.riskDollars || 0)} (${formatPercent(account.riskPercent || 0)})`;
    }
    if (this.elements.confirmPositionSize) {
      const positionSize = (trade.entry || 0) * (results.shares || 0);
      const positionPercent = (positionSize / account.currentSize) * 100;
      this.elements.confirmPositionSize.textContent =
        `${formatCurrency(positionSize)} (${formatPercent(positionPercent)})`;
    }
    if (this.elements.confirmDate) {
      // Get trade date from calculator or use today
      const tradeDateInput = document.getElementById('tradeDate');
      const tradeDate = tradeDateInput?.value || new Date().toISOString().split('T')[0];
      const timestamp = createTimestampFromDateInput(tradeDate);
      const formattedDate = formatDate(timestamp, { year: 'numeric' });
      this.elements.confirmDate.textContent = formattedDate;
    }

    // Update R-Multiple buttons state after pre-filling
    this.updateRMultipleButtons();

    // Update risk buttons and display
    this.updateRiskButtons();
    this.updateRiskDisplay();
    this.updateTargetRDisplay();

    // Auto-select 5R if buttons are enabled (only need entry and stop)
    if (this.elements.wizardRMultipleBtns && this.elements.wizardRMultipleBtns.length > 0) {
      const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
      const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;

      if (entry > 0 && stop > 0 && entry !== stop) {
        // Auto-select 5R button
        const fiveRBtn = Array.from(this.elements.wizardRMultipleBtns).find(btn => btn.dataset.r === '5');
        if (fiveRBtn) {
          this.elements.wizardRMultipleBtns.forEach(b => b.classList.remove('active'));
          fiveRBtn.classList.add('active');
          this.setTargetFromRMultiple(5);
        }
      }
    }
  }

  showStep(step) {
    this.currentStep = step;

    // Update steps visibility
    this.elements.steps?.forEach((stepEl, i) => {
      const stepNum = i + 1;
      stepEl.classList.remove('active', 'exit-left');
      if (stepNum === step) {
        stepEl.classList.add('active');
      }
    });

    // Update progress indicators
    this.elements.progressSteps?.forEach((progressStep, i) => {
      const stepNum = i + 1;
      progressStep.classList.remove('active', 'completed');
      if (stepNum < step) {
        progressStep.classList.add('completed');
      } else if (stepNum === step) {
        progressStep.classList.add('active');
      }
    });

    // Update confirmation on step 3
    if (step === 3) {
      this.updateConfirmation();
    }
  }

  goToStep(step) {
    if (step < 1 || step > this.totalSteps) return;

    // Collect data before leaving current step
    this.collectStepData();

    this.showStep(step);
  }

  nextStep() {
    if (this.currentStep < this.totalSteps) {
      this.goToStep(this.currentStep + 1);
    } else {
      this.confirmTrade();
    }
  }

  skipStep(step) {
    if (!this.skippedSteps.includes(step)) {
      this.skippedSteps.push(step);
    }
    this.goToStep(step + 1);
  }

  async skipAll() {
    // Direct save without wizard
    await this.logTrade(false);
    this.close();
  }

  collectStepData() {
    // Step 2 - Thesis
    if (this.currentStep === 2) {
      this.thesis.theme = this.elements.themeInput?.value.trim() || null;
      // Get notes from contenteditable div (store as HTML for formatting)
      if (this.elements.notesInput) {
        this.notes = this.elements.notesInput.innerHTML.trim() || '';
      }
    }
  }

  updateConfirmation() {
    // Get values from wizard inputs
    const ticker = this.elements.wizardTicker?.value.trim() || '';
    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const shares = parseInt(this.elements.wizardShares?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const riskPerShare = entry - stop;

    // Determine if this is an options trade
    const assetTypeBtn = document.querySelector('#assetTypeToggle .toggle-switch__option.active');
    const assetType = assetTypeBtn?.dataset.assetType || 'stock';
    const isOptions = assetType === 'options';

    // For options, account for 100 shares per contract
    const multiplier = isOptions ? 100 : 1;
    const riskDollars = shares * riskPerShare * multiplier;
    const riskPercent = (riskDollars / state.account.currentSize) * 100;

    // Update ticker display - just ticker for both stocks and options
    if (this.elements.confirmTicker) {
      this.elements.confirmTicker.textContent = ticker || 'No Ticker';
      this.elements.confirmTicker.classList.toggle('wizard-confirmation__ticker--empty', !ticker);
    }

    // Update position display
    if (this.elements.confirmPosition) {
      if (isOptions) {
        // Simple format for options: "5 contracts @ $2.15"
        this.elements.confirmPosition.textContent = `${formatNumber(shares)} contracts @ ${formatCurrency(entry)}`;
      } else {
        this.elements.confirmPosition.textContent = `${formatNumber(shares)} shares @ ${formatCurrency(entry)}`;
      }
    }

    // Update option row (only visible for options trades)
    if (isOptions) {
      const strike = parseFloat(this.elements.wizardStrikePrice?.value) || 0;
      const expirationDate = this.elements.wizardExpirationDate?.value || '';
      const optionTypeBtn = document.querySelector('#optionTypeToggle .toggle-switch__option.active');
      const optionType = optionTypeBtn?.dataset.optionType || 'call';
      const optionSymbol = optionType === 'call' ? 'C' : 'P';

      // Format expiration date as "Jan 16, 2026"
      let formattedExp = '';
      if (expirationDate) {
        const expDate = new Date(expirationDate + 'T00:00:00');
        formattedExp = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      if (this.elements.confirmOptionRow) {
        this.elements.confirmOptionRow.style.display = 'flex';
      }
      if (this.elements.confirmOption) {
        this.elements.confirmOption.textContent = `${strike}${optionSymbol} ${formattedExp}`;
      }
    } else {
      // Hide option row for stock trades
      if (this.elements.confirmOptionRow) {
        this.elements.confirmOptionRow.style.display = 'none';
      }
    }

    // Update risk display
    if (this.elements.confirmRisk) {
      this.elements.confirmRisk.textContent = `${formatCurrency(riskDollars)} (${formatPercent(riskPercent)})`;
    }

    // Update position size display
    if (this.elements.confirmPositionSize) {
      const positionSize = entry * shares * multiplier;
      const positionPercent = (positionSize / state.account.currentSize) * 100;
      this.elements.confirmPositionSize.textContent = `${formatCurrency(positionSize)} (${formatPercent(positionPercent)})`;
    }

    // Update date display
    if (this.elements.confirmDate) {
      const tradeDate = this.elements.wizardTradeDate?.value || new Date().toISOString().split('T')[0];
      const timestamp = createTimestampFromDateInput(tradeDate);
      const formattedDate = formatDate(timestamp, { year: 'numeric' });
      this.elements.confirmDate.textContent = formattedDate;
    }

    // Update setup row
    if (this.thesis.setupType) {
      if (this.elements.confirmSetupRow) {
        this.elements.confirmSetupRow.style.display = 'flex';
      }
      if (this.elements.confirmSetup) {
        this.elements.confirmSetup.textContent = this.thesis.setupType.toUpperCase();
      }
    } else {
      if (this.elements.confirmSetupRow) {
        this.elements.confirmSetupRow.style.display = 'none';
      }
    }

    // Update theme row
    if (this.thesis.theme) {
      if (this.elements.confirmThemeRow) {
        this.elements.confirmThemeRow.style.display = 'flex';
      }
      if (this.elements.confirmTheme) {
        this.elements.confirmTheme.textContent = this.thesis.theme;
      }
    } else {
      if (this.elements.confirmThemeRow) {
        this.elements.confirmThemeRow.style.display = 'none';
      }
    }
  }

  async confirmTrade() {
    this.collectStepData();
    await this.logTrade(true);
    this.close();
  }

  async logTrade(wizardComplete = false) {
    // Get values from wizard inputs
    const ticker = this.elements.wizardTicker?.value.trim() || '';
    const entryPrice = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stopPrice = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const targetPrice = parseFloat(this.elements.wizardTargetPrice?.value) || 0;
    const shares = parseInt(this.elements.wizardShares?.value) || 0;

    // Get trade date from flatpickr instance if available, otherwise from input value
    let tradeDate;
    if (this.elements.wizardTradeDate?._flatpickr && this.elements.wizardTradeDate._flatpickr.selectedDates.length > 0) {
      const selectedDate = this.elements.wizardTradeDate._flatpickr.selectedDates[0];
      tradeDate = formatDateYMD(selectedDate);
    } else {
      tradeDate = this.elements.wizardTradeDate?.value || new Date().toISOString().split('T')[0];
    }

    // Calculate derived values
    const riskPerShare = entryPrice - stopPrice;
    const positionSize = shares * entryPrice;
    const riskDollars = shares * riskPerShare;
    const riskPercent = (riskDollars / state.account.currentSize) * 100;
    const stopDistance = riskPerShare;

    // Validate ticker and fetch company data if API key is configured
    let companyData = null;
    if (priceTracker.apiKey && ticker) {
      try {
        // Fetch price to validate ticker and company profile in parallel
        const [priceData, profileData] = await Promise.all([
          priceTracker.fetchPrice(ticker),
          priceTracker.fetchCompanyProfile(ticker)
        ]);

        companyData = profileData;
      } catch (error) {
        // Only block trade if it's definitely an invalid ticker
        if (error.message.includes('Invalid ticker symbol')) {
          // Silent validation - no toast
          return;
        }

        // For API errors (rate limits, network issues), log trade anyway - silent
      }
    }

    // Get timestamp from trade date
    const timestamp = createTimestampFromDateInput(tradeDate);

    // Determine asset type from UI toggle
    const assetTypeBtn = document.querySelector('#assetTypeToggle .toggle-switch__option.active');
    const assetType = assetTypeBtn?.dataset.assetType || 'stock';

    // Capture options fields if in options mode
    let strike = null;
    let expirationDate = null;
    let optionType = null;
    let premium = null;

    if (assetType === 'options') {
      strike = parseFloat(this.elements.wizardStrikePrice?.value) || null;
      expirationDate = this.elements.wizardExpirationDate?.value || null;

      const optionTypeBtn = document.querySelector('#optionTypeToggle .toggle-switch__option.active');
      optionType = optionTypeBtn?.dataset.optionType || 'call';

      // Premium is the entry price for options
      premium = entryPrice;
    }

    // Build journal entry
    const journalEntry = {
      timestamp,
      ticker,
      entry: entryPrice,
      stop: stopPrice,
      originalStop: stopPrice,
      currentStop: stopPrice,
      target: targetPrice || null,
      shares,
      positionSize,
      riskDollars,
      riskPercent,
      stopDistance,
      notes: this.notes || '',
      status: 'open',

      // Options fields
      assetType,
      strike,
      expirationDate,
      optionType,
      premium,

      // Thesis data
      thesis: this.hasThesisData() ? { ...this.thesis } : null,
      wizardComplete,
      wizardSkipped: [...this.skippedSteps]

      // Note: Company data is cached separately in companyDataCache
      // and looked up by ticker when displaying trades
    };

    // Add to journal
    const newEntry = state.addJournalEntry(journalEntry);

    // Save changes
    state.saveJournalMeta();

    // Success toast removed - silent save
  }

  hasThesisData() {
    return this.thesis.setupType ||
           this.thesis.theme ||
           this.thesis.conviction;
  }

  updateRMultipleButtons() {
    if (!this.elements.wizardRMultipleBtns) return;

    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;

    // Only need entry and stop to calculate target price (R-Multiple)
    const canCalculate = entry > 0 && stop > 0 && entry !== stop;

    this.elements.wizardRMultipleBtns.forEach(btn => {
      btn.disabled = !canCalculate;
    });

    // Auto-populate target price if a button is active and target is empty
    if (canCalculate) {
      const targetValue = this.elements.wizardTargetPrice?.value.trim();

      // If target is empty, calculate based on active button
      if (!targetValue) {
        const activeBtn = Array.from(this.elements.wizardRMultipleBtns).find(btn => btn.classList.contains('active'));

        if (activeBtn) {
          // Calculate target based on currently active button
          const rMultiple = parseFloat(activeBtn.dataset.r);
          this.setTargetFromRMultiple(rMultiple);
        } else {
          // No button active, auto-select 5R
          const fiveRBtn = Array.from(this.elements.wizardRMultipleBtns).find(btn => btn.dataset.r === '5');
          if (fiveRBtn) {
            this.elements.wizardRMultipleBtns.forEach(b => b.classList.remove('active'));
            fiveRBtn.classList.add('active');
            this.setTargetFromRMultiple(5);
          }
        }
      }
    }
  }

  setTargetFromRMultiple(rMultiple) {
    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;

    if (entry <= 0 || stop <= 0 || entry === stop) return;

    const riskPerShare = entry - stop;
    const targetPrice = entry + (rMultiple * riskPerShare);

    if (this.elements.wizardTargetPrice) {
      this.elements.wizardTargetPrice.value = targetPrice.toFixed(2);
      state.updateTrade({ target: targetPrice });
    }

    this.updateTargetRDisplay();
  }

  isOptionsMode() {
    // Check if the Options toggle button is active
    const activeBtn = Array.from(this.elements.assetTypeButtons || []).find(b => b.classList.contains('active'));
    return activeBtn?.dataset.assetType === 'options';
  }

  updateRiskButtons() {
    if (!this.elements.wizardRiskPercentBtns) return;

    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const accountSize = state.account.currentSize || 0;

    // Enable when entry, stop valid AND account > 0 (shares not required - buttons calculate shares)
    const canCalculate = entry > 0 &&
                         stop > 0 &&
                         entry !== stop &&
                         accountSize > 0;

    this.elements.wizardRiskPercentBtns.forEach(btn => {
      btn.disabled = !canCalculate;
    });
  }

  setSharesFromRiskPercent(riskPercent) {
    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const accountSize = state.account.currentSize || 0;

    if (entry <= 0 || stop <= 0 || entry === stop || accountSize <= 0) return;

    // For options: 1 contract = 100 shares
    const multiplier = this.isOptionsMode() ? 100 : 1;
    const riskPerUnit = (entry - stop) * multiplier;
    const riskDollars = accountSize * (riskPercent / 100);
    const units = Math.floor(riskDollars / riskPerUnit);

    // Update shares/contracts input and risk dollar display programmatically
    this.updatingProgrammatically = true;
    if (this.elements.wizardShares) {
      this.elements.wizardShares.value = units;
    }
    if (this.elements.wizardRiskDollar) {
      this.elements.wizardRiskDollar.value = riskDollars.toFixed(2);
    }
    this.updatingProgrammatically = false;

    // Update displays
    this.updateRiskPercentDisplay();
    this.updateRMultipleButtons();
  }

  handleCustomRiskDollar() {
    const riskDollars = parseFloat(this.elements.wizardRiskDollar?.value) || 0;
    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const accountSize = state.account.currentSize || 0;

    if (riskDollars <= 0 || entry <= 0 || stop <= 0 || entry === stop) {
      this.updateRiskPercentDisplay();
      return;
    }

    // Calculate shares/contracts from risk dollars
    // For options: 1 contract = 100 shares
    const multiplier = this.isOptionsMode() ? 100 : 1;
    const riskPerUnit = (entry - stop) * multiplier;
    const units = Math.floor(riskDollars / riskPerUnit);

    // Update shares/contracts input programmatically
    this.updatingProgrammatically = true;
    if (this.elements.wizardShares) {
      this.elements.wizardShares.value = units;
    }
    this.updatingProgrammatically = false;

    // Calculate risk percentage
    const riskPercent = accountSize > 0 ? (riskDollars / accountSize) * 100 : 0;

    // Check if matches a preset button and auto-select it
    const presetValues = [0.1, 0.25, 0.5, 1, 2];
    const matchingPreset = presetValues.find(preset => {
      const presetDollars = accountSize * (preset / 100);
      return Math.abs(riskDollars - presetDollars) < 0.01; // Allow small floating point differences
    });

    // Update button states
    this.elements.wizardRiskPercentBtns?.forEach(btn => {
      const btnValue = parseFloat(btn.dataset.risk);
      if (matchingPreset && btnValue === matchingPreset) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update displays
    this.updateRiskPercentDisplay();
    this.updateRMultipleButtons();
  }

  updateRiskDisplay() {
    if (!this.elements.wizardRiskDollar) return;

    // Skip if we're programmatically updating to avoid circular updates
    if (this.updatingProgrammatically) return;

    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const units = parseInt(this.elements.wizardShares?.value) || 0;

    // Calculate risk dollars
    // For options: 1 contract = 100 shares
    let riskDollars = 0;
    if (entry > 0 && stop > 0 && units > 0 && entry !== stop) {
      const multiplier = this.isOptionsMode() ? 100 : 1;
      const riskPerUnit = (entry - stop) * multiplier;
      riskDollars = riskPerUnit * units;
    }

    // Display formatted value
    this.elements.wizardRiskDollar.value = riskDollars.toFixed(2);

    // Update risk percent display
    this.updateRiskPercentDisplay();
  }

  updateRiskPercentDisplay() {
    if (!this.elements.wizardRiskPercentDisplay) return;

    const riskDollars = parseFloat(this.elements.wizardRiskDollar?.value) || 0;
    const accountSize = state.account.currentSize || 0;

    // Calculate and display risk percentage
    if (riskDollars > 0 && accountSize > 0) {
      const riskPercent = (riskDollars / accountSize) * 100;
      this.elements.wizardRiskPercentDisplay.textContent = `(${riskPercent.toFixed(2)}%)`;
      this.elements.wizardRiskPercentDisplay.style.display = '';
    } else {
      this.elements.wizardRiskPercentDisplay.style.display = 'none';
    }
  }

  updateTargetRDisplay() {
    if (!this.elements.wizardRDisplay) return;

    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const target = parseFloat(this.elements.wizardTargetPrice?.value) || 0;

    // Calculate R-Multiple
    let rMultiple = 0;
    if (entry > 0 && stop > 0 && target > 0 && entry !== stop) {
      const risk = entry - stop;
      const reward = target - entry;
      rMultiple = reward / risk;
    }

    // Display formatted value
    if (rMultiple !== 0) {
      this.elements.wizardRDisplay.textContent = `(${rMultiple.toFixed(1)}R)`;
      this.elements.wizardRDisplay.classList.toggle('negative', rMultiple < 0);
      this.elements.wizardRDisplay.style.display = '';
    } else {
      this.elements.wizardRDisplay.style.display = 'none';
    }
  }

  showSuccessToast() {
    const messages = [
      "Trade logged! Good luck!",
      "Nice setup! Tracked.",
      "You're on a roll! Trade saved.",
      "Disciplined trader! Logged.",
      "Trade captured! Let's go!"
    ];
    const message = messages[Math.floor(Math.random() * messages.length)];
    showToast(message, 'success');
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
      // Remove inline display: none if present (for full-width errors)
      if (errorElement.style.display === 'none') {
        errorElement.style.display = 'block';
      }
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
      // Restore display: none for full-width errors that should be hidden
      if (errorElement.id === 'wizardStrikePriceError') {
        errorElement.style.display = 'none';
      }
    }
  }

  clearAllErrors() {
    // Clear all input error states
    const inputs = [
      this.elements.wizardTicker,
      this.elements.wizardEntryPrice,
      this.elements.wizardStopLoss,
      this.elements.wizardStrikePrice,
      this.elements.wizardExpirationDate,
      this.elements.wizardShares,
      this.elements.wizardRiskDollar,
      this.elements.wizardTargetPrice,
      this.elements.wizardTradeDate
    ];

    const errors = [
      this.elements.wizardTickerError,
      this.elements.wizardEntryPriceError,
      this.elements.wizardStopLossError,
      this.elements.wizardStrikePriceError,
      this.elements.wizardExpirationDateError,
      this.elements.wizardSharesError,
      this.elements.wizardRiskDollarError,
      this.elements.wizardTargetPriceError,
      this.elements.wizardTradeDateError,
      this.elements.wizardSetupTypeError
    ];

    inputs.forEach((input, index) => {
      this.clearInputError(input, errors[index]);
    });

    // Clear setup type error (no input element)
    if (this.elements.wizardSetupTypeError) {
      this.elements.wizardSetupTypeError.textContent = '';
      this.elements.wizardSetupTypeError.classList.remove('input-error--visible');
    }

    // Also clear ticker status icons
    this.hideTickerStatus();
  }

  showTickerLoading() {
    if (!this.elements.wizardTickerStatus) return;
    this.elements.wizardTickerStatus.className = 'input-status input-status--loading';
  }

  showTickerSuccess() {
    if (!this.elements.wizardTickerStatus) return;
    this.elements.wizardTickerStatus.className = 'input-status input-status--success';
  }

  hideTickerStatus() {
    if (!this.elements.wizardTickerStatus) return;
    this.elements.wizardTickerStatus.className = 'input-status';
  }

  async validateTickerOnBlur() {
    const ticker = this.elements.wizardTicker?.value.trim() || '';

    // Don't validate if ticker is empty
    if (!ticker) {
      this.hideTickerStatus();
      return;
    }

    // Don't validate if no API key is available
    if (!priceTracker.apiKey) {
      this.hideTickerStatus();
      return;
    }

    // Clear any existing errors
    this.clearInputError(this.elements.wizardTicker, this.elements.wizardTickerError);

    // Show loading spinner
    this.showTickerLoading();

    try {
      // Validate ticker with API
      await priceTracker.fetchPrice(ticker);

      // Show success check
      this.showTickerSuccess();
    } catch (error) {
      // Hide status icons
      this.hideTickerStatus();

      // Show error message
      const errorMsg = error.message.includes('Invalid ticker')
        ? `Invalid ticker: ${ticker}`
        : `Failed to validate ticker: ${error.message}`;
      this.showInputError(
        this.elements.wizardTicker,
        this.elements.wizardTickerError,
        errorMsg
      );
    }
  }

  sanitizeDecimalInput(e) {
    const input = e.target;
    const originalValue = input.value;
    let value = originalValue;

    // Allow only numbers and one decimal point
    value = value.replace(/[^\d.]/g, '');

    // Allow only one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }

    // Only update if value changed (to avoid triggering another input event)
    if (value !== originalValue) {
      input.value = value;
    }
  }

  sanitizeEntryPriceInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.wizardEntryPrice, this.elements.wizardEntryPriceError);

    // Validate entry price if value is provided
    const value = this.elements.wizardEntryPrice?.value.trim();

    if (value) {
      const entryPrice = parseFloat(value);

      if (!isNaN(entryPrice) && entryPrice <= 0) {
        this.showInputError(
          this.elements.wizardEntryPrice,
          this.elements.wizardEntryPriceError,
          'Entry price must be greater than 0'
        );
        return;
      }
    }

    // Update state and UI
    const entry = parseFloat(this.elements.wizardEntryPrice.value) || 0;
    state.updateTrade({ entry });
    this.updateRMultipleButtons();
    this.updateRiskButtons();
    this.updateRiskDisplay();
    this.updateTargetRDisplay();
  }

  sanitizeStopLossInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.wizardStopLoss, this.elements.wizardStopLossError);

    // Validate stop loss if value is provided
    const value = this.elements.wizardStopLoss?.value.trim();
    if (value) {
      const stopLoss = parseFloat(value);
      if (!isNaN(stopLoss) && stopLoss <= 0) {
        this.showInputError(
          this.elements.wizardStopLoss,
          this.elements.wizardStopLossError,
          'Stop loss must be greater than 0'
        );
        return; // Don't update state if there's an error
      }
    }

    // Update state and UI
    const stop = parseFloat(this.elements.wizardStopLoss.value) || 0;
    state.updateTrade({ stop });
    this.updateRMultipleButtons();
    this.updateRiskButtons();
    this.updateRiskDisplay();
    this.updateTargetRDisplay();
  }

  sanitizeStrikePriceInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.wizardStrikePrice, this.elements.wizardStrikePriceError);

    // Validate strike price if value is provided
    const value = this.elements.wizardStrikePrice?.value.trim();
    if (value) {
      const strikePrice = parseFloat(value);
      if (!isNaN(strikePrice) && strikePrice <= 0) {
        this.showInputError(
          this.elements.wizardStrikePrice,
          this.elements.wizardStrikePriceError,
          'Strike price must be greater than 0'
        );
        return;
      }
    }
  }

  sanitizeSharesInput(e) {
    const input = e.target;
    let value = input.value;

    // Allow only integers (no decimals)
    value = value.replace(/[^\d]/g, '');

    // Update input value with sanitized version
    input.value = value;

    // Clear any existing error
    this.clearInputError(this.elements.wizardShares, this.elements.wizardSharesError);

    // Validate shares if value is provided
    if (value) {
      const shares = parseInt(value);
      if (!isNaN(shares) && shares <= 0) {
        // Determine if in Options mode by checking active toggle button
        const activeAssetTypeBtn = Array.from(this.elements.assetTypeButtons || []).find(b => b.classList.contains('active'));
        const isOptionsMode = activeAssetTypeBtn?.dataset.assetType === 'options';
        const fieldLabel = isOptionsMode ? 'Contracts' : 'Shares';

        this.showInputError(
          this.elements.wizardShares,
          this.elements.wizardSharesError,
          `${fieldLabel} must be greater than 0`
        );
        return; // Don't update state if there's an error
      }
    }

    // Remove active state when shares manually changed
    this.elements.wizardRiskPercentBtns?.forEach(b => b.classList.remove('active'));

    // Update UI
    this.updateRMultipleButtons();
    this.updateRiskButtons();
    this.updateRiskDisplay();
  }

  sanitizeTargetPriceInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.wizardTargetPrice, this.elements.wizardTargetPriceError);

    // Validate target price if value is provided
    const value = this.elements.wizardTargetPrice?.value.trim();
    if (value) {
      const target = parseFloat(value);

      // Check if target > 0
      if (!isNaN(target) && target <= 0) {
        this.showInputError(
          this.elements.wizardTargetPrice,
          this.elements.wizardTargetPriceError,
          'Target price must be greater than 0'
        );
        return; // Don't update state if there's an error
      }

      // Check if target > entry price
      const entryValue = this.elements.wizardEntryPrice?.value.trim();
      if (entryValue) {
        const entryPrice = parseFloat(entryValue);
        if (!isNaN(target) && !isNaN(entryPrice) && target <= entryPrice) {
          this.showInputError(
            this.elements.wizardTargetPrice,
            this.elements.wizardTargetPriceError,
            'Target price must be greater than entry price'
          );
          return; // Don't update state if there's an error
        }
      }
    }

    // Update state and UI
    const target = parseFloat(this.elements.wizardTargetPrice.value) || 0;
    state.updateTrade({ target });
    this.updateTargetRDisplay();

    // Check if target matches any R-Multiple preset and update UI
    const entry = parseFloat(this.elements.wizardEntryPrice?.value) || 0;
    const stop = parseFloat(this.elements.wizardStopLoss?.value) || 0;
    const riskPerShare = entry - stop;

    if (riskPerShare > 0) {
      const rMultiple = (target - entry) / riskPerShare;
      let matchFound = false;

      this.elements.wizardRMultipleBtns?.forEach(btn => {
        const btnR = parseInt(btn.dataset.r);
        if (Math.abs(rMultiple - btnR) < 0.01) {
          btn.classList.add('active');
          matchFound = true;
        } else {
          btn.classList.remove('active');
        }
      });
    }
  }

  sanitizeRiskDollarInput(e) {
    // Use generic decimal sanitizer
    this.sanitizeDecimalInput(e);

    // Clear any existing error
    this.clearInputError(this.elements.wizardRiskDollar, this.elements.wizardRiskDollarError);

    // Validate risk dollar if value is provided
    const value = this.elements.wizardRiskDollar?.value.trim();
    if (value) {
      const riskDollar = parseFloat(value);
      if (!isNaN(riskDollar) && riskDollar <= 0) {
        this.showInputError(
          this.elements.wizardRiskDollar,
          this.elements.wizardRiskDollarError,
          'Risk must be greater than 0'
        );
      }
    }
  }
}

export const wizard = new TradeWizard();
export { TradeWizard };
