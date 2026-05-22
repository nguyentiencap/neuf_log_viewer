/**
 * Grouping Interface Module
 * Defines the generic interface for log message grouping algorithms.
 * Responsibility: Abstract base class for grouping algorithms with JSON export capability
 */

/**
 * Generic base class for log message grouping algorithms.
 * Subclasses must implement the group() method.
 *
 * Dictionary entry schema:
 *   { id: string, key: string[], count: number }
 *   - id:    unique rule identifier (e.g. "r1", "r2", …)
 *   - key:   ordered array of primitive tokens that this entry represents
 *   - count: number of times the pattern appeared in the input
 *
 * The list returned by group() is always sorted by count descending.
 * When outputFile is provided the same list is written as a JSON array.
 */
class GroupingInterface {
  /**
   * @param {Object} [options={}] - Default options applied to every group() call
   * @param {number} [options.minCount=2]   - Minimum occurrences required to create a rule
   * @param {number} [options.maxRules=200] - Maximum number of rules/entries to generate
   */
  constructor(options = {}) {
    this.options = { minCount: 2, maxRules: 200, ...options };
  }

  /**
   * Group messages by recurring patterns and return a sorted dictionary.
   *
   * @param {string[]} messages       - Array of log messages to analyze
   * @param {Object}   [options={}]   - Per-call overrides merged with constructor options
   * @param {string}   [options.outputFile] - If provided, the dictionary is written to this path as JSON
   * @param {number}   [options.minCount]   - Minimum occurrences to include a rule
   * @param {number}   [options.maxRules]   - Maximum number of rules to generate
   * @returns {Array<{id: string, key: string[], count: number}>} Dictionary sorted by count desc
   */
  group(messages, options = {}) {
    throw new Error('group() must be implemented by subclass');
  }
}

module.exports = { GroupingInterface };
