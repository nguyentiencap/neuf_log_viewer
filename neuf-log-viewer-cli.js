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
                             Repeat to apply multiple presets.
  --device          <id>     Include logs for this device ID. Repeatable.
  --level           <lvl>    Include log level: ERROR|WARN|INFO|DEBUG. Repeatable.
  --component       <name>   Include logs from this component. Repeatable.
  --exclude-component <name> Exclude logs from this component. Repeatable.
  --search          <text>   Search for text or regex in the log message.
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

Typical LLM workflow:
  # Step 1 — See what presets are available (auto-indexes on first run)
  node neuf-log-viewer-cli.js presets /path/to/logs

  # Step 2 — Apply a preset to reduce noise, show first batch
  node neuf-log-viewer-cli.js filter /path/to/logs \\
      --preset errors_and_warnings --page 1 --page-size 100

  # Step 3 — Search for a keyword of interest
  node neuf-log-viewer-cli.js filter /path/to/logs \\
      --search "NullPointerException" --format json

  # Step 4 — Read next batch
  node neuf-log-viewer-cli.js filter /path/to/logs \\
      --preset errors_and_warnings --page 2 --page-size 100

Note: To force a re-index, delete the log-filter-db/ folder inside the log
folder and run the command again.
`;

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
 * Build a filters object from CLI options.
 * @param {Object} opts - Parsed CLI options
 * @returns {Object} Filters compatible with NEUFLogService.filterLogs()
 */
function buildFilters(opts) {
  const filters = {};

  if (opts.preset) filters.preset = toArray(opts.preset);
  if (opts.device) filters.deviceInclude = toArray(opts.device);
  if (opts.level) filters.logLevelInclude = toArray(opts.level);
  if (opts.component) filters.componentInclude = toArray(opts.component);
  if (opts['exclude-component']) filters.componentExclude = toArray(opts['exclude-component']);
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
    process.stderr.write(`❌ Error: <folder> is required for the '${command}' command.\n`);
    process.stderr.write(`Run 'node neuf-log-viewer-cli.js help' for usage.\n`);
    process.exit(1);
  }

  const resolvedFolder = path.resolve(folder);

  if (!fs.existsSync(resolvedFolder)) {
    process.stderr.write(`❌ Error: Folder does not exist: ${resolvedFolder}\n`);
    process.exit(1);
  }

  if (!fs.statSync(resolvedFolder).isDirectory()) {
    process.stderr.write(`❌ Error: Path is not a directory: ${resolvedFolder}\n`);
    process.exit(1);
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
        process.stderr.write(`❌ Unknown command: '${command}'\n`);
        process.stderr.write(`Run 'node neuf-log-viewer-cli.js help' for usage.\n`);
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`❌ Error: ${err.message}\n`);
    if (process.env.DEBUG) process.stderr.write(err.stack + '\n');
    process.exit(1);
  }
}

main();
