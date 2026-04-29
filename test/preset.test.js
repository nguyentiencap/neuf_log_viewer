/**
 * Preset Service Tests
 * Tests for the PresetService dynamic filter suggestion logic
 */

const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');
const { PresetService } = require('../lib/preset');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDevices(ids) {
  return ids.map((id, i) => ({ device_id: id, count: 1000 - i * 100 }));
}

function makeComponents(names) {
  return names.map((name, i) => ({ component_name: name, count: 500 - i * 30 }));
}

function makeThreads(names) {
  return names.map((name, i) => ({ thread_name: name, count: 300 - i * 20 }));
}

function makeLogLevels(levels) {
  return levels.map(level => ({ log_level: level, count: 100 }));
}

function makeSuggestionIds(suggestions) {
  return suggestions.map(s => s.id);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

printSection('PresetService.getSuggestions — empty / minimal data');

runTest('Returns empty array for empty filter options', function() {
  const suggestions = PresetService.getSuggestions({}, {});
  return assertEqual(suggestions, [], 'Empty filterOptions should produce no suggestions');
});

runTest('Returns empty array when no fields have data', function() {
  const options = { devices: [], components: [], threads: [], logLevels: [], totalLogs: 0 };
  const suggestions = PresetService.getSuggestions(options, {});
  return assertEqual(suggestions, [], 'All-empty arrays should produce no suggestions');
});

// ─── Device suggestions ───────────────────────────────────────────────────────

printSection('PresetService.getSuggestions — device suggestions');

runTest('Suggests focus_top_device when multiple devices exist', function() {
  const options = { devices: makeDevices(['DEV001', 'DEV002', 'DEV003']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('focus_top_device'), true, 'Should suggest focus_top_device');
});

runTest('focus_top_device uses device with most entries (first in list)', function() {
  const options = { devices: makeDevices(['TOP_DEVICE', 'DEV002']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const suggestion = suggestions.find(s => s.id === 'focus_top_device');
  return assertEqual(
    suggestion && suggestion.filters,
    { deviceInclude: ['TOP_DEVICE'] },
    'focus_top_device should include the top device'
  );
});

runTest('No focus_top_device suggestion when only one device', function() {
  const options = { devices: makeDevices(['ONLY_DEVICE']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('focus_top_device'), false, 'Should not suggest when only one device');
});

runTest('No focus_top_device when deviceInclude already applied', function() {
  const options = { devices: makeDevices(['DEV001', 'DEV002']) };
  const filters = { deviceInclude: ['DEV001'] };
  const suggestions = PresetService.getSuggestions(options, filters);
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('focus_top_device'), false, 'Should skip if deviceInclude already set');
});

// ─── Component suggestions ────────────────────────────────────────────────────

printSection('PresetService.getSuggestions — component suggestions');

runTest('Suggests exclude_top_components when 5+ components exist', function() {
  const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('exclude_top_components'), true, 'Should suggest exclude_top_components');
});

runTest('No exclude_top_components when fewer than 5 components', function() {
  const options = { components: makeComponents(['A', 'B', 'C']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('exclude_top_components'), false, 'Should not suggest with < 5 components');
});

runTest('exclude_top_components caps at 10 entries', function() {
  const names = Array.from({ length: 15 }, (_, i) => 'Comp' + i);
  const options = { components: makeComponents(names) };
  const suggestions = PresetService.getSuggestions(options, {});
  const suggestion = suggestions.find(s => s.id === 'exclude_top_components');
  return assertEqual(
    suggestion && suggestion.filters.componentExclude.length <= 10,
    true,
    'Should exclude at most 10 components'
  );
});

runTest('Suggests focus_top_component when any component exists', function() {
  const options = { components: makeComponents(['TopComp']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('focus_top_component'), true, 'Should suggest focus_top_component');
});

runTest('No component suggestions when componentInclude already applied', function() {
  const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E', 'F']) };
  const filters = { componentInclude: ['A'] };
  const suggestions = PresetService.getSuggestions(options, filters);
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('focus_top_component'), false, 'Should skip focus_top_component when componentInclude set');
});

runTest('No exclude_top_components when componentExclude already applied', function() {
  const options = { components: makeComponents(['A', 'B', 'C', 'D', 'E']) };
  const filters = { componentExclude: ['A'] };
  const suggestions = PresetService.getSuggestions(options, filters);
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('exclude_top_components'), false, 'Should skip exclude_top_components when componentExclude set');
});

// ─── Log level suggestions ────────────────────────────────────────────────────

printSection('PresetService.getSuggestions — log level suggestions');

runTest('Suggests errors_and_warnings when ERROR and WARN present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_and_warnings'), true, 'Should suggest errors_and_warnings');
});

