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
    
    // Search text
    if (filters.search) {
      where += ' AND message LIKE ?';
      params.push(`%${filters.search}%`);
    }
    
    // Return selected time buckets for special handling
    const selectedTimeBuckets = [...timeBucketInclude];
    
    return { where, params, selectedTimeBuckets };
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
        message TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_filename ON logs(filename);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_thread_name ON logs(thread_name);
      CREATE INDEX IF NOT EXISTS idx_device_id ON logs(device_id);
      CREATE INDEX IF NOT EXISTS idx_component_name ON logs(component_name);
      CREATE INDEX IF NOT EXISTS idx_log_level ON logs(log_level);
    `);
  }
  
  /**
   * Get filtered log data from database (standard filtering)
   */
  getFilteredData(filters, options) {
    const { page = 1, pageSize = 1000, orderBy = 'timestamp DESC', limit = null } = options;
    
    // Build query
    const { where, params, selectedTimeBuckets } = this.buildWhereClause(filters);
    
    // Get all logs first (for time bucket filtering)
    let allLogs = this.db.prepare(`SELECT * FROM logs ${where} ORDER BY ${orderBy}`).all(...params);
    
    // Filter by time bucket if selected (done in-memory since it's calculated)
    if (selectedTimeBuckets && selectedTimeBuckets.length > 0) {
      allLogs = allLogs.filter(log => {
        const bucket = this.getTimeBucket(log.timestamp);
        return selectedTimeBuckets.includes(bucket);
      });
    }
    
    const total = allLogs.length;
    
    // Apply pagination
    let logs = allLogs;
    if (limit !== null) {
      logs = allLogs.slice(0, limit);
    } else if (pageSize) {
      const start = (page - 1) * pageSize;
      logs = allLogs.slice(start, start + pageSize);
    }
    
    return {
      logs,
      total,
      page,
      pageSize,
      totalPages: pageSize ? Math.ceil(total / pageSize) || 1 : 1
    };
  }
  
  /**
   * Search with context lines (like grep -C N)
   * Returns logs matching search text plus N lines before and after each match
   */
  searchWithContextLines(filters, options) {
    const { page = 1, pageSize = 1000, orderBy = 'timestamp ASC' } = options;
    
    if (!filters.search || filters.contextLines <= 0) {
      // No search or no context needed, use standard filtering
      return this.getFilteredData(filters, options);
    }
    
    // Create filter without search to get all logs (with other filters applied)
    const filtersWithoutSearch = { ...filters };
    delete filtersWithoutSearch.search;
    
    // Get all filtered logs (without search filter)
    const { logs: allLogs } = this.getFilteredData(filtersWithoutSearch, {
      orderBy,
      limit: null,
      pageSize: null
    });
    
    // Find matching indices and build context
    const contextLines = filters.contextLines;
    const searchLower = filters.search.toLowerCase();
    const matchedIndices = new Set();
    
    allLogs.forEach((log, index) => {
      if (log.message.toLowerCase().includes(searchLower)) {
        // Add context lines before
        for (let i = Math.max(0, index - contextLines); i < index; i++) {
          matchedIndices.add(i);
        }
        
        // Add the matched log itself
        matchedIndices.add(index);
        
        // Add context lines after
        for (let i = index + 1; i <= Math.min(allLogs.length - 1, index + contextLines); i++) {
          matchedIndices.add(i);
        }
      }
    });
    
    // Build result with context, maintaining order
    const logsWithContext = Array.from(matchedIndices)
      .sort((a, b) => a - b)
      .map(index => allLogs[index]);
    
    // Create temporary table with only filter fields (no message field for performance)
    this.db.exec('DROP TABLE IF EXISTS temp_context_filter');
    this.db.exec(`
      CREATE TEMP TABLE temp_context_filter (
        filename TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        thread_name TEXT NOT NULL,
        device_id TEXT,
        component_name TEXT,
        log_level TEXT
      )
    `);
    
    // Insert filter fields only into temporary table
    if (logsWithContext.length > 0) {
      const insertStmt = this.db.prepare(`
        INSERT INTO temp_context_filter (filename, timestamp, thread_name, device_id, component_name, log_level)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      this.db.db.run('BEGIN TRANSACTION');
      try {
        logsWithContext.forEach(log => {
          insertStmt.run(
            log.filename,
            log.timestamp,
            log.thread_name,
            log.device_id,
            log.component_name,
            log.log_level
          );
        });
        this.db.db.run('COMMIT');
      } catch (error) {
        this.db.db.run('ROLLBACK');
        throw error;
      }
    }
    
    const total = logsWithContext.length;
    
    // Apply pagination
    const start = (page - 1) * pageSize;
    const logs = logsWithContext.slice(start, start + pageSize);
    
    return {
      logs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1
    };
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
    
    // Get time buckets dynamically from timestamps using SQL substring
    const getTimeBuckets = () => {
      const { where, params } = this.buildWhereClause(filtersWithoutSearch, 'timeBucket');
      
      // Use SQL to calculate time bucket directly in the query
      const query = `
        SELECT
          SUBSTR(timestamp, 1, 10) || ' ' ||
          SUBSTR(timestamp, 12, 2) || ':' ||
          CASE
            WHEN CAST(SUBSTR(timestamp, 15, 2) AS INTEGER) < 30 THEN '00'
            ELSE '30'
          END as time_bucket,
          COUNT(*) as count
        FROM ${tableName}
        ${where}
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
      INSERT INTO raw_phase1_logs (filename, timestamp, raw_content)
      VALUES (?, ?, ?)
    `);
  }

  /**
   * Create transaction for batch inserts into raw Phase 1 table
   */
  createBatchInsertRaw(insertStmt) {
    return this.db.transaction((entries) => {
      for (const entry of entries) {
        insertStmt.run(entry.filename, entry.timestamp, entry.rawContent);
      }
    });
  }

  /**
   * Retrieve all Phase 1 raw entries ordered by timestamp ASC for Phase 2 processing.
   * @returns {Array} Array of {filename, timestamp, raw_content} objects
   */
  getAllRawLogsOrderedByTimestamp() {
    return this.db.prepare(
      'SELECT filename, timestamp, raw_content FROM raw_phase1_logs ORDER BY timestamp ASC'
    ).all();
  }

  /**
   * Drop the Phase 1 raw logs table after two-phase scanning is complete.
   */
  dropRawLogsTable() {
    this.db.exec('DROP TABLE IF EXISTS raw_phase1_logs');
  }

  /**
   * Prepare insert statement for batch operations
   */
  prepareInsert() {
    return this.db.prepare(`
      INSERT INTO logs (filename, timestamp, thread_name, device_id,
                        component_name, log_level, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
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
          log.componentName, log.logLevel, log.message
        );
      }
    });
  }
}

module.exports = {
  DatabaseWrapper,
  DatabaseService
};
