/**
 * Test Helper Utilities
 * Reusable test functions for all test suites
 */

// Test statistics
let totalTests = 0;
let passedTests = 0;

/**
 * Compare two values and report the result
 * @param {*} actual - The actual value
 * @param {*} expected - The expected value
 * @param {string} message - Description of the test
 * @returns {boolean} - True if test passed, false otherwise
 */
function assertEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual, null, 2);
  const expectedStr = JSON.stringify(expected, null, 2);
  if (actualStr !== expectedStr) {
    console.error(`❌ FAILED: ${message}`);
    console.error(`  Expected: ${expectedStr}`);
    console.error(`  Actual:   ${actualStr}`);
    return false;
  }
  console.log(`✅ PASSED: ${message}`);
  return true;
}

/**
 * Run a single test
 * @param {string} testName - Name of the test
 * @param {Function} testFn - Test function that returns true/false
 */
function runTest(testName, testFn) {
  totalTests++;
  console.log(`\n--- Running: ${testName} ---`);
  try {
    if (testFn()) {
      passedTests++;
    }
  } catch (error) {
    console.error(`❌ FAILED: ${testName} - ${error.message}`);
    console.error(error.stack);
  }
}

/**
 * Print a section header
 * @param {string} title - Section title
 */
function printSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

/**
 * Print test summary and exit with appropriate code
 * @param {string} suiteName - Name of the test suite
 */
function printSummary(suiteName = 'TEST SUITE') {
  printSection('TEST SUMMARY');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`);
  console.log('='.repeat(60));

  if (passedTests === totalTests) {
    console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED ❌\n');
    process.exit(1);
  }
}

/**
 * Reset test statistics (useful for running multiple test suites)
 */
function resetStats() {
  totalTests = 0;
  passedTests = 0;
}

/**
 * Get current test statistics
 * @returns {{total: number, passed: number, failed: number}}
 */
function getStats() {
  return {
    total: totalTests,
    passed: passedTests,
    failed: totalTests - passedTests
  };
}

module.exports = {
  assertEqual,
  runTest,
  printSection,
  printSummary,
  resetStats,
  getStats
};
