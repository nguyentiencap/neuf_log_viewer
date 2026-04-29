/**
 * Preset Module
 * Provides dynamic filter suggestions for the preset feature.
 * Each suggestion is computed from current filter option data and can be
 * applied in one click to progressively narrow down log results.
 *
 * Responsibility: Generate contextual filter suggestions based on data analytics
 */

/**
 * Preset Service
 * Generates dynamic filter suggestions based on current filter option data.
 * Pure utility service — no DB access, all inputs passed as parameters.
 */
class PresetService {
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
   * @param {Object} currentFilters - Currently applied filters (already normalised)
   * @returns {Array<Object>} List of suggestion objects:
   *   { id, label, description, filters }
   * Note: filters field is for internal API use (preset resolution); not exposed to clients.
   */
  static getSuggestions(filterOptions = {}, currentFilters = {}) {
    const suggestions = [];
    const {
      devices = [],
      components = [],
      threads = [],
      logLevels = []
    } = filterOptions;

    // ── Device suggestions ────────────────────────────────────────────────────
    if (devices.length > 1 && !(currentFilters.deviceInclude && currentFilters.deviceInclude.length)) {
      const topDevice = devices[0];
      suggestions.push({
        id: 'focus_top_device',
        label: `📱 Focus on device: ${topDevice.device_id}`,
        description: `Show only logs from device "${topDevice.device_id}" (${Number(topDevice.count).toLocaleString()} entries)`,
        filters: { deviceInclude: [topDevice.device_id] }
      });
    }

    // ── Component suggestions ─────────────────────────────────────────────────
    if (components.length >= 5 && !(currentFilters.componentExclude && currentFilters.componentExclude.length)) {
      const topN = Math.min(10, components.length);
      const topComponents = components.slice(0, topN).map(c => c.component_name).filter(Boolean);
      if (topComponents.length > 0) {
        suggestions.push({
          id: 'exclude_top_components',
          label: `🔧 Exclude top ${topComponents.length} noisiest components`,
          description: `Exclude the ${topComponents.length} most frequent components to reduce noise: ${topComponents.join(', ')}`,
          filters: { componentExclude: topComponents }
        });
      }
    }

    if (components.length >= 1 && !(currentFilters.componentInclude && currentFilters.componentInclude.length)) {
      const topComponent = components[0];
      if (topComponent.component_name) {
        suggestions.push({
          id: 'focus_top_component',
          label: `🔧 Focus on: ${topComponent.component_name}`,
          description: `Show only logs from "${topComponent.component_name}" (${Number(topComponent.count).toLocaleString()} entries, most active)`,
          filters: { componentInclude: [topComponent.component_name] }
        });
      }
    }

    // ── Log level suggestions ─────────────────────────────────────────────────
    if (!(currentFilters.logLevelInclude && currentFilters.logLevelInclude.length)) {
      const hasErrors = logLevels.some(l => l.log_level === 'ERROR');
      const hasWarnings = logLevels.some(l => l.log_level === 'WARN');

      if (hasErrors || hasWarnings) {
        const levels = [];
        if (hasErrors) levels.push('ERROR');
        if (hasWarnings) levels.push('WARN');
        suggestions.push({
          id: 'errors_and_warnings',
          label: '⚠️ Show errors and warnings only',
          description: `Filter to ${levels.join(' + ')} log levels only`,
          filters: { logLevelInclude: levels }
        });
      }

      if (hasErrors) {
        suggestions.push({
          id: 'errors_only',
          label: '🔴 Show errors only',
          description: 'Filter to ERROR log level only',
          filters: { logLevelInclude: ['ERROR'] }
        });
      }
    }

    return suggestions;
  }
}

module.exports = { PresetService };
