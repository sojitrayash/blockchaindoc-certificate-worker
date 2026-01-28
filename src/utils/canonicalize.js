const logger = require('./logger');

/**
 * Normalize Unicode strings to NFC (Canonical Decomposition, followed by Canonical Composition)
 * Ensures consistent representation of Unicode characters
 */
function normalizeUnicode(str) {
  // Use String.prototype.normalize if available (Node.js 0.6+)
  if (typeof str.normalize === 'function') {
    return str.normalize('NFC');
  }
  // Fallback: return as-is if normalize is not available
  return str;
}

/**
 * Recursively canonicalize a value (handles nested objects and arrays)
 */
function canonicalizeValue(value, metrics, isNested = false) {
  // Skip undefined
  if (value === undefined) {
    if (metrics) metrics.nullFieldsRemoved++;
    return undefined;
  }

  // Skip null and empty strings
  if (value === null || value === '') {
    if (metrics) metrics.nullFieldsRemoved++;
    return undefined; // Return undefined to skip in parent
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (metrics) metrics.hasArrays = true;
    // Recursively canonicalize each element, then sort
    const canonicalized = value
      .map((item) => canonicalizeValue(item, metrics, true))
      .filter((item) => item !== undefined); // Remove undefined/null items

    // Sort arrays for determinism (if all elements are comparable)
    if (canonicalized.length > 0 && typeof canonicalized[0] === 'string') {
      return canonicalized.sort();
    } else if (canonicalized.length > 0 && typeof canonicalized[0] === 'number') {
      return canonicalized.sort((a, b) => a - b);
    }
    return canonicalized;
  }

  // Handle nested objects
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    if (metrics) metrics.hasNestedObjects = true;
    // Recursively canonicalize nested object and parse back to object (not string)
    const canonicalString = canonicalizeCertificateData(value, '1.0', metrics, true);
    return JSON.parse(canonicalString); // Return as object, not string
  }

  // Handle dates
  if (value instanceof Date) {
    if (metrics) metrics.dateFieldsNormalized++;
    return value.toISOString();
  }

  // Handle date strings
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    try {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        if (metrics) metrics.dateFieldsNormalized++;
        return date.toISOString();
      }
    } catch (e) {
      // Keep original if parsing fails
    }
  }

  // Normalize strings (Unicode normalization)
  if (typeof value === 'string') {
    return normalizeUnicode(value);
  }

  // Normalize numbers
  if (typeof value === 'number') {
    if (metrics) metrics.numberFieldsNormalized++;
    return Number.isInteger(value) ? value : parseFloat(value.toFixed(10));
  }

  // Return other types as-is
  return value;
}

/**
 * Canonicalize certificate data for deterministic hashing
 * MUST match SDK implementation exactly
 *
 * Ensures same data always produces same hash regardless of:
 * - JSON key order
 * - Date format
 * - Null/undefined/empty string differences
 * - Number formatting
 * - Nested objects and arrays
 * - Unicode variations
 *
 * @param {Object} data - Certificate data object
 * @param {string} schemaVersion - Schema version (default: '1.0')
 * @param {Object} metrics - Optional metrics object to track normalization
 * @param {boolean} isNested - Internal flag to indicate nested call
 * @returns {string} Canonical JSON string (compact, sorted keys)
 */
function canonicalizeCertificateData(data, schemaVersion = '1.0', metrics = null, isNested = false) {
  // Initialize metrics if not provided
  const localMetrics = metrics || {
    nullFieldsRemoved: 0,
    dateFieldsNormalized: 0,
    numberFieldsNormalized: 0,
    hasNestedObjects: false,
    hasArrays: false,
  };

  // 1. Sort keys alphabetically
  const sortedKeys = Object.keys(data).sort();
  const sorted = {};

  for (const key of sortedKeys) {
    const value = data[key];
    const canonicalized = canonicalizeValue(value, localMetrics, isNested);

    // Skip undefined values (they won't be in JSON anyway)
    if (canonicalized === undefined) {
      continue;
    }

    sorted[key] = canonicalized;
  }

  // 2. Add schema version (only for top-level)
  const canonical = isNested
    ? sorted
    : {
        _schema: schemaVersion,
        ...sorted,
      };

  // 3. Return compact JSON (no whitespace, sorted keys)
  return JSON.stringify(canonical);
}

module.exports = { canonicalizeCertificateData };
