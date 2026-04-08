/**
 * Test Suite for Log Parser Module
 * Tests all functions in the LogParserService class
 */

const { logParserService } = require('../lib/log-parser');
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
  return assertEqual(result, '2026-04-08 14:00', 
    'Should round to :00 for minutes 0-29');
});

runTest('getTimeBucket: Second half hour (30-59 minutes)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:45:30.123');
  return assertEqual(result, '2026-04-08 14:30', 
    'Should round to :30 for minutes 30-59');
});

runTest('getTimeBucket: Exactly 00 minutes', () => {
  const result = parser.getTimeBucket('2026.04.08 14:00:00.000');
  return assertEqual(result, '2026-04-08 14:00', 
    'Should return :00 for exactly 00 minutes');
});

runTest('getTimeBucket: Exactly 30 minutes', () => {
  const result = parser.getTimeBucket('2026.04.08 14:30:00.000');
  return assertEqual(result, '2026-04-08 14:30', 
    'Should return :30 for exactly 30 minutes');
});

runTest('getTimeBucket: Minute 29 (boundary)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:29:59.999');
  return assertEqual(result, '2026-04-08 14:00', 
    'Should round to :00 for minute 29');
});

runTest('getTimeBucket: Minute 59 (boundary)', () => {
  const result = parser.getTimeBucket('2026.04.08 14:59:59.999');
  return assertEqual(result, '2026-04-08 14:30', 
    'Should round to :30 for minute 59');
});

runTest('getTimeBucket: Invalid timestamp format', () => {
  const result = parser.getTimeBucket('invalid-timestamp');
  return assertEqual(result, 'unknown', 
    'Should return "unknown" for invalid format');
});

runTest('getTimeBucket: Null input', () => {
  const result = parser.getTimeBucket(null);
  return assertEqual(result, 'unknown', 
    'Should return "unknown" for null input');
});

// ============================================================================
// Test parseLogEntry
// ============================================================================
printSection('Testing parseLogEntry()');

runTest('parseLogEntry: Complete log entry with all fields', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] class com.example.MyClass: Thread-1: <Device123> (com.example.package.Component) Test message';
  const result = parser.parseLogEntry(line);
  const expected = {
    timestamp: '2026.04.08 14:30:45.123',
    logLevel: 'INFO',
    className: 'class com.example.MyClass',
    threadName: 'Thread-1',
    deviceId: 'Device123',
    componentName: 'com.example.package',
    message: 'Test message',
    rawLine: line
  };
  return assertEqual(result, expected,
    'Should parse complete log entry with all fields');
});

runTest('parseLogEntry: Log entry without class name', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: <Device123> (com.example.Component) Test message';
  const result = parser.parseLogEntry(line);
  const expected = {
    timestamp: '2026.04.08 14:30:45.123',
    logLevel: 'INFO',
    className: null,
    threadName: 'Thread-1',
    deviceId: 'Device123',
    componentName: 'com.example',
    message: 'Test message',
    rawLine: line
  };
  return assertEqual(result, expected, 
    'Should parse log entry without class name');
});

runTest('parseLogEntry: Log entry without device ID', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: (com.example.Component) Test message';
  const result = parser.parseLogEntry(line);
  const expected = {
    timestamp: '2026.04.08 14:30:45.123',
    logLevel: 'INFO',
    className: null,
    threadName: 'Thread-1',
    deviceId: null,
    componentName: 'com.example',
    message: 'Test message',
    rawLine: line
  };
  return assertEqual(result, expected, 
    'Should parse log entry without device ID');
});

runTest('parseLogEntry: Log entry without component name', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: <Device123> Test message';
  const result = parser.parseLogEntry(line);
  const expected = {
    timestamp: '2026.04.08 14:30:45.123',
    logLevel: 'INFO',
    className: null,
    threadName: 'Thread-1',
    deviceId: 'Device123',
    componentName: null,
    message: 'Test message',
    rawLine: line
  };
  return assertEqual(result, expected, 
    'Should parse log entry without component name');
});

runTest('parseLogEntry: Minimal log entry', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: Test message';
  const result = parser.parseLogEntry(line);
  const expected = {
    timestamp: '2026.04.08 14:30:45.123',
    logLevel: 'INFO',
    className: null,
    threadName: 'Thread-1',
    deviceId: null,
    componentName: null,
    message: 'Test message',
    rawLine: line
  };
  return assertEqual(result, expected, 
    'Should parse minimal log entry');
});

runTest('parseLogEntry: Component name without dots (java:133)', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Thread-1: (java:133) Test message';
  const result = parser.parseLogEntry(line);
  const expected = {
    timestamp: '2026.04.08 14:30:45.123',
    logLevel: 'INFO',
    className: null,
    threadName: 'Thread-1',
    deviceId: null,
    componentName: 'java:133',
    message: 'Test message',
    rawLine: line
  };
  return assertEqual(result, expected, 
    'Should handle component name without dots');
});

runTest('parseLogEntry: Different log levels', () => {
  const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
  let allPassed = true;
  
  levels.forEach(level => {
    const line = `2026.04.08 14:30:45.123 [${level}] Thread-1: Test message`;
    const result = parser.parseLogEntry(line);
    if (result.logLevel !== level) {
      console.error(`  Failed for level: ${level}`);
      allPassed = false;
    }
  });
  
  if (allPassed) {
    console.log(`✅ PASSED: Should parse all log levels correctly`);
  }
  return allPassed;
});

runTest('parseLogEntry: Invalid format - no timestamp', () => {
  const line = '[INFO] Thread-1: Test message';
  const result = parser.parseLogEntry(line);
  return assertEqual(result, null, 
    'Should return null for invalid format (no timestamp)');
});

runTest('parseLogEntry: Invalid format - no log level', () => {
  const line = '2026.04.08 14:30:45.123 Thread-1: Test message';
  const result = parser.parseLogEntry(line);
  return assertEqual(result, null, 
    'Should return null for invalid format (no log level)');
});

runTest('parseLogEntry: Invalid format - no thread name', () => {
  const line = '2026.04.08 14:30:45.123 [INFO] Test message';
  const result = parser.parseLogEntry(line);
  return assertEqual(result, null, 
    'Should return null for invalid format (no thread name)');
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
// Summary
// ============================================================================
printSummary('LOG PARSER TEST SUITE');
