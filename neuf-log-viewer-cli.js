#!/usr/bin/env node

/**
 * NEUF Log Viewer - CLI
 * Command-line interface for log analysis, optimised for LLM workflows.
 *
 * Three primary use-cases:
 *   1. Apply presets to reduce noise and focus on a device / time window
 *   2. Keyword / regex search so an LLM can locate relevant entries
 *   3. Paginated output so an LLM can read large logs in manageable batches
 *
 * Usage:
 *   node neuf-log-viewer-cli.js presets <folder>
 *   node neuf-log-viewer-cli.js filter  <folder> [options]
 *   node neuf-log-viewer-cli.js help
 *
 * Note: The database is built automatically on the first run of 'filter' or
 * 'presets'. To force a re-index, delete the log-filter-db/ folder inside
 * the log folder and run again.
 */

const path = require('path');
const fs = require('fs');
const { NEUFLogService } = require('./src/neuf-log-service');

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into { command, folder, options }.
 * Supports:
 *   --flag value      (string)
 *   Repeated --flag   (accumulated into array)
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const folder = args[1] && !args[1].startsWith('--') ? args[1] : null;

  const options = {};
  let i = folder ? 2 : 1;

  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith('--')) {
        // Boolean flag
        options[key] = true;
        i++;
      } else {
        // Value flag — accumulate repeated keys into arrays
        const value = nextArg;
        if (key in options) {
          options[key] = [].concat(options[key], value);
        } else {
          options[key] = value;
        }
        i += 2;
      }
    } else {
      i++;
    }
  }

  return { command, folder, options };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
NEUF Log Viewer CLI — LLM-friendly log analysis tool
=====================================================

Usage:
  node neuf-log-viewer-cli.js <command> <folder> [options]

Commands:
  presets <folder>           List all available preset filters with their IDs.
  filter  <folder> [opts]    Filter and search logs with optional pagination.
                             The database is built automatically on first run.
  help                       Show this help message.

Filter options:
  --preset          <id>     Apply a preset (use ID from 'presets' command).
                             Repeatable: --preset p1 --preset p2
                             Or comma-separated: --preset "p1,p2"
  --device          <id>     Include logs for this device ID. Repeatable.
  --level           <lvl>    Include log level: ERROR|WARN|INFO|DEBUG. Repeatable.
  --component       <name>   Include logs from this component. Repeatable.
  --exclude-component <name> Exclude logs from this component. Repeatable.
  --search          <text>   Search for text or regex in the log message.
                             ⭐ SUPPORTS REGEX! Examples:
                             --search "Exception|Error"
                             --search "ERROR.*Connection"
  --time-from       <ts>     Start timestamp (YYYY.MM.DD HH:mm:ss).
  --time-to         <ts>     End  timestamp (YYYY.MM.DD HH:mm:ss).
  --context         <n>      Show n lines of context around each search match.
  --page            <n>      Page number for batch reading (default: 1).
  --page-size       <n>      Logs per page (default: 200).
  --format          <fmt>    Output format: text | compact | json (default: text).

Output formats:
  text     Human-readable, one log per line with all fields visible.
  compact  Short one-liner per entry — useful when token budget is limited.
  json     Machine-readable JSON — ideal for LLM structured processing.

═══════════════════════════════════════════════════════════════════════════════
RECOMMENDED LLM WORKFLOW (Ask → Presets → Filter → Analyze → Expand)
═══════════════════════════════════════════════════════════════════════════════

Phase 1: ASK USER FOR CONTEXT
───────────────────────────
❓ Questions to clarify scope:
  1. "Which device is affected?" → For --device flag
  2. "When did it happen?" → For --time-from / --time-to
  3. "Any error keywords?" → For --search (optional)

Phase 2: EXPLORE AVAILABLE PRESETS (Remove Noise First!)
───────────────────────────────────────────────────────
ALWAYS run this before filtering:

  node neuf-log-viewer-cli.js presets /path/to/logs

This shows available presets you can use (errors, warnings, etc.)

