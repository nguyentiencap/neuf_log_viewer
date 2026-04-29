/**
 * NEUF Log Service Module
 * Business logic for log operations (scan, clear, filter, get options)
 * Responsibility: Core log operations - can be used by API, CLI, or any interface
 *
 * STATELESS SERVICE - No instance state, all data passed as parameters
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { DatabaseWrapper, DatabaseService } = require('./database');
const { LogFileScannerService } = require('./log-file-scanner');
const { PresetService } = require('./preset');

/**
 * NEUF Log Service
 * Stateless service - all dependencies injected, no instance state
 */
class NEUFLogService {
  constructor(parserService, logger = console.log) {
    this.parserService = parserService;
    this.logger = logger;
    // Internal scanner wraps parserService so all parsing goes through scannerService
    this.scannerService = new LogFileScannerService(parserService, logger);
  }

  /**
   * Initialize SQL.js (backward compatible instance method)
   * Delegates to static method for shared initialization
   */
  async initialize() {
    return NEUFLogService.initializeSqlJs();
  }

  /**
   * Initialize SQL.js (static, shared across all instances)
   */
  static async initializeSqlJs() {
    if (!NEUFLogService._SQL) {
      NEUFLogService._SQL = await initSqlJs();
    }
    return NEUFLogService._SQL;
  }

  /**
   * Get SQL.js instance
   */
  async getSQL() {
    return NEUFLogService.initializeSqlJs();
  }

  /**
   * Get database path for a log folder
   * @param {string} folderPath - Path to log folder
   * @returns {Object} { logFolderPath, dbPath, dbDir }
   */
  getDbPath(folderPath) {
    const logFolderPath = path.resolve(folderPath);
    const dbDir = path.join(logFolderPath, 'log-filter-db');
    const dbPath = path.join(dbDir, 'neuf-logs.db');
    
    return { logFolderPath, dbPath, dbDir };
  }

  /**
   * Check if database exists for a folder
   * @param {string} folderPath - Path to log folder
   * @returns {boolean}
   */
  isDatabaseScanned(folderPath) {
    try {
      const { dbPath } = this.getDbPath(folderPath);
      return fs.existsSync(dbPath);
    } catch (error) {
      return false;
    }
  }

  /**
   * Create database wrapper and service
   * @param {Object} sqlDb - SQL.js database instance
   * @returns {Object} { db, databaseService }
   */
  _createDatabaseService(sqlDb) {
    const db = new DatabaseWrapper(sqlDb);
    // Pass only the getTimeBucket function (no need to bind since it doesn't use 'this')
    const databaseService = new DatabaseService(db);
    // Always register custom SQL functions (needed for both scan and load paths)
    databaseService.registerCustomFunctions();
    return { db, databaseService };
  }

  /**
   * Load database for a folder
   * @param {string} folderPath - Path to log folder
   * @returns {Object} { db, databaseService, dbPath }
   * @throws {Error} If database not found
   */
  async loadDatabase(folderPath) {
    const { dbPath } = this.getDbPath(folderPath);
    const resolvedPath = path.resolve(folderPath);

    // Return cached DB instance if available (allows temp tables to persist across requests)
    if (NEUFLogService._dbCache[resolvedPath]) {
      return NEUFLogService._dbCache[resolvedPath];
    }

    if (!fs.existsSync(dbPath)) {
      throw new Error('Database not found. Please scan logs first.');
    }

    const SQL = await this.getSQL();
    const buffer = fs.readFileSync(dbPath);
    const sqlDb = new SQL.Database(buffer);

    const { db, databaseService } = this._createDatabaseService(sqlDb);

    const cached = { db, databaseService, dbPath };
    NEUFLogService._dbCache[resolvedPath] = cached;
    return cached;
  }


