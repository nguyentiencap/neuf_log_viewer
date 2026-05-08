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
   // ─── Time range intersection tests ────────────────────────────────────────────
   test('Time range intersection: both have timeFrom/timeTo (string format)', () => {
     const presets = {
       afternoon: {
         id: 'afternoon',
         label: 'Afternoon',
         description: 'Afternoon preset',
         filters: {
           timeFrom: '2026.04.28 12:00:00',
           timeTo: '2026.04.28 18:00:00'
         }
       }
     };
     const filters = {
       preset: 'afternoon',
       timeFrom: '2026.04.28 13:00:00',
       timeTo: '2026.04.28 17:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // Should take larger timeFrom (13:00 > 12:00) and smaller timeTo (17:00 < 18:00)
     expect(filters.timeFrom).toBe('2026.04.28 13:00:00');
     expect(filters.timeTo).toBe('2026.04.28 17:00:00');
   });
   test('Time range intersection: preset wider than user range', () => {
     const presets = {
       wide_range: {
         id: 'wide_range',
         label: 'Wide range',
         description: 'Wide preset',
         filters: {
           timeFrom: '2026.04.28 06:00:00',
           timeTo: '2026.04.28 22:00:00'
         }
       }
     };
     const filters = {
       preset: 'wide_range',
       timeFrom: '2026.04.28 10:00:00',
       timeTo: '2026.04.28 15:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // User range is narrower, should remain unchanged
     expect(filters.timeFrom).toBe('2026.04.28 10:00:00');
     expect(filters.timeTo).toBe('2026.04.28 15:00:00');
   });
   test('Time range intersection: preset narrower than user range', () => {
     const presets = {
       narrow_range: {
         id: 'narrow_range',
         label: 'Narrow range',
         description: 'Narrow preset',
         filters: {
           timeFrom: '2026.04.28 10:00:00',
           timeTo: '2026.04.28 15:00:00'
         }
       }
     };
     const filters = {
       preset: 'narrow_range',
       timeFrom: '2026.04.28 06:00:00',
       timeTo: '2026.04.28 22:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // Preset range is narrower, should be used
     expect(filters.timeFrom).toBe('2026.04.28 10:00:00');
     expect(filters.timeTo).toBe('2026.04.28 15:00:00');
   });
   test('Time range intersection: only preset has timeFrom/timeTo', () => {
     const presets = {
       with_time: {
         id: 'with_time',
         label: 'With time',
         description: 'Has time filters',
         filters: {
           timeFrom: '2026.04.28 12:00:00',
           timeTo: '2026.04.28 18:00:00'
         }
       }
     };
     const filters = {
       preset: 'with_time'
     };
     PresetService.applyPreset(filters, presets);
     expect(filters.timeFrom).toBe('2026.04.28 12:00:00');
     expect(filters.timeTo).toBe('2026.04.28 18:00:00');
   });
   test('Time range intersection: only user has timeFrom/timeTo', () => {
     const presets = {
       without_time: {
         id: 'without_time',
         label: 'Without time',
         description: 'No time filters',
         filters: {
           logLevelInclude: ['ERROR']
         }
       }
     };
     const filters = {
       preset: 'without_time',
       timeFrom: '2026.04.28 10:00:00',
       timeTo: '2026.04.28 20:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // User time should be preserved
     expect(filters.timeFrom).toBe('2026.04.28 10:00:00');
     expect(filters.timeTo).toBe('2026.04.28 20:00:00');
     expect(filters.logLevelInclude).toEqual(['ERROR']);
   });
   test('Time range intersection: only preset has timeFrom (no timeTo)', () => {
     const presets = {
       from_only: {
         id: 'from_only',
         label: 'From only',
         description: 'Only timeFrom',
         filters: {
           timeFrom: '2026.04.28 12:00:00'
         }
       }
     };
     const filters = {
       preset: 'from_only',
       timeFrom: '2026.04.28 10:00:00',
       timeTo: '2026.04.28 20:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // Should take larger timeFrom
     expect(filters.timeFrom).toBe('2026.04.28 12:00:00');
     expect(filters.timeTo).toBe('2026.04.28 20:00:00');
   });
   test('Time range intersection: numeric (Unix seconds) timestamps', () => {
     // Convert test dates to Unix seconds (numeric format)
     const dateFrom = Date.UTC(2026, 3, 28, 12, 0, 0) / 1000;    // 2026.04.28 12:00:00
     const dateTo = Date.UTC(2026, 3, 28, 18, 0, 0) / 1000;      // 2026.04.28 18:00:00
     const userFrom = Date.UTC(2026, 3, 28, 13, 0, 0) / 1000;    // 2026.04.28 13:00:00
     const userTo = Date.UTC(2026, 3, 28, 17, 0, 0) / 1000;      // 2026.04.28 17:00:00

     const presets = {
       unix_time: {
         id: 'unix_time',
         label: 'Unix time',
         description: 'Unix seconds',
         filters: {
           timeFrom: dateFrom,
           timeTo: dateTo
         }
       }
     };
     const filters = {
       preset: 'unix_time',
       timeFrom: userFrom,
       timeTo: userTo
     };
     PresetService.applyPreset(filters, presets);
     expect(filters.timeFrom).toBe(userFrom);
     expect(filters.timeTo).toBe(userTo);
   });
   test('Time range intersection: mixed string and numeric timestamps', () => {
     // Convert test dates to Unix seconds (numeric format)
     const dateFrom = Date.UTC(2026, 3, 28, 12, 0, 0) / 1000;    // 2026.04.28 12:00:00
     const dateTo = Date.UTC(2026, 3, 28, 18, 0, 0) / 1000;      // 2026.04.28 18:00:00
     const userFrom = Date.UTC(2026, 3, 28, 13, 0, 0) / 1000;    // 2026.04.28 13:00:00
     const userTo = Date.UTC(2026, 3, 28, 17, 0, 0) / 1000;      // 2026.04.28 17:00:00

     const presets = {
       mixed_time: {
         id: 'mixed_time',
         label: 'Mixed time',
         description: 'Unix seconds',
         filters: {
           timeFrom: dateFrom,
           timeTo: dateTo
         }
       }
     };
     const filters = {
       preset: 'mixed_time',
       timeFrom: '2026.04.28 13:00:00',
       timeTo: '2026.04.28 17:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // Result should be in string format (user format)
     expect(typeof filters.timeFrom).toBe('string');
     expect(typeof filters.timeTo).toBe('string');
     expect(filters.timeFrom).toBe('2026.04.28 13:00:00');
     expect(filters.timeTo).toBe('2026.04.28 17:00:00');
   });
   test('Time range intersection: multiple presets with overlapping time ranges', () => {
     const presets = {
       morning: {
         id: 'morning',
         description: 'Morning',
         filters: {
           timeFrom: '2026.04.28 06:00:00',
           timeTo: '2026.04.28 12:00:00'
         }
       },
       business_hours: {
         id: 'business_hours',
         description: 'Business hours',
         filters: {
           timeFrom: '2026.04.28 09:00:00',
           timeTo: '2026.04.28 17:00:00'
         }
       }
     };
     const filters = {
       preset: ['morning', 'business_hours'],
       timeFrom: '2026.04.28 08:00:00',
       timeTo: '2026.04.28 15:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // Final range should be intersection of all: max(6:00, 9:00, 8:00) = 9:00, min(12:00, 17:00, 15:00) = 12:00
     expect(filters.timeFrom).toBe('2026.04.28 09:00:00');
     expect(filters.timeTo).toBe('2026.04.28 12:00:00');
   });
   test('Time range intersection: non-overlapping ranges result in empty range', () => {
     const presets = {
       early: {
         id: 'early',
         label: 'Early',
         description: 'Early range',
         filters: {
           timeFrom: '2026.04.28 06:00:00',
           timeTo: '2026.04.28 10:00:00'
         }
       }
     };
     const filters = {
       preset: 'early',
       timeFrom: '2026.04.28 15:00:00',
       timeTo: '2026.04.28 20:00:00'
     };
     PresetService.applyPreset(filters, presets);
     // Intersection of (6:00-10:00) and (15:00-20:00) is (15:00-10:00) which is invalid but technically set
     expect(filters.timeFrom).toBe('2026.04.28 15:00:00');
     expect(filters.timeTo).toBe('2026.04.28 10:00:00');
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
