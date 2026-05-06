/**
 * Preset Service Tests
 * Tests for the PresetService dynamic filter suggestion logic
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PresetService } = require('../src/preset');
// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeComponents(names) {
  return names.map((name, i) => ({ component_name: name, count: 500 - i * 30 }));
}
function makeLogLevels(levels) {
  return levels.map(level => ({ log_level: level, count: 100 }));
}
// ─── empty / minimal data ─────────────────────────────────────────────────────
describe('PresetService.getPresetSuggestions — empty / minimal data', () => {
  test('Returns empty object for empty filter options', () => {
    const suggestions = PresetService.getPresetSuggestions({});
    expect(Object.keys(suggestions).length).toBe(0);
  });
  test('Returns empty object when no fields have data', () => {
    const options = { components: [], logLevels: [], totalLogs: 0 };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions).length).toBe(0);
  });
});
// ─── Component suggestions ────────────────────────────────────────────────────
describe('PresetService.getPresetSuggestions — component suggestions', () => {
  test('Suggests exclude_top_components when 5+ components exist', () => {
    const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions)).toContain('exclude_top_components');
  });
  test('No exclude_top_components when fewer than 5 components', () => {
    const options = { components: makeComponents(['A', 'B', 'C']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions)).not.toContain('exclude_top_components');
  });
  test('exclude_top_components caps at 10 entries', () => {
    const names = Array.from({ length: 15 }, (_, i) => 'Comp' + i);
    const options = { components: makeComponents(names) };
    const suggestions = PresetService.getPresetSuggestions(options);
    const suggestion = suggestions['exclude_top_components'];
    expect(suggestion.filters.componentExclude.length).toBeLessThanOrEqual(10);
  });
});
// ─── Log level suggestions ────────────────────────────────────────────────────
describe('PresetService.getPresetSuggestions — log level suggestions', () => {
  test('Suggests errors_and_warnings when ERROR and WARN present', () => {
    const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions)).toContain('errors_and_warnings');
  });
  test('Suggests errors_only when ERROR level present', () => {
    const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'ERROR']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions)).toContain('errors_only');
  });
  test('No errors_only when ERROR not present', () => {
    const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions)).not.toContain('errors_only');
  });
  test('No errors_and_warnings when neither ERROR nor WARN present', () => {
    const options = { logLevels: makeLogLevels(['DEBUG', 'INFO']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions)).not.toContain('errors_and_warnings');
  });
});
// ─── Suggestion object shape ──────────────────────────────────────────────────
describe('PresetService.getPresetSuggestions — suggestion object shape', () => {
  test('Each suggestion has required fields: id, label, description, filters', () => {
    const options = { logLevels: makeLogLevels(['ERROR', 'WARN']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    const valid = Object.values(suggestions).every(s =>
      typeof s.id === 'string' &&
      typeof s.label === 'string' &&
      typeof s.description === 'string' &&
      typeof s.filters === 'object'
    );
    expect(valid).toBe(true);
  });
  test('Suggestion filters values are non-empty arrays', () => {
    const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E']) };
    const suggestions = PresetService.getPresetSuggestions(options);
    const valid = Object.values(suggestions).every(s =>
      Object.values(s.filters).every(v => Array.isArray(v) && v.length > 0)
    );
    expect(valid).toBe(true);
  });
  test('Suggestion id matches its key in the map', () => {
    const options = {
      components: makeComponents(['A', 'B', 'C', 'D', 'E']),
      logLevels: makeLogLevels(['ERROR'])
    };
    const suggestions = PresetService.getPresetSuggestions(options);
    const valid = Object.entries(suggestions).every(([key, s]) => s.id === key);
    expect(valid).toBe(true);
  });
});
// ─── Combined scenario ────────────────────────────────────────────────────────
describe('PresetService.getPresetSuggestions — combined scenario', () => {
  test('Multiple suggestion types returned for rich data set', () => {
    const options = {
      components: makeComponents(['A', 'B', 'C', 'D', 'E', 'F']),
      logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']),
      totalLogs: 5000
    };
    const suggestions = PresetService.getPresetSuggestions(options);
    expect(Object.keys(suggestions).length).toBeGreaterThanOrEqual(3);
  });
});
// ─── applyPreset ──────────────────────────────────────────────────────────────
describe('PresetService.applyPreset', () => {
  test('No-op when filters has no preset field', () => {
    const filters = { logLevelInclude: ['ERROR'] };
    PresetService.applyPreset(filters, {});
    expect(filters).toEqual({ logLevelInclude: ['ERROR'] });
  });
  test('No-op when preset is empty string', () => {
    const filters = { preset: '' };
    PresetService.applyPreset(filters, {});
    expect(Object.keys(filters)).toEqual(['preset']);
  });
  test('No-op when preset is empty array', () => {
    const filters = { preset: [] };
    PresetService.applyPreset(filters, {});
    expect(Object.keys(filters)).toEqual(['preset']);
  });
  test('Applies preset by string id — errors_only', () => {
    const presets = PresetService.getPresetSuggestions({ logLevels: makeLogLevels(['INFO', 'ERROR']) });
    const filters = { preset: 'errors_only' };
    PresetService.applyPreset(filters, presets);
    expect(filters.logLevelInclude).toEqual(['ERROR']);
  });
  test('Applies preset by array id — errors_only', () => {
    const presets = PresetService.getPresetSuggestions({ logLevels: makeLogLevels(['INFO', 'ERROR']) });
    const filters = { preset: ['errors_only'] };
    PresetService.applyPreset(filters, presets);
    expect(filters.logLevelInclude).toEqual(['ERROR']);
  });
  test('Applies exclude_top_components preset', () => {
    const presets = PresetService.getPresetSuggestions({ components: makeComponents(['A', 'B', 'C', 'D', 'E']) });
    const filters = { preset: 'exclude_top_components' };
    PresetService.applyPreset(filters, presets);
    expect(Array.isArray(filters.componentExclude) && filters.componentExclude.length === 5).toBe(true);
  });
  test('Applies multiple presets from array', () => {
    const presets = PresetService.getPresetSuggestions({
      components: makeComponents(['A', 'B', 'C', 'D', 'E']),
      logLevels: makeLogLevels(['INFO', 'ERROR'])
    });
    const filters = { preset: ['exclude_top_components', 'errors_only'] };
    PresetService.applyPreset(filters, presets);
    expect(Array.isArray(filters.componentExclude)).toBe(true);
    expect(filters.logLevelInclude[0]).toBe('ERROR');
  });
  test('Unknown preset id is skipped without throwing', () => {
    const presets = PresetService.getPresetSuggestions({ logLevels: makeLogLevels(['ERROR']) });
    const filters = { preset: 'nonexistent_preset' };
    const warnings = [];
    PresetService.applyPreset(filters, presets, (msg) => warnings.push(msg));
    expect(warnings.length).toBe(1);
  });
  test('Preset filters reflect the snapshot used to build presets', () => {
    const presets = PresetService.getPresetSuggestions({ components: makeComponents(['A', 'B', 'C', 'D', 'E']) });
    const filters = { preset: 'exclude_top_components' };
    PresetService.applyPreset(filters, presets);
    expect(filters.componentExclude).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});
// ─── loadUserPresets ──────────────────────────────────────────────────────────
describe('PresetService.loadUserPresets', () => {
  test('Returns empty object when file does not exist', () => {
    const result = PresetService.loadUserPresets('/tmp/nonexistent-preset.json');
    expect(Object.keys(result).length).toBe(0);
  });
  test('Loads and parses a valid preset JSON file', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-preset-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
    const presets = {
      test_preset: {
        id: 'test_preset',
        label: '🧪 Test preset',
        description: 'A test preset',
        filters: { componentExclude: ['%Test%'] }
      }
    };
    fs.writeFileSync(tmpFile, JSON.stringify(presets));
    try {
      const result = PresetService.loadUserPresets(tmpFile);
      expect(result.test_preset && result.test_preset.id).toBe('test_preset');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
  test('Returns empty object for a malformed JSON file', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-preset-bad-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmpFile, 'not valid json {{{');
    try {
      const warnings = [];
      const result = PresetService.loadUserPresets(tmpFile, (msg) => warnings.push(msg));
      expect(Object.keys(result).length).toBe(0);
      expect(warnings.length).toBe(1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
  test('Skips and warns for entries missing the filters property', () => {
    const tmpFile = path.join(os.tmpdir(), 'test-preset-nofilters-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
    const presets = {
      good_preset:        { id: 'good_preset',        label: 'Good',       description: 'ok',                   filters: { logLevelInclude: ['ERROR'] } },
      bad_no_filters:     { id: 'bad_no_filters',      label: 'No filters', description: 'missing filters field' },
      bad_null_filters:   { id: 'bad_null_filters',    label: 'Null',       description: 'null filters',         filters: null },
      bad_string_filters: { id: 'bad_string_filters',  label: 'String',     description: 'non-object filters',   filters: 'ERROR' }
    };
    fs.writeFileSync(tmpFile, JSON.stringify(presets));
    try {
      const warnings = [];
      const result = PresetService.loadUserPresets(tmpFile, (msg) => warnings.push(msg));
      expect('good_preset' in result).toBe(true);
      expect('bad_no_filters' in result).toBe(false);
      expect('bad_null_filters' in result).toBe(false);
      expect('bad_string_filters' in result).toBe(false);
      expect(warnings.length).toBe(3);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
  test('User presets from preset.json at project root are loadable', () => {
    const presets = PresetService.loadUserPresets();
    const valid = Object.values(presets).every(p =>
      typeof p.id === 'string' &&
      typeof p.label === 'string' &&
      typeof p.description === 'string' &&
      typeof p.filters === 'object'
    );
    expect(valid).toBe(true);
  });
  test('Static presets from preset.json can be applied via applyPreset', () => {
    const userPresets = PresetService.loadUserPresets();
    const filters = { preset: 'exclude_endpoint_tester' };
    PresetService.applyPreset(filters, userPresets);
    expect(Array.isArray(filters.componentExclude)).toBe(true);
    expect(filters.componentExclude).toContain('%Endpoint%');
  });
});
// ─── loadPreset (merged) ──────────────────────────────────────────────────────
describe('PresetService.loadPreset — merged from preset.json + snapshot', () => {
  test('Returns user presets when no snapshot file exists', () => {
    const result = PresetService.loadPreset('/tmp/nonexistent-db-dir');
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect('exclude_endpoint_tester' in result).toBe(true);
  });
  test('Merges snapshot presets with user presets; snapshot takes precedence', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuf-test-'));
    const snapshotPath = path.join(tmpDir, 'neuf-presets.json');
    const snapshot = {
      custom_snap: {
        id: 'custom_snap',
        label: '📸 Snapshot preset',
        description: 'From snapshot',
        filters: { logLevelInclude: ['ERROR'] }
      },
      exclude_endpoint_tester: {
        id: 'exclude_endpoint_tester',
        label: '📸 Overridden by snapshot',
        description: 'Snapshot version',
        filters: { componentExclude: ['%SnapshotEndpoint%'] }
      }
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    try {
      const result = PresetService.loadPreset(tmpDir);
      expect('exclude_historical_data' in result).toBe(true);
      expect('custom_snap' in result).toBe(true);
      expect(result.exclude_endpoint_tester.label).toBe('📸 Overridden by snapshot');
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
  test('Returns user presets when snapshot file is malformed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuf-test-'));
    const snapshotPath = path.join(tmpDir, 'neuf-presets.json');
    fs.writeFileSync(snapshotPath, 'not valid json');
    try {
      const warnings = [];
      const result = PresetService.loadPreset(tmpDir, (msg) => warnings.push(msg));
      expect('exclude_endpoint_tester' in result).toBe(true);
      expect(warnings.length).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
  test('Logs a warning when snapshot shadows user preset.json entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuf-test-'));
    const snapshotPath = path.join(tmpDir, 'neuf-presets.json');
    const snapshot = {
      exclude_endpoint_tester: {
        id: 'exclude_endpoint_tester',
        label: '📸 Snapshot version',
        description: 'Shadowing user preset',
        filters: { componentExclude: ['%Endpoint%'] }
      }
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    try {
      const warnings = [];
      PresetService.loadPreset(tmpDir, (msg) => warnings.push(msg));
      const hasWarning = warnings.some(msg => msg.includes('exclude_endpoint_tester') && msg.includes('overridden'));
      expect(hasWarning).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