  /**
   * Scan log folder and create database
   * @param {string} folderPath - Path to log folder
   * @returns {Object} Scan result with statistics
   */
  async scanLogs(folderPath) {
    const { logFolderPath, dbPath, dbDir } = this.getDbPath(folderPath);

    // Invalidate cached DB instance before scan so fresh DB is used after
    const resolvedPath = path.resolve(folderPath);
    delete NEUFLogService._dbCache[resolvedPath];
    NEUFLogService._presetCache.clear();

    // Check if database already exists
    if (fs.existsSync(dbPath)) {
      this.logger('⚠️  Database already exists. Skipping scan.');
      return {
        success: true,
        message: 'Database already exists. Use clear command to re-scan.',
        data: {
          dbPath,
          logFolderPath,
          alreadyScanned: true,
          totalLogs: 0,
          filesScanned: 0
        }
      };
    }
    
    this.logger('📊 Scanning and indexing logs...');

    const SQL = await this.getSQL();
    const sqlDb = new SQL.Database();
    const { db, databaseService } = this._createDatabaseService(sqlDb);

    // Create log file scanner service
    const scannerService = this.scannerService;

    // Get file count before scanning
    const logFiles = scannerService.findNeufLogFiles(logFolderPath);
    const filesScanned = logFiles.length;

    // --- Phase 1: Scan files and store raw entries {filename, timestamp, rawContent} ---
    databaseService.initRawLogsTable();
    const insertRaw = databaseService.prepareInsertRaw();
    const insertManyRaw = databaseService.createBatchInsertRaw(insertRaw);

    const totalRaw = await scannerService.parsePhase1Files(
      logFolderPath,
      (batch) => insertManyRaw(batch)
    );

    if (totalRaw === 0) {
      throw new Error('No logs were parsed. Please check the log format.');
    }

    // --- Phase 2: Read from temp table ordered by timestamp ASC, parse to full log objects ---
    const totalLogs = scannerService.parsePhase2Files(databaseService);

    if (totalLogs === 0) {
      throw new Error('Phase 2 parsing failed: no structured logs were parsed from the scanned raw entries.');
    }

    // Drop Phase 1 temp table
    databaseService.dropRawLogsTable();
    this.logger('🗑️  Phase 1 temp table dropped.');

    // Create directory and save database
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const data = db.export();
    fs.writeFileSync(dbPath, data);
    this.logger(`💾 Database saved to ${dbPath}`);

    return {
      success: true,
      data: {
        totalLogs: totalLogs,
        filesScanned: filesScanned,
        dbPath: dbPath
      }
    };
  }

  /**
   * Clear database (delete SQLite file)
   * @param {string} folderPath - Path to log folder
   * @returns {Object} Clear result
   */
  clearDatabase(folderPath) {
    const { dbPath } = this.getDbPath(folderPath);

    // Invalidate cached DB instance so next loadDatabase loads fresh from file
    const resolvedPath = path.resolve(folderPath);
    delete NEUFLogService._dbCache[resolvedPath];
    NEUFLogService._presetCache.clear();

    if (!fs.existsSync(dbPath)) {
      return {
        success: true,
        message: 'Database does not exist. Nothing to clear.',
        dbPath
      };
    }

    fs.unlinkSync(dbPath);
    this.logger(`🗑️  Database deleted: ${dbPath}`);

    return {
      success: true,
      message: 'Database cleared successfully.',
      dbPath
    };
  }

  /**
   * Normalize time bucket filter fields from label strings to Unix timestamps
   * @param {Object} filters
   * @returns {Object} filters with timeBucketFrom/timeBucketTo as numbers
   */
  _normalizeTimeBucketFilters(filters) {
    if (!filters) return filters;
    const result = { ...filters };
    if (filters.timeBucket != null) {
      result.timeFrom = this.scannerService.getTimeBucket(filters.timeBucket);
      result.timeTo = result.timeFrom + 1800; //30 mins bucket
      return result;
    }

    result.timeFrom = 0;
    result.timeTo = Number.MAX_SAFE_INTEGER;
    if (result.timeFrom != null) {
      result.timeFrom = this.scannerService.getTimeBucket(filters.timeFrom);
    }
    if (result.timeTo != null) {
      result.timeTo = this.scannerService.getTimeBucket(filters.timeTo);
    }

    return result;
  }

