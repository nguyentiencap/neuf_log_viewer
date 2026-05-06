/**
 * Test Suite for Log Parser Module
 * Tests all functions in the LogParserService class
 */
const { logParserService } = require('../src/log-parser');
const parser = logParserService;
// ============================================================================
// normalizeComponentName
// ============================================================================
describe('normalizeComponentName()', () => {
  test('Full package path', () => {
    expect(parser.normalizeComponentName('com.example.package.ClassName')).toBe('com.example.package');
  });
  test('Simple class name without package', () => {
    expect(parser.normalizeComponentName('ClassName')).toBe('ClassName');
  });
  test('java:133 format', () => {
    expect(parser.normalizeComponentName('java:133')).toBe('java:133');
  });
  test('Single level package', () => {
    expect(parser.normalizeComponentName('com.ClassName')).toBe('com');
  });
  test('Deep package path', () => {
    expect(parser.normalizeComponentName('com.nuance.docimg.dws.core.impl.DeviceManager'))
      .toBe('com.nuance.docimg.dws.core.impl');
  });
  test('Null input', () => {
    expect(parser.normalizeComponentName(null)).toBeNull();
  });
  test('Empty string', () => {
    expect(parser.normalizeComponentName('')).toBeNull();
  });
  test('Dot at start', () => {
    expect(parser.normalizeComponentName('.ClassName')).toBe('.ClassName');
  });
  test('HistoricalSessionManager.java:273 format', () => {
    expect(parser.normalizeComponentName('HistoricalSessionManager.java:273')).toBe('HistoricalSessionManager');
  });
});
// ============================================================================
// normalizeThreadName
// ============================================================================
describe('normalizeThreadName()', () => {
  test('Thread with number', () => {
    expect(parser.normalizeThreadName('Thread-123')).toBe('Thread');
  });
  test('Thread with multiple dashes', () => {
    expect(parser.normalizeThreadName('Worker-Thread-456')).toBe('Worker-Thread');
  });
  test('Thread without number', () => {
    expect(parser.normalizeThreadName('MainThread')).toBe('MainThread');
  });
  test('Null input', () => {
    expect(parser.normalizeThreadName(null)).toBe('unknown');
  });
  test('Empty string', () => {
    expect(parser.normalizeThreadName('')).toBe('unknown');
  });
});
// ============================================================================
// getTimeBucket
// ============================================================================
describe('getTimeBucket()', () => {
  test('First half hour (00-29 minutes)', () => {
    const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 15, 0) / 1000);
    expect(parser.getTimeBucket('2026.04.08 14:15:30.123')).toBe(expected);
  });
  test('Second half hour (30-59 minutes)', () => {
    const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 45, 0) / 1000);
    expect(parser.getTimeBucket('2026.04.08 14:45:30.123')).toBe(expected);
  });
  test('Exactly 00 minutes', () => {
    const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 0, 0) / 1000);
    expect(parser.getTimeBucket('2026.04.08 14:00:00.000')).toBe(expected);
  });
  test('Exactly 30 minutes', () => {
    const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000);
    expect(parser.getTimeBucket('2026.04.08 14:30:00.000')).toBe(expected);
  });
  test('Minute 29 (boundary)', () => {
    const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 29, 0) / 1000);
    expect(parser.getTimeBucket('2026.04.08 14:29:59.999')).toBe(expected);
  });
  test('Minute 59 (boundary)', () => {
    const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 59, 0) / 1000);
    expect(parser.getTimeBucket('2026.04.08 14:59:59.999')).toBe(expected);
  });
  test('Invalid timestamp format', () => {
    expect(parser.getTimeBucket('invalid-timestamp')).toBeNull();
  });
  test('Null input', () => {
    expect(parser.getTimeBucket(null)).toBeNull();
  });
});
// ============================================================================
// formatLogEntry
// ============================================================================
describe('formatLogEntry()', () => {
  test('Complete log object', () => {
    const logObj = {
      filename: 'test.log',
      timestamp: '2026.04.08 14:30:45.123',
      log_level: 'INFO',
      thread_name: 'Thread-1',
      device_id: 'Device123',
      component_name: 'com.example.Component',
      message: 'Test message'
    };
    expect(parser.formatLogEntry(logObj))
      .toBe('(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: <Device123> (com.example.Component) Test message');
  });
  test('Log object without device ID', () => {
    const logObj = {
      filename: 'test.log',
      timestamp: '2026.04.08 14:30:45.123',
      log_level: 'INFO',
      thread_name: 'Thread-1',
      device_id: null,
      component_name: 'com.example.Component',
      message: 'Test message'
    };
    expect(parser.formatLogEntry(logObj))
      .toBe('(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: (com.example.Component) Test message');
  });
  test('Log object without component name', () => {
    const logObj = {
      filename: 'test.log',
      timestamp: '2026.04.08 14:30:45.123',
      log_level: 'INFO',
      thread_name: 'Thread-1',
      device_id: 'Device123',
      component_name: null,
      message: 'Test message'
    };
    expect(parser.formatLogEntry(logObj))
      .toBe('(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: <Device123> Test message');
  });
  test('Minimal log object', () => {
    const logObj = {
      filename: 'test.log',
      timestamp: '2026.04.08 14:30:45.123',
      log_level: 'INFO',
      thread_name: 'Thread-1',
      device_id: null,
      component_name: null,
      message: 'Test message'
    };
    expect(parser.formatLogEntry(logObj))
      .toBe('(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: Test message');
  });
});
// ============================================================================
// parsePhase1Line
// ============================================================================
describe('parsePhase1Line()', () => {
  test('Valid log line returns timestamp, rawContent and timeBucket', () => {
    const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: <Device> (com.example.Class) Test message';
    expect(parser.parsePhase1Line(line)).toEqual({
      timestamp: '2026.04.08 14:30:45.123',
      rawContent: '[INFO] Thread-1: <Device> (com.example.Class) Test message',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000)
    });
  });
  test('Continuation line returns null', () => {
    expect(parser.parsePhase1Line('  at com.example.Class.method(Class.java:42)')).toBeNull();
  });
  test('Empty line returns null', () => {
    expect(parser.parsePhase1Line('')).toBeNull();
  });
  test('Plain text without timestamp returns null', () => {
    expect(parser.parsePhase1Line('Some random text without timestamp')).toBeNull();
  });
  test('Minimal log line (timestamp + level + thread + message)', () => {
    const line = '2026.04.08 14:30:45.123 [WARN] main: Something happened';
    expect(parser.parsePhase1Line(line)).toEqual({
      timestamp: '2026.04.08 14:30:45.123',
      rawContent: '[WARN] main: Something happened',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000)
    });
  });
});
// ============================================================================
// parsePhase2Entry
// ============================================================================
describe('parsePhase2Entry()', () => {
  test('Full entry with all fields', () => {
    const rawEntry = {
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      rawContent: '[INFO] class com.example.MyClass: Thread-1: <Device123> (com.example.package.Component) Test message'
    };
    expect(parser.parsePhase2Entry(rawEntry)).toEqual({
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      logLevel: 'INFO',
      threadName: 'Thread',
      deviceId: 'Device123',
      componentName: 'com.example.package',
      message: 'Test message'
    });
  });
  test('Entry without class name', () => {
    const rawEntry = {
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      rawContent: '[INFO] Thread-1: <Device123> (com.example.Component) Test message'
    };
    expect(parser.parsePhase2Entry(rawEntry)).toEqual({
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      logLevel: 'INFO',
      threadName: 'Thread',
      deviceId: 'Device123',
      componentName: 'com.example',
      message: 'Test message'
    });
  });
  test('Entry without deviceId and componentName', () => {
    const rawEntry = {
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      rawContent: '[WARN] MainThread: Simple warning'
    };
    expect(parser.parsePhase2Entry(rawEntry)).toEqual({
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      logLevel: 'WARN',
      threadName: 'MainThread',
      deviceId: null,
      componentName: null,
      message: 'Simple warning'
    });
  });
  test('Multi-line entry preserves continuation lines in message', () => {
    const rawEntry = {
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      rawContent: '[ERROR] Thread-1: Exception occurred\n  at com.example.Class.method(Class.java:42)\n  at com.example.Main.run(Main.java:10)'
    };
    const result = parser.parsePhase2Entry(rawEntry);
    expect(result.message).toBe('Exception occurred\n  at com.example.Class.method(Class.java:42)\n  at com.example.Main.run(Main.java:10)');
  });
  test('Invalid rawContent (no log level) returns null', () => {
    const rawEntry = {
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      rawContent: 'This is not a valid log entry'
    };
    expect(parser.parsePhase2Entry(rawEntry)).toBeNull();
  });
  test('Thread name is normalized (removes trailing number)', () => {
    const rawEntry = {
      filename: 'NEUF-test.log',
      timestamp: '2026.04.08 14:30:45.123',
      timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
      rawContent: '[INFO] Worker-Thread-42: Task completed'
    };
    const result = parser.parsePhase2Entry(rawEntry);
    expect(result.threadName).toBe('Worker-Thread');
  });
});
