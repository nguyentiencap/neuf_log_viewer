#!/usr/bin/env node

/**
 * NEUF Log Viewer - REST API Server
 * Entry point for REST API mode
 *
 * Usage: node neuf-log-viewer-api.js <folderPath>
 *
 * Provides REST API endpoints for log analysis:
 * - POST /filter_log - Filter logs with pagination (includes filterOptions in response)
 * - POST /export_log - Export filtered logs
 * - POST /preset_suggestions - Get preset filter suggestions
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { NEUFLogService } = require('./src/neuf-log-service');

const app = express();
const PORT = process.env.PORT || 3001;

// Parse command-line arguments - folderPath is REQUIRED
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ Error: Folder path is required');
  console.error('Usage: node neuf-log-viewer-api.js <folderPath>');
  process.exit(0);
}

const folderArg = args[0];
const FOLDER_PATH = path.resolve(folderArg);

if (!fs.existsSync(FOLDER_PATH)) {
  console.error(`❌ Error: Folder path does not exist: ${FOLDER_PATH}`);
  process.exit(0);
}

if (!fs.statSync(FOLDER_PATH).isDirectory()) {
  console.error(`❌ Error: Path is not a directory: ${FOLDER_PATH}`);
  process.exit(0);
}

console.log(`📁 Folder path: ${FOLDER_PATH}`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`\n📥 ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  if (req.query && Object.keys(req.query).length > 0) {
    console.log('Query:', JSON.stringify(req.query, null, 2));
  }
  next();
});

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Create shared services
const logService = new NEUFLogService(console.log);



/**
 * Parse filters from request body
 * This is API layer responsibility - build filters object from request
 * @param {Object} query - Request body filters object
 * @returns {Object} Parsed and normalized filters
 */
function parseFiltersFromRequest(query) {
  const filters = {
    // Include filters
    filenameInclude: query.filenameInclude || [],
    logLevelInclude: query.logLevelInclude || [],
    threadInclude: query.threadInclude || [],
    deviceInclude: query.deviceInclude || [],
    componentInclude: query.componentInclude || [],
    
    // Exclude filters
    filenameExclude: query.filenameExclude || [],
    logLevelExclude: query.logLevelExclude || [],
    threadExclude: query.threadExclude || [],
    deviceExclude: query.deviceExclude || [],
    componentExclude: query.componentExclude || [],
    
    // Other filters
    timeFrom: query.timeFrom || null,
    timeTo: query.timeTo || null,
    search: query.search || '',
    contextLines: parseInt(query.contextLines) || 0,
    strictContext: query.strictContext === true || query.strictContext === 'true',
    preset: query.preset || ''
  };
  
  // Normalize filters using shared logic from NEUFLogService
  return logService.normalizeFilters(filters);
}

/**
 * Escape CSV field value
 * @param {*} value - Value to escape
 * @returns {string} Escaped CSV value
 */
function escapeCSVValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const strValue = String(value);
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    return '"' + strValue.replace(/"/g, '""') + '"';
  }
  return strValue;
}




/**
 * POST /preset_suggestions
 * Get preset filter suggestions
 *
 * Response: {
 *   success: true,
 *   suggestions: [
 *     { id, label, description, filters }
 *   ]
 * }
 */
