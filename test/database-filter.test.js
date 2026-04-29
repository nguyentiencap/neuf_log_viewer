/**
 * Test Suite for multi-step filter chain (executeFilterStep + filterLogsChain)
 * Tests DatabaseService.executeFilterStep() with in-memory sql.js database
 */

const initSqlJs = require('sql.js');
const { DatabaseWrapper, DatabaseService } = require('../lib/database');
const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');

// ============================================================================
// Setup helpers
// ============================================================================

/**
 * Build an in-memory DatabaseService with seed logs
 * @param {Object} SQL - sql.js constructor
 * @param {Array} rows - Log rows to seed
 * @returns {DatabaseService}
 */
function buildDatabaseService(SQL, rows) {
  const sqlDb = new SQL.Database();
  const db = new DatabaseWrapper(sqlDb);
  const getTimeBucket = (ts) => {
    const match = ts.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})/);
    if (!match) return 'unknown';
    const [, year, month, day, hour, min] = match;
    const bucket = parseInt(min, 10) < 30 ? '00' : '30';
    return `${year}-${month}-${day} ${hour}:${bucket}`;
  };
  const databaseService = new DatabaseService(db, getTimeBucket);

  // Create logs table
  databaseService.initDatabase();

  // Insert seed rows — attach timeBucket computed from timestamp
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
// Tests
// ============================================================================

