/**
 * Log File Scanner Module
 * Handles scanning log directories and reading log files
 * Responsibility: File system operations ONLY - NO DATABASE CODE
 * Uses service object pattern to encapsulate file scanning operations
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Log File Scanner Service
 * Encapsulates all file scanning and parsing operations
 */
class LogFileScannerService {
  constructor(parserService, logger = console.log) {
    this.parserService = parserService;
    this.logger = logger;
  }
  
  /**
   * Find all NEUF log files in a directory
   * Scans only the top level (non-recursive)
   */
  findNeufLogFiles(directory) {
    const files = [];
    
    const scan = (dir) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isFile()) {
            if (/^(NEUF|neuf)-.*\.log/i.test(entry.name)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        this.logger(`  Warning: Cannot read directory ${dir}: ${error.message}`);
      }
    };
    
    scan(directory);
    return files.sort();
  }
  
  /**
   * Phase 1: Scan all log files and collect raw entries {filename, timestamp, rawContent}.
   * Handles multi-line log entries by appending continuation lines to rawContent.
   * Data is delivered via onBatchReady for storage in a temp table.
   * @param {string} logFolderPath - Path to log folder
   * @param {Function} onBatchReady - Callback when a batch of raw entries is ready (receives array of {filename, timestamp, rawContent})
   * @returns {Promise<number>} Total number of raw entries collected
   */
  async parsePhase1Files(logFolderPath, onBatchReady) {
    this.logger('🔍 Phase 1: Scanning log folder:', logFolderPath);

    const logFiles = this.findNeufLogFiles(logFolderPath);

    if (logFiles.length === 0) {
      this.logger('❌ No NEUF-*.log.* files found.');
      return 0;
    }

    this.logger(`📁 Found ${logFiles.length} log file(s):`);
    logFiles.forEach(file => this.logger(`  - ${path.relative(logFolderPath, file)}`));
    this.logger('');

    let totalLines = 0;
    let totalEntries = 0;
    const batchSize = 1000;
    let batch = [];

    for (const file of logFiles) {
      const filename = path.basename(file);
      this.logger(`📄 Phase 1 processing: ${path.relative(logFolderPath, file)}...`);

      const fileStream = fs.createReadStream(file, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      let currentEntry = null;
      let fileLines = 0;
      let fileEntries = 0;

      for await (const line of rl) {
        totalLines++;
        fileLines++;

        const phase1 = this.parserService.parsePhase1Line(line);

        if (phase1) {
          // Flush previous entry
          if (currentEntry) {
            batch.push(currentEntry);
            totalEntries++;
            fileEntries++;

            if (batch.length >= batchSize) {
              onBatchReady(batch);
              batch = [];
              process.stdout.write(`\r  ✅ Phase 1: ${fileLines} lines/${fileEntries} entries. Total ${totalLines.toLocaleString()} lines/${totalEntries} entries.`);
            }
          }

          currentEntry = { filename, timestamp: phase1.timestamp, timeBucket: phase1.timeBucket, rawContent: phase1.rawContent };
        } else {
          // Continuation line - append to current entry's rawContent
          if (currentEntry) {
            currentEntry.rawContent += '\n' + line;
          }
        }
      }

      // Flush last entry for this file
      if (currentEntry) {
        batch.push(currentEntry);
        totalEntries++;
        fileEntries++;
      }

      this.logger(`\r  ✅ Phase 1: ${fileLines} lines/${fileEntries} entries. Total ${totalLines.toLocaleString()} lines/${totalEntries} entries.`);
    }

    // Flush remaining batch
    if (batch.length > 0) {
      onBatchReady(batch);
    }

    this.logger('');
    this.logger('✅ Phase 1 complete!');
    this.logger(`   Total lines: ${totalLines.toLocaleString()}`);
    this.logger(`   Raw entries: ${totalEntries.toLocaleString()}`);
    this.logger('');

    return totalEntries;
  }

  /**
   * Phase 2: Read raw entries from database, parse to structured log objects, and insert into logs table.
   * @param {string|number|null} value
   * @returns {number|null}
   */
  getTimeBucket(value) {
    return this.parserService.getTimeBucket(value);
  }

  /**
   * Phase 2: Read raw entries from database, parse to structured log objects, and insert into logs table.
   * @param {DatabaseService} databaseService
   * @returns {number} Total parsed log entries
   */
  parsePhase2Files(databaseService) {
    this.logger('📊 Phase 2: Parsing structured fields from raw entries...');

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
          timeBucket: raw.time_bucket,
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

    return totalLogs;
  }

}
// Note: parseAndIndexLogFiles was removed -- it was unused dead code (no callers in the repository).

module.exports = {
  LogFileScannerService
};