Phase 3: RUN INITIAL FILTER (Preset + Device + Time)
─────────────────────────────────────────────────────
Command pattern:

  node neuf-log-viewer-cli.js filter /path/to/logs \\
    --device "device_x" \\
    --time-from "2026.05.08 09:45:00" --time-to "2026.05.08 10:15:00" \\
    --preset "errors,warnings" \\
    --format compact \\
    --page 1 --page-size 100

Use --format compact for quick pattern scanning (efficient)

Phase 4: INFER KEYWORDS & SEARCH DETAILS
─────────────────────────────────────────
Analyze compact output, find patterns:
  • Exception names (NullPointerException, OutOfMemory, etc.)
  • Component names (com.app.network, com.app.runtime, etc.)
  • Error types (Connection refused, Timeout, SQL error, etc.)

Then run detailed search with regex:

  node neuf-log-viewer-cli.js filter /path/to/logs \\
    --device "device_x" \\
    --time-from "2026.05.08 09:45:00" --time-to "2026.05.08 10:15:00" \\
    --preset "errors" \\
    --search "Exception|Error|Connection|Timeout" \\
    --format json \\
    --context 3 \\
    --page 1

⭐ --search supports full REGEX! Use patterns like:
  • "Exception|Error" = Either Exception OR Error
  • "ERROR.*Connection" = ERROR logs containing Connection
  • "Timeout|Hung|Stalled" = Any timeout-related message

Phase 5: ANALYZE LOGS (Look for Root Cause)
────────────────────────────────────────────
Using JSON output with --context, analyze:
  1. Exception/error names
  2. Timestamps (when exactly did it fail)
  3. Component names (where it failed)
  4. Surrounding logs (what happened before/after)
  5. Thread names (identify specific thread affected)

Phase 6: EXPAND SEARCH IF NO RESULTS (Progressive Widening)
───────────────────────────────────────────────────────────
If no results or incomplete data, expand in order:

  a) Expand TIME WINDOW (±30 minutes):
     --time-from "2026.05.08 09:00:00" --time-to "2026.05.08 11:00:00"

  b) REMOVE COMPONENT FILTER:
     Remove --component flag entirely

  c) LOOSEN PRESET (add more levels):
     --preset "errors,warnings,debug"  OR  remove --preset

  d) BROADEN KEYWORD (use simpler regex):
     --search "Exception|Error|Failed"  (instead of specific keywords)

  e) REMOVE DEVICE FILTER:
     Remove --device flag to search all devices

═══════════════════════════════════════════════════════════════════════════════
TYPICAL LLM INVESTIGATION FLOW
═══════════════════════════════════════════════════════════════════════════════

🔍 Investigation: "App crashed on Device X around 10 AM, suspect network issue"
─────────────────────────────────────────────────────────────────────────────

# Step 1: Ask user for context
  Q: Device? → "device_prod_01"
  Q: Time? → "Around 10:00 AM"
  Q: Error? → "Connection refused"

# Step 2: Check available presets
node neuf-log-viewer-cli.js presets /path/to/logs
# Output shows: errors, network_failures, connection_errors

# Step 3: Initial filter with presets (remove noise!)
node neuf-log-viewer-cli.js filter /path/to/logs \\
  --device "device_prod_01" \\
  --time-from "2026.05.08 09:45:00" --time-to "2026.05.08 10:30:00" \\
  --preset "errors,network_failures" \\
  --format compact \\
  --page 1

# Result (compact - easy to scan):
# 2026.05.08 10:02:34 [ERROR] (com.app.network) Connection refused: tcp://api.storage:9099
# 2026.05.08 10:02:35 [ERROR] (com.app.network) Retry timeout after 3 attempts
# 2026.05.08 10:02:36 [WARN] (com.app.bootstrap) Failed to connect to storage service

