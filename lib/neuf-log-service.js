/**
 * NEUF Log Service Module
 * Business logic for log operations (scan, clear, filter, get options)
 * Responsibility: Core log operations - can be used by API, CLI, or any interface
 *
 * STATELESS SERVICE - No instance state, all data passed as parameters
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { DatabaseWrapper, DatabaseService } = require('./database');
const { LogFileScannerService } = require('./log-file-scanner');

/**
 * NEUF Log Service
 * Stateless service - all dependencies injected, no instance state
 */
class NEUFLogService {
  constructor(parserService, logger = console.log) {
    this.parserService = parserService;
    this.logger = logger;
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
    const databaseService = new DatabaseService(db, (timestamp) => this.parserService.getTimeBucket(timestamp));
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
    
    if (!fs.existsSync(dbPath)) {
      throw new Error('Database not found. Please scan logs first.');
    }

    const SQL = await this.getSQL();
    const buffer = fs.readFileSync(dbPath);
    const sqlDb = new SQL.Database(buffer);
    
    const { db, databaseService } = this._createDatabaseService(sqlDb);
    
    return { db, databaseService, dbPath };
  }

  /**
   * Scan log folder and create database
   * @param {string} folderPath - Path to log folder
   * @returns {Object} Scan result with statistics
   */
  async scanLogs(folderPath) {
    const { logFolderPath, dbPath, dbDir } = this.getDbPath(folderPath);
    
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
    const scannerService = new LogFileScannerService(this.parserService, this.logger);

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
    this.logger('📊 Phase 2: Parsing structured fields from raw entries...');

    // Initialize final logs table (schema derived from Phase 2 output structure)
    databaseService.initDatabase();
    const insert = databaseService.prepareInsert();
    const insertMany = databaseService.createBatchInsert(insert);

    const rawPageSize = 5000;
    const batchSize = 1000;
    let offset = 0;
    let batch = [];
    let totalLogs = 0;

    while (true) {
      const rawPage = databaseService.getRawLogsPage(rawPageSize, offset);
      if (rawPage.length === 0) break;

      for (const raw of rawPage) {
        const logObj = this.parserService.parsePhase2Entry({
          filename: raw.filename,
          timestamp: raw.timestamp,
          rawContent: raw.raw_content
        });

        if (logObj) {
          batch.push(logObj);
          totalLogs++;

          if (batch.length >= batchSize) {
            insertMany(batch);
            batch = [];
          }
        }
      }

      offset += rawPage.length;
    }

    if (batch.length > 0) {
      insertMany(batch);
    }

    this.logger(`✅ Phase 2 complete! Parsed ${totalLogs.toLocaleString()} log entries.`);

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
   * Filter logs with pagination
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Filter parameters (already normalized)
   * @param {Object} options - Pagination options (page, pageSize)
   * @returns {Object} Filtered logs with pagination info
   */
  async filterLogs(folderPath, filters, options = {}) {
    const { databaseService } = await this.loadDatabase(folderPath);

    const page = options.page || 1;
    const pageSize = options.pageSize || 1000;

    const { logs, total, totalPages } = databaseService.searchWithContextLines(
      filters,
      { page, pageSize, orderBy: 'timestamp ASC' }
    );

    return {
      success: true,
      logs: logs,
      total,
      page,
      pageSize,
      totalPages,
      filters
    };
  }

  /**
   * Get filter options (available values for each filter field)
   * @param {string} folderPath - Path to log folder
   * @param {Object} filters - Current filters (already normalized)
   * @param {boolean} limitedOptions - Limit thread_name and components to top 20 (default: true)
   * @returns {Object} Available filter options
   */
  async getFilterOptions(folderPath, filters = {}, limitedOptions = true) {
    const { databaseService } = await this.loadDatabase(folderPath);

    const filterOptions = databaseService.getFilterOptions(filters, 'logs', limitedOptions);

    return {
      success: true,
      data: filterOptions
    };
  }
}

// Static property for shared SQL.js instance
NEUFLogService._SQL = null;

module.exports = {
  NEUFLogService
};
