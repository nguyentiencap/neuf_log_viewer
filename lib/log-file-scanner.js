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
   * Parse and index all log files
   * Processes files in batches for better performance
   * @param {string} logFolderPath - Path to log folder
   * @param {Function} onBatchReady - Callback when a batch of logs is ready (receives array of log objects)
   */
  async parseAndIndexLogFiles(logFolderPath, onBatchReady) {
    this.logger('🔍 Scanning log folder:', logFolderPath);
    
    const logFiles = this.findNeufLogFiles(logFolderPath);
    
    if (logFiles.length === 0) {
      this.logger('❌ No NEUF-*.log.* files found.');
      return 0;
    }
    
    this.logger(`📁 Found ${logFiles.length} log file(s):`);
    logFiles.forEach(file => this.logger(`  - ${path.relative(logFolderPath, file)}`));
    this.logger('');
    
    let totalLines = 0;
    let parsedLines = 0;
    const batchSize = 1000;
    let batch = [];
    
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
      let fileLogs = 0;
      
      for await (const line of rl) {
        totalLines++;
        fileLines++;
        
        const parsed = this.parserService.parseLogEntry(line);
        
        if (parsed) {
          // Save previous entry if exists
          if (currentEntry) {
            // Timestamp giữ nguyên format gốc YYYY.MM.DD HH:mm:ss.SSS - không cần convert
            batch.push({
              filename: filename,
              timestamp: currentEntry.timestamp,  // Giữ nguyên format gốc
              threadName: this.parserService.normalizeThreadName(currentEntry.threadName),
              deviceId: currentEntry.deviceId || null,
              componentName: currentEntry.componentName || null,
              logLevel: currentEntry.logLevel || 'INFO',
              message: currentEntry.message
            });
            parsedLines++;
            fileLogs++;
            
            if (batch.length >= batchSize) {
              onBatchReady(batch);
              batch = [];
              process.stdout.write(`\r  ✅ Parsed: ${fileLines} lines/${fileLogs} logs. Totals ${totalLines.toLocaleString()} lines/${parsedLines} logs.`);
            }
          }
          
          currentEntry = parsed;
        } else {
          // Multi-line log entry - append to current entry
          if (currentEntry) {
            currentEntry.message += '\n' + line;
          }
        }
      }
      
      // Save last entry
      if (currentEntry) {
        // Timestamp giữ nguyên format gốc YYYY.MM.DD HH:mm:ss.SSS - không cần convert
        batch.push({
          filename: filename,
          timestamp: currentEntry.timestamp,  // Giữ nguyên format gốc
          threadName: this.parserService.normalizeThreadName(currentEntry.threadName),
          deviceId: currentEntry.deviceId || null,
          componentName: currentEntry.componentName || null,
          logLevel: currentEntry.logLevel || 'INFO',
          message: currentEntry.message
        });
        parsedLines++;
        fileLogs++;
      }
      
      this.logger(`\r  ✅ Parsed: ${fileLines} lines/${fileLogs} logs. Totals ${totalLines.toLocaleString()} lines/${parsedLines} logs.`);
    }
    
    // Insert remaining batch
    if (batch.length > 0) {
      onBatchReady(batch);
    }
    
    this.logger('');
    this.logger('✅ Indexing complete!');
    this.logger(`   Total lines: ${totalLines.toLocaleString()}`);
    this.logger(`   Parsed logs: ${parsedLines.toLocaleString()}`);
    this.logger('');
    
    return parsedLines;
  }
}

module.exports = {
  LogFileScannerService
};