# Step 4: Infer keywords & search with details
# Pattern found: Connection refused + bootstrap failed
node neuf-log-viewer-cli.js filter /path/to/logs \\
  --device "device_prod_01" \\
  --time-from "2026.05.08 09:45:00" --time-to "2026.05.08 10:30:00" \\
  --preset "errors" \\
  --search "Connection|refused|storage" \\
  --component "com.app.network,com.app.bootstrap" \\
  --format json \\
  --context 5 \\
  --page 1

# Step 5: Analyze JSON output
# → Found: DNS resolution failed at 09:50 for storage service
# → Root cause: Storage service unreachable → Bootstrap failed → App crashed

# Step 6: If needed, expand (e.g., to see what happened before)
node neuf-log-viewer-cli.js filter /path/to/logs \\
  --device "device_prod_01" \\
  --time-from "2026.05.08 09:00:00" --time-to "2026.05.08 10:45:00" \\
  --preset "errors,warnings" \\
  --format json \\
  --page 1

═══════════════════════════════════════════════════════════════════════════════
KEYWORD INFERENCE PATTERNS (What to search for)
═══════════════════════════════════════════════════════════════════════════════

Observed Pattern                        → Search Keywords (Regex)
─────────────────────────────────────────────────────────────────────────────
Java/Spring exceptions                  → Exception|Throwable|Error
Network connection failed               → Connection|refused|Network|Socket|Timeout
Out of memory                           → OutOfMemory|OOM|Heap|Memory
Auth/Permission error                   → Permission|Denied|Unauthorized|Forbidden
Database error                          → SQLException|Connection pool|Database
Thread/concurrency issue                → Deadlock|Thread|Lock|Blocked
Configuration/startup error            → Config|Not found|Missing|Failed to load
Timeout/hang issue                      → Timeout|Hung|Waiting|Stalled
Bootstrap/initialization issue          → Bootstrap|Initialization|Init|Setup

═══════════════════════════════════════════════════════════════════════════════
MULTI-VALUE OPTIONS (All support both syntaxes)
═══════════════════════════════════════════════════════════════════════════════

Repeated flags:       --preset p1 --preset p2 --preset p3
Comma-separated:      --preset "p1,p2,p3"
Mixed:                --preset "p1,p2" --preset p3

Applies to:
  --preset              --preset "p1,p2"  or  --preset p1 --preset p2
  --device              --device "d1,d2"  or  --device d1 --device d2
  --level               --level "ERROR,WARN"  or  --level ERROR --level WARN
  --component           --component "c1,c2"  or  --component c1 --component c2
  --exclude-component   --exclude-component "exc1,exc2"  or repeated

Note: To force a re-index, delete the log-filter-db/ folder inside the log
folder and run the command again.

