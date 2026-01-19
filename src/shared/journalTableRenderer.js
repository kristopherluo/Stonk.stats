/**
 * Shared Journal Table Renderer
 * Single source of truth for journal entry table rendering
 * Used by both journal page and stats page
 */

import { formatCurrency, formatDate } from '../core/utils.js';
import { getTradeRealizedPnL } from '../core/utils/tradeCalculations.js';
import { state } from '../core/state.js';
import { priceTracker } from '../core/priceTracker.js';

/**
 * Render journal table rows for given trades
 * @param {Array} trades - Array of trade objects to render
 * @param {Object} options - Rendering options
 * @param {boolean} options.shouldAnimate - Whether to apply animation classes
 * @param {Set} options.expandedRows - Set of expanded row IDs (optional)
 * @returns {Promise<string>} HTML string for table rows
 */
export async function renderJournalTableRows(trades, options = {}) {
  const { shouldAnimate = false, expandedRows = new Set() } = options;

  // Fetch company data for all tickers (to match journal table exactly)
  const companyDataMap = new Map();
  const uniqueTickers = [...new Set(trades.map(t => t.ticker))];

  for (const ticker of uniqueTickers) {
    let data = await priceTracker.getCachedCompanyData(ticker);
    if (data && !data.industry) {
      const profile = await priceTracker.fetchCompanyProfile(ticker);
      if (profile) data = profile;
      await new Promise(resolve => setTimeout(resolve, 100));
    } else if (!data) {
      const profile = await priceTracker.fetchCompanyProfile(ticker);
      if (profile) data = profile;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (data && data.industry) {
      companyDataMap.set(ticker, data);
    }
  }

  // Generate table rows HTML
  return trades.map((trade, index) => {
    const pnl = getTradeRealizedPnL(trade);
    const hasPnL = trade.status === 'closed' || trade.status === 'trimmed';
    const shares = trade.remainingShares ?? trade.shares;
    const sharesDisplay = trade.originalShares
      ? `${shares}/${trade.originalShares}`
      : shares;

    // Calculate R-multiple
    let rMultiple = null;
    if (hasPnL && trade.riskDollars > 0) {
      // For options, riskDollars doesn't include the 100 multiplier
      // so we need to multiply it to get the actual dollar risk
      const multiplier = trade.assetType === 'options' ? 100 : 1;
      const actualRiskDollars = trade.riskDollars * multiplier;
      rMultiple = pnl / actualRiskDollars;
    }

    // Calculate P&L % based on position cost
    let pnlPercent = null;
    if (hasPnL) {
      const totalShares = trade.originalShares || trade.shares;
      const multiplier = trade.assetType === 'options' ? 100 : 1;
      const positionCost = trade.entry * totalShares * multiplier;
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

    // Determine row background class for closed trades
    let rowBgClass = '';
    if (trade.status === 'closed') {
      if (pnl > 0) {
        rowBgClass = 'journal-row--closed-winner';
      } else if (pnl < 0) {
        rowBgClass = 'journal-row--closed-loser';
      }
    }

    // Determine exit price class
    let exitPriceClass = '';
    if (trade.exitPrice) {
      const priceDiff = trade.exitPrice - trade.entry;
      if (Math.abs(priceDiff) >= 0.01) {
        exitPriceClass = priceDiff > 0 ? 'journal-table__pnl--positive' : 'journal-table__pnl--negative';
      }
    }

    // Format option details if this is an options trade
    let optionDisplay = '—';
    if (trade.assetType === 'options' && trade.strike && trade.expirationDate) {
      const strike = trade.strike;
      const optionSymbol = trade.optionType === 'put' ? 'P' : 'C';
      const expDate = new Date(trade.expirationDate + 'T00:00:00');
      const month = expDate.getMonth() + 1;
      const day = expDate.getDate();
      const year = expDate.getFullYear().toString().slice(-2);
      const formattedExp = `${month}/${day}/${year}`;
      optionDisplay = `<span class="journal-option-glow">${strike}${optionSymbol} ${formattedExp}</span>`;
    }

    // Get company data for industry badge
    const companyData = companyDataMap.get(trade.ticker);
    const industry = companyData?.industry || '';

    // Get trade type for badge
    const setupType = trade.thesis?.setupType;
    const typeLabels = {
      'ep': 'EP',
      'long-term': 'Long-term',
      'base': 'Base',
      'breakout': 'Breakout',
      'bounce': 'Bounce',
      'other': 'Other'
    };
    const formattedSetupType = setupType ? (typeLabels[setupType] || setupType.replace(/\b\w/g, l => l.toUpperCase())) : '';

    // Determine display status
    let statusClass = trade.status;
    let statusText = trade.status.charAt(0).toUpperCase() + trade.status.slice(1);

    const animationDelay = shouldAnimate ? `animation-delay: ${index * 40}ms;` : '';

    return `
      <tr class="journal-table__row ${shouldAnimate ? 'journal-row--animate' : ''} ${rowBgClass}" data-id="${trade.id}" style="${animationDelay}">
        <td>${formatDate(trade.timestamp)}</td>
        <td><strong>${trade.ticker}</strong></td>
        <td>${optionDisplay}</td>
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
          ${industry ? `<span class="position-card__badge position-card__badge--industry">${industry}</span>` : '—'}
        </td>
        <td>
          ${formattedSetupType ? `<span class="position-card__badge position-card__badge--type">${formattedSetupType}</span>` : '—'}
        </td>
        <td>
          <span class="journal-table__status journal-table__status--${statusClass}">
            ${statusText}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}