app.post('/preset_suggestions', async (req, res) => {
  try {
    const result = await logService.getPresetSuggestions(FOLDER_PATH);
    res.json(result);
  } catch (error) {
    console.error('❌ Preset suggestions error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /filter_log
 * Filter logs with a single filters object.
 *
 * Body: {
 *   filters: {
 *     logLevelInclude: ["ERROR"],
 *     deviceInclude: ["DEV001"]
 *   },
 *   page: number (default: 1),
 *   pageSize: number (default: 1000),
 *   inputTable: string (optional) - for applying filters on a specific output table from previous steps
 *   raw: boolean (default: false)
 * }
 *
 * Response: {
 *   success: true,
 *   logs: [...],
 *   total: number,
 *   page: number,
 *   pageSize: number,
 *   totalPages: number,
 *   outputTable: string
 * }
 */
app.post('/filter_log', async (req, res) => {
  try {
    const { filters = {}, steps = [], page = 1, pageSize = 1000, raw = false } = req.body;
    const legacyStep = steps[0] && steps[0].filters ? steps[0].filters : {};
    const requestFilters = Object.keys(filters).length > 0 ? filters : legacyStep;

    // Parse and normalize filters (API layer responsibility)
    const parsedFilters = parseFiltersFromRequest(requestFilters);
    await logService.applyPreset(FOLDER_PATH, parsedFilters);

    const result = await logService.filterLogs(FOLDER_PATH, parsedFilters, { page, pageSize });

    // Fetch filter options from the filtered output table in the same request
    const filterOptionsResult = await logService.getFilterOptions(FOLDER_PATH, result.outputTable);

    if (raw) {
      res.json({ ...result, filterOptions: filterOptionsResult.data });
      return;
    }

    // Format logs at API layer - formatLogEntry now returns object with formattedLog
    const formattedLogs = result.logs.map(log => logService.formatLogEntry(log, "full"));

    res.json({ ...result, logs: formattedLogs, filterOptions: filterOptionsResult.data });

  } catch (error) {
    console.error('❌ Filter chain error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /export_log
 * Export all logs matching current filters as a downloadable file.
 *
 * Body: {
 *   filters: { ...same as /filter_log },
 *   steps: [{ filters: ... }] (legacy compatibility),
 *   format: "full" | "compact" | "json" (optional, default: "full")
 * }
 */
app.post('/export_log', async (req, res) => {
  try {
    const { filters = {}, steps = [], format = 'full' } = req.body;
    const legacyStep = steps[0] && steps[0].filters ? steps[0].filters : {};
    const requestFilters = Object.keys(filters).length > 0 ? filters : legacyStep;
    const exportFormat = format === 'compact' ? 'compact' : format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'full';

    // ...existing code...
    const parsedFilters = parseFiltersFromRequest(requestFilters);
    await logService.applyPreset(FOLDER_PATH, parsedFilters);

    const exportPageSize = 5000;
    const firstPageResult = await logService.filterLogs(FOLDER_PATH, parsedFilters, { page: 1, pageSize: exportPageSize });

    // Format logs based on export format
    let exportedData;
    if (exportFormat === 'json' || exportFormat === 'csv') {
      // For JSON and CSV, export raw log objects without formattedLog
      exportedData = firstPageResult.logs;
    } else {
      // For 'full' and 'compact', format logs and extract formattedLog
      exportedData = firstPageResult.logs.map(log => logService.formatLogEntry(log, exportFormat));
    }

    for (let page = 2; page <= firstPageResult.totalPages; page++) {
      const pageResult = await logService.filterLogs(FOLDER_PATH, parsedFilters, { page, pageSize: exportPageSize });
      if (exportFormat === 'json' || exportFormat === 'csv') {
        exportedData.push(...pageResult.logs);
      } else {
        const pageData = pageResult.logs.map(log => logService.formatLogEntry(log, exportFormat));
        exportedData.push(...pageData);
      }
    }

    // Generate timestamp in local timezone: YYYY.MM.DD_HH-mm-ss
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}.${month}.${date}_${hours}-${minutes}-${seconds}`;

    // Determine file extension and format suffix
    let fileExtension;
    let formatSuffix;

    if (exportFormat === 'json') {
      fileExtension = 'json';
      formatSuffix = 'json';
    } else if (exportFormat === 'csv') {
      fileExtension = 'csv';
      formatSuffix = 'csv';
    } else if (exportFormat === 'compact') {
      fileExtension = 'log';
      formatSuffix = 'compact';
    } else {
      fileExtension = 'log';
      formatSuffix = 'full';
    }

    const filename = `neuf-logs-export-${timestamp}-${formatSuffix}.${fileExtension}`;

    if (exportFormat === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(exportedData, null, 2));
    } else if (exportFormat === 'csv') {
      // Convert raw logs to CSV format
      const csvLines = [];

      // CSV header
      if (exportedData.length > 0) {
        const headers = ['filename', 'timestamp', 'log_level', 'thread', 'device', 'component', 'message'];
        csvLines.push(headers.map(h => escapeCSVValue(h)).join(','));

        // CSV rows
        for (const log of exportedData) {
          const row = [
            `(${log.filename})`,
            log.timestamp,
            `[${log.log_level}]`,
            log.thread_name,
            `<${log.device_id}>`,
            `(${log.component_name})`,
            log.message
          ];
          csvLines.push(row.map(v => escapeCSVValue(v)).join(','));
        }
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvLines.join('\n'));
    } else {
      // For 'full' and 'compact' formats, export formattedLog strings
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const exportedLines = exportedData.map(log => log.formattedLog);
      res.send(exportedLines.join('\n'));
    }

  } catch (error) {
    console.error('❌ Export logs error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const databaseScanned = logService.isDatabaseScanned(FOLDER_PATH);
  
  res.json({
    success: true,
    status: 'healthy',
    version: '1.0.0',
    databaseScanned,
    folderPath: FOLDER_PATH
  });
});

/**
 * Serve static files (for client-side UI)
 */
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Start server
 */
async function main() {
  try {
    // Initialize SQL.js and scan logs
    await logService.initialize();
    
    console.log('');
    console.log('🔍 Scanning logs...');
    const scanResult = await logService.scanLogs(FOLDER_PATH);
    
    if (scanResult.success) {
      if (scanResult.data && !scanResult.data.alreadyScanned) {
        console.log(`✅ Scanned ${scanResult.data.totalLogs} log entries from ${scanResult.data.filesScanned} files`);
      }
    } else {
      console.error('❌ Failed to scan logs:', scanResult.error);
      process.exit(0);
    }
    
    app.listen(PORT, () => {
      console.log('');
      console.log('╔════════════════════════════════════════╗');
      console.log('║   🚀 NEUF Log Viewer API v1.0         ║');
      console.log('╚════════════════════════════════════════╝');
      console.log('');
      console.log(`🌐 API Server running at http://localhost:${PORT}`);
      console.log(`📊 Web UI available at http://localhost:${PORT}`);
      console.log('');
      console.log(`📁 Folder path: ${FOLDER_PATH}`);
      console.log('');
      console.log('📋 Available endpoints:');
      console.log('  POST   /filter_log           - Filter logs (includes filterOptions)');
      console.log('  POST   /export_log           - Export filtered logs');
      console.log('  POST   /preset_suggestions   - Get preset filter suggestions');
      console.log('  GET    /health               - Health check');
      console.log('');
      console.log('Press Ctrl+C to stop the server');
      console.log('');
    });
    
  } catch (error) {
    console.error('');
    console.error('❌ Failed to start server:');
    console.error(error.message || error);
    process.exit(0);
  }
}

main();
