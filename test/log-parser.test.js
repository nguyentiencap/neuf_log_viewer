/**
 * Test Suite for Log Parser Module
 * Tests all functions in the LogParserService class
 */

const { logParserService } = require('../src/log-parser');
const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');

// Use singleton instance
const parser = logParserService;

printSection('LOG PARSER TEST SUITE');

// ============================================================================
// Test normalizeComponentName
// ============================================================================
printSection('Testing normalizeComponentName()');

runTest('normalizeComponentName: Full package path', () => {
  const result = parser.normalizeComponentName('com.example.package.ClassName');
  return assertEqual(result, 'com.example.package', 
    'Should extract package path (everything before last dot)');
});

runTest('normalizeComponentName: Simple class name without package', () => {
  const result = parser.normalizeComponentName('ClassName');
  return assertEqual(result, 'ClassName', 
    'Should return as-is when no dot present');
});

runTest('normalizeComponentName: java:133 format', () => {
  const result = parser.normalizeComponentName('java:133');
  return assertEqual(result, 'java:133', 
    'Should return as-is when no dot present (colon format)');
});

runTest('normalizeComponentName: Single level package', () => {
  const result = parser.normalizeComponentName('com.ClassName');
  return assertEqual(result, 'com', 
    'Should extract single level package');
});

runTest('normalizeComponentName: Deep package path', () => {
  const result = parser.normalizeComponentName('com.nuance.docimg.dws.core.impl.DeviceManager');
  return assertEqual(result, 'com.nuance.docimg.dws.core.impl', 
    'Should extract deep package path');
});

runTest('normalizeComponentName: Null input', () => {
  const result = parser.normalizeComponentName(null);
  return assertEqual(result, null, 
    'Should return null for null input');
});

runTest('normalizeComponentName: Empty string', () => {
  const result = parser.normalizeComponentName('');
  return assertEqual(result, null, 
    'Should return null for empty string');
});

runTest('normalizeComponentName: Dot at start', () => {
  const result = parser.normalizeComponentName('.ClassName');
  return assertEqual(result, '.ClassName',
    'Should return as-is when dot at position 0');
});

runTest('normalizeComponentName: HistoricalSessionManager.java:273 format', () => {
  const result = parser.normalizeComponentName('HistoricalSessionManager.java:273');
  return assertEqual(result, 'HistoricalSessionManager',
    'Should extract class name before .java:line format');
});

// ============================================================================
// Test normalizeThreadName
// ============================================================================
printSection('Testing normalizeThreadName()');

runTest('normalizeThreadName: Thread with number', () => {
  const result = parser.normalizeThreadName('Thread-123');
  return assertEqual(result, 'Thread', 
    'Should remove trailing number');
});

runTest('normalizeThreadName: Thread with multiple dashes', () => {
  const result = parser.normalizeThreadName('Worker-Thread-456');
  return assertEqual(result, 'Worker-Thread', 
    'Should only remove last dash and number');
});

runTest('normalizeThreadName: Thread without number', () => {
  const result = parser.normalizeThreadName('MainThread');
  return assertEqual(result, 'MainThread', 
    'Should return as-is when no trailing number');
});

runTest('normalizeThreadName: Null input', () => {
  const result = parser.normalizeThreadName(null);
  return assertEqual(result, 'unknown', 
    'Should return "unknown" for null input');
});

runTest('normalizeThreadName: Empty string', () => {
  const result = parser.normalizeThreadName('');
  return assertEqual(result, 'unknown', 
    'Should return "unknown" for empty string');
});

// ============================================================================
// Test getTimeBucket
// ============================================================================
printSection('Testing getTimeBucket()');

runTest('getTimeBucket: First half hour (00-29 minutes)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:15:30.123');
  const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 15, 0) / 1000);
  return assertEqual(result, expected,
    'Should truncate seconds/ms and keep minute for minutes 0-29');
});

runTest('getTimeBucket: Second half hour (30-59 minutes)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:45:30.123');
  const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 45, 0) / 1000);
  return assertEqual(result, expected,
    'Should truncate seconds/ms and keep minute for minutes 30-59');
});

