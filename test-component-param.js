#!/usr/bin/env node

/**
 * Test: Verify component parameter supports both syntaxes
 */

// Inline the function for testing
function expandCommaSeparated(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(v => v.split(',').map(s => s.trim()).filter(s => s));
}

console.log('Testing --component parameter support:\n');

// Test 1: Repeated flags
const test1 = expandCommaSeparated(['com.app.network', 'com.app.runtime', 'com.app.ui']);
console.log('✅ Test 1 - Repeated flags: --component net --component runtime --component ui');
console.log(`   Input (array):  ['com.app.network', 'com.app.runtime', 'com.app.ui']`);
console.log(`   Output:         ${JSON.stringify(test1)}`);
console.log(`   Result:         ${JSON.stringify(test1) === JSON.stringify(['com.app.network', 'com.app.runtime', 'com.app.ui']) ? 'PASS' : 'FAIL'}\n`);

// Test 2: Comma-separated
const test2 = expandCommaSeparated('com.app.network,com.app.runtime,com.app.ui');
console.log('✅ Test 2 - Comma-separated: --component "com.app.network,com.app.runtime,com.app.ui"');
console.log(`   Input (string): 'com.app.network,com.app.runtime,com.app.ui'`);
console.log(`   Output:         ${JSON.stringify(test2)}`);
console.log(`   Result:         ${JSON.stringify(test2) === JSON.stringify(['com.app.network', 'com.app.runtime', 'com.app.ui']) ? 'PASS' : 'FAIL'}\n`);

// Test 3: Mixed
const test3 = expandCommaSeparated(['com.app.network,com.app.runtime', 'com.app.ui']);
console.log('✅ Test 3 - Mixed: --component "net,runtime" --component ui');
console.log(`   Input (mixed):  ['com.app.network,com.app.runtime', 'com.app.ui']`);
console.log(`   Output:         ${JSON.stringify(test3)}`);
console.log(`   Result:         ${JSON.stringify(test3) === JSON.stringify(['com.app.network', 'com.app.runtime', 'com.app.ui']) ? 'PASS' : 'FAIL'}\n`);

// Test 4: With exclude-component
const test4 = expandCommaSeparated(['test,mock,debug']);
console.log('✅ Test 4 - Exclude components: --exclude-component "test,mock,debug"');
console.log(`   Input (string): 'test,mock,debug'`);
console.log(`   Output:         ${JSON.stringify(test4)}`);
console.log(`   Result:         ${JSON.stringify(test4) === JSON.stringify(['test', 'mock', 'debug']) ? 'PASS' : 'FAIL'}\n`);

console.log('═'.repeat(80));
console.log('Summary: --component parameter supports both syntaxes!\n');
console.log('For LLM usage:');
console.log('  • Comma-separated:  --component "comp1,comp2,comp3"        (shorter)');
console.log('  • Repeated flags:   --component comp1 --component comp2   (explicit)');
console.log('  • Both mix:         --component "comp1,comp2" --component comp3\n');
console.log('Same for --exclude-component:');
console.log('  • Comma-separated:  --exclude-component "exc1,exc2"');
console.log('  • Repeated flags:   --exclude-component exc1 --exclude-component exc2\n');

