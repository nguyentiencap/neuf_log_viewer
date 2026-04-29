/**
 * Filters Module
 * Handles filter parsing and SQL WHERE clause building
 * Responsibility: Filter logic and query construction
 * Uses service object pattern to encapsulate filter operations
 */

/**
 * Filter Service
 * Encapsulates all filter-related operations
 */
class FilterService {
  constructor() {}

  /**
   * Normalize filters object
   * Ensures arrays and removes empty values
   * This is shared logic that can be used by any layer
   * @param {Object} filters - Raw filters object
   * @returns {Object} Normalized filters
   */
  normalizeFilters(filters) {
    // Ensure arrays for all filter fields
    const filterFields = [
      'timeBucketInclude',
      'filenameInclude', 'filenameExclude',
      'logLevelInclude', 'logLevelExclude',
      'threadInclude', 'threadExclude',
      'deviceInclude', 'deviceExclude',
      'componentInclude', 'componentExclude'
    ];

    filterFields.forEach(key => {
      if (filters[key] && !Array.isArray(filters[key])) {
        filters[key] = [filters[key]];
      }
      // Remove empty arrays
      if (Array.isArray(filters[key]) && filters[key].length === 0) {
        delete filters[key];
      }
    });

    // Remove empty search
    if (!filters.search) delete filters.search;

    return filters;
  }
}

module.exports = {
  FilterService
};
