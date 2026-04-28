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
  
  export() {
    return this.db.export();
  }
}

/**
 * Database Service
 * Encapsulates all database operations with dependencies
 */
class DatabaseService {
  constructor(db, getTimeBucketFn) {
    this.db = db;
    this.getTimeBucket = getTimeBucketFn;
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
    const timeBucketInclude = filters.timeBucketInclude || [];
    const timeBucketExclude = filters.timeBucketExclude || [];
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
    addFilterClause('timeBucket', 'time_bucket', timeBucketInclude, timeBucketExclude);

    // Search text
    if (filters.search) {
      where += ' AND message LIKE ?';
      params.push(`%${filters.search}%`);
    }
    
    return { where, params };
  }
  
  /**
   * Initialize database schema
   */
  initDatabase() {
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
    
    // Get time buckets from stored time_bucket column
    const getTimeBuckets = () => {
      const { where, params } = this.buildWhereClause(filtersWithoutSearch, 'timeBucket');
      const query = `
        SELECT time_bucket, COUNT(*) as count
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
        id INTEGER,
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
    this.db.prepare(
      `INSERT INTO ${outputTable} SELECT * FROM ${inputTable} ${where} ORDER BY timestamp ASC`
    ).run(...params);

    // Step 2: if contextLines requested, insert surrounding rows not yet in outputTable
    if (filters.search && filters.contextLines > 0) {
      const contextLines = filters.contextLines;

      // Match IDs already inserted in step 1, sorted ascending
      const matchIds = this.db.prepare(
        `SELECT id FROM ${outputTable} ORDER BY id ASC`
      ).all().map(r => r.id);
      const matchIdSet = new Set(matchIds);

      // Collect context IDs using ID arithmetic (IDs are sequential autoincrement)
      const contextIdSet = new Set();
      for (const matchId of matchIds) {
        for (let i = matchId - contextLines; i <= matchId + contextLines; i++) {
          if (!matchIdSet.has(i)) contextIdSet.add(i);
        }
      }

      // Insert context rows with a single query
      if (contextIdSet.size > 0) {
        const placeholders = Array.from({ length: contextIdSet.size }, () => '?').join(',');
        this.db.prepare(
          `INSERT INTO ${outputTable} SELECT * FROM ${inputTable} WHERE id IN (${placeholders})`
        ).run(...Array.from(contextIdSet));
      }
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
