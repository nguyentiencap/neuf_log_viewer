/**
 * Filters Module
 * Handles filter parsing and SQL WHERE clause building
 * Responsibility: Filter logic and query construction
 * Uses service object pattern to encapsulate filter operations
 */

const fs = require('fs');
const path = require('path');

/**
 * Filter Service
 * Encapsulates all filter-related operations
 */
class FilterService {
  constructor(presetFilePath = null) {
    this.presets = {};
    this.presetFilePath = presetFilePath || path.join(process.cwd(), 'filter_preset.json');
    this.loadPresets();
  }

  /**
   * Load filter presets from JSON configuration file
   */
  loadPresets() {
    try {
      if (fs.existsSync(this.presetFilePath)) {
        const content = fs.readFileSync(this.presetFilePath, 'utf8');
        const config = JSON.parse(content);
        this.presets = config.presets || {};
        console.log(`✅ Loaded ${Object.keys(this.presets).length} filter presets`);
      } else {
        console.log(`⚠️  Filter preset file not found: ${this.presetFilePath}`);
      }
    } catch (error) {
      console.error(`❌ Error loading filter presets: ${error.message}`);
    }
  }

  /**
   * Get available preset names and descriptions
   */
  getAvailablePresets() {
    return Object.entries(this.presets).map(([name, preset]) => ({
      name,
      description: preset.description || name
    }));
  }

  /**
   * Apply a preset to filters
   * Preset structure matches request parameters (e.g., filenameInclude, threadExclude)
   */
  applyPreset(presetName, filters) {
    const preset = this.presets[presetName];
    if (!preset) {
      console.warn(`⚠️  Preset not found: ${presetName}`);
      return filters;
    }

    // Apply all preset fields directly to filters
    // Only apply if the filter field is not already set
    Object.entries(preset).forEach(([field, values]) => {
      // Skip description field
      if (field === 'description') return;
      
      // Apply preset value if filter is not already set
      if (!filters[field] || filters[field].length === 0) {
        filters[field] = Array.isArray(values) ? values : [values];
      }
    });

    return filters;
  }

  /**
   * Normalize filters object
   * Ensures arrays, removes empty values, applies preset
   * This is shared logic that can be used by any layer
   * @param {Object} filters - Raw filters object
   * @returns {Object} Normalized filters
   */
  normalizeFilters(filters) {
    // Ensure arrays for all filter fields
    const filterFields = [
      'filenameInclude', 'filenameExclude',
      'timeBucketInclude', 'timeBucketExclude',
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
    
    // Apply preset if specified
    if (filters.preset) {
      this.applyPreset(filters.preset, filters);
      console.log(`🎯 Applied preset: ${filters.preset}`);
    }
    
    return filters;
  }
}

module.exports = {
  FilterService
};