For detailed workflow guide, see: LLM-WORKFLOW.md
`;

// ---------------------------------------------------------------------------
// Constants & Validators
// ---------------------------------------------------------------------------

const VALID_LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
const VALID_FORMATS = ['text', 'compact', 'json'];
const VALID_OPTIONS = [
  'preset',
  'device',
  'level',
  'component',
  'exclude-component',
  'search',
  'time-from',
  'time-to',
  'context',
  'page',
  'page-size',
  'format',
  'help'
];

/**
 * Validate timestamp format: YYYY.MM.DD HH:mm:ss
 * @param {string} ts - Timestamp string
 * @returns {boolean}
 */
function isValidTimestamp(ts) {
  if (!ts || typeof ts !== 'string') return false;
  // Format: YYYY.MM.DD HH:mm:ss
  const pattern = /^\d{4}\.\d{2}\.\d{2}\s\d{2}:\d{2}:\d{2}$/;
  return pattern.test(ts);
}

/**
 * Calculate Levenshtein distance for typo detection.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Find the most likely valid option name from a typo.
 * @param {string} typo - Misspelled option
 * @returns {string|null}
 */
function suggestOptionName(typo) {
  let best = null;
  let bestDistance = 3; // Only suggest if within 3 edits
  for (const valid of VALID_OPTIONS) {
    const distance = levenshteinDistance(typo, valid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = valid;
    }
  }
  return best;
}

/**
 * Validate integer value
 * @param {string} value - String to parse
 * @param {number} min - Minimum value (optional)
 * @returns {{valid: boolean, result: number, error: string}}
 */
function validateInteger(value, min = null) {
  if (!value || typeof value !== 'string') {
    return { valid: false, result: null, error: 'Value is required' };
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return { valid: false, result: null, error: `Expected integer, got: "${value}"` };
  }
  if (min !== null && num < min) {
    return { valid: false, result: null, error: `Expected value >= ${min}, got: ${num}` };
  }
  return { valid: true, result: num, error: null };
}

/**
 * Validate and report all option errors before executing command.
 * Exits with error message if validation fails.
 * @param {string} command - Command name (presets, filter)
 * @param {Object} opts - Parsed options
 */
function validateOptions(command, opts) {
  const errors = [];

  // Check for unknown options (typos)
  for (const key of Object.keys(opts)) {
    if (!VALID_OPTIONS.includes(key)) {
      const suggestion = suggestOptionName(key);
      if (suggestion) {
        errors.push(
          `❌ Unknown option: --${key}\n   Did you mean: --${suggestion}?`
        );
      } else {
        errors.push(
          `❌ Unknown option: --${key}\n   Valid options: ${VALID_OPTIONS.slice(0, -1).map(o => '--' + o).join(', ')}`
        );
      }
    }
  }

  // Validate log levels
  if (opts.level) {
    const levels = Array.isArray(opts.level) ? opts.level : [opts.level];
    for (const level of levels) {
      if (!VALID_LOG_LEVELS.includes(level.toUpperCase())) {
        errors.push(
          `❌ Invalid --level "${level}". Allowed values: ${VALID_LOG_LEVELS.join(' | ')}`
        );
      }
    }
  }

  // Validate format
  if (opts.format && !VALID_FORMATS.includes(opts.format)) {
    errors.push(
      `❌ Invalid --format "${opts.format}". Allowed values: ${VALID_FORMATS.join(' | ')}`
    );
  }

  // Validate timestamps
  if (opts['time-from']) {
    if (!isValidTimestamp(opts['time-from'])) {
      errors.push(
        `❌ Invalid --time-from "${opts['time-from']}". Expected format: YYYY.MM.DD HH:mm:ss\n   Example: --time-from "2026.05.08 10:30:00"`
      );
    }
  }

  if (opts['time-to']) {
    if (!isValidTimestamp(opts['time-to'])) {
      errors.push(
        `❌ Invalid --time-to "${opts['time-to']}". Expected format: YYYY.MM.DD HH:mm:ss\n   Example: --time-to "2026.05.08 15:45:00"`
      );
    }
  }

  // Validate page number
  if (opts.page) {
    const { valid, error } = validateInteger(opts.page, 1);
    if (!valid) {
      errors.push(
        `❌ Invalid --page "${opts.page}". ${error}\n   Example: --page 1`
      );
    }
  }

  // Validate page size
  if (opts['page-size']) {
    const { valid, error } = validateInteger(opts['page-size'], 1);
    if (!valid) {
      errors.push(
        `❌ Invalid --page-size "${opts['page-size']}". ${error}\n   Example: --page-size 200`
      );
    }
  }

  // Validate context lines
  if (opts.context) {
    const { valid, error } = validateInteger(opts.context, 0);
    if (!valid) {
      errors.push(
        `❌ Invalid --context "${opts.context}". ${error}\n   Example: --context 5`
      );
    }
  }

  // Report all errors at once
  if (errors.length > 0) {
    process.stderr.write('\n' + errors.join('\n') + '\n\n');
    process.stderr.write(`💡 For help, run: node neuf-log-viewer-cli.js help\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Silent logger — suppresses internal service noise on stdout. */
function silentLogger() {}

/** Convert a single option value or array to a proper JS array. */
function toArray(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  return [value];
}

/**
 * Expand comma-separated values in an option value or array.
 * Supports both: --opt val1,val2,val3 and --opt val1 --opt val2
 * @param {string|string[]} value - Option value(s)
 * @returns {string[]} Array of expanded values
 */
