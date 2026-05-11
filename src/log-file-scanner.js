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
   * Scan all log files, parse each line directly to structured log objects,
   * and deliver them in batches via callback. No in-memory accumulation.
   * Sorting is delegated to SQLite when inserting from temp table into logs.
   * @param {string} logFolderPath - Path to log folder
   * @param {Function} onBatchReady - Callback receiving each batch of parsed log objects
   * @param {string[]|null} precomputedFiles - Optional pre-computed file list (avoids double scan)
   * @returns {Promise<number>} Total number of parsed log entries
   */
  async parseFiles(logFolderPath, onBatchReady, precomputedFiles = null) {
    this.logger('🔍 Scanning log folder:', logFolderPath);

    const logFiles = precomputedFiles || this.findNeufLogFiles(logFolderPath);

    if (logFiles.length === 0) {
      this.logger('❌ No NEUF-*.log.* files found.');
      return 0;
    }

    this.logger(`📁 Found ${logFiles.length} log file(s):`);
    logFiles.forEach(file => this.logger(`  - ${path.relative(logFolderPath, file)}`));
    this.logger('');

    const batchSize = 1000;
    let batch = [];
    let totalLines = 0;
    let totalEntries = 0;

    for (const file of logFiles) {
      const filename = path.basename(file);
      this.logger(`📄 Processing: ${path.relative(logFolderPath, file)}...`);

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

        const lineStart = this.parserService.detectLogLineStart(line);

        if (lineStart) {
          // Flush previous entry
          if (currentEntry) {
            const logObj = this.parserService.parseLine(
              currentEntry.timestamp + ' ' + currentEntry.rawContent,
              currentEntry.filename
            );
            if (logObj) {
              batch.push(logObj);
              totalEntries++;
              fileEntries++;

              if (batch.length >= batchSize) {
                onBatchReady(batch);
                batch = [];
              }
            }
          }

          const rawContent = line.substring(lineStart.timestamp.length).trim();
          currentEntry = { filename, timestamp: lineStart.timestamp, rawContent };
        } else {
          // Continuation line - append to current entry's rawContent
          if (currentEntry) {
            currentEntry.rawContent += '\n' + line;
          }
        }
      }

      // Flush last entry for this file
      if (currentEntry) {
        const logObj = this.parserService.parseLine(
          currentEntry.timestamp + ' ' + currentEntry.rawContent,
          currentEntry.filename
        );
        if (logObj) {
          batch.push(logObj);
          totalEntries++;
          fileEntries++;
        }
      }

      this.logger(`  ✅ ${fileLines} lines / ${fileEntries} entries.`);
    }

    // Flush remaining batch
    if (batch.length > 0) {
      onBatchReady(batch);
    }

    this.logger('');
    this.logger(`✅ Scan complete! Total lines: ${totalLines.toLocaleString()}, entries: ${totalEntries.toLocaleString()}`);
    this.logger('');

    return totalEntries;
  }

}
// Note: parseAndIndexLogFiles was removed -- it was unused dead code (no callers in the repository).

module.exports = {
  LogFileScannerService
};
