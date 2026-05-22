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
 * for example, if the pair (a,b) is found in original messages 1-5 and the sub-pattern
 * (key_1_5,c) is found in messages 1-3, then the entries are:
 * key_1_5→[a,b], key_1_3→[a,b,c], key_4_5→[a,b,d].
 *
 * Rule ID format: key_{minLine}_{maxLine} where minLine/maxLine are the 1-based indices
 * of the first and last original messages that contain the pattern.
 * Collisions (same min/max) are disambiguated by appending _2, _3, …
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
   * Rule IDs use the format key_{minLine}_{maxLine} where minLine/maxLine are the
   * 1-based indices of the first and last original messages containing the pattern.
   * Collisions are disambiguated by appending _2, _3, …
   *
   * @param {string[][]} sequences - Mutable token sequences (index = original message index)
   * @param {number}     minCount  - Minimum pair frequency to create a rule
   * @param {number}     maxRules  - Maximum number of rules to generate
   * @returns {Object} rules map: ruleId → { left: string, right: string, count: number }
   */
  _runRePair(sequences, minCount, maxRules) {
    const rules = {};
    const usedIds = new Set();

    while (Object.keys(rules).length < maxRules) {
      // --- Count all adjacent pairs and track which original sequences contain them ---
      const pairData = new Map(); // pairKey -> { count: number, indices: Set<number> }
      for (let seqIdx = 0; seqIdx < sequences.length; seqIdx++) {
        const seq = sequences[seqIdx];
        for (let i = 0; i < seq.length - 1; i++) {
          const pairKey = seq[i] + '\x00' + seq[i + 1];
          if (!pairData.has(pairKey)) {
            pairData.set(pairKey, { count: 0, indices: new Set() });
          }
          const data = pairData.get(pairKey);
          data.count++;
          data.indices.add(seqIdx);
        }
      }

      // --- Find the most frequent pair ---
      let bestKey = null;
      let bestCount = 0;
      let bestIndices = null;
      for (const [pairKey, { count, indices }] of pairData) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = pairKey;
          bestIndices = indices;
        }
      }

      if (!bestKey || bestCount < minCount) break;

      const sep = bestKey.indexOf('\x00');
      const left = bestKey.substring(0, sep);
      const right = bestKey.substring(sep + 1);

      // Build rule ID: key_{minLine}_{maxLine} (1-based original message indices)
      const sortedIdx = [...bestIndices].sort((a, b) => a - b);
      const minLine = sortedIdx[0] + 1;
      const maxLine = sortedIdx[sortedIdx.length - 1] + 1;
      const baseId = `key_${minLine}_${maxLine}`;
      let ruleId = baseId;
      let suffix = 2;
      while (usedIds.has(ruleId)) {
        ruleId = `${baseId}_${suffix++}`;
      }
      usedIds.add(ruleId);
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