function expandCommaSeparated(value) {
  if (!value) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(v => v.split(',').map(s => s.trim()).filter(s => s));
}

/**
 * Build a filters object from CLI options.
 * Options are assumed to be pre-validated by validateOptions().
 * Supports comma-separated values and repeated flags for multi-value options.
 * @param {Object} opts - Parsed CLI options
 * @returns {Object} Filters compatible with NEUFLogService.filterLogs()
 */
function buildFilters(opts) {
  const filters = {};

  // Support both: --preset p1,p2 and --preset p1 --preset p2
  if (opts.preset) filters.preset = expandCommaSeparated(opts.preset);
  if (opts.device) filters.deviceInclude = expandCommaSeparated(opts.device);
  // Normalize log levels to uppercase
  if (opts.level) {
    const levels = expandCommaSeparated(opts.level);
    filters.logLevelInclude = levels.map(l => l.toUpperCase());
  }
  if (opts.component) filters.componentInclude = expandCommaSeparated(opts.component);
  if (opts['exclude-component']) filters.componentExclude = expandCommaSeparated(opts['exclude-component']);
  if (opts.search) filters.search = opts.search;
  if (opts['time-from']) filters.timeFrom = opts['time-from'];
  if (opts['time-to']) filters.timeTo = opts['time-to'];
  if (opts.context) filters.contextLines = parseInt(opts.context, 10) || 0;

  return filters;
}

/**
 * Format a single log row for text output.
 * @param {Object} log - Log row from database
 * @returns {string}
 */
function formatText(log) {
  let line = `${log.timestamp} [${log.log_level}]`;
  if (log.thread_name) line += ` ${log.thread_name}:`;
  if (log.device_id) line += ` <${log.device_id}>`;
  if (log.component_name) line += ` (${log.component_name})`;
  line += ` ${log.message}`;
  if (log.filename) line += `  [${log.filename}]`;
  return line;
}

/**
 * Format a single log row for compact output.
 * @param {Object} log - Log row from database
 * @returns {string}
 */
function formatCompact(log) {
  let line = `${log.timestamp} [${log.log_level}]`;
  if (log.component_name) line += ` (${log.component_name})`;
  line += ` ${log.message}`;
  return line;
}

/**
 * Print pagination summary line.
 */
