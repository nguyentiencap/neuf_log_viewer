#!/usr/bin/env node

/**
 * NEUF Log Viewer - Terminal CLI
 * Command-line interface for log analysis
 * 
 * Provides terminal commands for log analysis:
 * - scan <folderPath> - Scan log folder and create SQLite database
 * - clear <folderPath> - Clear SQLite database
 * - filter <folderPath> [options] - Filter logs with command-line options
 * - options <folderPath> [filters] - Get available filter options
 */

const path = require('path');
const { NEUFLogService } = require('./lib/neuf-log-service');
const { FilterService } = require('./lib/filters');
const { logParserService } = require('./lib/log-parser');

// Create shared services
const filterService = new FilterService();
const logService = new NEUFLogService(logParserService, console.log);

/**
 * Parse comma-separated values into array
 * @param {string} input - Comma-separated string
 * @returns {string[]} Array of trimmed values
 */
function parseArray(input) {
  if (!input || input.trim() === '') return [];
  return input.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Parse command-line arguments into filters object
 * @param {string[]} args - Command-line arguments
 * @returns {Object} Filters object
 */
function parseFiltersFromArgs(args) {
  const filters = {
    filenameInclude: [],
    timeBucketInclude: [],
    logLevelInclude: [],
    threadInclude: [],
    deviceInclude: [],
    componentInclude: [],
    filenameExclude: [],
    timeBucketExclude: [],
    logLevelExclude: [],
    threadExclude: [],
    deviceExclude: [],
    componentExclude: [],
    search: '',
    contextLines: 0,
    preset: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--search':
      case '-s':
        if (nextArg) filters.search = nextArg;
        i++;
        break;
      
      case '--context':
      case '-c':
        if (nextArg) filters.contextLines = parseInt(nextArg) || 0;
        i++;
        break;
      
      case '--preset':
      case '-p':
        if (nextArg) filters.preset = nextArg;
        i++;
        break;
      
      case '--level-include':
      case '--level':
        if (nextArg) filters.logLevelInclude = parseArray(nextArg);
        i++;
        break;
      
      case '--level-exclude':
        if (nextArg) filters.logLevelExclude = parseArray(nextArg);
        i++;
        break;
      
      case '--thread-include':
      case '--thread':
        if (nextArg) filters.threadInclude = parseArray(nextArg);
        i++;
        break;
      
      case '--thread-exclude':
        if (nextArg) filters.threadExclude = parseArray(nextArg);
        i++;
        break;
      
      case '--component-include':
      case '--component':
        if (nextArg) filters.componentInclude = parseArray(nextArg);
        i++;
        break;
      
      case '--component-exclude':
        if (nextArg) filters.componentExclude = parseArray(nextArg);
        i++;
        break;
      
      case '--device-include':
      case '--device':
        if (nextArg) filters.deviceInclude = parseArray(nextArg);
        i++;
        break;
      
      case '--device-exclude':
        if (nextArg) filters.deviceExclude = parseArray(nextArg);
        i++;
        break;
      
      case '--filename-include':
      case '--filename':
        if (nextArg) filters.filenameInclude = parseArray(nextArg);
        i++;
        break;
      
      case '--filename-exclude':
        if (nextArg) filters.filenameExclude = parseArray(nextArg);
        i++;
        break;
    }
  }

  // Normalize filters using FilterService
  return filterService.normalizeFilters(filters);
}

/**
 * Parse pagination options from arguments
 * @param {string[]} args - Command-line arguments
 * @returns {Object} Pagination options
 */
function parsePaginationFromArgs(args) {
  const pagination = {
    page: 1,
    pageSize: 100
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if ((arg === '--page' || arg === '-pg') && nextArg) {
      pagination.page = parseInt(nextArg) || 1;
      i++;
    } else if ((arg === '--page-size' || arg === '--size') && nextArg) {
      pagination.pageSize = parseInt(nextArg) || 100;
      i++;
    }
  }

  return pagination;
}

