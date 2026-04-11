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
   * @param {Object} filters - Filter parameters
   * @param {Object} options - Pagination options
   * @param {string} tableName - Table to query from (default: 'logs')
   */
  getFilteredData(filters, options, tableName = 'logs') {
    const { page = 1, pageSize = 1000, orderBy = 'timestamp DESC', limit = null } = options;
    
    // Build query
    const { where, params, selectedTimeBuckets } = this.buildWhereClause(filters);
    
    // Get all logs first (for time bucket filtering)
    let allLogs = this.db.prepare(`SELECT * FROM ${tableName} ${where} ORDER BY ${orderBy}`).all(...params);
    
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
   * Materialize context rows into a temporary table (context_results).
   *
   * Algorithm:
   *   1. Page through matching IDs (filter + keyword, ORDER BY id ASC).
   *   2. For each match, expand the candidate range [id-N, id+N], deduplicating
   *      efficiently by tracking maxExpanded (the highest ID already buffered) —
   *      safe because match IDs are sorted ascending so ranges only grow.
   *   3. Flush the candidate ID buffer to context_results every FLUSH_THRESHOLD
   *      entries via a batch INSERT…SELECT…WHERE id IN (…), keeping individual
   *      SQL statements small and memory bounded.
   *
   * context_results mirrors the logs schema so callers can pass it as tableName
   * to getFilteredData() and getFilterOptions() without modification.
   *
   * @param {Object} filters - Full filters including search and contextLines
   * @returns {void}
   * @throws {Error} If contextLines is not a valid positive integer
   */
  _materializeContextIds(filters) {
    // Strict integer validation — reject partially-numeric strings like "10xyz" or "0"
    const ctxStr = String(filters.contextLines).trim();
    const ctxN = parseInt(ctxStr, 10);
    if (!/^\d+$/.test(ctxStr) || ctxN <= 0) {
      throw new Error('Invalid contextLines value for _materializeContextIds');
    }

    const { where: matchWhere, params: matchParams } = this.buildWhereClause(filters);

    // Create context_results with the full logs schema so it can be used as a
    // drop-in replacement for the logs table in any downstream query.
    this.db.exec('DROP TABLE IF EXISTS context_results');
    this.db.exec(`
      CREATE TEMP TABLE context_results (
        id INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        thread_name TEXT NOT NULL,
        device_id TEXT,
        component_name TEXT,
        log_level TEXT,
        message TEXT NOT NULL
      )
    `);

    const MATCH_PAGE_SIZE = 1000;
    const FLUSH_THRESHOLD = 500;
    let offset = 0;
    let maxExpanded = -1; // highest candidate ID added to the buffer so far
    let idBuffer = [];

    const flushBuffer = () => {
      if (idBuffer.length === 0) return;
      const placeholders = idBuffer.map(() => '?').join(',');
      this.db.prepare(
        `INSERT OR IGNORE INTO context_results SELECT * FROM logs WHERE id IN (${placeholders})`
      ).run(...idBuffer);
      idBuffer = [];
    };

    while (true) {
      // Fetch the next page of matching IDs ordered ascending so range expansion
      // proceeds monotonically and dedup only requires checking maxExpanded.
      const matchPage = this.db.prepare(
        `SELECT id FROM logs ${matchWhere} ORDER BY id ASC LIMIT ${MATCH_PAGE_SIZE} OFFSET ${offset}`
      ).all(...matchParams);

      if (matchPage.length === 0) break;

      for (const row of matchPage) {
        // Begin from the first ID not already covered by a previous expansion.
        const start = Math.max(row.id - ctxN, maxExpanded + 1, 1);
        const end = row.id + ctxN;
        maxExpanded = Math.max(maxExpanded, end);

        if (start > end) continue; // range fully covered by previous expansion

        for (let id = start; id <= end; id++) {
          idBuffer.push(id);
          if (idBuffer.length >= FLUSH_THRESHOLD) {
            flushBuffer();
          }
        }
      }

      offset += matchPage.length;
    }

    flushBuffer(); // flush any remaining IDs
  }

  /**
   * Allowed column names for ORDER BY validation.
   * Restricts orderBy to known schema columns, preventing SQL injection.
   */
  static get ALLOWED_ORDER_COLUMNS() {
    return new Set(['id', 'timestamp', 'log_level', 'thread_name', 'device_id', 'component_name', 'filename', 'message']);
  }

  /**
   * Validate and sanitize an ORDER BY string against known column names.
   * Falls back to defaultValue if any column name is not in the allowlist.
   * @param {string} orderBy - Raw ORDER BY string (e.g. "timestamp ASC")
   * @param {string} defaultValue - Safe fallback value
   * @returns {string} Safe ORDER BY string
   */
  _sanitizeOrderBy(orderBy, defaultValue = 'timestamp ASC') {
    if (!orderBy || typeof orderBy !== 'string') return defaultValue;
    const parts = orderBy.split(',');
    for (const part of parts) {
      const tokens = part.trim().split(/\s+/);
      if (tokens.length < 1 || tokens.length > 2) return defaultValue;
      if (!DatabaseService.ALLOWED_ORDER_COLUMNS.has(tokens[0])) return defaultValue;
      if (tokens.length === 2 && !/^(ASC|DESC)$/i.test(tokens[1])) return defaultValue;
    }
    return orderBy;
  }

  /**
   * Search with context lines (like grep -C N).
   *
   * Builds a context_results temp table via _materializeContextIds(), then
   * delegates pagination to getFilteredData() using that table as the source.
   * This keeps the query simple and pushes the heavy work into small, bounded
   * SQL statements rather than one large CTE.
   *
   * Falls back to standard getFilteredData() if search is absent, contextLines
   * is invalid, or any other error occurs during materialization.
   */
  searchWithContextLines(filters, options) {
    if (!filters.search) {
      return this.getFilteredData(filters, options);
    }

    try {
      this._materializeContextIds(filters);
      // Query all rows from context_results (already pre-filtered); no additional
      // WHERE predicates are needed — pass empty filters so buildWhereClause
      // produces only "WHERE 1=1".
      const safeOrderBy = this._sanitizeOrderBy(options.orderBy || 'timestamp ASC');
      return this.getFilteredData({}, { ...options, orderBy: safeOrderBy }, 'context_results');
    } catch (e) {
      // Invalid contextLines or other materialization error — fall back to
      // standard filtering so callers always get a usable result.
      return this.getFilteredData(filters, options);
    } finally {
      this.db.exec('DROP TABLE IF EXISTS context_results');
    }
  }
  
  /**
   * Get filter options with counts.
   *
   * When search + contextLines > 0 the counts are scoped to the context result
   * set so the UI accurately reflects what is visible in the search result.
   * _materializeContextIds() builds a context_results temp table (full log rows)
   * within this call; all per-field count queries then run against that table.
   * Because the entire computation happens within the lifetime of this single
   * method call, it works correctly even when getFilterOptions() is invoked in
   * a separate HTTP request from the one that called filterLogs().
   *
   * @param {Object} filters - Current filters
   * @param {string} tableName - Table to query from when context is not active (default: 'logs')
   * @param {boolean} limitedOptions - Limit thread_name and components to top 20 (default: true)
   */
  getFilterOptions(filters, tableName = 'logs', limitedOptions = true) {
    // Remove search/contextLines from the cascade-filter WHERE clauses so that
    // each field's option list is not artificially restricted to itself.
    const filtersWithoutSearch = { ...filters };
    delete filtersWithoutSearch.search;
    delete filtersWithoutSearch.contextLines;

    // When context is active, materialize context rows into context_results and
    // use that as the query source so counts reflect the visible result set.
    const hasContextFilter = !!(filters.search && Number(filters.contextLines) > 0);
    let effectiveTable = tableName;

    if (hasContextFilter) {
      try {
        this._materializeContextIds(filters);
        effectiveTable = 'context_results';
      } catch (e) {
        // Invalid contextLines or other error — fall back to the normal table.
        effectiveTable = tableName;
      }
    }

    try {
      // Helper function to get filter options with counts
      const getOptions = (field, column, orderBy = `${column} ASC`, additionalWhere = '', limit = null) => {
        const { where, params } = this.buildWhereClause(filtersWithoutSearch, field);
        const limitClause = limit ? ` LIMIT ${limit}` : '';
        const query = `SELECT ${column}, COUNT(*) as count FROM ${effectiveTable} ${where}${additionalWhere} GROUP BY ${column} ORDER BY ${orderBy}${limitClause}`;
        return this.db.prepare(query).all(...params);
      };

      // Get total log count
      const { where: totalWhere, params: totalParams } = this.buildWhereClause(filtersWithoutSearch);
      const totalResult = this.db.prepare(`SELECT COUNT(*) as total FROM ${effectiveTable} ${totalWhere}`).get(...totalParams);
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
          FROM ${effectiveTable}
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
    } finally {
      if (hasContextFilter) {
        this.db.exec('DROP TABLE IF EXISTS context_results');
      }
    }
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
   * Retrieve Phase 1 raw entries ordered by timestamp ASC, id ASC for Phase 2 processing.
   * Uses pagination (LIMIT/OFFSET) to keep memory bounded for large log sets.
   * @param {number} limit - Number of rows per page (default: 5000)
   * @param {number} offset - Row offset for pagination (default: 0)
   * @returns {Array} Array of {filename, timestamp, raw_content} objects
   */
  getRawLogsPage(limit = 5000, offset = 0) {
    return this.db.prepare(
      'SELECT filename, timestamp, raw_content FROM raw_phase1_logs ORDER BY timestamp ASC, id ASC LIMIT ? OFFSET ?'
    ).all(limit, offset);
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