function printPaginationInfo(result) {
  process.stdout.write(
    `\n--- Page ${result.page}/${result.totalPages} | Showing ${result.logs.length} of ${result.total} matching logs ---\n`
  );
  if (result.page < result.totalPages) {
    process.stdout.write(
      `    (use --page ${result.page + 1} to read the next batch)\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Ensure the database exists for the given folder, scanning if necessary.
 * Writes status lines to stderr so stdout remains clean (e.g. for JSON output).
 * @param {string} folder - Resolved folder path
 * @param {Object} logService - NEUFLogService instance
 */
async function ensureDatabase(folder, logService) {
  if (logService.isDatabaseScanned(folder)) return;

  process.stderr.write(`📁 Indexing logs in: ${folder}\n`);
  try {
    const result = await logService.scanLogs(folder);
    process.stderr.write(`✅ Indexed ${result.data.totalLogs} log entries from ${result.data.filesScanned} file(s).\n\n`);
  } catch (err) {
    process.stderr.write(`❌ Indexing failed: ${err.message || 'unknown error'}\n`);
    process.exit(1);
  }
}

async function cmdPresets(folder, _opts, logService) {
  await logService.initialize();
  await ensureDatabase(folder, logService);

  const result = await logService.getPresetSuggestions(folder);

  if (!result.success) {
    process.stderr.write(`❌ Failed to load presets: ${result.error}\n`);
    process.exit(1);
  }

  const suggestions = result.suggestions;
  if (suggestions.length === 0) {
    process.stdout.write('ℹ️  No presets available for this folder.\n');
    return;
  }

  process.stdout.write(`\nAvailable presets (${suggestions.length}):\n`);
  process.stdout.write('─'.repeat(60) + '\n');
  for (const s of suggestions) {
    process.stdout.write(`  ID:          ${s.id}\n`);
    process.stdout.write(`  Label:       ${s.label}\n`);
    if (s.description && s.description !== s.label) {
      process.stdout.write(`  Description: ${s.description}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(`Use --preset <ID> with the 'filter' command to apply a preset.\n`);
}

async function cmdFilter(folder, opts, logService) {
  await logService.initialize();
  await ensureDatabase(folder, logService);

  const filters = buildFilters(opts);
  const normalizedFilters = logService.normalizeFilters(filters);
  await logService.applyPreset(folder, normalizedFilters);

  const page = parseInt(opts.page, 10) || 1;
  const pageSize = parseInt(opts['page-size'], 10) || 200;
  const format = opts.format || 'text';

  const result = await logService.filterLogs(folder, normalizedFilters, { page, pageSize });

  if (!result.success) {
    process.stderr.write(`❌ Filter failed: ${result.error}\n`);
    process.exit(1);
  }

  if (format === 'json') {
    process.stdout.write(
      JSON.stringify(
        {
          page: result.page,
          totalPages: result.totalPages,
          total: result.total,
          pageSize: result.pageSize,
          logs: result.logs
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  // Text / compact output
  for (const log of result.logs) {
    const line = format === 'compact' ? formatCompact(log) : formatText(log);
    process.stdout.write(line + '\n');
  }

  printPaginationInfo(result);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  const { command, folder, options } = parseArgs(process.argv);

  if (command === 'help' || options.help) {
    process.stdout.write(HELP_TEXT + '\n');
    process.exit(0);
  }

  if (!folder) {
    process.stderr.write(`❌ Error: <folder> is required for the '${command}' command.\n\n`);
    process.stderr.write(`Usage: node neuf-log-viewer-cli.js ${command} <folder> [options]\n`);
    process.stderr.write(`Example: node neuf-log-viewer-cli.js ${command} /path/to/logs\n\n`);
    process.stderr.write(`💡 For help, run: node neuf-log-viewer-cli.js help\n`);
    process.exit(1);
  }

  const resolvedFolder = path.resolve(folder);

  if (!fs.existsSync(resolvedFolder)) {
    process.stderr.write(`❌ Error: Folder does not exist: ${resolvedFolder}\n\n`);
    process.stderr.write(`💡 Please provide a valid folder path.\n`);
    process.stderr.write(`Example: node neuf-log-viewer-cli.js ${command} "C:\\Users\\logs"\n`);
    process.exit(1);
  }

  if (!fs.statSync(resolvedFolder).isDirectory()) {
    process.stderr.write(`❌ Error: Path is not a directory: ${resolvedFolder}\n\n`);
    process.stderr.write(`💡 Please provide a directory path, not a file.\n`);
    process.exit(1);
  }

  // Validate options based on command
  if (command === 'filter') {
    validateOptions(command, options);
  }

  const logService = new NEUFLogService(silentLogger);

  try {
    switch (command) {
      case 'presets':
        await cmdPresets(resolvedFolder, options, logService);
        break;
      case 'filter':
        await cmdFilter(resolvedFolder, options, logService);
        break;
      default:
        process.stderr.write(`❌ Unknown command: '${command}'\n\n`);
        process.stderr.write(`Available commands:\n`);
        process.stderr.write(`  - presets <folder>          List available presets\n`);
        process.stderr.write(`  - filter  <folder> [opts]   Filter logs with options\n`);
        process.stderr.write(`  - help                      Show this help message\n\n`);
        process.stderr.write(`Example: node neuf-log-viewer-cli.js filter /path/to/logs --search "Error"\n\n`);
        process.stderr.write(`💡 For help, run: node neuf-log-viewer-cli.js help\n`);
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) process.stderr.write(err.stack + '\n');
    process.exit(1);
  }
}

main();