runTest('getTimeBucket: Exactly 00 minutes', () => {
  const result = parser.getTimeBucket('2026.04.08 14:00:00.000');
  const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 0, 0) / 1000);
  return assertEqual(result, expected,
    'Should return minute-level bucket for exactly 00 minutes');
});

runTest('getTimeBucket: Exactly 30 minutes', () => {
  const result = parser.getTimeBucket('2026.04.08 14:30:00.000');
  const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000);
  return assertEqual(result, expected,
    'Should return minute-level bucket for exactly 30 minutes');
});

runTest('getTimeBucket: Minute 29 (boundary)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:29:59.999');
  const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 29, 0) / 1000);
  return assertEqual(result, expected,
    'Should return minute-level bucket for minute 29');
});

runTest('getTimeBucket: Minute 59 (boundary)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:59:59.999');
  const expected = Math.floor(Date.UTC(2026, 3, 8, 14, 59, 0) / 1000);
  return assertEqual(result, expected,
    'Should return minute-level bucket for minute 59');
});

runTest('getTimeBucket: Invalid timestamp format', () => {
  const result = parser.getTimeBucket('invalid-timestamp');
  return assertEqual(result, null,
    'Should return null for invalid format');
});

runTest('getTimeBucket: Null input', () => {
  const result = parser.getTimeBucket(null);
  return assertEqual(result, null,
    'Should return null for null input');
});

// ============================================================================
// Test formatLogEntry
// ============================================================================
printSection('Testing formatLogEntry()');

runTest('formatLogEntry: Complete log object', () => {
  const logObj = {
    filename: 'test.log',
    timestamp: '2026.04.08 14:30:45.123',
    log_level: 'INFO',
    thread_name: 'Thread-1',
    device_id: 'Device123',
    component_name: 'com.example.Component',
    message: 'Test message'
  };
  const result = parser.formatLogEntry(logObj);
  const expected = '(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: <Device123> (com.example.Component) Test message';
  return assertEqual(result, expected, 
    'Should format complete log object correctly');
});

runTest('formatLogEntry: Log object without device ID', () => {
  const logObj = {
    filename: 'test.log',
    timestamp: '2026.04.08 14:30:45.123',
    log_level: 'INFO',
    thread_name: 'Thread-1',
    device_id: null,
    component_name: 'com.example.Component',
    message: 'Test message'
  };
  const result = parser.formatLogEntry(logObj);
  const expected = '(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: (com.example.Component) Test message';
  return assertEqual(result, expected, 
    'Should format log without device ID correctly');
});

runTest('formatLogEntry: Log object without component name', () => {
  const logObj = {
    filename: 'test.log',
    timestamp: '2026.04.08 14:30:45.123',
    log_level: 'INFO',
    thread_name: 'Thread-1',
    device_id: 'Device123',
    component_name: null,
    message: 'Test message'
  };
  const result = parser.formatLogEntry(logObj);
  const expected = '(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: <Device123> Test message';
  return assertEqual(result, expected, 
    'Should format log without component name correctly');
});

runTest('formatLogEntry: Minimal log object', () => {
  const logObj = {
    filename: 'test.log',
    timestamp: '2026.04.08 14:30:45.123',
    log_level: 'INFO',
    thread_name: 'Thread-1',
    device_id: null,
    component_name: null,
    message: 'Test message'
  };
  const result = parser.formatLogEntry(logObj);
  const expected = '(test.log) 2026.04.08 14:30:45.123 [INFO] Thread-1: Test message';
  return assertEqual(result, expected, 
    'Should format minimal log object correctly');
});

// ============================================================================
// Test parsePhase1Line
// ============================================================================
printSection('Testing parsePhase1Line()');

runTest('parsePhase1Line: Valid log line returns timestamp, rawContent and timeBucket', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: <Device> (com.example.Class) Test message';
  const result = parser.parsePhase1Line(line);
  return assertEqual(result, {
    timestamp: '2026.04.08 14:30:45.123',
    rawContent: '[INFO] Thread-1: <Device> (com.example.Class) Test message',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000)
  }, 'Should extract timestamp, rawContent and timeBucket from valid log line');
});