/**
 * Escape CSV field (handle commas, quotes, newlines)
 * @param {string} field - Field value
 * @returns {string} Escaped field
 */
function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Format filter results as CSV
 * @param {Object} result - Filter result from logService
 * @returns {string} CSV formatted string
 */
function formatFilterResultsAsCSV(result) {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  const logs = result.logs || [];
  
  if (logs.length === 0) {
    return 'No logs found matching the filters.';
  }

  // CSV header
  const headers = ['timestamp', 'level', 'filename', 'thread', 'device', 'component', 'message'];
  let csv = headers.join(',') + '\n';

  // CSV rows
  logs.forEach(log => {
    const row = [
      escapeCSV(log.timestamp || ''),
      escapeCSV(log.log_level || ''),
      escapeCSV(log.filename || ''),
      escapeCSV(log.thread_name || ''),
      escapeCSV(log.device_id || ''),
      escapeCSV(log.component_name || ''),
      escapeCSV(log.message || '')
    ];
    csv += row.join(',') + '\n';
  });

  return csv;
}

/**
 * Format filter options as CSV
 * @param {Object} result - Filter options result from logService
 * @returns {string} CSV formatted string
 */
function formatFilterOptionsAsCSV(result) {
  if (!result.success) {
    return `Error: ${result.error}`;
  }

  const options = result.data;
  let csv = '';

  // Filenames
  if (options.filenames && options.filenames.length > 0) {
    csv += 'Filenames\n';
    csv += 'filename,count\n';
    options.filenames.forEach(f => {
      const name = typeof f === 'object' ? f.filename : f;
      const count = typeof f === 'object' ? f.count : '';
      csv += `${escapeCSV(name)},${count}\n`;
    });
    csv += '\n';
  }

  // Log Levels
  if (options.logLevels && options.logLevels.length > 0) {
    csv += 'Log Levels\n';
    csv += 'level,count\n';
    options.logLevels.forEach(l => {
      const name = typeof l === 'object' ? l.log_level : l;
      const count = typeof l === 'object' ? l.count : '';
      csv += `${escapeCSV(name)},${count}\n`;
    });
    csv += '\n';
  }

  // Threads
  if (options.threads && options.threads.length > 0) {
    csv += 'Threads\n';
    csv += 'thread,count\n';
    options.threads.forEach(t => {
      const name = typeof t === 'object' ? t.thread_name : t;
      const count = typeof t === 'object' ? t.count : '';
      csv += `${escapeCSV(name)},${count}\n`;
    });
    csv += '\n';
  }

  // Devices
  if (options.devices && options.devices.length > 0) {
    csv += 'Devices\n';
    csv += 'device,count\n';
    options.devices.forEach(d => {
      const name = typeof d === 'object' ? d.device_id : d;
      const count = typeof d === 'object' ? d.count : '';
      csv += `${escapeCSV(name)},${count}\n`;
    });
    csv += '\n';
  }

  // Components
  if (options.components && options.components.length > 0) {
    csv += 'Components\n';
    csv += 'component,count\n';
    options.components.forEach(c => {
      const name = typeof c === 'object' ? c.component_name : c;
      const count = typeof c === 'object' ? c.count : '';
      csv += `${escapeCSV(name)},${count}\n`;
    });
    csv += '\n';
  }

  return csv;
}

/**
 * Format filter results as text
 * @param {Object} result - Filter result from logService
 * @returns {string} Text formatted string
 */
