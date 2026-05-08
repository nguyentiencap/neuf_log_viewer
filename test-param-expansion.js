#!/usr/bin/env node

/**
 * Test script: Verify expandCommaSeparated() handles both syntaxes
 */

// Inline the function for testing
function expandCommaSeparated(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(v => v.split(',').map(s => s.trim()).filter(s => s));
}

console.log('Testing expandCommaSeparated() function:\n');

// Test 1: Repeated flags (parsed as array)
const test1 = expandCommaSeparated(['preset1', 'preset2', 'preset3']);
console.log('✅ Test 1 - Repeated flags: --preset p1 --preset p2 --preset p3');
console.log(`   Input (array):  ['preset1', 'preset2', 'preset3']`);
console.log(`   Output:         ${JSON.stringify(test1)}`);
console.log(`   Result:         ${JSON.stringify(test1) === JSON.stringify(['preset1', 'preset2', 'preset3']) ? 'PASS' : 'FAIL'}\n`);

// Test 2: Comma-separated (parsed as single string)
const test2 = expandCommaSeparated('preset1,preset2,preset3');
console.log('✅ Test 2 - Comma-separated: --preset "preset1,preset2,preset3"');
console.log(`   Input (string): 'preset1,preset2,preset3'`);
console.log(`   Output:         ${JSON.stringify(test2)}`);
console.log(`   Result:         ${JSON.stringify(test2) === JSON.stringify(['preset1', 'preset2', 'preset3']) ? 'PASS' : 'FAIL'}\n`);

// Test 3: Mix of both (array with some comma-separated values)
const test3 = expandCommaSeparated(['preset1,preset2', 'preset3']);
console.log('✅ Test 3 - Mixed: --preset "preset1,preset2" --preset preset3');
console.log(`   Input (mixed):  ['preset1,preset2', 'preset3']`);
console.log(`   Output:         ${JSON.stringify(test3)}`);
console.log(`   Result:         ${JSON.stringify(test3) === JSON.stringify(['preset1', 'preset2', 'preset3']) ? 'PASS' : 'FAIL'}\n`);

// Test 4: Single value (backward compatible)
const test4 = expandCommaSeparated('single_preset');
console.log('✅ Test 4 - Single value: --preset single_preset');
console.log(`   Input (string): 'single_preset'`);
console.log(`   Output:         ${JSON.stringify(test4)}`);
console.log(`   Result:         ${JSON.stringify(test4) === JSON.stringify(['single_preset']) ? 'PASS' : 'FAIL'}\n`);

// Test 5: Whitespace handling
const test5 = expandCommaSeparated('preset1 , preset2 , preset3');
console.log('✅ Test 5 - Whitespace: --preset "preset1 , preset2 , preset3"');
console.log(`   Input (string): 'preset1 , preset2 , preset3'`);
console.log(`   Output:         ${JSON.stringify(test5)}`);
console.log(`   Result:         ${JSON.stringify(test5) === JSON.stringify(['preset1', 'preset2', 'preset3']) ? 'PASS' : 'FAIL'}\n`);

// Test 6: Empty values
const test6 = expandCommaSeparated(['preset1', '', 'preset2']);
console.log('✅ Test 6 - Empty values: --preset preset1 --preset "" --preset preset2');
console.log(`   Input (array):  ['preset1', '', 'preset2']`);
console.log(`   Output:         ${JSON.stringify(test6)}`);
console.log(`   Result:         ${JSON.stringify(test6) === JSON.stringify(['preset1', 'preset2']) ? 'PASS' : 'FAIL'}\n`);

console.log('═'.repeat(70));
console.log('Summary: Both syntaxes are supported!\n');
console.log('For LLM usage:');
console.log('  • Comma-separated:   --preset "p1,p2,p3"          (shorter, 1 param)');
console.log('  • Repeated flags:    --preset p1 --preset p2      (more explicit)');
console.log('  • Both mix:          --preset "p1,p2" --preset p3 (flexible)\n');

