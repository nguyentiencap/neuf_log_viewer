/**
 * Test Suite for NEUF Log Service Module
 * Tests all functions in the NEUFLogService class
 */

const fs = require('fs');
const path = require('path');
const { NEUFLogService } = require('../lib/neuf-log-service');
const { FilterService } = require('../lib/filters');
const { logParserService } = require('../lib/log-parser');
const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');

// Test directory setup
const TEST_DIR = path.join(__dirname, 'test-logs');
const TEST_LOG_DIR = path.join(TEST_DIR, 'sample-logs');

// Mock logger to suppress output during tests
const mockLogger = () => {};

// Initialize services
const filterService = new FilterService();
const logService = new NEUFLogService(logParserService, mockLogger);

printSection('NEUF LOG SERVICE TEST SUITE');

// ============================================================================
// Test getDbPath
// ============================================================================
printSection('Testing getDbPath()');

runTest('getDbPath: Returns correct database path structure', () => {
  const folderPath = '/test/logs';
  const result = logService.getDbPath(folderPath);
  
  const hasLogFolderPath = result.logFolderPath !== undefined;
  const hasDbPath = result.dbPath !== undefined;
  const hasDbDir = result.dbDir !== undefined;
  const dbPathEndsCorrectly = result.dbPath.endsWith(path.join('log-filter-db', 'neuf-logs.db'));
  
  const allChecks = hasLogFolderPath && hasDbPath && hasDbDir && dbPathEndsCorrectly;
  
  if (allChecks) {
    console.log('✅ PASSED: Returns correct database path structure');
    return true;
  } else {
    console.error('❌ FAILED: Database path structure incorrect');
    console.error(`  logFolderPath: ${hasLogFolderPath}`);
    console.error(`  dbPath: ${hasDbPath}`);
    console.error(`  dbDir: ${hasDbDir}`);
    console.error(`  dbPathEndsCorrectly: ${dbPathEndsCorrectly}`);
    return false;
  }
});

runTest('getDbPath: Resolves relative paths', () => {
  const folderPath = './logs';
  const result = logService.getDbPath(folderPath);
  
  const isAbsolute = path.isAbsolute(result.logFolderPath);
  
  if (isAbsolute) {
    console.log('✅ PASSED: Resolves relative paths to absolute');
    return true;
  } else {
    console.error('❌ FAILED: Did not resolve to absolute path');
    console.error(`  Result: ${result.logFolderPath}`);
    return false;
  }
});

runTest('getDbPath: Database directory is inside log folder', () => {
  const folderPath = '/test/logs';
  const result = logService.getDbPath(folderPath);
  
  const dbDirStartsWithLogFolder = result.dbDir.startsWith(result.logFolderPath);
  
  return assertEqual(dbDirStartsWithLogFolder, true,
    'Database directory should be inside log folder');
});

runTest('getDbPath: Database file is named neuf-logs.db', () => {
  const folderPath = '/test/logs';
  const result = logService.getDbPath(folderPath);
  
  const dbFileName = path.basename(result.dbPath);
  
  return assertEqual(dbFileName, 'neuf-logs.db',
    'Database file should be named neuf-logs.db');
});

// ============================================================================
// Test isDatabaseScanned
// ============================================================================
printSection('Testing isDatabaseScanned()');

runTest('isDatabaseScanned: Returns false for non-existent database', () => {
  const folderPath = '/non/existent/path';
  const result = logService.isDatabaseScanned(folderPath);
  
  return assertEqual(result, false,
    'Should return false for non-existent database');
});

runTest('isDatabaseScanned: Returns false for invalid path', () => {
  const folderPath = null;
  const result = logService.isDatabaseScanned(folderPath);
  
  return assertEqual(result, false,
    'Should return false for invalid path');
});

// ============================================================================
// Test _createDatabaseService
// ============================================================================
printSection('Testing _createDatabaseService()');

