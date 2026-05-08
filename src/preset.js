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
   * Load and parse a preset JSON file from disk.
   * Returns null if the file is absent, undefined, or cannot be parsed.
   * @param {string} filePath - Full path to the JSON file
   * @param {Function} logger - Logger function
   * @returns {Object|null} Parsed JSON object, or null on failure
   */
  static loadPresetFile(filePath, logger = console.log) {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) || null;
    } catch (e) {
      logger(`⚠️  Failed to load preset file "${filePath}": ${e.message}`);
      return null;
    }
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
    const parsed = PresetService.loadPresetFile(filePath, logger);
    if (!parsed) return {};
    // Validate each entry: warn and skip any that lack a valid `filters` object,
    // because applyPreset() calls Object.entries(preset.filters) and would crash.
    const valid = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || !entry.filters || typeof entry.filters !== 'object') {
        logger(`⚠️  Skipping malformed preset "${id}" in ${filePath}: missing or invalid "filters" property`);
        continue;
      }
      valid[id] = entry;
    }
    return valid;
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
    const snapshotPresets = PresetService.loadPresetFile(presetsPath, logger);
    if (!snapshotPresets) return userPresets;

    // Warn when a snapshot entry shadows a user-defined preset with the same id.
    // This typically means the preset was part of the codebase at scan time and
    // was written into neuf-presets.json.  Edits to preset.json won't take effect
    // for those ids until the database is rebuilt (delete neuf-logs.db and re-scan).
    const shadowed = Object.keys(userPresets).filter(id => id in snapshotPresets);
    if (shadowed.length > 0) {
      shadowed.forEach(id => logger(`⚠️  User preset "${id}" is overridden by scan preset`));
    }

    // Snapshot (data-derived) presets override user presets on key collision
    return { ...userPresets, ...snapshotPresets };
  }

  // ...existing code...

  /**
   * Merge time ranges (timeFrom/timeTo) using intersection logic.
   * Takes the larger timeFrom (most recent start) and smaller timeTo (earliest end).
   * Handles both string and numeric (Unix seconds) timestamps.
   * No-op if only one side has a time value — uses the available one.
   * @param {string|number|null} userTime - User-provided time value
   * @param {string|number|null} presetTime - Preset time value
   * @param {'from'|'to'} type - 'from' for timeFrom, 'to' for timeTo
   * @returns {string|number|null} Merged time value
   */
  static _mergeTimeRange(userTime, presetTime, type) {
    if (!userTime && !presetTime) return null;
    if (!userTime) return presetTime;
    if (!presetTime) return userTime;

    // Convert to comparable format (Unix seconds)
    const userSec = typeof userTime === 'number' ? userTime : this._parseTimestampSec(userTime)?.floorSec;
    const presetSec = typeof presetTime === 'number' ? presetTime : this._parseTimestampSec(presetTime)?.floorSec;

    if (userSec === null || userSec === undefined || presetSec === null || presetSec === undefined) {
      // If parse fails, return user value (user input takes precedence in case of error)
      return userTime;
    }

    // For timeFrom: take the larger (more recent start) — creates narrower range
    // For timeTo: take the smaller (earlier end) — creates narrower range
    const selectedSec = type === 'from' ? Math.max(userSec, presetSec) : Math.min(userSec, presetSec);

    // Return in same format as userTime (preserve original format)
    if (typeof userTime === 'number') {
      return selectedSec;
    } else {
      return this._formatUnixSec(selectedSec);
    }
  }

  /**
   * Apply preset filters into an existing filters object (mutates in place).
   * Reads filters.preset (string or array), resolves against snapshotOptions,
   * and merges matching preset filters in order.
   * For time ranges (timeFrom/timeTo): computes intersection when both preset and user have values.
   * For array fields: merges values (combines multiple presets).
   * For other fields: uses preset value if not already set by user.
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
      // Merge preset filters into user filters
      for (const [key, value] of Object.entries(suggestion.filters)) {
        if (key === 'timeFrom' || key === 'timeTo') {
          // Time range: compute intersection
          filters[key] = this._mergeTimeRange(filters[key], value, key === 'timeFrom' ? 'from' : 'to');
        } else if (Array.isArray(value) && Array.isArray(filters[key])) {
          // Array field: merge values to support combining multiple presets
          filters[key] = [...new Set([...filters[key], ...value])];
        } else {
          // Other fields: use preset value if not already set
          if (filters[key] === undefined || filters[key] === null || filters[key] === '') {
            filters[key] = value;
          }
        }
      }
    }
  }

  /**
   * Parse a log timestamp string to floor/ceil Unix seconds.
   * Supports formats with and without milliseconds:
   * - "YYYY.MM.DD HH:mm:ss.SSS" (with milliseconds)
   * - "YYYY.MM.DD HH:mm:ss" (without milliseconds)
   * @param {string} ts - Timestamp string
   * @returns {{ floorSec: number, ceilSec: number }|null}
   */
  static _parseTimestampSec(ts) {
    // Match with optional milliseconds
    const m = ts.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/);
    if (!m) return null;
    const ms = m[7] ? parseInt(m[7], 10) : 0;
    const unixMs = Date.UTC(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10), parseInt(m[6], 10), ms
    );
    return {
      floorSec: Math.floor(unixMs / 1000),
      ceilSec: Math.ceil(unixMs / 1000)
    };
  }

  /**
   * Format Unix timestamp (seconds, UTC) to "YYYY.MM.DD HH:mm:ss" string.
   * @param {number} unixSec
   * @returns {string}
   */
  static _formatUnixSec(unixSec) {
    const d = new Date(unixSec * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  /**
   * Create install-based presets from LifecycleProvider install log entries.
   * Groups by device_id, sorts timestamps, and creates a preset for each interval
   * between consecutive installs plus one for the last (open-ended) install.
   * timeFrom/timeTo stored as Unix seconds (numbers) so normalizeFilters passes them through unchanged.
   * @param {Array<{device_id: string, timestamp: string}>} installLogs - Install log rows from DB
   * @returns {Object} Map of preset id to preset object
   */
  static createInstallPresets(installLogs) {
    const presets = {};

    // Group timestamps by device_id
    const byDevice = {};
    for (const log of installLogs) {
      if (!log.device_id) continue;
      if (!byDevice[log.device_id]) byDevice[log.device_id] = [];
      byDevice[log.device_id].push(log.timestamp);
    }

    for (const [deviceId, timestamps] of Object.entries(byDevice)) {
      // Ensure ascending order
      timestamps.sort();

      for (let i = 0; i < timestamps.length; i++) {
        const parsedFrom = PresetService._parseTimestampSec(timestamps[i]);
        if (!parsedFrom) continue;

        const timeFromSec = parsedFrom.floorSec;
        const timeFromStr = PresetService._formatUnixSec(timeFromSec);
        const presetId = `fujifilm_${deviceId}_install_${i + 1}`;

        let label, filters;

        if (i < timestamps.length - 1) {
          // Interval between this install and the next
          const parsedTo = PresetService._parseTimestampSec(timestamps[i + 1]);
          if (!parsedTo) continue;
          const timeToSec = parsedTo.ceilSec;
          const timeToStr = PresetService._formatUnixSec(timeToSec);
          label = `📦 Fujifilm-${deviceId} install from ${timeFromStr} -> ${timeToStr}`;
          filters = { timeFrom: timeFromSec, timeTo: timeToSec, deviceInclude: [deviceId, null] };
        } else {
          // Last install — open-ended, no timeTo
          label = `📦 Fujifilm-${deviceId} install from ${timeFromStr}`;
          filters = { timeFrom: timeFromSec, deviceInclude: [deviceId, null] };
        }

        presets[presetId] = {
          id: presetId,
          label,
          description: label,
          filters
        };
      }
    }

    return presets;
  }
}

module.exports = { PresetService };