async function runAllTests() {
  const SQL = await initSqlJs();

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: basic include filter');
  // --------------------------------------------------------------------------

  runTest('Step with logLevelInclude=[ERROR] keeps only ERROR rows', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { logLevelInclude: ['ERROR'] },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 2, 'Should keep 2 ERROR rows');
  });

  runTest('Step with deviceInclude=[DEV001] keeps DEV001 rows', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { deviceInclude: ['DEV001'] },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 2, 'Should keep 2 DEV001 rows');
  });

  runTest('Step with no filters keeps all rows', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep({}, 'logs', 'filter_step_1');
    return assertEqual(count, SEED_LOGS.length, 'Should keep all rows when no filters');
  });

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: exclude filter');
  // --------------------------------------------------------------------------

  runTest('Step with logLevelExclude=[DEBUG] removes DEBUG rows', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { logLevelExclude: ['DEBUG'] },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 5, 'Should have 5 rows after excluding DEBUG');
  });

  runTest('Step with filenameExclude=[sys.log] removes sys.log rows', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { filenameExclude: ['sys.log'] },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 4, 'Should have 4 rows after excluding sys.log');
  });

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: chained steps (inputTable from previous step)');
  // --------------------------------------------------------------------------

  runTest('Step 1 -> Step 2: filter ERROR then filter DEV001', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);

    // Step 1: keep only ERROR rows (2 rows: DEV001 + DEV002)
    const step1 = svc.executeFilterStep(
      { logLevelInclude: ['ERROR'] },
      'logs',
      'filter_step_1'
    );
    assertEqual(step1.count, 2, 'Step 1 should produce 2 ERROR rows');

    // Step 2: from step 1, keep only DEV001 (1 row)
    const step2 = svc.executeFilterStep(
      { deviceInclude: ['DEV001'] },
      'filter_step_1',
      'filter_step_2'
    );
    return assertEqual(step2.count, 1, 'Step 2 should narrow to 1 row (ERROR + DEV001)');
  });

  runTest('Step 1 -> Step 2 -> Step 3: filename then level then device', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);

    // Step 1: only app.log (4 rows)
    svc.executeFilterStep({ filenameInclude: ['app.log'] }, 'logs', 'filter_step_1');

    // Step 2: only ERROR from app.log (2 rows)
    svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'filter_step_1', 'filter_step_2');

    // Step 3: only DEV002 from previous (1 row)
    const step3 = svc.executeFilterStep(
      { deviceInclude: ['DEV002'] },
      'filter_step_2',
      'filter_step_3'
    );
    return assertEqual(step3.count, 1, 'Step 3 should have 1 row (app.log + ERROR + DEV002)');
  });

  runTest('Output table is recreated when same outputTable name is reused', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);

    // First run: filter ERROR (2 rows)
    svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'logs', 'filter_step_1');

    // Second run with same outputTable but different filter: INFO (2 rows)
    const result = svc.executeFilterStep({ logLevelInclude: ['INFO'] }, 'logs', 'filter_step_1');
    return assertEqual(result.count, 2, 'Should recreate output table with new filter result');
  });

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: search filter');
  // --------------------------------------------------------------------------

  runTest('Step with search keeps rows containing search text', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection' },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 2, 'Should match 2 rows containing "Connection"');
  });

  runTest('Step1 ERROR -> Step2 search "failed" narrows correctly', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);

    svc.executeFilterStep({ logLevelInclude: ['ERROR'] }, 'logs', 'filter_step_1');

    // Both ERROR rows contain "failed" (case-insensitive via LIKE)
    const step2 = svc.executeFilterStep({ search: 'failed' }, 'filter_step_1', 'filter_step_2');
    return assertEqual(step2.count, 2, 'Both ERROR rows should contain "failed"');
  });

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: empty result');
  // --------------------------------------------------------------------------

  runTest('Step with impossible filter produces empty output table', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { deviceInclude: ['DEV_NONEXISTENT'] },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 0, 'Should produce 0 rows for impossible filter');
  });

  runTest('Step chained from empty table produces empty output', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);

    // Step 1 produces empty table
    svc.executeFilterStep({ deviceInclude: ['NONE'] }, 'logs', 'filter_step_1');

    // Step 2 chained from empty table
    const result = svc.executeFilterStep({}, 'filter_step_1', 'filter_step_2');
    return assertEqual(result.count, 0, 'Chained from empty table should also be empty');
  });

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: contextLines');
  // --------------------------------------------------------------------------

  runTest('contextLines=1: includes 1 row before and after each match', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    // SEED_LOGS ordered by timestamp: rows 0-5
    // "Connection failed" is at index 0 → context: index 0, 1
    // "Retrying connection" is at index 1 → context: index 0, 1, 2
    // Total unique: 0,1,2 = 3 rows
    const { count } = svc.executeFilterStep(
      { search: 'Connection', contextLines: 1 },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 3, 'contextLines=1 around "Connection" matches should produce 3 rows');
  });

  runTest('contextLines=0: behaves same as plain search (no context)', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection', contextLines: 0 },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 2, 'contextLines=0 should match only the 2 rows containing "Connection"');
  });

  runTest('contextLines=2: matches at IDs 10 and 17 produce 10 rows total', () => {
    // Build 20 rows, match keyword "TARGET" at positions 10 and 17 (1-based IDs)
    const rows = Array.from({ length: 20 }, (_, i) => ({
      filename: 'app.log',
      timestamp: `2026.04.28 09:${String(i).padStart(2, '0')}:00.000`,
      threadName: 'main',
      deviceId: 'DEV001',
      componentName: 'com.example',
      logLevel: 'INFO',
      message: (i === 9 || i === 16) ? 'TARGET message' : `Normal message ${i}`
    }));
    const svc = buildDatabaseService(SQL, rows);
    // IDs 10 and 17 are matches (1-based autoincrement)
    // contextLines=2: range [8..12] + [15..19], minus matches already in Step 1
    // Total = 2 matches + 8 context = 10 rows
    const { count } = svc.executeFilterStep(
      { search: 'TARGET', contextLines: 2 },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 10, 'contextLines=2 with matches at IDs 10,17 should produce 10 rows');
  });

  runTest('contextLines=2: overlapping ranges (matches at IDs 10 and 12) deduplicate correctly', () => {
    // Build 20 rows, match at positions 10 and 12 (1-based IDs)
    const rows = Array.from({ length: 20 }, (_, i) => ({
      filename: 'app.log',
      timestamp: `2026.04.28 09:${String(i).padStart(2, '0')}:00.000`,
      threadName: 'main',
      deviceId: 'DEV001',
      componentName: 'com.example',
      logLevel: 'INFO',
      message: (i === 9 || i === 11) ? 'TARGET message' : `Normal message ${i}`
    }));
    const svc = buildDatabaseService(SQL, rows);
    // match IDs 10 and 12, contextLines=2
    // range for 10: [8..14], range for 12: [10..14]
    // union: [8..14] = 7 rows (8,9,10,11,12,13,14), no gap between ranges
    const { count } = svc.executeFilterStep(
      { search: 'TARGET', contextLines: 2 },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 7, 'overlapping contextLines ranges should be deduplicated to 7 rows');
  });

  runTest('contextLines with other filters: context expands over all inputTable rows regardless of other filters', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    // Seed order by timestamp: 0=app/ERR(Connection failed), 1=app/WARN(Retrying), 2=app/INFO(Request received),
    //   3=app/ERR(Request failed), 4=sys/INFO(System startup), 5=sys/DEBUG(Loaded config)
    // Step1: INSERT rows matching filenameInclude=app.log AND search=failed → IDs of row 0 and row 3
    // Step2: allIds from logs (all 6 rows); context ±1 around match positions (0 and 3):
    //   match at index 0 → adds index 1 (row 1, app.log Retrying)
    //   match at index 3 → adds index 2 (row 2, app.log Request received) + index 4 (sys.log System startup)
    // Total: rows 0,1,2,3,4 = 5 rows
    const { count } = svc.executeFilterStep(
      { filenameInclude: ['app.log'], search: 'failed', contextLines: 1 },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 5, 'context expands over all rows in inputTable, not bounded by non-search filters');
  });

  // --------------------------------------------------------------------------
  printSection('executeFilterStep: regex search');
  // --------------------------------------------------------------------------

  runTest('searchRegex: basic pattern matches correctly', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'conn.*failed', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 1, 'pattern "conn.*failed" should match 1 row');
  });

  runTest('searchRegex: alternation pattern (|) matches multiple rows', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection failed|startup', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 2, 'pattern "Connection failed|startup" should match 2 rows');
  });

  runTest('searchRegex: case-insensitive by default (uppercase pattern matches lowercase message)', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'CONNECTION FAILED', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 1, 'pattern "CONNECTION FAILED" should match case-insensitively');
  });

  runTest('searchRegex: anchor ^ matches start of message', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: '^System', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 1, 'pattern "^System" should match only "System startup"');
  });

  runTest('searchRegex: invalid pattern returns 0 rows without throwing', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: '[invalid(regex', searchRegex: true },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 0, 'invalid regex pattern should return 0 rows');
  });

  runTest('searchRegex: false falls back to LIKE search', () => {
    const svc = buildDatabaseService(SQL, SEED_LOGS);
    const { count } = svc.executeFilterStep(
      { search: 'Connection', searchRegex: false },
      'logs',
      'filter_step_1'
    );
    return assertEqual(count, 2, 'LIKE search for "Connection" should match 2 rows');
  });

  printSummary('FILTER CHAIN TEST SUITE');
}

runAllTests().catch(err => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});

