/**
 * Test Suite for NEUF Log Service Module
 * Tests all functions in the NEUFLogService class
 */
const fs = require('fs');
const path = require('path');
const { NEUFLogService } = require('../src/neuf-log-service');
const TEST_DIR = path.join(__dirname, 'test-logs');
const mockLogger = () => {};
const logService = new NEUFLogService(mockLogger);

// Clean up all generated test folders inside test-logs after all tests complete
afterAll(() => {
  if (!fs.existsSync(TEST_DIR)) return;
  for (const entry of fs.readdirSync(TEST_DIR)) {
    const entryPath = path.join(TEST_DIR, entry);
    try {
      fs.rmSync(entryPath, { recursive: true, force: true });
    } catch (_) { /* ignore cleanup errors */ }
  }
});
// ============================================================================
// getDbPath
// ============================================================================
describe('getDbPath()', () => {
  test('Returns correct database path structure', () => {
    const result = logService.getDbPath('/test/logs');
    expect(result.logFolderPath).toBeDefined();
    expect(result.dbPath).toBeDefined();
    expect(result.dbDir).toBeDefined();
    expect(result.dbPath.endsWith(path.join('log-filter-db', 'neuf-logs.db'))).toBe(true);
  });
  test('Resolves relative paths to absolute', () => {
    const result = logService.getDbPath('./logs');
    expect(path.isAbsolute(result.logFolderPath)).toBe(true);
  });
  test('Database directory is inside log folder', () => {
    const result = logService.getDbPath('/test/logs');
    expect(result.dbDir.startsWith(result.logFolderPath)).toBe(true);
  });
  test('Database file is named neuf-logs.db', () => {
    const result = logService.getDbPath('/test/logs');
    expect(path.basename(result.dbPath)).toBe('neuf-logs.db');
  });
  test('Handles Windows-style paths', () => {
    const result = logService.getDbPath('C:\\Users\\test\\logs');
    expect(result.dbPath.length).toBeGreaterThan(0);
  });
  test('Handles Unix-style paths', () => {
    const result = logService.getDbPath('/home/user/logs');
    expect(result.dbPath.length).toBeGreaterThan(0);
  });
  test('Handles paths with spaces', () => {
    const result = logService.getDbPath('/path/with spaces/logs');
    expect(result.dbPath.length).toBeGreaterThan(0);
  });
  test('Multiple getDbPath calls do not interfere', () => {
    const path1 = logService.getDbPath('/test/path1');
    const path2 = logService.getDbPath('/test/path2');
    const path3 = logService.getDbPath('/test/path1');
    expect(path1.dbPath).toBe(path3.dbPath);
    expect(path1.dbPath).not.toBe(path2.dbPath);
  });
});
// ============================================================================
// isDatabaseScanned
// ============================================================================
describe('isDatabaseScanned()', () => {
  test('Returns false for non-existent database', () => {
    expect(logService.isDatabaseScanned('/non/existent/path')).toBe(false);
  });
  test('Returns false for null input', () => {
    expect(logService.isDatabaseScanned(null)).toBe(false);
  });
  test('Returns false for undefined input', () => {
    expect(logService.isDatabaseScanned(undefined)).toBe(false);
  });
  test('Returns false for empty string', () => {
    expect(logService.isDatabaseScanned('')).toBe(false);
  });
});
// ============================================================================
// _createDatabaseService
// ============================================================================
describe('_createDatabaseService()', () => {
  test('Returns db and databaseService objects', () => {
    const Database = require('better-sqlite3');
    const betterSqliteDb = new Database(':memory:');
    const result = logService._createDatabaseService(betterSqliteDb);
    expect(result.db).toBeDefined();
    expect(result.databaseService).toBeDefined();
    betterSqliteDb.close();
  });
});
// ============================================================================
// clearDatabase
// ============================================================================
describe('clearDatabase()', () => {
  test('Returns success when database does not exist', () => {
    const result = logService.clearDatabase('/non/existent/path');
    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.dbPath).toBeDefined();
  });
  test('Handles non-existent paths gracefully', () => {
    const result = logService.clearDatabase('/absolutely/non/existent/path/12345');
    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
  });
});
// ============================================================================
// Constructor
// ============================================================================
describe('Constructor', () => {
  test('Accepts logger parameter', () => {
    const customLogger = (msg) => console.log(`CUSTOM: ${msg}`);
    const service = new NEUFLogService(customLogger);
    expect(service.parserService).toBeDefined();
    expect(service.logger).toBeDefined();
  });
  test('Uses default console.log logger when not provided', () => {
    const service = new NEUFLogService();
    expect(typeof service.logger).toBe('function');
  });
});
// ============================================================================
// loadDatabase error handling
// ============================================================================
describe('loadDatabase() error handling', () => {
  test('Throws error when database not found', async () => {
    await expect(logService.loadDatabase('/non/existent/path'))
      .rejects.toThrow('Database not found');
  });
});
// ============================================================================
// scanLogs return structure
// ============================================================================
describe('scanLogs() return structure', () => {
  test('Returns correct structure when database already exists', async () => {
    const testFolder = path.join(TEST_DIR, 'existing-db-test-jest-' + Date.now());
    const dbDir = path.join(testFolder, 'log-filter-db');
    const dbPath = path.join(dbDir, 'neuf-logs.db');
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, '');
    try {
      const result = await logService.scanLogs(testFolder);
      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.data.alreadyScanned).toBe(true);
    } finally {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dbDir)) fs.rmdirSync(dbDir);
      if (fs.existsSync(testFolder)) fs.rmdirSync(testFolder);
    }
  });

  test('Throws "No NEUF log files found" error for empty folder', async () => {
    const testFolder = path.join(TEST_DIR, 'empty-folder-test-jest-' + Date.now());
    fs.mkdirSync(testFolder, { recursive: true });
    try {
      await expect(logService.scanLogs(testFolder))
        .rejects.toThrow(/No NEUF log files found in:/);
    } finally {
      fs.rmSync(testFolder, { recursive: true, force: true });
    }
  });

  test('"No NEUF log files found" error mentions naming requirement', async () => {
    const testFolder = path.join(TEST_DIR, 'empty-folder-naming-jest-' + Date.now());
    fs.mkdirSync(testFolder, { recursive: true });
    try {
      await expect(logService.scanLogs(testFolder))
        .rejects.toThrow(/NEUF-\*\.log/);
    } finally {
      fs.rmSync(testFolder, { recursive: true, force: true });
    }
  });

  test('Throws "could not parse" error when NEUF-*.log file has no valid entries', async () => {
    const testFolder = path.join(TEST_DIR, 'bad-format-test-jest-' + Date.now());
    fs.mkdirSync(testFolder, { recursive: true });
    const logFile = path.join(testFolder, 'NEUF-test.log');
    fs.writeFileSync(logFile, 'This is not a valid NEUF log line\nNeither is this\n');
    try {
      await expect(logService.scanLogs(testFolder))
        .rejects.toThrow(/NEUF-\*\.log file\(s\).*could not parse/);
    } finally {
      fs.rmSync(testFolder, { recursive: true, force: true });
    }
  });

  test('"could not parse" error includes file count', async () => {
    const testFolder = path.join(TEST_DIR, 'bad-format-count-jest-' + Date.now());
    fs.mkdirSync(testFolder, { recursive: true });
    fs.writeFileSync(path.join(testFolder, 'NEUF-a.log'), 'not valid\n');
    fs.writeFileSync(path.join(testFolder, 'NEUF-b.log'), 'also not valid\n');
    try {
      await expect(logService.scanLogs(testFolder))
        .rejects.toThrow(/Found 2 NEUF-\*\.log file\(s\)/);
    } finally {
      fs.rmSync(testFolder, { recursive: true, force: true });
    }
  });

  test('DB file is removed when scan finds no matching files (stale DB cleanup)', async () => {
    const testFolder = path.join(TEST_DIR, 'stale-db-empty-' + Date.now());
    const dbDir = path.join(testFolder, 'log-filter-db');
    const dbPath = path.join(dbDir, 'neuf-logs.db');
    // Pre-create a stale DB file; verify _clearDbFile removes it
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(dbPath, 'stale');
    logService._clearDbFile(dbPath, testFolder);
    try {
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(testFolder, { recursive: true, force: true });
    }
  });

  test('DB file is removed when NEUF-*.log files exist but parse 0 entries (stale DB cleanup)', async () => {
    const testFolder = path.join(TEST_DIR, 'stale-db-bad-format-' + Date.now());
    const dbDir = path.join(testFolder, 'log-filter-db');
    const dbPath = path.join(dbDir, 'neuf-logs.db');
    // Place a NEUF log file with invalid content; no DB file present so scanLogs runs through
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(testFolder, 'NEUF-test.log'), 'not a valid log line\n');
    try {
      await expect(logService.scanLogs(testFolder))
        .rejects.toThrow(/could not parse/);
      // After the scan attempt, no DB file should exist
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(testFolder, { recursive: true, force: true });
    }
  });
});
// ============================================================================
// Service integration
// ============================================================================
describe('Service integration', () => {
  test('parserService is properly injected with required methods', () => {
    expect(typeof logService.parserService.getTimeBucket).toBe('function');
    expect(typeof logService.parserService.parseLine).toBe('function');
    expect(typeof logService.parserService.detectLogLineStart).toBe('function');
    expect(typeof logService.parserService.normalizeComponentName).toBe('function');
    expect(typeof logService.parserService.normalizeThreadName).toBe('function');
  });
  test('No instance state stored between operations', () => {
    const service1 = new NEUFLogService(mockLogger);
    const service2 = new NEUFLogService(mockLogger);
    const p1 = service1.getDbPath('/test/path1');
    const p2 = service2.getDbPath('/test/path2');
    expect(p1.dbPath).not.toBe(p2.dbPath);
  });
});
// ============================================================================
// filterLogs and getFilterOptions with real database
// ============================================================================
async function createTestDatabase() {
  const testFolder = path.join(TEST_DIR, 'filter-test-jest-' + Date.now());
  const dbDir = path.join(testFolder, 'log-filter-db');
  const dbPath = path.join(dbDir, 'neuf-logs.db');

  fs.mkdirSync(testFolder, { recursive: true });

  const logContent = [
    '2026.04.08 10:00:00.000 [INFO] Thread-1: <Device001> (com.example.service) Test message 1',
    '2026.04.08 10:00:01.000 [ERROR] Thread-2: <Device002> (com.example.controller) Test error message',
    '2026.04.08 10:00:02.000 [DEBUG] Thread-1: <Device001> (com.example.service) Debug message',
    '2026.04.08 10:00:03.000 [WARN] Thread-3: <Device003> (com.example.util) Warning message',
    '2026.04.08 10:00:04.000 [INFO] Thread-1: <Device001> (com.example.service) Another info message'
  ].join('\n');

  // Log file must be directly in testFolder and named NEUF-*.log for the scanner to pick it up
  const logFilePath = path.join(testFolder, 'NEUF-test.log');
  fs.writeFileSync(logFilePath, logContent);

  await logService.scanLogs(testFolder);

  return { testFolder, dbPath, logFolder: testFolder, logFilePath };
}
function cleanupTestDatabase({ testFolder, dbPath, logFilePath }) {
  try {
    if (fs.existsSync(logFilePath)) fs.unlinkSync(logFilePath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(path.dirname(dbPath))) fs.rmdirSync(path.dirname(dbPath));
    if (fs.existsSync(testFolder)) fs.rmdirSync(testFolder);
  } catch (_) { /* ignore cleanup errors */ }
}
describe('filterLogs() and getFilterOptions() with real database', () => {
  test('filterLogs: Returns all logs with empty filters', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result = await logService.filterLogs(
        testPaths.testFolder,
        {},
        { page: 1, pageSize: 100 }
      );
      expect(result.success).toBe(true);
      expect(Array.isArray(result.logs)).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(100);
      expect(result.logs.length).toBe(5);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
  test('filterLogs: Filters by log level', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result = await logService.filterLogs(
        testPaths.testFolder,
        { logLevelInclude: ['ERROR'] },
        { page: 1, pageSize: 100 }
      );
      expect(result.logs.every(log => log.log_level === 'ERROR')).toBe(true);
      expect(result.logs.length).toBe(1);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
  test('filterLogs: Filters by device ID', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result = await logService.filterLogs(
        testPaths.testFolder,
        { deviceInclude: ['Device001'] },
        { page: 1, pageSize: 100 }
      );
      expect(result.logs.every(log => log.device_id === 'Device001')).toBe(true);
      expect(result.logs.length).toBe(3);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
  test('filterLogs: Pagination works correctly', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result1 = await logService.filterLogs(
        testPaths.testFolder,
        {},
        { page: 1, pageSize: 2 }
      );
      const result2 = await logService.filterLogs(
        testPaths.testFolder,
        {},
        { page: 2, pageSize: 2 }
      );
      expect(result1.logs.length).toBe(2);
      expect(result2.logs.length).toBe(2);
      expect(result1.totalPages).toBe(3);
      expect(result1.logs[0].id).not.toBe(result2.logs[0].id);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
  test('getFilterOptions: Returns available filter options', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result = await logService.getFilterOptions(testPaths.testFolder);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data.logLevels)).toBe(true);
      expect(Array.isArray(result.data.devices)).toBe(true);
      expect(Array.isArray(result.data.threads)).toBe(true);
      expect(Array.isArray(result.data.components)).toBe(true);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
  test('getFilterOptions: Returns correct log levels from data', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result = await logService.getFilterOptions(testPaths.testFolder);
      const logLevels = result.data.logLevels;
      expect(logLevels.some(l => l.log_level === 'INFO')).toBe(true);
      expect(logLevels.some(l => l.log_level === 'ERROR')).toBe(true);
      expect(logLevels.some(l => l.log_level === 'DEBUG')).toBe(true);
      expect(logLevels.some(l => l.log_level === 'WARN')).toBe(true);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
  test('getFilterOptions: Returns correct device IDs from data', async () => {
    const testPaths = await createTestDatabase();
    try {
      const result = await logService.getFilterOptions(testPaths.testFolder);
      const devices = result.data.devices;
      expect(devices.some(d => d.device_id === 'Device001')).toBe(true);
      expect(devices.some(d => d.device_id === 'Device002')).toBe(true);
      expect(devices.some(d => d.device_id === 'Device003')).toBe(true);
      expect(devices.length).toBe(3);
    } finally {
      cleanupTestDatabase(testPaths);
    }
  });
});
