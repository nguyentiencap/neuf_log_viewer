/**
 * Database Module
 * Handles all database operations including wrapper, queries, and data retrieval
 * Responsibility: Database abstraction and all SQL operations
 * Uses service object pattern to encapsulate dependencies
 */

const { logParserService } = require('./log-parser');

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
  constructor(db, logger = console.log) {
    this.db = db;
    this.logger = logger;
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

    // Helper: detect LIKE pattern (value contains %)
    const isLikePattern = (v) => typeof v === 'string' && v.includes('%');

    // Helper function to add include/exclude clauses
    // Supports null values: null in includeList → OR column IS NULL
    //                       null in excludeList → AND column IS NOT NULL
    // Supports LIKE patterns: values containing % use LIKE instead of IN
    const addFilterClause = (field, dbColumn, includeList, excludeList) => {
      if (excludeField === field) return;

      // Separate null, LIKE patterns, and exact values
      const includeNulls = includeList.includes(null);
      const nonNullInclude = includeList.filter(v => v !== null);
      const likeInclude = nonNullInclude.filter(isLikePattern);
      const exactInclude = nonNullInclude.filter(v => !isLikePattern(v));

      const excludeNulls = excludeList.includes(null);
      const nonNullExclude = excludeList.filter(v => v !== null);
      const likeExclude = nonNullExclude.filter(isLikePattern);
      const exactExclude = nonNullExclude.filter(v => !isLikePattern(v));

      // Add include clause — combine exact IN, LIKE patterns, and null with OR
      if (includeList.length > 0) {
        const parts = [];
        if (exactInclude.length > 0) {
          parts.push(`${dbColumn} IN (${exactInclude.map(() => '?').join(',')})`);
          params.push(...exactInclude);
        }
        for (const pattern of likeInclude) {
          parts.push(`${dbColumn} LIKE ?`);
          params.push(pattern);
        }
        if (includeNulls) {
          parts.push(`${dbColumn} IS NULL`);
        }
        if (parts.length > 0) {
          where += ` AND (${parts.join(' OR ')})`;
        }
      }

      // Add exclude clause — exact values use NOT IN; LIKE patterns use NOT LIKE
      if (excludeList.length > 0) {
        if (exactExclude.length > 0 && excludeNulls) {
          where += ` AND (${dbColumn} NOT IN (${exactExclude.map(() => '?').join(',')}) AND ${dbColumn} IS NOT NULL)`;
          params.push(...exactExclude);
        } else if (exactExclude.length > 0) {
          where += ` AND ${dbColumn} NOT IN (${exactExclude.map(() => '?').join(',')})`;
          params.push(...exactExclude);
        } else if (excludeNulls) {
          where += ` AND ${dbColumn} IS NOT NULL`;
        }
        // NOT LIKE excludes — combine all patterns into one clause for performance
        // When excludeNulls is true, IS NOT NULL already handled above, so no null-preservation needed
        if (likeExclude.length === 1) {
          if (excludeNulls) {
            where += ` AND ${dbColumn} NOT LIKE ?`;
          } else {
            where += ` AND (${dbColumn} NOT LIKE ? OR ${dbColumn} IS NULL)`;
          }
          params.push(likeExclude[0]);
        } else if (likeExclude.length > 1) {
          const notLikeParts = likeExclude.map(() => `${dbColumn} NOT LIKE ?`).join(' AND ');
          if (excludeNulls) {
            where += ` AND (${notLikeParts})`;
          } else {
            where += ` AND (${dbColumn} IS NULL OR (${notLikeParts}))`;
          }
          params.push(...likeExclude);
        }
      }
    };

    // Apply filters for each field
    addFilterClause('filename', 'filename', filenameInclude, filenameExclude);
    addFilterClause('logLevel', 'log_level', logLevelInclude, logLevelExclude);
    addFilterClause('thread', 'thread_name', threadInclude, threadExclude);
    addFilterClause('device', 'device_id', deviceInclude, deviceExclude);
    addFilterClause('component', 'component_name', componentInclude, componentExclude);

     // Time bucket range filter using BETWEEN (Unix timestamps)
     // Convert string timeFrom/timeTo to unix timestamps
     if (filters.timeFrom != null || filters.timeTo != null) {
       let timeFromUnix = 0;
       let timeToUnix = 2147483647;

       if (filters.timeFrom != null) {
         const timeFromTs = typeof filters.timeFrom === 'string'
           ? logParserService.getTimeBucket(filters.timeFrom)
           : filters.timeFrom;
         timeFromUnix = timeFromTs != null ? timeFromTs : 0;
       }

       if (filters.timeTo != null) {
         const timeToTs = typeof filters.timeTo === 'string'
           ? logParserService.getTimeBucket(filters.timeTo)
           : filters.timeTo;
         timeToUnix = timeToTs != null ? timeToTs : 2147483647;
       }

       where += ' AND time_bucket BETWEEN ? AND ?';
       params.push(timeFromUnix, timeToUnix);
     }

    // Search text: always try both LIKE (plain text) and REGEXP (pattern) with OR
    if (filters.search) {
      where += ' AND (message LIKE ? OR REGEXP(?, message))';
      params.push(`%${filters.search}%`, filters.search);
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

    // Register BUCKET_LABEL(unixTs) — converts Unix timestamp (seconds) to "YYYY-MM-DD HH:00" label
    this.db.registerFunction('BUCKET_LABEL', (unixTs) => {
      if (unixTs == null) return null;
      const d = new Date(unixTs * 1000);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
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
        time_bucket INTEGER,
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
   * Get filter options with counts from a given table.
   * Caller is responsible for passing the correct table (already filtered).
   * Simple GROUP BY queries — no WHERE filtering applied here.
   * @param {string} tableName - Table to query (logs or a pre-filtered temp table)
   * @param {boolean} limitedOptions - Limit thread_name and components to top 20 (default: true)
   */
  getFilterOptions(tableName = 'logs', limitedOptions = true) {
    // Simple GROUP BY on the given table
    const getOptions = (column, orderBy, limit = null) => {
      const limitClause = limit ? ` LIMIT ${limit}` : '';
      const query = `SELECT ${column}, COUNT(*) as count FROM ${tableName} GROUP BY ${column} ORDER BY ${orderBy}${limitClause}`;
      return this.db.prepare(query).all();
    };

    const totalResult = this.db.prepare(`SELECT COUNT(*) as total FROM ${tableName}`).get();
    const totalLogs = totalResult ? totalResult.total : 0;

    const getTimeBuckets = () => {
      const query = `
        SELECT BUCKET_LABEL(time_bucket) as time_label, COUNT(*) as count
        FROM ${tableName}
        WHERE time_bucket IS NOT NULL
        GROUP BY BUCKET_LABEL(time_bucket)
        ORDER BY time_label ASC
        LIMIT 100
      `;
      return this.db.prepare(query).all();
    };

    const threadLimit = limitedOptions ? 20 : null;
    const componentLimit = limitedOptions ? 20 : null;

    return {
      filenames: getOptions('filename', 'filename ASC'),
      timeBuckets: getTimeBuckets(),
      logLevels: getOptions('log_level', 'log_level ASC'),
      threads: getOptions('thread_name', 'count DESC', threadLimit),
      devices: getOptions('device_id', 'count DESC'),
      components: getOptions('component_name', 'count DESC', componentLimit),
      totalLogs: totalLogs
    };
  }
  
  /**
   * Initialize temp table for parsed log objects during scan.
   * Same columns as logs table but no id (auto-assigned on final insert).
   */
  initTempLogsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS temp_parsed_logs (
        filename TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        thread_name TEXT NOT NULL,
        device_id TEXT,
        component_name TEXT,
        log_level TEXT,
        time_bucket INTEGER,
        message TEXT NOT NULL
      )
    `);
  }

  /**
   * Prepare insert statement for temp parsed logs table
   */
  prepareInsertTemp() {
    return this.db.prepare(`
      INSERT INTO temp_parsed_logs (filename, timestamp, thread_name, device_id,
                                    component_name, log_level, time_bucket, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Create transaction for batch inserts into temp parsed logs table
   */
  createBatchInsertTemp(insertStmt) {
    return this.db.transaction((logs) => {
      for (const log of logs) {
        insertStmt.run(
          log.filename, log.timestamp, log.threadName, log.deviceId,
          log.componentName, log.logLevel, log.timeBucket, log.message
        );
      }
    });
  }

  /**
   * Insert all rows from temp table into logs table ordered by timestamp ASC.
   * Delegates sorting to SQLite for efficiency.
   */
  insertFromTempToLogs() {
    this.db.exec(`
      INSERT INTO logs (filename, timestamp, thread_name, device_id, component_name, log_level, time_bucket, message)
      SELECT filename, timestamp, thread_name, device_id, component_name, log_level, time_bucket, message
      FROM temp_parsed_logs
      ORDER BY timestamp ASC
    `);
  }

  /**
   * Drop the temp parsed logs table after scan is complete.
   */
  dropTempLogsTable() {
    this.db.exec('DROP TABLE IF EXISTS temp_parsed_logs');
  }

  /**
   * Execute a single filter step: materialize filtered rows from inputTable into outputTable.
   *
   * Step 1 (always): INSERT matching rows using full WHERE clause (including search).
   * Step 2 (if contextLines > 0): additionally INSERT surrounding context rows that
   *   are N positions before/after each match in the ordered full result set.
   * Step 3 (if contextLines > 0): additionally INSERT surrounding rows that match WHERE
   *   clause (excluding search), within ±contextLines of any row currently in outputTable.
   *
   * @param {Object} filters - Filter parameters (same shape as buildWhereClause)
   * @param {string} inputTable - Source table name (e.g. 'logs' or 'filter_step_1')
   * @param {string} outputTable - Destination temp table name (e.g. 'filter_step_1')
   * @returns {{ count: number }} Number of rows stored in the output table
   */
  executeFilterStep(filters, inputTable, outputTable) {
    if (inputTable !== outputTable) {
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
          time_bucket INTEGER,
          message TEXT NOT NULL
        )
      `);

      // Step 1: insert all matching rows (applies all filters including search)
      const { where, params } = this.buildWhereClause(filters);
      const sql = `INSERT INTO ${outputTable} SELECT * FROM ${inputTable} ${where} ORDER BY timestamp ASC`;
      this.logger(sql);
      this.db.prepare(sql).run(...params);

      // Step 2: if contextLines requested, insert surrounding rows not yet in outputTable
      if (filters.search && filters.contextLines > 0) {
        const contextLines = filters.contextLines;
        // Insert context rows that match WHERE clause (excluding search),
        // within ±contextLines of any row currently in outputTable
        const { where: whereNoSearch, params: paramsNoSearch } = this.buildWhereClause({ ...filters, search: null });
        this.db.prepare(`
          INSERT OR IGNORE INTO ${outputTable}
          SELECT * FROM ${inputTable} i
          ${whereNoSearch}
          AND EXISTS (
            SELECT 1 FROM ${outputTable} m
            WHERE i.id BETWEEN m.id - ? AND m.id + ?
          )
        `).run(...paramsNoSearch, contextLines, contextLines);

        // Step 3: Insert additional context rows (any rows within ±contextLines of any match, no WHERE filter).
        // Skipped when strictContext is true to avoid pulling in unrelated rows.
        if (!filters.strictContext) {
          this.db.prepare(`
            INSERT OR IGNORE INTO ${outputTable}
            SELECT * FROM ${inputTable} i
            WHERE EXISTS (
                SELECT 1 FROM ${outputTable} m
                WHERE i.id BETWEEN m.id - ? AND m.id + ?
              )
          `).run(contextLines, contextLines);
        }
      }
    }

    const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${outputTable}`).get();
    const count = result ? result.count : 0;
    this.logger(`executeFilterStep completed: ${count} rows in ${outputTable}`);
    return { count };
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
