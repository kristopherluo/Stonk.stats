/**
 * Schema Migrations - Handles data structure upgrades for long-term compatibility
 *
 * Each cache type has its own version number. When structures change, increment
 * the version and add a migration function to transform old data to new format.
 */

import { createLogger } from './logger.js';

const logger = createLogger('Migrations');

// Current schema versions for each cache type
export const SCHEMA_VERSIONS = {
  historicalPriceCache: 2,  // v1: just prices, v2: added __metadata with fetchedAt
  riskCalcPriceCache: 1,    // v1: prices with trading day boundary
  optionsPriceCache: 1,     // v1: initial implementation
  eodCache: 1,              // v1: current structure with incomplete/missingTickers
  companySummaryCache: 1,   // v1: compressed summaries with LRU
  companyDataCache: 1,      // v1: Finnhub company profiles
  journal: 3,               // v3: individual trade storage (v2: added compression to notes)
  cashFlow: 1,              // v1: transactions array
  settings: 2               // v2: added twelveDataBatchSize
};

/**
 * Migration registry
 * Key format: "cacheType:fromVersion:toVersion"
 * Value: migration function that takes old data and returns new data
 */
const migrations = {
  // Historical Price Cache: v1 -> v2 (add metadata)
  'historicalPriceCache:1:2': (oldData) => {
    // Old format: { ticker: { 'YYYY-MM-DD': OHLCV } }
    // New format: { ticker: { 'YYYY-MM-DD': OHLCV }, __metadata: { ticker: { fetchedAt } } }

    if (oldData.__metadata) {
      // Already has metadata, just ensure version is set
      return { ...oldData, __schemaVersion: 2 };
    }

    // Initialize empty metadata for all tickers
    const metadata = {};
    for (const ticker in oldData) {
      if (ticker !== '__schemaVersion') {
        metadata[ticker] = {
          fetchedAt: Date.now() // Set to now since we don't know when it was originally fetched
        };
      }
    }

    return {
      ...oldData,
      __metadata: metadata,
      __schemaVersion: 2
    };
  },

  // Settings: v1 -> v2 (add twelveDataBatchSize)
  'settings:1:2': (oldData) => {
    return {
      ...oldData,
      twelveDataBatchSize: oldData.twelveDataBatchSize || 8,
      __schemaVersion: 2
    };
  }

  // Note: Journal v2 -> v3 migration (array to individual trades) is handled
  // in state.js during initialization, not here. It requires storage-level
  // operations that can't be done in a simple data transform.
};

/**
 * Get the current schema version for a cache type
 */
export function getCurrentVersion(cacheType) {
  return SCHEMA_VERSIONS[cacheType] || 1;
}

/**
 * Migrate data from old version to current version
 * @param {string} cacheType - Type of cache being migrated
 * @param {any} data - Data to migrate
 * @param {number} fromVersion - Version of the data
 * @returns {any} Migrated data
 */
export function migrateData(cacheType, data, fromVersion) {
  const targetVersion = getCurrentVersion(cacheType);

  // Already at current version
  if (fromVersion === targetVersion) {
    return data;
  }

  // No migration path defined
  if (fromVersion > targetVersion) {
    logger.warn(`[Migrations] Data version ${fromVersion} is newer than current ${targetVersion} for ${cacheType}`);
    return data;
  }

  let currentData = data;
  let currentVersion = fromVersion;

  // Apply migrations sequentially
  while (currentVersion < targetVersion) {
    const nextVersion = currentVersion + 1;
    const migrationKey = `${cacheType}:${currentVersion}:${nextVersion}`;
    const migrationFn = migrations[migrationKey];

    if (!migrationFn) {
      logger.warn(`[Migrations] No migration found for ${migrationKey}`);
      // Can't migrate further, return what we have
      return currentData;
    }

    logger.debug(`[Migrations] Migrating ${cacheType} from v${currentVersion} to v${nextVersion}`);
    try {
      currentData = migrationFn(currentData);
      currentVersion = nextVersion;
    } catch (error) {
      logger.error(`[Migrations] Failed to migrate ${cacheType}:`, error);
      return currentData; // Return partially migrated data
    }
  }

  return currentData;
}

/**
 * Add schema version to data if not present
 * @param {string} cacheType - Type of cache
 * @param {any} data - Data to add version to
 * @returns {any} Data with version
 */
export function addSchemaVersion(cacheType, data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const currentVersion = getCurrentVersion(cacheType);
  return {
    ...data,
    __schemaVersion: data.__schemaVersion || currentVersion
  };
}

/**
 * Validate and migrate data on load
 * @param {string} cacheType - Type of cache
 * @param {any} data - Loaded data
 * @returns {any} Validated and migrated data
 */
export function validateAndMigrate(cacheType, data) {
  if (!data) {
    return null;
  }

  const dataVersion = data.__schemaVersion || 1; // Default to v1 if no version
  const currentVersion = getCurrentVersion(cacheType);

  if (dataVersion === currentVersion) {
    return data;
  }

  logger.debug(`[Migrations] ${cacheType} needs migration from v${dataVersion} to v${currentVersion}`);
  return migrateData(cacheType, data, dataVersion);
}

/**
 * Check if data needs migration
 * @param {string} cacheType - Type of cache
 * @param {any} data - Data to check
 * @returns {boolean} True if migration needed
 */
export function needsMigration(cacheType, data) {
  if (!data) {
    return false;
  }

  const dataVersion = data.__schemaVersion || 1;
  const currentVersion = getCurrentVersion(cacheType);
  return dataVersion < currentVersion;
}
