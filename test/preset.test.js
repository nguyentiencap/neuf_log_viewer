/**
 * Preset Service Tests
 * Tests for the PresetService dynamic filter suggestion logic
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');
const { PresetService } = require('../src/preset');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeComponents(names) {
  return names.map((name, i) => ({ component_name: name, count: 500 - i * 30 }));
}

function makeLogLevels(levels) {
  return levels.map(level => ({ log_level: level, count: 100 }));
}

/** Recursively delete a directory; works on Node.js 12+ (no fs.rmSync required). */
function rmdirRec(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function(entry) {
    const full = path.join(dir, entry);
    if (fs.lstatSync(full).isDirectory()) {
      rmdirRec(full);
    } else {
      fs.unlinkSync(full);
    }
  });
  fs.rmdirSync(dir);
}

// suggestions is an object map { [id]: { ... } }
function getSuggestionIds(suggestions) {
  return Object.keys(suggestions);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

printSection('PresetService.getPresetSuggestions — empty / minimal data');

runTest('Returns empty object for empty filter options', function() {
  const suggestions = PresetService.getPresetSuggestions({});
  return assertEqual(Object.keys(suggestions).length, 0, 'Empty filterOptions should produce no suggestions');
});

runTest('Returns empty object when no fields have data', function() {
  const options = { components: [], logLevels: [], totalLogs: 0 };
  const suggestions = PresetService.getPresetSuggestions(options);
  return assertEqual(Object.keys(suggestions).length, 0, 'All-empty arrays should produce no suggestions');
});

// ─── Component suggestions ────────────────────────────────────────────────────

printSection('PresetService.getPresetSuggestions — component suggestions');

runTest('Suggests exclude_top_components when 5+ components exist', function() {
  const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const ids = getSuggestionIds(suggestions);
  return assertEqual(ids.includes('exclude_top_components'), true, 'Should suggest exclude_top_components');
});

runTest('No exclude_top_components when fewer than 5 components', function() {
  const options = { components: makeComponents(['A', 'B', 'C']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const ids = getSuggestionIds(suggestions);
  return assertEqual(ids.includes('exclude_top_components'), false, 'Should not suggest with < 5 components');
});

runTest('exclude_top_components caps at 10 entries', function() {
  const names = Array.from({ length: 15 }, (_, i) => 'Comp' + i);
  const options = { components: makeComponents(names) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const suggestion = suggestions['exclude_top_components'];
  return assertEqual(
    suggestion && suggestion.filters.componentExclude.length <= 10,
    true,
    'Should exclude at most 10 components'
  );
});


// ─── Log level suggestions ────────────────────────────────────────────────────

printSection('PresetService.getPresetSuggestions — log level suggestions');

runTest('Suggests errors_and_warnings when ERROR and WARN present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const ids = getSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_and_warnings'), true, 'Should suggest errors_and_warnings');
});

runTest('Suggests errors_only when ERROR level present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'ERROR']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const ids = getSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_only'), true, 'Should suggest errors_only when ERROR present');
});

runTest('No errors_only when ERROR not present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const ids = getSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_only'), false, 'Should not suggest errors_only without ERROR level');
});

runTest('No errors_and_warnings when neither ERROR nor WARN present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const ids = getSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_and_warnings'), false, 'Should not suggest errors_and_warnings without WARN/ERROR');
});

// ─── Suggestion object shape ──────────────────────────────────────────────────

printSection('PresetService.getPresetSuggestions — suggestion object shape');

