/**
 * Test Suite for multi-step filter chain (executeFilterStep + filterLogsChain)
 * Tests DatabaseService.executeFilterStep() with in-memory better-sqlite3 database
 */
const Database = require('better-sqlite3');
const { DatabaseWrapper, DatabaseService } = require('../src/database');
const { logParserService } = require('../src/log-parser');
const getTimeBucket = (ts) => logParserService.getTimeBucket(ts);
// ============================================================================
// Setup helpers
// ============================================================================
/**
 * Build an in-memory DatabaseService with seed logs
 * @param {Array} rows - Log rows to seed
 * @returns {DatabaseService}
 */
function buildDatabaseService(rows) {
  const betterSqliteDb = new Database(':memory:');
  const db = new DatabaseWrapper(betterSqliteDb);
  const databaseService = new DatabaseService(db);
  databaseService.initDatabase();
  if (rows.length > 0) {
    const rowsWithBucket = rows.map(r => ({ ...r, timeBucket: getTimeBucket(r.timestamp) }));
    const insertStmt = databaseService.prepareInsert();
    const insertMany = databaseService.createBatchInsert(insertStmt);
    insertMany(rowsWithBucket);
  }
  return databaseService;
}
/** Seed log data for tests */
const SEED_LOGS = [
  { filename: 'app.log', timestamp: '2026.04.28 09:00:00.000', threadName: 'main', deviceId: 'DEV001', componentName: 'com.example', logLevel: 'ERROR', message: 'Connection failed' },
  { filename: 'app.log', timestamp: '2026.04.28 09:01:00.000', threadName: 'main', deviceId: 'DEV001', componentName: 'com.example', logLevel: 'WARN',  message: 'Retrying connection' },
  { filename: 'app.log', timestamp: '2026.04.28 09:02:00.000', threadName: 'http', deviceId: 'DEV002', componentName: 'com.http',    logLevel: 'INFO',  message: 'Request received' },
  { filename: 'app.log', timestamp: '2026.04.28 09:03:00.000', threadName: 'http', deviceId: 'DEV002', componentName: 'com.http',    logLevel: 'ERROR', message: 'Request failed' },
  { filename: 'sys.log', timestamp: '2026.04.28 10:00:00.000', threadName: 'sys',  deviceId: 'DEV003', componentName: 'com.sys',     logLevel: 'INFO',  message: 'System startup' },
  { filename: 'sys.log', timestamp: '2026.04.28 10:01:00.000', threadName: 'sys',  deviceId: 'DEV003', componentName: 'com.sys',     logLevel: 'DEBUG', message: 'Loaded config' },
];
// ============================================================================
// basic include filter
// ============================================================================
describe('executeFilterStep: basic include filter', () => {
  test('Step with logLevelInclude=[ERROR] keeps only ERROR rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'logs', 'filter_step_1');
    expect(count).toBe(2);
  });
  test('Step with deviceInclude=[DEV001] keeps DEV001 rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({ deviceInclude: ['DEV001'] }, 'logs', 'filter_step_1');
    expect(count).toBe(2);
  });
  test('Step with no filters keeps all rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({}, 'logs', 'filter_step_1');
    expect(count).toBe(SEED_LOGS.length);
  });
});
// ============================================================================
// exclude filter
// ============================================================================
describe('executeFilterStep: exclude filter', () => {
  test('Step with logLevelExclude=[DEBUG] removes DEBUG rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({ logLevelExclude: ['DEBUG'] }, 'logs', 'filter_step_1');
    expect(count).toBe(5);
  });
  test('Step with filenameExclude=[sys.log] removes sys.log rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({ filenameExclude: ['sys.log'] }, 'logs', 'filter_step_1');
    expect(count).toBe(4);
  });
});
// ============================================================================
// chained steps
// ============================================================================
describe('executeFilterStep: chained steps (inputTable from previous step)', () => {
  test('Step 1 -> Step 2: filter ERROR then filter DEV001', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const step1 = svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'logs', 'filter_step_1');
    expect(step1.count).toBe(2);
    const step2 = svc.executeFilterStep({ deviceInclude: ['DEV001'] }, 'filter_step_1', 'filter_step_2');
    expect(step2.count).toBe(1);
  });
  test('Step 1 -> Step 2 -> Step 3: filename then level then device', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    svc.executeFilterStep({ filenameInclude: ['app.log'] }, 'logs', 'filter_step_1');
    svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'filter_step_1', 'filter_step_2');
    const step3 = svc.executeFilterStep({ deviceInclude: ['DEV002'] }, 'filter_step_2', 'filter_step_3');
    expect(step3.count).toBe(1);
  });
  test('Output table is recreated when same outputTable name is reused', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'logs', 'filter_step_1');
    const result = svc.executeFilterStep({ logLevelInclude: ['INFO'] }, 'logs', 'filter_step_1');
    expect(result.count).toBe(2);
  });
});
// ============================================================================
// search filter
// ============================================================================
describe('executeFilterStep: search filter', () => {
  test('Step with search keeps rows containing search text', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({ search: 'Connection' }, 'logs', 'filter_step_1');
    expect(count).toBe(2);
  });
  test('Step1 ERROR -> Step2 search "failed" narrows correctly', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'logs', 'filter_step_1');
    const step2 = svc.executeFilterStep({ search: 'failed' }, 'filter_step_1', 'filter_step_2');
    expect(step2.count).toBe(2);
  });
});
// ============================================================================
// empty result
// ============================================================================
describe('executeFilterStep: empty result', () => {
  test('Step with impossible filter produces empty output table', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep({ deviceInclude: ['DEV_NONEXISTENT'] }, 'logs', 'filter_step_1');
    expect(count).toBe(0);
  });
  test('Step chained from empty table produces empty output', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    svc.executeFilterStep({ deviceInclude: ['NONE'] }, 'logs', 'filter_step_1');
    const result = svc.executeFilterStep({}, 'filter_step_1', 'filter_step_2');
    expect(result.count).toBe(0);
  });
});
// ============================================================================
// contextLines
// ============================================================================
describe('executeFilterStep: contextLines', () => {
  test('contextLines=1: includes 1 row before and after each match', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection', contextLines: 1 },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(4);
  });
  test('contextLines=0: behaves same as plain search (no context)', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection', contextLines: 0 },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(2);
  });
  test('contextLines=2: matches at IDs 10 and 17 produce 15 rows total', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      filename: 'app.log',
      timestamp: `2026.04.28 09:${String(i).padStart(2, '0')}:00.000`,
      threadName: 'main',
      deviceId: 'DEV001',
      componentName: 'com.example',
      logLevel: 'INFO',
      message: (i === 9 || i === 16) ? 'TARGET message' : `Normal message ${i}`
    }));
    const svc = buildDatabaseService(rows);
    const { count } = svc.executeFilterStep(
      { search: 'TARGET', contextLines: 2 },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(15);
  });
  test('contextLines=2: overlapping ranges (matches at IDs 10 and 12) deduplicate correctly', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      filename: 'app.log',
      timestamp: `2026.04.28 09:${String(i).padStart(2, '0')}:00.000`,
      threadName: 'main',
      deviceId: 'DEV001',
      componentName: 'com.example',
      logLevel: 'INFO',
      message: (i === 9 || i === 11) ? 'TARGET message' : `Normal message ${i}`
    }));
    const svc = buildDatabaseService(rows);
    const { count } = svc.executeFilterStep(
      { search: 'TARGET', contextLines: 2 },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(11);
  });
  test('contextLines with other filters: context expands over all inputTable rows regardless of other filters', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { filenameInclude: ['app.log'], search: 'failed', contextLines: 1 },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(5);
  });
});
// ============================================================================
// regex search
// ============================================================================
describe('executeFilterStep: regex search', () => {
  test('searchRegex: basic pattern matches correctly', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'conn.*failed', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(1);
  });
  test('searchRegex: alternation pattern (|) matches multiple rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection failed|startup', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(2);
  });
  test('searchRegex: case-insensitive by default (uppercase pattern matches lowercase message)', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'CONNECTION FAILED', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(1);
  });
  test('searchRegex: anchor ^ matches start of message', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: '^System', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(1);
  });
  test('searchRegex: invalid pattern returns 0 rows without throwing', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: '[invalid(regex', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(0);
  });
  test('searchRegex: false falls back to LIKE search', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection', searchRegex: false },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(2);
  });
});
// ============================================================================
// time range (timeFrom / timeTo)
// ============================================================================
describe('executeFilterStep: time range (timeFrom / timeTo)', () => {
  test('timeFrom filters out earlier rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { timeFrom: getTimeBucket('2026.04.28 09:02:00.000') },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(4);
  });
  test('timeTo filters out later rows', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { timeTo: getTimeBucket('2026.04.28 09:01:00.000') },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(2);
  });
  test('timeFrom + timeTo keeps only rows in range', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      {
        timeFrom: getTimeBucket('2026.04.28 09:01:00.000'),
        timeTo:   getTimeBucket('2026.04.28 09:03:00.000')
      },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(3);
  });
  test('timeFrom + timeTo with no matching rows returns 0', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      {
        timeFrom: getTimeBucket('2026.04.28 11:00:00.000'),
        timeTo:   getTimeBucket('2026.04.28 11:59:00.000')
      },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(0);
  });
  test('timeFrom + timeTo combined with logLevelInclude narrows correctly', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      {
        timeFrom: getTimeBucket('2026.04.28 09:00:00.000'),
        timeTo:   getTimeBucket('2026.04.28 09:03:00.000'),
        logLevelInclude: ['ERROR']
      },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(2);
  });
  test('timeFrom as string filters correctly', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { timeFrom: '2026.04.28 09:02:00.000' },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(4);
  });
  test('timeTo as string filters correctly', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { timeTo: '2026.04.28 09:01:00.000' },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(2);
  });
  test('timeFrom and timeTo as strings work together', () => {
    const svc = buildDatabaseService(SEED_LOGS);
    const { count } = svc.executeFilterStep(
      {
        timeFrom: '2026.04.28 09:01:00.000',
        timeTo:   '2026.04.28 09:03:00.000'
      },
      'logs',
      'filter_step_1'
    );
    expect(count).toBe(3);
  });
});