runTest('parsePhase1Line: Continuation line returns null', () => {
  const line = '  at com.example.Class.method(Class.java:42)';
  const result = parser.parsePhase1Line(line);
  return assertEqual(result, null, 'Should return null for continuation/stacktrace line');
});

runTest('parsePhase1Line: Empty line returns null', () => {
  const result = parser.parsePhase1Line('');
  return assertEqual(result, null, 'Should return null for empty line');
});

runTest('parsePhase1Line: Plain text without timestamp returns null', () => {
  const result = parser.parsePhase1Line('Some random text without timestamp');
  return assertEqual(result, null, 'Should return null for text without timestamp');
});

runTest('parsePhase1Line: Minimal log line (timestamp + level + thread + message)', () => {
  const line = '2026.04.08 14:30:45.123 [WARN] main: Something happened';
  const result = parser.parsePhase1Line(line);
  return assertEqual(result, {
    timestamp: '2026.04.08 14:30:45.123',
    rawContent: '[WARN] main: Something happened',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000)
  }, 'Should parse minimal log line');
});


// ============================================================================
// Test parsePhase2Entry
// ============================================================================
printSection('Testing parsePhase2Entry()');

runTest('parsePhase2Entry: Full entry with all fields', () => {
  const rawEntry = {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    rawContent: '[INFO] class com.example.MyClass: Thread-1: <Device123> (com.example.package.Component) Test message'
  };
  const result = parser.parsePhase2Entry(rawEntry);
  return assertEqual(result, {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    logLevel: 'INFO',
    threadName: 'Thread',
    deviceId: 'Device123',
    componentName: 'com.example.package',
    message: 'Test message'
  }, 'Should parse full entry with all fields');
});

runTest('parsePhase2Entry: Entry without class name', () => {
  const rawEntry = {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    rawContent: '[INFO] Thread-1: <Device123> (com.example.Component) Test message'
  };
  const result = parser.parsePhase2Entry(rawEntry);
  return assertEqual(result, {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    logLevel: 'INFO',
    threadName: 'Thread',
    deviceId: 'Device123',
    componentName: 'com.example',
    message: 'Test message'
  }, 'Should parse entry without class name');
});

runTest('parsePhase2Entry: Entry without deviceId and componentName', () => {
  const rawEntry = {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    rawContent: '[WARN] MainThread: Simple warning'
  };
  const result = parser.parsePhase2Entry(rawEntry);
  return assertEqual(result, {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    logLevel: 'WARN',
    threadName: 'MainThread',
    deviceId: null,
    componentName: null,
    message: 'Simple warning'
  }, 'Should handle entry without optional fields');
});

runTest('parsePhase2Entry: Multi-line entry preserves continuation lines in message', () => {
  const rawEntry = {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    rawContent: '[ERROR] Thread-1: Exception occurred\n  at com.example.Class.method(Class.java:42)\n  at com.example.Main.run(Main.java:10)'
  };
  const result = parser.parsePhase2Entry(rawEntry);
  const expectedMessage = 'Exception occurred\n  at com.example.Class.method(Class.java:42)\n  at com.example.Main.run(Main.java:10)';
  return assertEqual(result && result.message, expectedMessage,
    'Should preserve continuation lines as part of the message');
});

runTest('parsePhase2Entry: Invalid rawContent (no log level) returns null', () => {
  const rawEntry = {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    rawContent: 'This is not a valid log entry'
  };
  const result = parser.parsePhase2Entry(rawEntry);
  return assertEqual(result, null, 'Should return null for invalid rawContent');
});

runTest('parsePhase2Entry: Thread name is normalized (removes trailing number)', () => {
  const rawEntry = {
    filename: 'NEUF-test.log',
    timestamp: '2026.04.08 14:30:45.123',
    timeBucket: Math.floor(Date.UTC(2026, 3, 8, 14, 30, 0) / 1000),
    rawContent: '[INFO] Worker-Thread-42: Task completed'
  };
  const result = parser.parsePhase2Entry(rawEntry);
  return assertEqual(result && result.threadName, 'Worker-Thread',
    'Thread name should have trailing number removed');
});

// ============================================================================
// Summary
// ============================================================================
printSummary('LOG PARSER TEST SUITE');