runTest('Each suggestion has required fields: id, label, description, filters', function() {
  const options = { logLevels: makeLogLevels(['ERROR', 'WARN']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const valid = Object.values(suggestions).every(s =>
    typeof s.id === 'string' &&
    typeof s.label === 'string' &&
    typeof s.description === 'string' &&
    typeof s.filters === 'object'
  );
  return assertEqual(valid, true, 'All suggestions should have id, label, description, filters');
});

runTest('Suggestion filters values are non-empty arrays', function() {
  const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E']) };
  const suggestions = PresetService.getPresetSuggestions(options);
  const valid = Object.values(suggestions).every(s =>
    Object.values(s.filters).every(v => Array.isArray(v) && v.length > 0)
  );
  return assertEqual(valid, true, 'All filter values should be non-empty arrays');
});

runTest('Suggestion id matches its key in the map', function() {
  const options = {
    components: makeComponents(['A', 'B', 'C', 'D', 'E']),
    logLevels: makeLogLevels(['ERROR'])
  };
  const suggestions = PresetService.getPresetSuggestions(options);
  const valid = Object.entries(suggestions).every(([key, s]) => s.id === key);
  return assertEqual(valid, true, 'Each suggestion id should match its map key');
});

// ─── Combined scenario ────────────────────────────────────────────────────────

printSection('PresetService.getPresetSuggestions — combined scenario');

runTest('Multiple suggestion types returned for rich data set', function() {
  const options = {
    components: makeComponents(['A', 'B', 'C', 'D', 'E', 'F']),
    logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']),
    totalLogs: 5000
  };
  const suggestions = PresetService.getPresetSuggestions(options);
  // expects: exclude_top_components, errors_and_warnings, errors_only
  return assertEqual(Object.keys(suggestions).length >= 3, true, 'Should return at least 3 suggestions for rich data');
});

// ─── applyPreset ──────────────────────────────────────────────────────────────

printSection('PresetService.applyPreset');

runTest('No-op when filters has no preset field', function() {
  const filters = { logLevelInclude: ['ERROR'] };
  PresetService.applyPreset(filters, {});
  return assertEqual(filters, { logLevelInclude: ['ERROR'] }, 'filters should be unchanged');
});

runTest('No-op when preset is empty string', function() {
  const filters = { preset: '' };
  PresetService.applyPreset(filters, {});
  return assertEqual(Object.keys(filters), ['preset'], 'no extra keys should be added');
});

runTest('No-op when preset is empty array', function() {
  const filters = { preset: [] };
  PresetService.applyPreset(filters, {});
  return assertEqual(Object.keys(filters), ['preset'], 'no extra keys should be added');
});

runTest('Applies preset by string id — errors_only', function() {
  // presets map is computed from getPresetSuggestions, then passed to applyPreset
  const presets = PresetService.getPresetSuggestions({ logLevels: makeLogLevels(['INFO', 'ERROR']) });
  const filters = { preset: 'errors_only' };
  PresetService.applyPreset(filters, presets);
  return assertEqual(filters.logLevelInclude, ['ERROR'], 'should add logLevelInclude: [ERROR]');
});

runTest('Applies preset by array id — errors_only', function() {
  const presets = PresetService.getPresetSuggestions({ logLevels: makeLogLevels(['INFO', 'ERROR']) });
  const filters = { preset: ['errors_only'] };
  PresetService.applyPreset(filters, presets);
  return assertEqual(filters.logLevelInclude, ['ERROR'], 'should add logLevelInclude: [ERROR]');
});

runTest('Applies exclude_top_components preset', function() {
  const presets = PresetService.getPresetSuggestions({ components: makeComponents(['A', 'B', 'C', 'D', 'E']) });
  const filters = { preset: 'exclude_top_components' };
  PresetService.applyPreset(filters, presets);
  return assertEqual(Array.isArray(filters.componentExclude) && filters.componentExclude.length === 5, true, 'should exclude 5 components');
});

runTest('Applies multiple presets from array', function() {
  const presets = PresetService.getPresetSuggestions({
    components: makeComponents(['A', 'B', 'C', 'D', 'E']),
    logLevels: makeLogLevels(['INFO', 'ERROR'])
  });
  const filters = { preset: ['exclude_top_components', 'errors_only'] };
  PresetService.applyPreset(filters, presets);
  return assertEqual(
    Array.isArray(filters.componentExclude) && filters.logLevelInclude[0] === 'ERROR',
    true,
    'should apply both presets'
  );
});

runTest('Unknown preset id is skipped without throwing', function() {
  const presets = PresetService.getPresetSuggestions({ logLevels: makeLogLevels(['ERROR']) });
  const filters = { preset: 'nonexistent_preset' };
  const warnings = [];
  PresetService.applyPreset(filters, presets, (msg) => warnings.push(msg));
  return assertEqual(warnings.length, 1, 'should log one warning for unknown preset');
});

runTest('Preset filters reflect the snapshot used to build presets', function() {
  const presets = PresetService.getPresetSuggestions({ components: makeComponents(['A', 'B', 'C', 'D', 'E']) });
  const filters = { preset: 'exclude_top_components' };
  PresetService.applyPreset(filters, presets);
  return assertEqual(filters.componentExclude, ['A', 'B', 'C', 'D', 'E'], 'should exclude exactly the 5 snapshot components');
});

// ─── loadUserPresets ──────────────────────────────────────────────────────────

printSection('PresetService.loadUserPresets');

runTest('Returns empty object when file does not exist', function() {
  const result = PresetService.loadUserPresets('/tmp/nonexistent-preset.json');
  return assertEqual(Object.keys(result).length, 0, 'should return empty object for missing file');
});

runTest('Loads and parses a valid preset JSON file', function() {
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
    return assertEqual(result.test_preset && result.test_preset.id, 'test_preset', 'should load test_preset from file');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

runTest('Returns empty object for a malformed JSON file', function() {
  const tmpFile = path.join(os.tmpdir(), 'test-preset-bad-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(tmpFile, 'not valid json {{{');
  try {
    const warnings = [];
    const result = PresetService.loadUserPresets(tmpFile, (msg) => warnings.push(msg));
    return assertEqual(Object.keys(result).length === 0 && warnings.length === 1, true, 'should return empty object and log warning');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

runTest('User presets from preset.json at project root are loadable', function() {
  // Verifies the actual preset.json ships with required fields on every entry
  const presets = PresetService.loadUserPresets();
  const valid = Object.values(presets).every(p =>
    typeof p.id === 'string' &&
    typeof p.label === 'string' &&
    typeof p.description === 'string' &&
    typeof p.filters === 'object'
  );
  return assertEqual(valid, true, 'all entries in preset.json should have id, label, description, filters');
});

runTest('Static presets from preset.json can be applied via applyPreset', function() {
  const userPresets = PresetService.loadUserPresets();
  const filters = { preset: 'exclude_endpoint_tester' };
  PresetService.applyPreset(filters, userPresets);
  return assertEqual(
    Array.isArray(filters.componentExclude) && filters.componentExclude.includes('%Endpoint%'),
    true,
    'should apply exclude_endpoint_tester from preset.json'
  );
});

// ─── loadPreset (merged) ──────────────────────────────────────────────────────

printSection('PresetService.loadPreset — merged from preset.json + snapshot');

runTest('Returns user presets when no snapshot file exists', function() {
  const result = PresetService.loadPreset('/tmp/nonexistent-db-dir');
  return assertEqual(
    typeof result === 'object' && result !== null && 'exclude_endpoint_tester' in result,
    true,
    'should return user presets from preset.json even without a snapshot'
  );
});

runTest('Merges snapshot presets with user presets; snapshot takes precedence', function() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuf-test-'));
  const snapshotPath = path.join(tmpDir, 'neuf-presets.json');
  const snapshot = {
    custom_snap: {
      id: 'custom_snap',
      label: '📸 Snapshot preset',
      description: 'From snapshot',
      filters: { logLevelInclude: ['ERROR'] }
    },
    // Override a key that also exists in preset.json
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
    const hasUserKey = 'exclude_historical_data' in result;
    const hasSnapKey = 'custom_snap' in result;
    const snapshotWins = result.exclude_endpoint_tester.label === '📸 Overridden by snapshot';
    return assertEqual(
      hasUserKey && hasSnapKey && snapshotWins,
      true,
      'should contain both user and snapshot presets, with snapshot winning on conflict'
    );
  } finally {
    rmdirRec(tmpDir);
  }
});

runTest('Returns user presets when snapshot file is malformed', function() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuf-test-'));
  const snapshotPath = path.join(tmpDir, 'neuf-presets.json');
  fs.writeFileSync(snapshotPath, 'not valid json');
  try {
    const warnings = [];
    const result = PresetService.loadPreset(tmpDir, (msg) => warnings.push(msg));
    return assertEqual(
      'exclude_endpoint_tester' in result && warnings.length === 1,
      true,
      'should fall back to user presets and log warning when snapshot is malformed'
    );
  } finally {
    rmdirRec(tmpDir);
  }
});

runTest('Logs a warning when snapshot shadows user preset.json entries', function() {
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
    const hasWarning = warnings.some(msg => msg.includes('exclude_endpoint_tester') && msg.includes('shadowed'));
    return assertEqual(hasWarning, true, 'should warn that exclude_endpoint_tester is shadowed by the snapshot');
  } finally {
    rmdirRec(tmpDir);
  }
});

printSummary('PRESET SERVICE');
