#!/usr/bin/env node

/**
 * NEUF Log Viewer - REST API Server
 * Entry point for REST API mode
 *
 * Usage: node neuf-log-viewer-api.js <folderPath>
 *
 * Provides REST API endpoints for log analysis:
 * - POST /filter_log - Filter logs with pagination
 * - POST /filter_option - Get available filter options
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { NEUFLogService } = require('./lib/neuf-log-service');

const app = express();
const PORT = process.env.PORT || 3001;

// Parse command-line arguments - folderPath is REQUIRED
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ Error: Folder path is required');
  console.error('Usage: node neuf-log-viewer-api.js <folderPath>');
  process.exit(1);
}

const folderArg = args[0];
const FOLDER_PATH = path.resolve(folderArg);

if (!fs.existsSync(FOLDER_PATH)) {
  console.error(`❌ Error: Folder path does not exist: ${FOLDER_PATH}`);
  process.exit(1);
}

if (!fs.statSync(FOLDER_PATH).isDirectory()) {
  console.error(`❌ Error: Path is not a directory: ${FOLDER_PATH}`);
  process.exit(1);
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
    timeBucket: query.timeBucket || [],
    timeFrom: query.timeFrom || [],
    timeTo: query.timeTo || [],
    search: query.search || '',
    contextLines: parseInt(query.contextLines) || 0,
    preset: query.preset || ''
  };
  
  // Normalize filters using shared logic from NEUFLogService
  return logService.normalizeFilters(filters);
}



/**
 * POST /filter_option
 * Get available filter options based on current filters
 * Body: {
 *   filters: {
 *     // Same as filter_log
 *   },
 *   limitedOptions: boolean (optional, default: true) - Limit thread_name and components to top 20,
 *   inputTable: string (optional) - output table returned by /filter_log
 * }
 */
app.post('/filter_option', async (req, res) => {
  try {
    const { filters = {}, limitedOptions = true, inputTable = null } = req.body;

    // Parse and normalize filters (API layer responsibility)
    const parsedFilters = parseFiltersFromRequest(filters);

    // Get filter options (loadDatabase will check if DB exists)
    const result = await logService.getFilterOptions(FOLDER_PATH, inputTable, limitedOptions);
    res.json(result);

  } catch (error) {
    console.error('❌ Filter options error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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

    if (raw) {
      res.json(result);
      return;
    }

    // Format logs at API layer
    const formattedLogs = result.logs.map(log => ({
      ...log,
      formattedLog: logService.formatLogEntry(log, "api")
    }));

    res.json({ ...result, logs: formattedLogs });

  } catch (error) {
    console.error('❌ Filter chain error:', error);
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
      console.log(`✅ Scanned ${scanResult.totalLogs} log entries from ${scanResult.filesScanned} files`);
    } else {
      console.error('❌ Failed to scan logs:', scanResult.error);
      process.exit(1);
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
      console.log('  POST   /filter_log      - Filter logs');
      console.log('  POST   /filter_option         - Get filter options');
      console.log('  POST   /preset_suggestions   - Get dynamic filter suggestions');
      console.log('  GET    /health                - Health check');
      console.log('');
      console.log('Press Ctrl+C to stop the server');
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();
