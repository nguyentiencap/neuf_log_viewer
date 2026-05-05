/**
 * Preset Service Tests
 * Tests for the PresetService dynamic filter suggestion logic
 */

const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');
const { PresetService } = require('../src/preset');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeComponents(names) {
  return names.map((name, i) => ({ component_name: name, count: 500 - i * 30 }));
}

function makeLogLevels(levels) {
  return levels.map(level => ({ log_level: level, count: 100 }));
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

printSummary('PRESET SERVICE');