runTest('_createDatabaseService: Returns db and databaseService objects', () => {
  // Create a mock SQL database
  const mockSqlDb = {
    run: () => {},
    exec: () => [],
    prepare: () => ({
      get: () => null,
      all: () => [],
      run: () => {}
    }),
    export: () => new Uint8Array()
  };
  
  const result = logService._createDatabaseService(mockSqlDb);
  
  const hasDb = result.db !== undefined;
  const hasDatabaseService = result.databaseService !== undefined;
  
  if (hasDb && hasDatabaseService) {
    console.log('✅ PASSED: Returns db and databaseService objects');
    return true;
  } else {
    console.error('❌ FAILED: Missing required objects');
    console.error(`  hasDb: ${hasDb}`);
    console.error(`  hasDatabaseService: ${hasDatabaseService}`);
    return false;
  }
});

// ============================================================================
// Test _materializeContextIds (DatabaseService)
// ============================================================================
printSection('Testing DatabaseService._materializeContextIds()');

runTest('_materializeContextIds: Populates context_results with correct rows', async () => {
  try {
    const SQL = await NEUFLogService.initializeSqlJs();
    const sqlDb = new SQL.Database();
    const { databaseService } = logService._createDatabaseService(sqlDb);

    // Initialize schema and insert test data
    databaseService.initDatabase();
    const insert = databaseService.prepareInsert();
    insert.run('test.log', '2026.01.01 00:00:00.000', 'T1', 'D1', 'com.test', 'INFO', 'line 1');
    insert.run('test.log', '2026.01.01 00:00:01.000', 'T1', 'D1', 'com.test', 'INFO', 'line 2');
    insert.run('test.log', '2026.01.01 00:00:02.000', 'T1', 'D1', 'com.test', 'ERROR', 'line 3 error');
    insert.run('test.log', '2026.01.01 00:00:03.000', 'T1', 'D1', 'com.test', 'INFO', 'line 4');
    insert.run('test.log', '2026.01.01 00:00:04.000', 'T1', 'D1', 'com.test', 'INFO', 'line 5');

    // Match is id=3 ("line 3 error"), context 1 means ids 2,3,4 should be included
    databaseService._materializeContextIds({ search: 'error', contextLines: 1 });
    const rows = databaseService.db.prepare('SELECT id FROM context_results ORDER BY id').all();
    const ids = rows.map(r => r.id);

    return assertEqual(ids, [2, 3, 4],
      '_materializeContextIds should populate context_results with match ± 1 context rows');
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

runTest('_materializeContextIds: Throws for invalid contextLines', async () => {
  try {
    const SQL = await NEUFLogService.initializeSqlJs();
    const sqlDb = new SQL.Database();
    const { databaseService } = logService._createDatabaseService(sqlDb);
    databaseService.initDatabase();

    let threw = false;
    try {
      databaseService._materializeContextIds({ search: 'error', contextLines: 0 });
    } catch (e) {
      threw = true;
    }

    return assertEqual(threw, true,
      '_materializeContextIds should throw for contextLines = 0');
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

runTest('searchWithContextLines: Returns context logs using id-range query', async () => {
  try {
    const SQL = await NEUFLogService.initializeSqlJs();
    const sqlDb = new SQL.Database();
    const { databaseService } = logService._createDatabaseService(sqlDb);

    databaseService.initDatabase();
    const insert = databaseService.prepareInsert();
    insert.run('test.log', '2026.01.01 00:00:00.000', 'T1', 'D1', 'com.test', 'INFO', 'line 1');
    insert.run('test.log', '2026.01.01 00:00:01.000', 'T1', 'D1', 'com.test', 'INFO', 'line 2');
    insert.run('test.log', '2026.01.01 00:00:02.000', 'T1', 'D1', 'com.test', 'ERROR', 'line 3 error');
    insert.run('test.log', '2026.01.01 00:00:03.000', 'T1', 'D1', 'com.test', 'INFO', 'line 4');
    insert.run('test.log', '2026.01.01 00:00:04.000', 'T1', 'D1', 'com.test', 'INFO', 'line 5');

    const result = databaseService.searchWithContextLines(
      { search: 'error', contextLines: 1 },
      { page: 1, pageSize: 100 }
    );

    const ids = result.logs.map(l => l.id);
    const correctIds = ids.length === 3 && ids[0] === 2 && ids[1] === 3 && ids[2] === 4;
    const correctTotal = result.total === 3;

    if (correctIds && correctTotal) {
      console.log('✅ PASSED: Returns correct context logs (match ± contextLines)');
      return true;
    } else {
      console.error('❌ FAILED: Unexpected context logs');
      console.error(`  ids: ${JSON.stringify(ids)}`);
      console.error(`  total: ${result.total}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

runTest('getFilterOptions with context: counts scoped to context result set', async () => {
  try {
    const SQL = await NEUFLogService.initializeSqlJs();
    const sqlDb = new SQL.Database();
    const { databaseService } = logService._createDatabaseService(sqlDb);

    databaseService.initDatabase();
    const insert = databaseService.prepareInsert();
    // 5 logs across two devices; only id 3 matches search "error"
    insert.run('a.log', '2026.01.01 00:00:00.000', 'T1', 'DevA', 'com.test', 'INFO', 'line 1');
    insert.run('a.log', '2026.01.01 00:00:01.000', 'T1', 'DevA', 'com.test', 'INFO', 'line 2');
    insert.run('a.log', '2026.01.01 00:00:02.000', 'T1', 'DevA', 'com.test', 'ERROR', 'line 3 error');
    insert.run('b.log', '2026.01.01 00:00:03.000', 'T1', 'DevB', 'com.test', 'INFO', 'line 4');
    insert.run('b.log', '2026.01.01 00:00:04.000', 'T1', 'DevB', 'com.test', 'INFO', 'line 5');

    // Context 1 around match id=3 → context set = ids 2,3,4
    // id=4 belongs to b.log/DevB, ids 2,3 belong to a.log/DevA
    const options = databaseService.getFilterOptions(
      { search: 'error', contextLines: 1 },
      'logs',
      false
    );

    // totalLogs should be 3 (context result set size)
    const correctTotal = options.totalLogs === 3;

    // Both filenames should appear in the context set
    const filenameValues = options.filenames.map(f => f.filename);
    const hasALog = filenameValues.includes('a.log');
    const hasBLog = filenameValues.includes('b.log');

    if (correctTotal && hasALog && hasBLog) {
      console.log('✅ PASSED: Filter options scoped to context result set');
      return true;
    } else {
      console.error('❌ FAILED: Filter options not scoped correctly');
      console.error(`  totalLogs: ${options.totalLogs} (expected 3)`);
      console.error(`  filenames: ${JSON.stringify(filenameValues)}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

// ============================================================================
// Test clearDatabase
// ============================================================================
printSection('Testing clearDatabase()');

runTest('clearDatabase: Returns success when database does not exist', () => {
  const folderPath = '/non/existent/path';
  const result = logService.clearDatabase(folderPath);
  
  const isSuccess = result.success === true;
  const hasMessage = result.message !== undefined;
  const hasDbPath = result.dbPath !== undefined;
  
  if (isSuccess && hasMessage && hasDbPath) {
    console.log('✅ PASSED: Returns success when database does not exist');
    return true;
  } else {
    console.error('❌ FAILED: Incorrect return structure');
    console.error(`  success: ${isSuccess}`);
    console.error(`  hasMessage: ${hasMessage}`);
    console.error(`  hasDbPath: ${hasDbPath}`);
    return false;
  }
});

// ============================================================================
// Test Static SQL.js Initialization
// ============================================================================
printSection('Testing Static SQL.js Initialization');

runTest('initializeSqlJs: Returns SQL.js instance', async () => {
  try {
    const SQL = await NEUFLogService.initializeSqlJs();
    const isFunction = typeof SQL.Database === 'function';
    
    return assertEqual(isFunction, true,
      'Should return SQL.js instance with Database constructor');
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

runTest('getSQL: Returns same SQL.js instance (singleton)', async () => {
  try {
    const SQL1 = await logService.getSQL();
    const SQL2 = await logService.getSQL();
    
    const isSameInstance = SQL1 === SQL2;
    
    return assertEqual(isSameInstance, true,
      'Should return same SQL.js instance (singleton pattern)');
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

runTest('initialize: Delegates to static initializeSqlJs', async () => {
  try {
    const result = await logService.initialize();
    const isFunction = typeof result.Database === 'function';
    
    return assertEqual(isFunction, true,
      'Should delegate to static initializeSqlJs method');
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    return false;
  }
});

// ============================================================================
// Test Service Constructor
// ============================================================================
printSection('Testing Service Constructor');

runTest('Constructor: Accepts parserService and logger', () => {
  const customLogger = (msg) => console.log(`CUSTOM: ${msg}`);
  const service = new NEUFLogService(logParserService, customLogger);
  
  const hasParserService = service.parserService !== undefined;
  const hasLogger = service.logger !== undefined;
  
  if (hasParserService && hasLogger) {
    console.log('✅ PASSED: Constructor accepts all dependencies');
    return true;
  } else {
    console.error('❌ FAILED: Missing dependencies');
    console.error(`  hasParserService: ${hasParserService}`);
    console.error(`  hasLogger: ${hasLogger}`);
    return false;
  }
});

runTest('Constructor: Uses default console.log logger when not provided', () => {
  const service = new NEUFLogService(logParserService);
  
  const hasLogger = service.logger !== undefined;
  const isFunction = typeof service.logger === 'function';
  
  if (hasLogger && isFunction) {
    console.log('✅ PASSED: Uses default logger when not provided');
    return true;
  } else {
    console.error('❌ FAILED: Logger not properly initialized');
    return false;
  }
});

// ============================================================================
// Test loadDatabase Error Handling
// ============================================================================
printSection('Testing loadDatabase() Error Handling');

runTest('loadDatabase: Throws error when database not found', async () => {
  const folderPath = '/non/existent/path';
  
  try {
    await logService.loadDatabase(folderPath);
    console.error('❌ FAILED: Should have thrown error for non-existent database');
    return false;
  } catch (error) {
    const hasCorrectMessage = error.message.includes('Database not found');
    
    return assertEqual(hasCorrectMessage, true,
      'Should throw error with correct message when database not found');
  }
});

// ============================================================================
// Test scanLogs Return Structure
// ============================================================================
printSection('Testing scanLogs() Return Structure');

runTest('scanLogs: Returns correct structure when database already exists', async () => {
  // Create a temporary test directory with existing database
  const testFolder = path.join(TEST_DIR, 'existing-db-test');
  const dbDir = path.join(testFolder, 'log-filter-db');
  const dbPath = path.join(dbDir, 'neuf-logs.db');
  
  try {
    // Create directory structure
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    // Create empty database file
    fs.writeFileSync(dbPath, '');
    
    // Test scanLogs
    const result = await logService.scanLogs(testFolder);
    
    const hasSuccess = result.success === true;
    const hasMessage = result.message !== undefined;
    const hasData = result.data !== undefined;
    const hasAlreadyScanned = result.data && result.data.alreadyScanned === true;
    
    // Cleanup
    fs.unlinkSync(dbPath);
    fs.rmdirSync(dbDir);
    fs.rmdirSync(testFolder);
    
    if (hasSuccess && hasMessage && hasData && hasAlreadyScanned) {
      console.log('✅ PASSED: Returns correct structure when database already exists');
      return true;
    } else {
      console.error('❌ FAILED: Incorrect return structure');
      console.error(`  hasSuccess: ${hasSuccess}`);
      console.error(`  hasMessage: ${hasMessage}`);
      console.error(`  hasData: ${hasData}`);
      console.error(`  hasAlreadyScanned: ${hasAlreadyScanned}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    // Cleanup on error
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbDir)) fs.rmdirSync(dbDir);
      if (fs.existsSync(testFolder)) fs.rmdirSync(testFolder);
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    return false;
  }
});

// ============================================================================
// Test Path Handling
// ============================================================================
printSection('Testing Path Handling');

runTest('getDbPath: Handles Windows-style paths', () => {
  const folderPath = 'C:\\Users\\test\\logs';
  const result = logService.getDbPath(folderPath);
  
  const hasValidPath = result.dbPath !== undefined && result.dbPath.length > 0;
  
  return assertEqual(hasValidPath, true,
    'Should handle Windows-style paths correctly');
});

runTest('getDbPath: Handles Unix-style paths', () => {
  const folderPath = '/home/user/logs';
  const result = logService.getDbPath(folderPath);
  
  const hasValidPath = result.dbPath !== undefined && result.dbPath.length > 0;
  
  return assertEqual(hasValidPath, true,
    'Should handle Unix-style paths correctly');
});

runTest('getDbPath: Handles paths with spaces', () => {
  const folderPath = '/path/with spaces/logs';
  const result = logService.getDbPath(folderPath);
  
  const hasValidPath = result.dbPath !== undefined && result.dbPath.length > 0;
  
  return assertEqual(hasValidPath, true,
    'Should handle paths with spaces correctly');
});

// ============================================================================
// Test Service Integration
// ============================================================================
printSection('Testing Service Integration');

runTest('Service: parserService is properly injected', () => {
  const hasGetTimeBucket = typeof logService.parserService.getTimeBucket === 'function';
  const hasParseLogEntry = typeof logService.parserService.parseLogEntry === 'function';
  
  const allMethodsPresent = hasGetTimeBucket && hasParseLogEntry;
  
  return assertEqual(allMethodsPresent, true,
    'ParserService should be properly injected with required methods');
});

// ============================================================================
// Test Stateless Design
// ============================================================================
printSection('Testing Stateless Design');

runTest('Service: No instance state stored between operations', () => {
  const service1 = new NEUFLogService(logParserService, mockLogger);
  const service2 = new NEUFLogService(logParserService, mockLogger);
  
  // Both services should work independently
  const path1 = service1.getDbPath('/test/path1');
  const path2 = service2.getDbPath('/test/path2');
  
  const pathsAreDifferent = path1.dbPath !== path2.dbPath;
  
  return assertEqual(pathsAreDifferent, true,
    'Services should be stateless and work independently');
});

runTest('Service: Multiple getDbPath calls do not interfere', () => {
  const path1 = logService.getDbPath('/test/path1');
  const path2 = logService.getDbPath('/test/path2');
  const path3 = logService.getDbPath('/test/path1'); // Same as first
  
  const firstAndThirdMatch = path1.dbPath === path3.dbPath;
  const firstAndSecondDiffer = path1.dbPath !== path2.dbPath;
  
  const isStateless = firstAndThirdMatch && firstAndSecondDiffer;
  
  return assertEqual(isStateless, true,
    'Multiple calls should not interfere with each other (stateless)');
});

// ============================================================================
// Test Error Handling
// ============================================================================
printSection('Testing Error Handling');

runTest('isDatabaseScanned: Handles errors gracefully', () => {
  // Test with various invalid inputs
  const result1 = logService.isDatabaseScanned(null);
  const result2 = logService.isDatabaseScanned(undefined);
  const result3 = logService.isDatabaseScanned('');
  
  const allReturnFalse = result1 === false && result2 === false && result3 === false;
  
  return assertEqual(allReturnFalse, true,
    'Should handle invalid inputs gracefully and return false');
});

runTest('clearDatabase: Handles non-existent paths gracefully', () => {
  const result = logService.clearDatabase('/absolutely/non/existent/path/12345');
  
  const hasSuccess = result.success === true;
  const hasMessage = result.message !== undefined;
  
  if (hasSuccess && hasMessage) {
    console.log('✅ PASSED: Handles non-existent paths gracefully');
    return true;
  } else {
    console.error('❌ FAILED: Did not handle non-existent path gracefully');
    return false;
  }
});

// ============================================================================
// Test filterLogs and getFilterOptions with Real Database
// ============================================================================
printSection('Testing filterLogs() and getFilterOptions() with Real Database');

// Helper function to create test database with sample data
async function createTestDatabase() {
  const testFolder = path.join(TEST_DIR, 'filter-test');
  const logFolder = path.join(testFolder, 'logs');
  const dbDir = path.join(testFolder, 'log-filter-db');
  const dbPath = path.join(dbDir, 'neuf-logs.db');
  
  // Create directories
  if (!fs.existsSync(logFolder)) {
    fs.mkdirSync(logFolder, { recursive: true });
  }
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  // Create sample log file
  const logContent = `2026.04.08 10:00:00.000 [INFO] Thread-1: <Device001> (com.example.service) Test message 1
2026.04.08 10:00:01.000 [ERROR] Thread-2: <Device002> (com.example.controller) Test error message
2026.04.08 10:00:02.000 [DEBUG] Thread-1: <Device001> (com.example.service) Debug message
2026.04.08 10:00:03.000 [WARN] Thread-3: <Device003> (com.example.util) Warning message
2026.04.08 10:00:04.000 [INFO] Thread-1: <Device001> (com.example.service) Another info message`;
  
  const logFilePath = path.join(logFolder, 'test.log');
  fs.writeFileSync(logFilePath, logContent);
  
  // Scan logs to create database
  await logService.scanLogs(testFolder);
  
  return { testFolder, dbPath, logFolder, logFilePath };
}

// Helper function to cleanup test database
function cleanupTestDatabase(testFolder, dbPath, logFolder, logFilePath) {
  try {
    if (fs.existsSync(logFilePath)) fs.unlinkSync(logFilePath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(path.dirname(dbPath))) fs.rmdirSync(path.dirname(dbPath));
    if (fs.existsSync(logFolder)) fs.rmdirSync(logFolder);
    if (fs.existsSync(testFolder)) fs.rmdirSync(testFolder);
  } catch (error) {
    // Ignore cleanup errors
  }
}

runTest('filterLogs: Returns all logs with empty filters', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    const result = await logService.filterLogs(testFolder, {}, { page: 1, pageSize: 100 });
    
    const hasSuccess = result.success === true;
    const hasLogs = Array.isArray(result.logs);
    const hasTotal = typeof result.total === 'number';
    const hasPage = result.page === 1;
    const hasPageSize = result.pageSize === 100;
    const logCountCorrect = result.logs.length === 5; // 5 log entries
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (hasSuccess && hasLogs && hasTotal && hasPage && hasPageSize && logCountCorrect) {
      console.log('✅ PASSED: Returns all logs with empty filters');
      return true;
    } else {
      console.error('❌ FAILED: Incorrect return structure or log count');
      console.error(`  hasSuccess: ${hasSuccess}`);
      console.error(`  hasLogs: ${hasLogs}`);
      console.error(`  hasTotal: ${hasTotal}`);
      console.error(`  hasPage: ${hasPage}`);
      console.error(`  hasPageSize: ${hasPageSize}`);
      console.error(`  logCountCorrect: ${logCountCorrect} (got ${result.logs.length})`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});

runTest('filterLogs: Filters by log level', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    const filters = { logLevel: ['ERROR'] };
    const result = await logService.filterLogs(testFolder, filters, { page: 1, pageSize: 100 });
    
    const hasOnlyErrorLogs = result.logs.every(log => log.log_level === 'ERROR');
    const correctCount = result.logs.length === 1;
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (hasOnlyErrorLogs && correctCount) {
      console.log('✅ PASSED: Filters by log level correctly');
      return true;
    } else {
      console.error('❌ FAILED: Log level filter not working correctly');
      console.error(`  hasOnlyErrorLogs: ${hasOnlyErrorLogs}`);
      console.error(`  correctCount: ${correctCount} (got ${result.logs.length})`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});

runTest('filterLogs: Filters by device ID', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    const filters = { deviceId: ['Device001'] };
    const result = await logService.filterLogs(testFolder, filters, { page: 1, pageSize: 100 });
    
    const hasOnlyDevice001 = result.logs.every(log => log.device_id === 'Device001');
    const correctCount = result.logs.length === 3; // 3 logs with Device001
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (hasOnlyDevice001 && correctCount) {
      console.log('✅ PASSED: Filters by device ID correctly');
      return true;
    } else {
      console.error('❌ FAILED: Device ID filter not working correctly');
      console.error(`  hasOnlyDevice001: ${hasOnlyDevice001}`);
      console.error(`  correctCount: ${correctCount} (got ${result.logs.length})`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});

runTest('filterLogs: Pagination works correctly', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    // Get first page with 2 items
    const result1 = await logService.filterLogs(testFolder, {}, { page: 1, pageSize: 2 });
    // Get second page with 2 items
    const result2 = await logService.filterLogs(testFolder, {}, { page: 2, pageSize: 2 });
    
    const page1HasTwoLogs = result1.logs.length === 2;
    const page2HasTwoLogs = result2.logs.length === 2;
    const totalPagesCorrect = result1.totalPages === 3; // 5 logs / 2 per page = 3 pages
    const logsAreDifferent = result1.logs[0].id !== result2.logs[0].id;
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (page1HasTwoLogs && page2HasTwoLogs && totalPagesCorrect && logsAreDifferent) {
      console.log('✅ PASSED: Pagination works correctly');
      return true;
    } else {
      console.error('❌ FAILED: Pagination not working correctly');
      console.error(`  page1HasTwoLogs: ${page1HasTwoLogs}`);
      console.error(`  page2HasTwoLogs: ${page2HasTwoLogs}`);
      console.error(`  totalPagesCorrect: ${totalPagesCorrect} (got ${result1.totalPages})`);
      console.error(`  logsAreDifferent: ${logsAreDifferent}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});

runTest('getFilterOptions: Returns available filter options', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    const result = await logService.getFilterOptions(testFolder, {}, true);
    
    const hasSuccess = result.success === true;
    const hasData = result.data !== undefined;
    const hasLogLevels = Array.isArray(result.data.logLevels);
    const hasDeviceIds = Array.isArray(result.data.deviceIds);
    const hasThreadNames = Array.isArray(result.data.threadNames);
    const hasComponents = Array.isArray(result.data.components);
    const hasPresets = Array.isArray(result.data.presets);
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (hasSuccess && hasData && hasLogLevels && hasDeviceIds && hasThreadNames && hasComponents && hasPresets) {
      console.log('✅ PASSED: Returns available filter options');
      return true;
    } else {
      console.error('❌ FAILED: Missing filter options');
      console.error(`  hasSuccess: ${hasSuccess}`);
      console.error(`  hasData: ${hasData}`);
      console.error(`  hasLogLevels: ${hasLogLevels}`);
      console.error(`  hasDeviceIds: ${hasDeviceIds}`);
      console.error(`  hasThreadNames: ${hasThreadNames}`);
      console.error(`  hasComponents: ${hasComponents}`);
      console.error(`  hasPresets: ${hasPresets}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});

runTest('getFilterOptions: Returns correct log levels from data', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    const result = await logService.getFilterOptions(testFolder, {}, true);
    
    const logLevels = result.data.logLevels;
    const hasInfo = logLevels.some(l => l.value === 'INFO');
    const hasError = logLevels.some(l => l.value === 'ERROR');
    const hasDebug = logLevels.some(l => l.value === 'DEBUG');
    const hasWarn = logLevels.some(l => l.value === 'WARN');
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (hasInfo && hasError && hasDebug && hasWarn) {
      console.log('✅ PASSED: Returns correct log levels from data');
      return true;
    } else {
      console.error('❌ FAILED: Missing expected log levels');
      console.error(`  hasInfo: ${hasInfo}`);
      console.error(`  hasError: ${hasError}`);
      console.error(`  hasDebug: ${hasDebug}`);
      console.error(`  hasWarn: ${hasWarn}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});

runTest('getFilterOptions: Returns correct device IDs from data', async () => {
  let testPaths = null;
  try {
    testPaths = await createTestDatabase();
    const { testFolder } = testPaths;
    
    const result = await logService.getFilterOptions(testFolder, {}, true);
    
    const deviceIds = result.data.deviceIds;
    const hasDevice001 = deviceIds.some(d => d.value === 'Device001');
    const hasDevice002 = deviceIds.some(d => d.value === 'Device002');
    const hasDevice003 = deviceIds.some(d => d.value === 'Device003');
    const correctCount = deviceIds.length === 3;
    
    cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    
    if (hasDevice001 && hasDevice002 && hasDevice003 && correctCount) {
      console.log('✅ PASSED: Returns correct device IDs from data');
      return true;
    } else {
      console.error('❌ FAILED: Missing expected device IDs');
      console.error(`  hasDevice001: ${hasDevice001}`);
      console.error(`  hasDevice002: ${hasDevice002}`);
      console.error(`  hasDevice003: ${hasDevice003}`);
      console.error(`  correctCount: ${correctCount} (got ${deviceIds.length})`);
      return false;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    if (testPaths) {
      cleanupTestDatabase(testPaths.testFolder, testPaths.dbPath, testPaths.logFolder, testPaths.logFilePath);
    }
    return false;
  }
});


// ============================================================================
// Summary
// ============================================================================
printSummary('NEUF LOG SERVICE TEST SUITE');