  /**
   * Filter logs through a multi-step chain.
   * Table names are auto-generated: logs -> filter_1 -> filter_2 -> ...
   * Reuses existing filter tables when steps are identical to the previous request
   * (only page/pageSize changed), skipping the DROP+CREATE+INSERT cycle.
   *
   * @param {string} folderPath - Path to log folder
   * @param {Array<{filters: Object}>} steps - Each step only needs a filters object
   * @param {Object} options - Pagination options (page, pageSize)
   * @returns {Object} { success, logs, total, page, pageSize, totalPages }
   */
  async filterLogs(folderPath, steps, options = {}) {
    const cached = await this.loadDatabase(folderPath);
    const { databaseService } = cached;

    const page = options.page || 1;
    const pageSize = options.pageSize || 1000;

    // Normalize all step filters upfront
    const normalizedSteps = steps.map(s => ({
      filters: this._normalizeTimeBucketFilters(s.filters || {})
    }));

    // Compute a stable MD5 hash of steps to detect whether steps have changed
    const stepsKey = crypto.createHash('md5').update(JSON.stringify(normalizedSteps)).digest('hex');

    if (cached.lastStepsKey !== stepsKey) {
      // Steps changed — re-execute all filter steps
      for (let i = 0; i < normalizedSteps.length; i++) {
        const inputTable = NEUFLogService.getInputTableByStep(i);
        const outputTable = NEUFLogService.getOutputTableByStep(i);
        databaseService.executeFilterStep(normalizedSteps[i].filters, inputTable, outputTable);
      }

      // Determine final table and cache the total row count
      const lastOutputTable = normalizedSteps.length > 0
        ? NEUFLogService.getOutputTableByStep(normalizedSteps.length - 1)
        : 'logs';

      const countRow = databaseService.db.prepare(
        `SELECT COUNT(*) as count FROM ${lastOutputTable}`
      ).get();

      cached.lastStepsKey = stepsKey;
      cached.lastStepsTotal = countRow ? countRow.count : 0;
      cached.lastOutputTable = lastOutputTable;
    }

    const total = cached.lastStepsTotal;
    const lastOutputTable = cached.lastOutputTable;
    const offset = (page - 1) * pageSize;

    // Fetch only the requested page directly from DB (avoid loading all rows)
    const logs = databaseService.db.prepare(
      `SELECT * FROM ${lastOutputTable} ORDER BY timestamp ASC LIMIT ? OFFSET ?`
    ).all(pageSize, offset);

    return {
      success: true,
      logs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1
    };
  }

  /**
   * Get the input table name for a given step index.
   * step 0 reads from 'logs', step N reads from 'filter_N'
   * @param {number} stepIndex - Zero-based step index
   * @returns {string}
   */
  static getInputTableByStep(stepIndex) {
    return stepIndex === 0 ? 'logs' : `filter_${stepIndex}`;
  }

  /**
   * Get the output table name for a given step index.
   * step N writes to 'filter_{N+1}'
   * @param {number} stepIndex - Zero-based step index
   * @returns {string}
   */
  static getOutputTableByStep(stepIndex) {
    return `filter_${stepIndex + 1}`;
  }

  /**
   * Resolve a preset name to its filters object.
   * Result is cached in NEUFLogService._presetCache so getFilterOptions is only called once per preset.
   * Cache is cleared automatically when the database is rescanned or cleared.
   * @param {string} folderPath - Path to log folder
   * @param {string} presetName - Preset id (e.g. "focus_top_device_TC102002903525")
   * @returns {Promise<Object|null>} Resolved filters object, or null if preset not found
   */
  async resolvePreset(folderPath, presetName) {
    if (!presetName) return null;

    if (!NEUFLogService._presetCache.has(presetName)) {
      const optionsResult = await this.getFilterOptions(folderPath, {});
      if (!optionsResult.success) return null;

      const suggestions = PresetService.getSuggestions(optionsResult.data, {});
      const suggestion = suggestions.find(s => s.id === presetName);
      if (!suggestion) {
        this.logger(`⚠️  Preset not found: "${presetName}"`);
        return null;
      }

      NEUFLogService._presetCache.set(presetName, suggestion.filters);
      this.logger(`🎯 Resolved and cached preset: ${suggestion.label}`);
    }

    return NEUFLogService._presetCache.get(presetName);
  }

  /**
   * Apply preset filters into an existing filters object (mutates in place).
   * Reads filters.preset, resolves it via resolvePreset, and merges the result.
   * No-op if filters.preset is empty or preset is not found.
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Filters object (will be mutated in place)
   * @returns {Promise<void>}
   */
  async applyPreset(folderPath, filters) {
    if (!filters.preset) return;
    const resolved = await this.resolvePreset(folderPath, filters.preset);
    if (resolved) Object.assign(filters, resolved);
  }

  /**
   * Get filter options (available values for each filter field)
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Current filters (already normalized)
   * @param {boolean} limitedOptions - Limit thread_name and components to top 20 (default: true)
   * @param {number} stepNumber - Step number whose output to query (0 = logs, N = filter_N)
   * @returns {Object} Available filter options
   */
  async getFilterOptions(folderPath, filters = {}, limitedOptions = true, stepNumber = 0) {
    const { databaseService } = await this.loadDatabase(folderPath);

    const inputTable = NEUFLogService.getInputTableByStep(stepNumber);
    const normalizedFilters = this._normalizeTimeBucketFilters(filters);
    const filterOptions = databaseService.getFilterOptions(normalizedFilters, inputTable, limitedOptions);

    return {
      success: true,
      data: filterOptions
    };
  }
}

// Static properties for shared SQL.js instance and DB cache
NEUFLogService._SQL = null;
NEUFLogService._dbCache = {};
NEUFLogService._presetCache = new Map();

module.exports = {
  NEUFLogService
};