function formatFilterResultsAsText(result) {
  if (!result.success) {
    return `\n❌ Error: ${result.error}`;
  }

  const logs = result.logs || [];
  const page = result.page || 1;
  const totalPages = result.totalPages || 1;
  const total = result.total || 0;

  let output = '\n' + '═'.repeat(80) + '\n';
  output += `📊 Results: ${logs.length} logs (Page ${page}/${totalPages})\n`;
  output += `📈 Total: ${total} logs matching filters\n`;
  output += '═'.repeat(80);

  if (logs.length === 0) {
    output += '\n\n📭 No logs found matching the filters.';
    return output;
  }

  logs.forEach((log, index) => {
    const levelColor = {
      'ERROR': '🔴',
      'WARN': '🟡',
      'INFO': '🔵',
      'DEBUG': '⚪',
      'TRACE': '⚫'
    }[log.log_level] || '⚪';

    // Use LogParserService to format the log entry
    const formattedLog = parserService.formatLogEntry(log);
    
    output += `\n\n${index + 1}. ${levelColor} ${formattedLog}`;
  });

  output += '\n\n' + '═'.repeat(80);
  return output;
}

/**
 * Format filter options as text
 * @param {Object} result - Filter options result from logService
 * @returns {string} Text formatted string
 */
function formatFilterOptionsAsText(result) {
  if (!result.success) {
    return `\n❌ Error: ${result.error}`;
  }

  const options = result.data;
  
  let output = '\n' + '═'.repeat(80) + '\n';
  output += '📋 Available Filter Options\n';
  output += '═'.repeat(80);

  if (options.filenames && options.filenames.length > 0) {
    output += `\n\n📁 Filenames (${options.filenames.length}):`;
    options.filenames.slice(0, 20).forEach(f => {
      const name = typeof f === 'object' ? f.filename : f;
      const count = typeof f === 'object' ? ` (${f.count} logs)` : '';
      output += `\n   - ${name}${count}`;
    });
    if (options.filenames.length > 20) {
      output += `\n   ... and ${options.filenames.length - 20} more`;
    }
  }

  if (options.logLevels && options.logLevels.length > 0) {
    output += `\n\n📊 Log Levels (${options.logLevels.length}):`;
    options.logLevels.forEach(l => {
      const name = typeof l === 'object' ? l.log_level : l;
      const count = typeof l === 'object' ? ` (${l.count} logs)` : '';
      output += `\n   - ${name}${count}`;
    });
  }

  if (options.threads && options.threads.length > 0) {
    output += `\n\n🧵 Threads (${options.threads.length}):`;
    options.threads.slice(0, 20).forEach(t => {
      const name = typeof t === 'object' ? t.thread_name : t;
      const count = typeof t === 'object' ? ` (${t.count} logs)` : '';
      output += `\n   - ${name}${count}`;
    });
    if (options.threads.length > 20) {
      output += `\n   ... and ${options.threads.length - 20} more`;
    }
  }

  if (options.devices && options.devices.length > 0) {
    output += `\n\n📱 Devices (${options.devices.length}):`;
    options.devices.forEach(d => {
      const name = typeof d === 'object' ? d.device_id : d;
      const count = typeof d === 'object' ? ` (${d.count} logs)` : '';
      output += `\n   - ${name}${count}`;
    });
  }

  if (options.components && options.components.length > 0) {
    output += `\n\n🔧 Components (${options.components.length}):`;
    options.components.slice(0, 20).forEach(c => {
      const name = typeof c === 'object' ? c.component_name : c;
      const count = typeof c === 'object' ? ` (${c.count} logs)` : '';
      output += `\n   - ${name}${count}`;
    });
    if (options.components.length > 20) {
      output += `\n   ... and ${options.components.length - 20} more`;
    }
  }

  output += '\n\n' + '═'.repeat(80);
  return output;
}

/**
 * Format output based on format type
 * @param {Object} result - Result object from logService
 * @param {string} format - Output format: 'text', 'json', or 'csv'
 * @param {string} type - Type of result: 'filter' or 'options'
 * @returns {string} Formatted output
 */
function formatOutput(result, format = 'text', type = 'filter') {
  // Handle JSON format
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // Handle CSV format
  if (format === 'csv') {
    if (type === 'filter') {
      return formatFilterResultsAsCSV(result);
    } else if (type === 'options') {
      return formatFilterOptionsAsCSV(result);
    }
  }

  // Handle text format (default)
  if (type === 'filter') {
    return formatFilterResultsAsText(result);
  } else if (type === 'options') {
    return formatFilterOptionsAsText(result);
  }

  return '';
}

