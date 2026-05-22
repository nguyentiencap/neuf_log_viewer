/**
 * Re-Pair Grouping Service Module
 * Implements the Re-Pair compression algorithm for log message pattern discovery.
 * Responsibility: Find recurring token-pair patterns in log messages using Re-Pair
 *
 * Algorithm overview:
 *  1. Tokenize each message into tokens (split on whitespace).
 *  2. Repeatedly find the most-frequent adjacent token pair across all sequences.
 *  3. Replace that pair with a new rule symbol and record the rule.
 *  4. Stop when no pair meets minCount or maxRules is reached.
 *  5. Expand each rule recursively to its full primitive-token sequence for the dictionary.
 *
 * Dictionary export: each rule entry lists its fully-expanded primitive tokens so that,
 * for example, if r1→[a,b], r2→[r1,c], r3→[r1,d] then the final entries are
 * r2→key:[a,b,c] and r3→key:[a,b,d].
 */

'use strict';

const fs = require('fs');
const { GroupingInterface } = require('./grouping-interface');

/**
 * Re-Pair Grouping Service
 * Applies the Re-Pair algorithm to discover frequent token-pair patterns
 * across a collection of log messages.
 */
class RePairGroupingService extends GroupingInterface {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.minCount=2]   - Minimum pair frequency required to create a rule
   * @param {number} [options.maxRules=200] - Maximum number of rules to generate
   */
  constructor(options = {}) {
    super(options);
  }

  /**
   * Tokenise a single log message into an array of tokens.
   * Splits on whitespace and discards empty tokens.
   * @param {string} msg
   * @returns {string[]}
   */
  tokenize(msg) {
    if (!msg || typeof msg !== 'string') return [];
    return msg.trim().split(/\s+/).filter(t => t.length > 0);
  }

  /**
   * Group messages using the Re-Pair algorithm.
   * @param {string[]} messages     - Log messages to group
   * @param {Object}   [options={}] - Per-call overrides
   * @param {string}   [options.outputFile] - Path to export JSON dictionary
   * @param {number}   [options.minCount]   - Minimum pair frequency
   * @param {number}   [options.maxRules]   - Maximum rules
   * @returns {Array<{id: string, key: string[], count: number}>} Sorted dictionary
   */
  group(messages, options = {}) {
    const { outputFile, minCount, maxRules } = { ...this.options, ...options };

    const sequences = messages.map(msg => this.tokenize(msg));
    const rules = this._runRePair(sequences, minCount, maxRules);
    const dictionary = this._buildDictionary(rules);

    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(dictionary, null, 2), 'utf8');
    }

    return dictionary;
  }

  /**
   * Run the Re-Pair algorithm on an array of token sequences.
   * Each sequence is modified in-place so the caller's copy reflects the
   * compressed form after the method returns.
   *
   * @param {string[][]} sequences - Mutable token sequences
   * @param {number}     minCount  - Minimum pair frequency to create a rule
   * @param {number}     maxRules  - Maximum number of rules to generate
   * @returns {Object} rules map: ruleId → { left: string, right: string, count: number }
   */
  _runRePair(sequences, minCount, maxRules) {
    const rules = {};
    let nextId = 1;

    while (Object.keys(rules).length < maxRules) {
      // --- Count all adjacent pairs across every sequence ---
      const pairCounts = new Map();
      for (const seq of sequences) {
        for (let i = 0; i < seq.length - 1; i++) {
          const key = seq[i] + '\x00' + seq[i + 1];
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }

      // --- Find the most frequent pair ---
      let bestKey = null;
      let bestCount = 0;
      for (const [key, count] of pairCounts) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      }

      if (!bestKey || bestCount < minCount) break;

      const sep = bestKey.indexOf('\x00');
      const left = bestKey.substring(0, sep);
      const right = bestKey.substring(sep + 1);
      const ruleId = `r${nextId++}`;
      rules[ruleId] = { left, right, count: bestCount };

      // --- Replace all non-overlapping occurrences left-to-right ---
      for (const seq of sequences) {
        const newSeq = [];
        let i = 0;
        while (i < seq.length) {
          if (i < seq.length - 1 && seq[i] === left && seq[i + 1] === right) {
            newSeq.push(ruleId);
            i += 2;
          } else {
            newSeq.push(seq[i]);
            i++;
          }
        }
        // Update sequence in-place
        seq.length = newSeq.length;
        for (let j = 0; j < newSeq.length; j++) seq[j] = newSeq[j];
      }
    }

    return rules;
  }

  /**
   * Build the final dictionary from the rules map.
   * Each rule is expanded recursively to its full primitive-token sequence.
   * The result is sorted by count descending.
   *
   * @param {Object} rules - ruleId → { left, right, count }
   * @returns {Array<{id: string, key: string[], count: number}>}
   */
  _buildDictionary(rules) {
    const expandCache = new Map();

    const expand = (symbol) => {
      if (expandCache.has(symbol)) return expandCache.get(symbol);
      if (!rules[symbol]) {
        expandCache.set(symbol, [symbol]);
        return [symbol];
      }
      const { left, right } = rules[symbol];
      const result = [...expand(left), ...expand(right)];
      expandCache.set(symbol, result);
      return result;
    };

    const entries = Object.entries(rules).map(([id, { count }]) => ({
      id,
      key: expand(id),
      count
    }));

    entries.sort((a, b) => b.count - a.count);
    return entries;
  }
}

module.exports = { RePairGroupingService };
