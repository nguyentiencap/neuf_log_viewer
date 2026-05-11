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
const { logParserService } = require('./log-parser');

/**
 * NEUF Log Service
 * Stateless service - all dependencies injected, no instance state
 */
class NEUFLogService {
  constructor(logger = console.log) {
    this.parserService = logParserService;
    this.logger = logger;
    // Internal scanner wraps parserService so all parsing goes through scannerService
    this.scannerService = new LogFileScannerService(logParserService, logger);
  }

  // -------- SQL.js lifecycle --------

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

  // -------- Path and cache helpers --------

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
   * Normalize folder path used for cache keys
   * @param {string} folderPath - Path to log folder
   * @returns {string}
   */
  _getResolvedPath(folderPath) {
    return path.resolve(folderPath);
  }

  /**
   * Invalidate in-memory caches related to a folder
   * @param {string} folderPath - Path to log folder
   */
  _invalidateFolderCaches(folderPath) {
    const resolvedPath = this._getResolvedPath(folderPath);
    delete NEUFLogService._dbCache[resolvedPath];
    NEUFLogService._presetCache.clear();
  }

  /**
   * Normalize filters object
   * Ensures arrays and removes empty values
   * timeFrom/timeTo are kept as strings for readability, converted to unix timestamps only when building DB queries
   * @param {Object} filters - Raw filters object
   * @returns {Object} Normalized filters
   */
  normalizeFilters(filters) {
    const filterFields = [
      'filenameInclude', 'filenameExclude',
      'logLevelInclude', 'logLevelExclude',
      'threadInclude', 'threadExclude',
      'deviceInclude', 'deviceExclude',
      'componentInclude', 'componentExclude'
    ];

    filterFields.forEach(key => {
      if (filters[key] && !Array.isArray(filters[key])) {
        filters[key] = [filters[key]];
      }
      // Remove empty arrays
      if (Array.isArray(filters[key]) && filters[key].length === 0) {
        delete filters[key];
      }
    });

    // Remove empty search
    if (!filters.search) delete filters.search;

    // timeFrom/timeTo are kept as strings for readability
    // They will be converted to unix timestamps only when building DB queries
    if (!filters.timeFrom) delete filters.timeFrom;
    if (!filters.timeTo) delete filters.timeTo;

    return filters;
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

  // -------- Database lifecycle --------

  /**
   * Create database wrapper and service
   * @param {Object} sqlDb - SQL.js database instance
   * @returns {Object} { db, databaseService }
   */
  _createDatabaseService(sqlDb) {
    const db = new DatabaseWrapper(sqlDb);
    // Pass only the getTimeBucket function (no need to bind since it doesn't use 'this')
    const databaseService = new DatabaseService(db, this.logger);
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
    const resolvedPath = this._getResolvedPath(folderPath);

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
   * Build response when scan is skipped due to existing DB
   * @param {string} dbPath - Database file path
   * @param {string} logFolderPath - Resolved log folder path
   * @returns {Object}
   */
  _createAlreadyScannedResult(dbPath, logFolderPath) {
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

  /**
   * Persist SQL.js database to disk
   * @param {Object} db - Database wrapper
   * @param {string} dbDir - Database directory
   * @param {string} dbPath - Database file path
   */
  _saveDatabaseToFile(db, dbDir, dbPath) {
    const data = db.export();
    fs.writeFileSync(dbPath, data);
    this.logger(`💾 Database saved to ${dbPath}`);
  }


  /**
   * Scan log folder and create database
   * @param {string} folderPath - Path to log folder
   * @returns {Object} Scan result with statistics
   */
  async scanLogs(folderPath) {
    const { logFolderPath, dbPath, dbDir } = this.getDbPath(folderPath);

    // Invalidate cached DB instance before scan so fresh DB is used after
    this._invalidateFolderCaches(folderPath);

    // Check if database already exists
    if (fs.existsSync(dbPath)) {
      this.logger('⚠️  Database already exists. Skipping scan.');
      return this._createAlreadyScannedResult(dbPath, logFolderPath);
    }

    this.logger('📊 Scanning and indexing logs...');

    const SQL = await this.getSQL();
    const sqlDb = new SQL.Database();
    const { db, databaseService } = this._createDatabaseService(sqlDb);

    const scannerService = this.scannerService;

    // Get file count before scanning
    const logFiles = scannerService.findNeufLogFiles(logFolderPath);
    const filesScanned = logFiles.length;

    if (filesScanned === 0) {
      throw new Error(
        `No NEUF log files found in: ${logFolderPath}\n` +
        `\nLog files must be named NEUF-*.log (e.g. NEUF-device.log, NEUF-app-2024.log).\n` +
        `\nExpected log format (each line):\n` +
        `  YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: Message\n` +
        `  YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: <DeviceID> (com.example.component) Message\n` +
        `\nExample:\n` +
        `  2024.01.15 10:30:45.123 [INFO] [class com.example.Main]: main: Application started\n` +
        `  2024.01.15 10:30:46.456 [DEBUG] [class com.example.Worker]: worker-1: <device-001> (com.example.app) Initializing`
      );
    }

    // Scan all files, parse directly to log objects, batch insert into temp table
    databaseService.initTempLogsTable();
    const insertTemp = databaseService.prepareInsertTemp();
    const insertManyTemp = databaseService.createBatchInsertTemp(insertTemp);

    const totalLogs = await scannerService.parseFiles(logFolderPath, (batch) => insertManyTemp(batch));

    if (totalLogs === 0) {
      throw new Error(
        `Found ${filesScanned} file(s) in ${logFolderPath} but could not parse any log entries.\n` +
        `\nPlease check that the log files use the correct format (each line):\n` +
        `  YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: Message\n` +
        `  YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: <DeviceID> (com.example.component) Message\n` +
        `\nExample:\n` +
        `  2024.01.15 10:30:45.123 [INFO] [class com.example.Main]: main: Application started\n` +
        `  2024.01.15 10:30:46.456 [DEBUG] [class com.example.Worker]: worker-1: <device-001> (com.example.app) Initializing`
      );
    }

    // Init main logs table and insert from temp ordered by timestamp (SQLite handles sort)
    databaseService.initDatabase();
    databaseService.insertFromTempToLogs();
    databaseService.dropTempLogsTable();
    this.logger(`✅ Inserted ${totalLogs.toLocaleString()} entries into logs table.`);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Generate and save preset snapshot before export (UDFs still registered on scan-time connection)
    const presetsPath = PresetService.getPresetsPath(dbDir);
    const presets = this._generateInstallPresets(databaseService);
    this.logger(presets);
    PresetService.savePreset(presetsPath, presets, this.logger);

    this._saveDatabaseToFile(db, dbDir, dbPath);

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
    this._invalidateFolderCaches(folderPath);

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

  // -------- Filter pipeline --------


  /**
   * Compute the output table name for a given filters object.
   * Table name is 'filter_<md5(filtersKey)>' to ensure uniqueness per filter combination.
   * @param {Object} normalizedFilters - Already normalized filters object
   * @returns {string}
   */
  _getFilterOutputTable(normalizedFilters) {
    const filtersKey = JSON.stringify(normalizedFilters);
    return `filter_${crypto.createHash('md5').update(filtersKey).digest('hex')}`;
  }

  /**
   * Check whether a table name is a valid filter output table
   * @param {string} inputTable - Candidate output table name
   * @returns {boolean}
   */
  _isValidTable(inputTable) {
    return typeof inputTable === 'string' && /^filter_[a-f0-9]{32}$/.test(inputTable);
  }

  /**
   * Normalize paging options for log queries
   * @param {Object} options - Pagination options
   * @returns {Object} { page, pageSize }
   */
  _getPagingOptions(options = {}) {
    return {
      page: options.page || 1,
      pageSize: options.pageSize || 1000
    };
  }

  /**
   * Read total rows from a temp output table
   * @param {Object} databaseService - Database service instance
   * @param {string} outputTable - Table name
   * @returns {number}
   */
  _getOutputTableCount(databaseService, outputTable) {
    const countRow = databaseService.db.prepare(
      `SELECT COUNT(*) as count FROM ${outputTable}`
    ).get();
    return countRow ? countRow.count : 0;
  }

  /**
   * Filter logs with a single filter step.
   * Input table: 'logs', output table: 'filter_<md5(filtersKey)>'.
   * Reuses existing filter table when filters are identical to the previous request
   * (only page/pageSize changed), skipping the DROP+CREATE+INSERT cycle.
   *
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Filter options object
   * @param {Object} options - Pagination options (page, pageSize)
   * @returns {Object} { success, logs, total, page, pageSize, totalPages, outputTable }
   */
  async filterLogs(folderPath, filters, options = {}) {
    const cached = await this.loadDatabase(folderPath);
    const { databaseService } = cached;

    const { page, pageSize } = this._getPagingOptions(options);

    const normalizedFilters = filters || {};
    const filtersKey = JSON.stringify(normalizedFilters);
    const sourceTable = 'logs';
    const outputTable = this._getFilterOutputTable(filtersKey);
    this.logger(`🔍 Filtering logs with page: ${page}, pageSize: ${pageSize}, sourceTable: ${sourceTable}, filtersKey: ${filtersKey}`);

    databaseService.executeFilterStep(normalizedFilters, sourceTable, outputTable);
    const total = this._getOutputTableCount(databaseService, outputTable);
    const offset = (page - 1) * pageSize;

    const logs = databaseService.db.prepare(
      `SELECT * FROM ${outputTable} ORDER BY timestamp ASC LIMIT ? OFFSET ?`
    ).all(pageSize, offset);

    return {
      success: true,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      outputTable,
      logs
    };
  }

  // -------- Presets and filter options --------

  /**
   * Apply preset filters into an existing filters object (mutates in place).
   * Reads filters.preset (string or array), resolves from preset snapshot (saved at scan time),
   * and merges matching preset filters in order.
   * No-op if filters.preset is empty or no preset matches.
   * Falls back to dynamic resolution from base logs table if snapshot not found.
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Filters object (will be mutated in place)
   * @returns {Promise<void>}
   */
  async applyPreset(folderPath, filters) {
    if (!filters || !filters.preset) return;

    // Always resolve presets from snapshot (generated at scan time from base logs table).
    // loadPreset merges user presets (preset.json) with the scan-time snapshot.
    const { dbDir } = this.getDbPath(folderPath);
    const presets = PresetService.loadPreset(dbDir, this.logger);
    PresetService.applyPreset(filters, presets, this.logger);
  }

  /**
   * Get preset suggestions.
   * Returns all presets from snapshot (saved at scan time from base logs table).
   * Frontend calls this once at load time and manages applied state locally.
   * Falls back to dynamic resolution from base logs table if snapshot not found.
   * @param {string} folderPath - Path to log folder
   * @param {string|null} inputTable - Unused, kept for API compatibility
   * @param {Object} filters - Unused, kept for API compatibility
   * @returns {Promise<Object>} { success, suggestions: [{ id, label, description }] }
   */
  async getPresetSuggestions(folderPath) {
    this.logger(`💡 Getting preset suggestions`);

    const { dbDir } = this.getDbPath(folderPath);
    // loadPreset merges user presets (preset.json) with the scan-time snapshot.
    const presets = PresetService.loadPreset(dbDir, this.logger);

    // Strip internal filters field — only expose id, label, description to callers
    const clientSuggestions = Object.values(presets).map(({ id, label, description }) => ({ id, label, description }));

    return { success: true, suggestions: clientSuggestions };
  }

  /**
   * Get filter options (available values for each filter field)
   * Uses client-provided output table when it matches the expected naming format,
   * otherwise falls back to the base 'logs' table.
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Current filters (kept for API compatibility)
   * @param {boolean} limitedOptions - Limit thread_name and components to top 20 (default: true)
   * @param {string|null} inputTable - Optional filter output table name from client
   * @returns {Object} Available filter options
   */
  async getFilterOptions(folderPath, inputTable = null, limitedOptions = true) {
    const { databaseService } = await this.loadDatabase(folderPath);

    const sourceTable = this._isValidTable(inputTable) ? inputTable : 'logs';

    this.logger(`📋 Getting filter options for filters, sourceTable: ${sourceTable}, limitedOptions: ${limitedOptions}`);

    const filterOptions = databaseService.getFilterOptions(sourceTable, limitedOptions);

    return {
      success: true,
      data: filterOptions
    };
  }

  // -------- Install presets --------

  /**
   * Query install events from in-memory database service and generate install presets.
   * Filters logs where component_name LIKE '%LifecycleProvider' AND message LIKE 'Fujifilm dws:install%'.
   * @param {Object} databaseService - Database service instance
   * @returns {Object} Map of install preset id to preset object
   */
  _generateInstallPresets(databaseService) {
    const installLogs = databaseService.db.prepare(
      `SELECT device_id, timestamp FROM logs
       WHERE component_name LIKE '%LifecycleProvider'
         AND message LIKE 'Fujifilm dws:install%'
       ORDER BY device_id, timestamp ASC`
    ).all();

    if (installLogs.length === 0) {
      this.logger('ℹ️  No LifecycleProvider install events found, skipping install presets.');
      return {};
    }

    this.logger(`🔍 Found ${installLogs.length} LifecycleProvider install events.`);
    return PresetService.createInstallPresets(installLogs);
  }

  /**
   * Create install-based presets from LifecycleProvider install events.
   * Can be called standalone after scan to regenerate install presets.
   * Queries logs, groups by device_id, creates time-range presets between consecutive installs,
   * then merges with existing preset snapshot and saves to disk.
   * @param {string} folderPath - Path to log folder
   * @returns {Promise<Object>} { success, count }
   */
  async createInstallPreset(folderPath) {
    const { dbDir } = this.getDbPath(folderPath);
    const { databaseService } = await this.loadDatabase(folderPath);

    this.logger('📦 Creating install presets from LifecycleProvider events...');

    const installPresets = this._generateInstallPresets(databaseService);

    const presetsPath = PresetService.getPresetsPath(dbDir);
    const existingPresets = PresetService.loadPresetFile(presetsPath, this.logger) || {};
    const mergedPresets = { ...existingPresets, ...installPresets };
    PresetService.savePreset(presetsPath, mergedPresets, this.logger);

    const count = Object.keys(installPresets).length;
    this.logger(`💡 Created ${count} install presets.`);
    return { success: true, count };
  }

  // -------- Output formatting --------

  formatLogEntry(log, format) {
    return logParserService.formatLogEntry(log, format);
  }
}

// Static properties for shared SQL.js instance and DB cache
NEUFLogService._SQL = null;
NEUFLogService._dbCache = {};
NEUFLogService._presetCache = new Map();

module.exports = {
  NEUFLogService
};