/**
 * Display filter results in a formatted way
 * @param {Object} result - Filter result from logService
 * @param {string} format - Output format: 'text', 'json', or 'csv'
 */
function displayFilterResults(result, format = 'text') {
  const output = formatOutput(result, format, 'filter');
  console.log(output);
}

/**
 * Display filter options in a formatted way
 * @param {Object} result - Filter options result from logService
 * @param {string} format - Output format: 'text', 'json', or 'csv'
 */
function displayFilterOptions(result, format = 'text') {
  const output = formatOutput(result, format, 'options');
  console.log(output);
}

/**
 * Handle scan command
 * @param {string} folderPath - Path to log folder
 */
async function handleScan(folderPath) {
  if (!folderPath) {
    console.log('❌ Error: folderPath is required');
    console.log('Usage: neuf-log-viewer-cli scan <folderPath>');
    return;
  }

  try {
    console.log(`\n🔍 Scanning logs in: ${folderPath}`);
    const result = await logService.scanLogs(folderPath);
    
    if (result.success) {
      console.log(`\n✅ Scan completed successfully!`);
      console.log(`📊 Total logs: ${result.data.totalLogs}`);
      console.log(`📁 Files scanned: ${result.data.filesScanned}`);
      console.log(`💾 Database: ${result.data.dbPath}`);
    } else {
      console.log(`\n❌ Scan failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.log(`\n❌ Scan error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle clear command
 * @param {string} folderPath - Path to log folder
 */
function handleClear(folderPath) {
  if (!folderPath) {
    console.log('❌ Error: folderPath is required');
    console.log('Usage: neuf-log-viewer-cli clear <folderPath>');
    return;
  }

  try {
    const result = logService.clearDatabase(folderPath);
    
    if (result.success) {
      console.log(`\n✅ Database cleared successfully!`);
    } else {
      console.log(`\n❌ Clear failed: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.log(`\n❌ Clear error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Parse output format from arguments
 * @param {string[]} args - Command-line arguments
 * @returns {string} Output format: 'text', 'json', or 'csv'
 */
function parseOutputFormat(args) {
  if (args.includes('--json') || args.includes('-j')) {
    return 'json';
  }
  if (args.includes('--csv')) {
    return 'csv';
  }
  return 'text';
}

/**
 * Handle filter command
 * @param {string} folderPath - Path to log folder
 * @param {string[]} args - Command-line arguments
 */
async function handleFilter(folderPath, args) {
  if (!folderPath) {
    console.log('❌ Error: folderPath is required');
    console.log('Usage: neuf-log-viewer-cli filter <folderPath> [options]');
    return;
  }

  try {
    // Parse filters and pagination from arguments
    const filters = parseFiltersFromArgs(args);
    const pagination = parsePaginationFromArgs(args);
    const format = parseOutputFormat(args);

    // Filter logs (loadDatabase will check if DB exists)
    const steps = [{ filters }];
    const result = await logService.filterLogs(folderPath, steps, pagination);
    displayFilterResults(result, format);

  } catch (error) {
    console.log(`\n❌ Filter error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle filterOptions command
 * @param {string} folderPath - Path to log folder
 * @param {string[]} args - Command-line arguments
 */
async function handleFilterOptions(folderPath, args) {
  if (!folderPath) {
    console.log('❌ Error: folderPath is required');
    console.log('Usage: neuf-log-viewer-cli filterOptions <folderPath> [filters]');
    return;
  }

  try {
    // Parse filters from arguments
    const filters = parseFiltersFromArgs(args);
    const format = parseOutputFormat(args);

    // Get filter options (loadDatabase will check if DB exists)
    const result = await logService.getFilterOptions(folderPath, filters);
    displayFilterOptions(result, format);

  } catch (error) {
    console.log(`\n❌ FilterOptions error: ${error.message}`);
    console.log(error.stack);
    process.exit(1);
  }
}

/**
 * Display help message
 */
function displayHelp() {
  console.log('\n' + '═'.repeat(80));
  console.log('📚 NEUF Log Viewer CLI - Command-Line Interface');
  console.log('═'.repeat(80));
  console.log('\n📋 Commands:');
  console.log('  scan <folderPath>');
  console.log('    Scan log folder and create SQLite database');
  console.log('');
  console.log('  clear <folderPath>');
  console.log('    Clear SQLite database');
  console.log('');
  console.log('  filter <folderPath> [options]');
  console.log('    Filter logs with command-line options');
  console.log('');
  console.log('  filterOptions <folderPath> [filters]');
  console.log('    Get available filter options');
  console.log('');
  console.log('  help');
  console.log('    Show this help message');
  console.log('');
  console.log('🔧 Filter Options:');
  console.log('  -s, --search <text>              Search text in log messages');
  console.log('  -c, --context <number>           Number of context lines (default: 0)');
  console.log('  -p, --preset <name>              Filter preset name');
  console.log('  --level <levels>                 Log levels to include (comma-separated)');
  console.log('  --level-exclude <levels>         Log levels to exclude (comma-separated)');
  console.log('  --thread <threads>               Threads to include (comma-separated)');
  console.log('  --thread-exclude <threads>       Threads to exclude (comma-separated)');
  console.log('  --component <components>         Components to include (comma-separated)');
  console.log('  --component-exclude <components> Components to exclude (comma-separated)');
  console.log('  --device <devices>               Devices to include (comma-separated)');
  console.log('  --device-exclude <devices>       Devices to exclude (comma-separated)');
  console.log('  --filename <files>               Filenames to include (comma-separated)');
  console.log('  --filename-exclude <files>       Filenames to exclude (comma-separated)');
  console.log('');
  console.log('📄 Pagination Options:');
  console.log('  --page, -pg <number>             Page number (default: 1)');
  console.log('  --page-size, --size <number>     Page size (default: 100)');
  console.log('');
  console.log('📤 Output Options:');
  console.log('  --json, -j                       Output as JSON');
  console.log('  --csv                            Output as CSV');
  console.log('');
  console.log('💡 Examples:');
  console.log('  neuf-log-viewer-cli scan ./logs');
  console.log('  neuf-log-viewer-cli filter ./logs --search "error" --level ERROR,WARN');
  console.log('  neuf-log-viewer-cli filter ./logs --thread "main" --page 2 --size 50');
  console.log('  neuf-log-viewer-cli filter ./logs --component "com.example" --json');
  console.log('  neuf-log-viewer-cli filter ./logs --search "error" --csv');
  console.log('  neuf-log-viewer-cli filterOptions ./logs --level ERROR --csv');
  console.log('  neuf-log-viewer-cli clear ./logs');
  console.log('\n' + '═'.repeat(80));
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Initialize SQL.js
    await logService.initialize();
    
    // Parse command-line arguments
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
      displayHelp();
      return;
    }

    const command = args[0].toLowerCase();
    const folderPath = args[1];
    const restArgs = args.slice(2);

    switch (command) {
      case 'scan':
        await handleScan(folderPath);
        break;
      
      case 'clear':
        handleClear(folderPath);
        break;
      
      case 'filter':
        await handleFilter(folderPath, restArgs);
        break;
      
      case 'filteroptions':
        await handleFilterOptions(folderPath, restArgs);
        break;
      
      default:
        console.log(`\n❌ Unknown command: ${command}`);
        console.log('Run "neuf-log-viewer-cli help" for available commands');
        process.exit(1);
    }

  } catch (error) {
    console.error('❌ CLI error:', error);
    process.exit(1);
  }
}

main();
