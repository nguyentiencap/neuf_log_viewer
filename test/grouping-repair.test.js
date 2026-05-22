/**
 * Test Suite for Re-Pair Grouping Service
 * Tests GroupingInterface and RePairGroupingService
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GroupingInterface } = require('../src/grouping-interface');
const { RePairGroupingService } = require('../src/grouping-repair');

const serviceDefault = new RePairGroupingService();

// ============================================================================
// GroupingInterface
// ============================================================================
describe('GroupingInterface', () => {
  test('group() throws when called on base class', () => {
    const iface = new GroupingInterface();
    expect(() => iface.group([])).toThrow('group() must be implemented by subclass');
  });

  test('Constructor applies default options', () => {
    const iface = new GroupingInterface();
    expect(iface.options.minCount).toBe(2);
    expect(iface.options.maxRules).toBe(200);
  });

  test('Constructor merges custom options', () => {
    const iface = new GroupingInterface({ minCount: 5, maxRules: 50 });
    expect(iface.options.minCount).toBe(5);
    expect(iface.options.maxRules).toBe(50);
  });
});

// ============================================================================
// RePairGroupingService.tokenize
// ============================================================================
describe('RePairGroupingService.tokenize()', () => {
  const service = new RePairGroupingService();

  test('Splits on whitespace', () => {
    expect(service.tokenize('hello world foo')).toEqual(['hello', 'world', 'foo']);
  });

  test('Handles multiple spaces', () => {
    expect(service.tokenize('a  b   c')).toEqual(['a', 'b', 'c']);
  });

  test('Handles leading and trailing spaces', () => {
    expect(service.tokenize('  foo bar  ')).toEqual(['foo', 'bar']);
  });

  test('Returns empty array for empty string', () => {
    expect(service.tokenize('')).toEqual([]);
  });

  test('Returns empty array for null', () => {
    expect(service.tokenize(null)).toEqual([]);
  });

  test('Returns single token for single-word message', () => {
    expect(service.tokenize('hello')).toEqual(['hello']);
  });
});

// ============================================================================
// RePairGroupingService.group – basic correctness
// ============================================================================
describe('RePairGroupingService.group()', () => {
  const service = new RePairGroupingService();

  test('Returns empty array for empty input', () => {
    expect(service.group([])).toEqual([]);
  });

  test('Returns empty array when no pair appears twice', () => {
    expect(service.group(['a b', 'c d', 'e f'])).toEqual([]);
  });

  test('Detects single repeated pair and uses key_minLine_maxLine format', () => {
    // messages at 1-based lines 1, 2, 3 — pair (a,b) in all three → key_1_3
    const messages = ['a b c', 'a b d', 'a b e'];
    const result = service.group(messages);
    expect(result.length).toBeGreaterThan(0);
    const entry = result.find(e => e.id === 'key_1_3');
    expect(entry).toBeDefined();
    expect(entry.key).toEqual(['a', 'b']);
    expect(entry.count).toBe(3);
  });

  test('Result is sorted by count descending', () => {
    const messages = [
      'a b c', 'a b c', 'a b c',
      'x y',   'x y',
    ];
    const result = service.group(messages);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].count).toBeGreaterThanOrEqual(result[i].count);
    }
  });

  test('Each entry id uses key_minLine_maxLine format', () => {
    const messages = ['hello world', 'hello world', 'hello world'];
    const result = service.group(messages);
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) {
      expect(entry.id).toMatch(/^key_\d+_\d+/);
      expect(typeof entry.id).toBe('string');
      expect(Array.isArray(entry.key)).toBe(true);
      expect(entry.key.length).toBeGreaterThan(0);
      expect(typeof entry.count).toBe('number');
    }
  });

  test('Handles messages consisting of a single token', () => {
    expect(service.group(['hello', 'hello', 'hello'])).toEqual([]);
  });

  test('Handles a single message', () => {
    expect(service.group(['only one message here'])).toEqual([]);
  });

  test('Respects minCount option — pair below threshold excluded', () => {
    const messages = ['a b', 'a b', 'c d'];
    expect(service.group(messages, { minCount: 3 })).toEqual([]);
  });

  test('Respects maxRules option', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      `token${i % 5} next${i % 3} other`
    );
    const result = service.group(messages, { maxRules: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// RePairGroupingService.group – rule expansion (issue example)
// ============================================================================
describe('RePairGroupingService rule expansion', () => {
  test('key_1_5 (a,b), key_1_3 (a,b,c), key_4_5 (a,b,d) — IDs from original line ranges', () => {
    // messages (1-based lines):
    //   1: 'a b c', 2: 'a b c', 3: 'a b c'  → (a,b) in lines 1-5, (key_1_5,c) in lines 1-3
    //   4: 'a b d', 5: 'a b d'               → (key_1_5,d) in lines 4-5
    const messages = [
      'a b c', 'a b c', 'a b c',
      'a b d', 'a b d',
    ];
    const result = serviceDefault.group(messages, { minCount: 2 });

    const abRule = result.find(e => e.id === 'key_1_5');
    const abcRule = result.find(e => e.id === 'key_1_3');
    const abdRule = result.find(e => e.id === 'key_4_5');

    expect(abRule).toBeDefined();
    expect(abRule.key).toEqual(['a', 'b']);
    expect(abRule.count).toBe(5);

    expect(abcRule).toBeDefined();
    expect(abcRule.key).toEqual(['a', 'b', 'c']);
    expect(abcRule.count).toBe(3);

    expect(abdRule).toBeDefined();
    expect(abdRule.key).toEqual(['a', 'b', 'd']);
    expect(abdRule.count).toBe(2);
  });

  test('Deeper expansion: r3 uses two different sub-rules', () => {
    // (a,b)=4, (c,d)=4, then (r1,r2)=4
    const messages = [
      'a b c d', 'a b c d', 'a b c d', 'a b c d',
    ];
    const result = serviceDefault.group(messages, { minCount: 2 });
    // After round 1: one of (a,b) or (c,d) gets replaced (tie-break by iteration order)
    // After round 2: the other pair replaced
    // After round 3: (r1,r2) replaced
    expect(result.length).toBeGreaterThan(0);
    // The rule covering the full pattern must expand to [a,b,c,d]
    const full = result.find(e => e.key.length === 4);
    expect(full).toBeDefined();
    expect(full.key).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ============================================================================
// RePairGroupingService.group – JSON export
// ============================================================================
describe('RePairGroupingService JSON export', () => {
  test('Writes dictionary JSON file when outputFile is specified', () => {
    const tmpFile = path.join(os.tmpdir(), `grouping-test-${Date.now()}.json`);
    const messages = ['a b c', 'a b c', 'a b d'];
    try {
      serviceDefault.group(messages, { outputFile: tmpFile });
      expect(fs.existsSync(tmpFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('key');
      expect(data[0]).toHaveProperty('count');
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  test('Exported JSON is sorted by count descending', () => {
    const tmpFile = path.join(os.tmpdir(), `grouping-sort-${Date.now()}.json`);
    const messages = [
      'a b', 'a b', 'a b', 'a b',
      'c d', 'c d',
    ];
    try {
      serviceDefault.group(messages, { outputFile: tmpFile });
      const data = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
      for (let i = 1; i < data.length; i++) {
        expect(data[i - 1].count).toBeGreaterThanOrEqual(data[i].count);
      }
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  test('outputFile option can be set at constructor level', () => {
    const tmpFile = path.join(os.tmpdir(), `grouping-ctor-${Date.now()}.json`);
    const svc = new RePairGroupingService({ outputFile: tmpFile });
    const messages = ['x y z', 'x y z', 'x y w'];
    try {
      svc.group(messages);
      expect(fs.existsSync(tmpFile)).toBe(true);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  });

  test('Per-call outputFile overrides constructor outputFile', () => {
    const ctorFile = path.join(os.tmpdir(), `grouping-ctor2-${Date.now()}.json`);
    const callFile = path.join(os.tmpdir(), `grouping-call2-${Date.now()}.json`);
    const svc = new RePairGroupingService({ outputFile: ctorFile });
    const messages = ['p q r', 'p q r', 'p q s'];
    try {
      svc.group(messages, { outputFile: callFile });
      expect(fs.existsSync(callFile)).toBe(true);
      expect(fs.existsSync(ctorFile)).toBe(false);
    } finally {
      if (fs.existsSync(ctorFile)) fs.unlinkSync(ctorFile);
      if (fs.existsSync(callFile)) fs.unlinkSync(callFile);
    }
  });
});

// ============================================================================
// Performance tests – 10k and 100k messages
// ============================================================================
describe('RePairGroupingService performance', () => {
  const TEMPLATES = [
    'User login from {ip} at port {port}',
    'Connection refused to host {host} port {port}',
    'Exception in thread {thread} at {file}:{line}',
    'Retry attempt {n} for request {id}',
    'Cache miss for key {key} in region {region}',
  ];

  function makeMessages(count) {
    return Array.from({ length: count }, (_, i) => {
      const t = TEMPLATES[i % TEMPLATES.length];
      return t.replace(/\{[^}]+\}/g, () => `val${i % 100}`);
    });
  }

  function assertDictionary(result) {
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].count).toBeGreaterThanOrEqual(result[i].count);
    }
    for (const entry of result) {
      expect(entry.id).toMatch(/^key_\d+_\d+/);
      expect(Array.isArray(entry.key)).toBe(true);
      expect(entry.key.length).toBeGreaterThan(0);
      expect(typeof entry.count).toBe('number');
      expect(entry.count).toBeGreaterThanOrEqual(2);
    }
  }

  test('Groups 10k messages correctly', () => {
    const svc = new RePairGroupingService({ maxRules: 50 });
    const result = svc.group(makeMessages(10000));
    assertDictionary(result);
  }, 30000);

  test('Groups 100k messages correctly', () => {
    const svc = new RePairGroupingService({ maxRules: 30 });
    const result = svc.group(makeMessages(100000));
    assertDictionary(result);
  }, 60000);
});
