/**
 * Database Module
 * Handles all database operations including wrapper, queries, and data retrieval
 * Responsibility: Database abstraction and all SQL operations
 * Uses service object pattern to encapsulate dependencies
 */

/**
 * Database Wrapper Class
 * Provides a wrapper around sql.js database for easier operations
 */
class DatabaseWrapper {
  constructor(db) {
    this.db = db;
  }
  
  exec(sql) {
    this.db.run(sql);
  }
  
  prepare(sql) {
    return {
      run: (...params) => {
        this.db.run(sql, params);
      },
      get: (...params) => {
        const result = this.db.exec(sql, params);
        if (result.length === 0) return null;
        const columns = result[0].columns;
        const values = result[0].values[0];
        if (!values) return null;
        const row = {};
        columns.forEach((col, i) => row[col] = values[i]);
        return row;
      },
      all: (...params) => {
        const result = this.db.exec(sql, params);
        if (result.length === 0) return [];
        const columns = result[0].columns;
        return result[0].values.map(values => {
          const row = {};
          columns.forEach((col, i) => row[col] = values[i]);
          return row;
        });
      },
      each: (callback, ...params) => {
        const result = this.db.exec(sql, params);
        if (result.length === 0) return;
        const columns = result[0].columns;
        result[0].values.forEach(values => {
          const row = {};
          columns.forEach((col, i) => row[col] = values[i]);
          callback(row);
        });
      }
    };
  }
  
  transaction(fn) {
    return (items) => {
      this.db.run('BEGIN TRANSACTION');
      try {
        fn(items);
        this.db.run('COMMIT');
      } catch (error) {
        this.db.run('ROLLBACK');
        throw error;
      }
    };
  }
  
  /**
   * Register a custom SQL function on the underlying sql.js database
   * @param {string} name - Function name
   * @param {Function} fn - Implementation function
   */
  registerFunction(name, fn) {
    this.db.create_function(name, fn);
  }

  export() {
    return this.db.export();
  }
}

/**
 * Database Service
 * Encapsulates all database operations with dependencies
 */
class DatabaseService {
  constructor(db) {
    this.db = db;
  }
  
  /**
   * Build SQL WHERE clause and parameters from filters
   * Now supports separate include and exclude parameters
   * @param {Object} filters - Filter object with include/exclude arrays
   * @param {string} excludeField - Field to exclude from WHERE clause (for getting filter options)
   * @returns {Object} { where, params, selectedTimeBuckets }
   */
  buildWhereClause(filters, excludeField = null) {
    let where = 'WHERE 1=1';
    const params = [];
    
    // Extract include/exclude arrays for each field
    const filenameInclude = filters.filenameInclude || [];
    const filenameExclude = filters.filenameExclude || [];
    const logLevelInclude = filters.logLevelInclude || [];
    const logLevelExclude = filters.logLevelExclude || [];
    const threadInclude = filters.threadInclude || [];
    const threadExclude = filters.threadExclude || [];
    const deviceInclude = filters.deviceInclude || [];
    const deviceExclude = filters.deviceExclude || [];
    const componentInclude = filters.componentInclude || [];
    const componentExclude = filters.componentExclude || [];

    // Helper function to add include/exclude clauses
    const addFilterClause = (field, dbColumn, includeList, excludeList) => {
      if (excludeField === field) return;

      // Add include clause
      if (includeList.length > 0) {
        where += ` AND ${dbColumn} IN (${includeList.map(() => '?').join(',')})`;
        params.push(...includeList);
      }

      // Add exclude clause
      if (excludeList.length > 0) {
        where += ` AND ${dbColumn} NOT IN (${excludeList.map(() => '?').join(',')})`;
        params.push(...excludeList);
      }
    };

    // Apply filters for each field
    addFilterClause('filename', 'filename', filenameInclude, filenameExclude);
    addFilterClause('logLevel', 'log_level', logLevelInclude, logLevelExclude);
    addFilterClause('thread', 'thread_name', threadInclude, threadExclude);
    addFilterClause('device', 'device_id', deviceInclude, deviceExclude);
    addFilterClause('component', 'component_name', componentInclude, componentExclude);

    // Time bucket range filter using BETWEEN (Unix timestamps)
    if (excludeField !== 'timeBucket') {
      if (filters.timeFrom != null && filters.timeTo != null) {
        where += ' AND timestamp BETWEEN ? AND ?';
        params.push(filters.timeFrom, filters.timeTo);
      }
    }

    // Search text: use REGEXP(pattern, value) when searchRegex=true (always case-insensitive), otherwise LIKE
    if (filters.search) {
      if (filters.searchRegex) {
        where += ' AND REGEXP(?, message)';
        params.push(filters.search);
      } else {
        where += ' AND message LIKE ?';
        params.push(`%${filters.search}%`);
      }
    }
    
    return { where, params };
  }
  