runTest('Suggests errors_only when ERROR level present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'ERROR']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_only'), true, 'Should suggest errors_only when ERROR present');
});

runTest('No errors_only when ERROR not present', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN']) };
  const suggestions = PresetService.getSuggestions(options, {});
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('errors_only'), false, 'Should not suggest errors_only without ERROR level');
});

runTest('No log level suggestions when logLevelInclude already applied', function() {
  const options = { logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']) };
  const filters = { logLevelInclude: ['ERROR'] };
  const suggestions = PresetService.getSuggestions(options, filters);
  const ids = makeSuggestionIds(suggestions);
  const hasLevelSuggestion = ids.includes('errors_and_warnings') || ids.includes('errors_only');
  return assertEqual(hasLevelSuggestion, false, 'Should skip level suggestions when logLevelInclude already set');
});

// ─── Suggestion shape ─────────────────────────────────────────────────────────

printSection('PresetService.getSuggestions — suggestion object shape');

runTest('Each suggestion has required fields: id, label, description, filters', function() {
  const options = {
    devices: makeDevices(['D1', 'D2']),
    logLevels: makeLogLevels(['ERROR', 'WARN'])
  };
  const suggestions = PresetService.getSuggestions(options, {});
  const valid = suggestions.every(s =>
    typeof s.id === 'string' &&
    typeof s.label === 'string' &&
    typeof s.description === 'string' &&
    typeof s.filters === 'object'
  );
  return assertEqual(valid, true, 'All suggestions should have id, label, description, filters');
});

runTest('Suggestion filters values are non-empty arrays', function() {
  const options = {
    devices: makeDevices(['D1', 'D2']),
    components: makeComponents(['A', 'B', 'C', 'D', 'E'])
  };
  const suggestions = PresetService.getSuggestions(options, {});
  const valid = suggestions.every(s =>
    Object.values(s.filters).every(v => Array.isArray(v) && v.length > 0)
  );
  return assertEqual(valid, true, 'All filter values should be non-empty arrays');
});

// ─── Combined scenario ────────────────────────────────────────────────────────

printSection('PresetService.getSuggestions — combined scenario');

runTest('Multiple suggestion types returned for rich data set', function() {
  const options = {
    devices: makeDevices(['D1', 'D2', 'D3']),
    components: makeComponents(['A', 'B', 'C', 'D', 'E', 'F']),
    threads: makeThreads(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']),
    logLevels: makeLogLevels(['DEBUG', 'INFO', 'WARN', 'ERROR']),
    totalLogs: 5000
  };
  const suggestions = PresetService.getSuggestions(options, {});
  return assertEqual(suggestions.length >= 4, true, 'Should return at least 4 suggestions for rich data');
});

runTest('After applying device filter, device suggestion disappears', function() {
  const options = {
    devices: makeDevices(['D1', 'D2', 'D3']),
    components: makeComponents(['A', 'B', 'C', 'D', 'E'])
  };
  const filtersAfterStep1 = { deviceInclude: ['D1'] };
  const suggestions = PresetService.getSuggestions(options, filtersAfterStep1);
  const ids = makeSuggestionIds(suggestions);
  return assertEqual(ids.includes('focus_top_device'), false, 'focus_top_device should not reappear after being applied');
});

printSummary('PRESET SERVICE');
