/**
 * Preset Module
 * Provides dynamic filter suggestions for the preset feature.
 * Each suggestion is computed from current filter option data and can be
 * applied in one click to progressively narrow down log results.
 *
 * Responsibility: Generate contextual filter suggestions based on data analytics
 */

const fs = require('fs');
const path = require('path');

/**
 * Preset Service
 * Generates dynamic filter suggestions based on current filter option data.
 * Also handles persistence of preset snapshots to/from disk.
 */
class PresetService {
  /**
   * Get path to preset snapshot JSON file
   * @param {string} dbDir - Database directory path
   * @returns {string}
   */
  static getPresetsPath(dbDir) {
    return path.join(dbDir, 'neuf-presets.json');
  }

  /**
   * Get path to user-defined preset JSON file (preset.json at project root).
   * @returns {string}
   */
  static getUserPresetsPath() {
    return path.join(__dirname, '..', 'preset.json');
  }

  /**
   * Load user-defined presets from the preset.json file at the project root.
   * Returns an empty object if the file is absent or cannot be parsed.
   * @param {string|null} jsonPath - Override path (defaults to getUserPresetsPath())
   * @param {Function} logger - Logger function
   * @returns {Object} Map of preset id to preset object
   */
  static loadUserPresets(jsonPath = null, logger = console.log) {
    const filePath = jsonPath || PresetService.getUserPresetsPath();
    if (!fs.existsSync(filePath)) return {};
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) || {};
    } catch (e) {
      logger(`⚠️  Failed to load user presets: ${e.message}`);
      return {};
    }
  }

  /**
   * Save filter options snapshot to JSON file.
   * Called once after scan so presets always reflect original data.
   * @param {string} presetsPath - Full path to the JSON file
   * @param {Object} filterOptions - Filter options from getFilterOptions()
   * @param {Function} logger - Logger function
   */
  static savePreset(presetsPath, presets, logger = console.log) {
    fs.writeFileSync(presetsPath, JSON.stringify(presets, null, 2));
    logger(`💾 Preset snapshot saved to ${presetsPath}`);
  }

  /**
   * Load filter options snapshot from JSON file and merge with user-defined presets
   * from preset.json at the project root.
   * User presets are loaded first; snapshot presets (data-derived) take precedence
   * on ID collision so dynamic suggestions always win.
   * @param {string} dbDir - path to the DB directory (used to construct full path to presets file)
   * @param {Function} logger - Logger function
   * @returns {Object} Merged preset map (never null — at minimum returns user presets or {})
   */
  static loadPreset(dbDir, logger = console.log) {
    const userPresets = PresetService.loadUserPresets(null, logger);

    const presetsPath = PresetService.getPresetsPath(dbDir);
    if (!fs.existsSync(presetsPath)) return userPresets;
    try {
      const raw = fs.readFileSync(presetsPath, 'utf-8');
      const snapshotPresets = JSON.parse(raw) || {};

      // Warn when a snapshot entry shadows a user-defined preset with the same id.
      // This typically means the preset was part of the codebase at scan time and
      // was written into neuf-presets.json.  Edits to preset.json won't take effect
      // for those ids until the database is rebuilt (delete neuf-logs.db and re-scan).
      const shadowed = Object.keys(userPresets).filter(id => id in snapshotPresets);
      if (shadowed.length > 0) {
        logger(`⚠️  The following preset(s) in preset.json are shadowed by the scan-time snapshot and won't reflect your edits until you rebuild the database: ${shadowed.join(', ')}`);
      }

      // Snapshot (data-derived) presets override user presets on key collision
      return { ...userPresets, ...snapshotPresets };
    } catch (e) {
      logger(`⚠️  Failed to load preset snapshot: ${e.message}`);
      return userPresets;
    }
  }

  // ...existing code...

  /**
   * Apply preset filters into an existing filters object (mutates in place).
   * Reads filters.preset (string or array), resolves against snapshotOptions,
   * and merges matching preset filters in order.
   * No-op if filters.preset is empty or no preset matches.
   * @param {Object} filters - Filters object (will be mutated in place)
   * @param {Object} presets - filterOptions presets from base logs table
   * @param {Function} logger - Logger function
   */
  static applyPreset(filters, presets, logger = console.log) {
    if (!filters || !filters.preset) return;

    const presetIds = Array.isArray(filters.preset)
      ? filters.preset.filter(Boolean)
      : [filters.preset];

    if (presetIds.length === 0) return;

    for (const presetId of presetIds) {
      const suggestion = presets[presetId];
      if (!suggestion) {
        logger(`⚠️  Preset not found: "${presetId}"`);
        continue;
      }
      // Merge array fields instead of overwriting to support combining multiple presets
      for (const [key, value] of Object.entries(suggestion.filters)) {
        if (Array.isArray(value) && Array.isArray(filters[key])) {
          filters[key] = [...new Set([...filters[key], ...value])];
        } else {
          filters[key] = value;
        }
      }
    }
  }

  /**
   * Generate preset suggestions based on current data.
   * Suggestions are contextually aware: options already applied via currentFilters
   * are not re-suggested.
   *
   * @param {Object} filterOptions - Options object from getFilterOptions()
   * @param {string[]} filterOptions.devices - Device entries with device_id and count
   * @param {string[]} filterOptions.components - Component entries with component_name and count
   * @param {string[]} filterOptions.threads - Thread entries with thread_name and count
   * @param {string[]} filterOptions.logLevels - Log level entries with log_level and count
   * @param {number} filterOptions.totalLogs - Total number of logs matching current filters
   * @returns {Object} Map of preset id to suggestion object:
   *   { [id]: { id, label, description, filters } }
   * Note: filters field is for internal API use (preset resolution); not exposed to clients.
   */
  static getPresetSuggestions(filterOptions = {}) {
     const suggestions = {};
     const {
       devices = [],
       components = [],
       threads = [],
       logLevels = []
     } = filterOptions;

      // Only return suggestions if there is some data to work with
      const hasData = components.length > 0 || logLevels.length > 0 || devices.length > 0 || threads.length > 0;
      if (!hasData) {
          return suggestions;
      }

     // ── Component suggestions ─────────────────────────────────────────────────
     if (components.length >= 5) {
       // Take top 10 non-null components after filtering out nulls
       const topComponents = components
         .map(c => c.component_name)
         .filter(Boolean)
         .slice(0, 10);
       if (topComponents.length > 0) {
         suggestions["exclude_top_components"] = {
           id: 'exclude_top_components',
           label: `🔧 Exclude top ${topComponents.length} noisiest components`,
           description: `Exclude the ${topComponents.length} most frequent components to reduce noise: ${topComponents.join(', ')}`,
           filters: { componentExclude: topComponents }
         };
       }
     }

     // ── Log level suggestions ─────────────────────────────────────────────────
     const hasErrors = logLevels.some(l => l.log_level === 'ERROR');
     const hasWarnings = logLevels.some(l => l.log_level === 'WARN');

     if (hasErrors || hasWarnings) {
       const levels = [];
       if (hasErrors) levels.push('ERROR');
       if (hasWarnings) levels.push('WARN');
       suggestions["errors_and_warnings"] = {
         id: 'errors_and_warnings',
         label: '⚠️ Show errors and warnings only',
         description: `Filter to ${levels.join(' + ')} log levels only`,
         filters: { logLevelInclude: levels }
       };
     }

     if (hasErrors) {
       suggestions["errors_only"] = {
         id: 'errors_only',
         label: '🔴 Show errors only',
         description: 'Filter to ERROR log level only',
         filters: { logLevelInclude: ['ERROR'] }
       };
     }

     return suggestions;
   }
}

module.exports = { PresetService };