  /**
   * Register all custom SQL functions (REGEXP, BUCKET_LABEL)
   * Must be called after every new Database connection (scan and load)
   */
  registerCustomFunctions() {
    // Register REGEXP(pattern, value) function — always case-insensitive
    this.db.registerFunction('REGEXP', (pattern, value) => {
      if (value == null) return 0;
      try {
        return new RegExp(pattern, 'i').test(value) ? 1 : 0;
      } catch (e) {
        return 0;
      }
    });

    // Register BUCKET_LABEL(unixTs) — converts Unix timestamp (seconds) to "YYYY-MM-DD HH:MM" label
    this.db.registerFunction('BUCKET_LABEL', (unixTs) => {
      if (unixTs == null) return null;
      const d = new Date(unixTs * 1000);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    });
  }

  /**
   * Initialize database schema
   */
  initDatabase() {
    this.registerCustomFunctions();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        thread_name TEXT NOT NULL,
        device_id TEXT,
        component_name TEXT,
        log_level TEXT,
        time_bucket TEXT,
        message TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_filename ON logs(filename);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_thread_name ON logs(thread_name);
      CREATE INDEX IF NOT EXISTS idx_device_id ON logs(device_id);
      CREATE INDEX IF NOT EXISTS idx_component_name ON logs(component_name);
      CREATE INDEX IF NOT EXISTS idx_log_level ON logs(log_level);
      CREATE INDEX IF NOT EXISTS idx_time_bucket ON logs(time_bucket);
    `);
  }
  
  /**
   * Get filter options with counts
   * NOTE: Search filter is excluded when calculating options to show all available values
   * @param {Object} filters - Current filters
   * @param {string} tableName - Table to query (logs or temp_context_filter)
   * @param {boolean} limitedOptions - Limit thread_name and components to top 20 (default: true)
   */
  getFilterOptions(filters, tableName = 'logs', limitedOptions = true) {
    // Remove search from filters for getting options (we want all available options, not just from search results)
    const filtersWithoutSearch = { ...filters };
    delete filtersWithoutSearch.search;
    delete filtersWithoutSearch.contextLines;
    
    // Helper function to get filter options with counts
    const getOptions = (field, column, orderBy = `${column} ASC`, additionalWhere = '', limit = null) => {
      const { where, params } = this.buildWhereClause(filtersWithoutSearch, field);
      const limitClause = limit ? ` LIMIT ${limit}` : '';
      const query = `SELECT ${column}, COUNT(*) as count FROM ${tableName} ${where}${additionalWhere} GROUP BY ${column} ORDER BY ${orderBy}${limitClause}`;
      return this.db.prepare(query).all(...params);
    };
    
    // Get total log count
    const { where, params } = this.buildWhereClause(filtersWithoutSearch);
    const totalResult = this.db.prepare(`SELECT COUNT(*) as total FROM ${tableName} ${where}`).get(...params);
    const totalLogs = totalResult ? totalResult.total : 0;
    
    // Get time buckets from stored time_bucket column, with human-readable label via BUCKET_LABEL()
    const getTimeBuckets = () => {
      const { where, params } = this.buildWhereClause(filtersWithoutSearch, 'timeBucket');
      const query = `
        SELECT BUCKET_LABEL(time_bucket) as time_label, COUNT(*) as count
        FROM ${tableName}
        ${where}
        AND time_bucket IS NOT NULL
        GROUP BY time_bucket
        ORDER BY time_bucket ASC
        LIMIT 100
      `;
      return this.db.prepare(query).all(...params);
    };
    
    // Determine limit for threads and components
    const threadLimit = limitedOptions ? 20 : null;
    const componentLimit = limitedOptions ? 20 : null;
    
    return {
      filenames: getOptions('filename', 'filename', 'filename ASC', ' AND filename IS NOT NULL'),
      timeBuckets: getTimeBuckets(),
      logLevels: getOptions('logLevel', 'log_level', 'log_level ASC', ' AND log_level IS NOT NULL'),
      threads: getOptions('thread', 'thread_name', 'count DESC', ' AND thread_name IS NOT NULL', threadLimit),
      devices: getOptions('device', 'device_id', 'count DESC', ' AND device_id IS NOT NULL'),
      components: getOptions('component', 'component_name', 'count DESC', ' AND component_name IS NOT NULL', componentLimit),
      totalLogs: totalLogs
    };
  }
  
  /**
   * Initialize the Phase 1 raw logs temp table.
   * Stores raw entries {filename, timestamp, raw_content} for two-phase scanning.
   */
  initRawLogsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raw_phase1_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        time_bucket TEXT,
        raw_content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_raw_timestamp ON raw_phase1_logs(timestamp);
    `);
  }

  /**
   * Prepare insert statement for raw Phase 1 batch operations
   */
  prepareInsertRaw() {
    return this.db.prepare(`
      INSERT INTO raw_phase1_logs (filename, timestamp, time_bucket, raw_content)
      VALUES (?, ?, ?, ?)
    `);
  }

  /**
   * Create transaction for batch inserts into raw Phase 1 table
   */
  createBatchInsertRaw(insertStmt) {
    return this.db.transaction((entries) => {
      for (const entry of entries) {
        insertStmt.run(entry.filename, entry.timestamp, entry.timeBucket, entry.rawContent);
      }
    });
  }

  /**
   * Retrieve Phase 1 raw entries ordered by timestamp ASC, id ASC for Phase 2 processing.
   * Uses pagination (LIMIT/OFFSET) to keep memory bounded for large log sets.
   * @param {number} limit - Number of rows per page (default: 5000)
   * @param {number} offset - Row offset for pagination (default: 0)
   * @returns {Array} Array of {filename, timestamp, raw_content} objects
   */
  getRawLogsPage(limit = 5000, offset = 0) {
    return this.db.prepare(
      'SELECT filename, timestamp, time_bucket, raw_content FROM raw_phase1_logs ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  /**
   * Drop the Phase 1 raw logs table after two-phase scanning is complete.
   */
  dropRawLogsTable() {
    this.db.exec('DROP TABLE IF EXISTS raw_phase1_logs');
  }

  /**
   * Execute a single filter step: materialize filtered rows from inputTable into outputTable.
   *
   * Step 1 (always): INSERT matching rows using full WHERE clause (including search).
   * Step 2 (if contextLines > 0): additionally INSERT surrounding context rows that
   *   are N positions before/after each match in the ordered full result set.
   *
   * @param {Object} filters - Filter parameters (same shape as buildWhereClause)
   * @param {string} inputTable - Source table name (e.g. 'logs' or 'filter_step_1')
   * @param {string} outputTable - Destination temp table name (e.g. 'filter_step_1')
   * @returns {{ count: number }} Number of rows stored in the output table
   */
  executeFilterStep(filters, inputTable, outputTable) {
    // Drop and recreate output table
    this.db.exec(`DROP TABLE IF EXISTS ${outputTable}`);
    this.db.exec(`
      CREATE TEMP TABLE ${outputTable} (
        id INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        thread_name TEXT NOT NULL,
        device_id TEXT,
        component_name TEXT,
        log_level TEXT,
        time_bucket TEXT,
        message TEXT NOT NULL
      )
    `);

    // Step 1: insert all matching rows (applies all filters including search)
    const { where, params } = this.buildWhereClause(filters);
    const sql = `INSERT INTO ${outputTable} SELECT * FROM ${inputTable} ${where} ORDER BY timestamp ASC`
    console.log(sql);
    this.db.prepare(sql).run(...params);

    // Step 2: if contextLines requested, insert surrounding rows not yet in outputTable
    if (filters.search && filters.contextLines > 0) {
      const contextLines = filters.contextLines;

      // Insert context rows: rows within ±contextLines of any match, skip duplicates via PRIMARY KEY
      this.db.prepare(`
        INSERT OR IGNORE INTO ${outputTable}
        SELECT * FROM ${inputTable} i
        WHERE EXISTS (
            SELECT 1 FROM ${outputTable} m
            WHERE i.id BETWEEN m.id - ? AND m.id + ?
          )
      `).run(contextLines, contextLines);
    }

    const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${outputTable}`).get();
    return { count: result ? result.count : 0 };
  }

  /**
   * Prepare insert statement for batch operations
   */
  prepareInsert() {
    return this.db.prepare(`
      INSERT INTO logs (filename, timestamp, thread_name, device_id,
                        component_name, log_level, time_bucket, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }
  
  /**
   * Create transaction for batch inserts
   */
  createBatchInsert(insertStmt) {
    return this.db.transaction((logs) => {
      for (const log of logs) {
        insertStmt.run(
          log.filename, log.timestamp, log.threadName, log.deviceId,
          log.componentName, log.logLevel, log.timeBucket, log.message
        );
      }
    });
  }
}

module.exports = {
  DatabaseWrapper,
  DatabaseService
};
