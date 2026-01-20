/**
 * Asset Type Utilities - Centralized logic for asset type handling
 */

import { OPTIONS_CONTRACT_MULTIPLIER } from '../constants/index.js';

/**
 * Get the multiplier for an asset type
 * @param {string} assetType - The asset type ('options' or 'stock')
 * @returns {number} Multiplier (100 for options, 1 for stocks)
 */
export function getAssetMultiplier(assetType) {
  return assetType === 'options' ? OPTIONS_CONTRACT_MULTIPLIER : 1;
}

/**
 * Check if a trade is an options trade
 * @param {Object} trade - Trade object
 * @returns {boolean} True if options, false otherwise
 */
export function isOptionsAsset(trade) {
  return trade.assetType === 'options';
}

/**
 * Get the multiplier from a trade object
 * @param {Object} trade - Trade object
 * @returns {number} Multiplier (100 for options, 1 for stocks)
 */
export function getTradeMultiplier(trade) {
  return getAssetMultiplier(trade.assetType);
}
