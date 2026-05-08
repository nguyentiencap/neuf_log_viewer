/**
 * Log Parser Module
 * Handles parsing of individual NEUF log entries
 * Responsibility: Parse log line format and extract structured data
 * Uses service object pattern to encapsulate parsing operations
 */

/**
 * Log Parser Service
 * Encapsulates all log parsing operations
 */
class LogParserService {
  /**
   * Parse a log line to extract all structured log fields
   * Combines timestamp detection and full parsing in one function
   * @param {string} line - Raw log line
   * @param {string} filename - Source filename
   * @returns {Object|null} Complete log object or null if not a valid log entry
   */
  parseLine(line, filename) {
    // Step 1: Extract timestamp
    const timestampRegex = /^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;
    const match = line.match(timestampRegex);
    if (!match) return null;

    const timestamp = match[1];
    const timeBucket = this.getTimeBucket(timestamp);
    let remaining = line.substring(match[0].length).trim();

    // Step 2: Extract log level
    const levelMatch = remaining.match(/^\[(\w+)\]/);
    if (!levelMatch) return null;

    const logLevel = levelMatch[1];
    remaining = remaining.substring(levelMatch[0].length).trim();

    // Step 3: Skip optional class prefix
    const classMatch = remaining.match(/^(?:class\s+[\w.]+):\s+/);
    if (classMatch) {
      remaining = remaining.substring(classMatch[0].length);
    }

    // Step 4: Extract thread name
    const threadMatch = remaining.match(/^([^:]+):/);
    if (!threadMatch) return null;

    const threadName = threadMatch[1].trim();
    remaining = remaining.substring(threadMatch[0].length).trim();

    // Step 5: Extract optional device ID
    let deviceId = null;
    const deviceMatch = remaining.match(/^<([^>]+)>\s+/);
    if (deviceMatch) {
      deviceId = deviceMatch[1];
      remaining = remaining.substring(deviceMatch[0].length);
    }

    // Step 6: Extract optional component name
    let componentName = null;
    const componentMatch = remaining.match(/^\(([^)]+)\)/);
    if (componentMatch) {
      componentName = this.normalizeComponentName(componentMatch[1]);
      remaining = remaining.substring(componentMatch[0].length).trim();
    }

    // Step 7: Remaining content is message
    const message = remaining;

    return {
      filename,
      timestamp,
      timeBucket,
      logLevel,
      threadName: this.normalizeThreadName(threadName),
      deviceId: deviceId || null,
      componentName: componentName || null,
      message
    };
  }

  /**
   * Detect if a line starts a new log entry (for Phase 1 file scanning)
   * Returns timestamp and timeBucket if found, otherwise null
   * Used to detect log entry boundaries while handling multi-line entries
   * @param {string} line - Raw log line
   * @returns {{timestamp: string, timeBucket: number}|null} Timestamp info or null
   */
  detectLogLineStart(line) {
    const timestampRegex = /^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;
    const match = line.match(timestampRegex);
    if (!match) return null;

    const timestamp = match[1];
    const timeBucket = this.getTimeBucket(timestamp);
    return { timestamp, timeBucket };
  }

  /**
   * Normalize component name by extracting the package/class path (everything before the last dot)
   * Example: "com.example.package.ClassName" -> "com.example.package"
   * Example: "ClassName" -> "ClassName" (no dot, return as-is)
   * Example: "java:133" -> "java:133" (no dot, return as-is)
   */
  normalizeComponentName(componentName) {
    if (!componentName) return null;
    
    // Extract everything before the last dot, or full name if no dot
    const lastDotIndex = componentName.lastIndexOf('.');
    return lastDotIndex > 0 ? componentName.substring(0, lastDotIndex) : componentName;
  }
  
  /**
   * Normalize thread name by removing trailing numbers
   * Example: "Thread-123" -> "Thread"
   */
  normalizeThreadName(threadName) {
    if (!threadName) return 'unknown';
    return threadName.replace(/-\d+$/, '');
  }
  
  /**
   * Convert a timestamp or bucket label to Unix timestamp (seconds, UTC)
   * Accepts:
   *   - null/undefined -> null
   *   - number -> as-is
   *   - "YYYY-MM-DD HH:MM" (bucket label format from BUCKET_LABEL SQL output)
   *   - "YYYY.MM.DD HH:mm:ss" (preset filter format, second precision)
   *   - "YYYY.MM.DD HH:mm:ss.SSS" (raw log timestamp format)
   * @param {string|number|null} value - Input value
   * @returns {number|null}
   */
  getTimeBucket(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    try {
      // Supports optional seconds: "YYYY.MM.DD HH:mm" or "YYYY.MM.DD HH:mm:ss[.SSS]"
      const tsMatch = String(value).match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/);
      if (!tsMatch) return null;

      const year = parseInt(tsMatch[1], 10);
      const month = parseInt(tsMatch[2], 10) - 1;
      const day = parseInt(tsMatch[3], 10);
      const hour = parseInt(tsMatch[4], 10);
      const minute = parseInt(tsMatch[5], 10);
      const second = tsMatch[6] ? parseInt(tsMatch[6], 10) : 0;

      const date = new Date(Date.UTC(year, month, day, hour, minute, second, 0));
      return Math.floor(date.getTime() / 1000);
    } catch (error) {
      return null;
    }
  }

   /**
    * Format log entry for display/export
    * Returns object with original log data + formattedLog string
    * @param {Object} log - Log entry object from database
    * @param {string} format - 'full' | 'compact' | 'json'
    * @returns {Object} Log object with added formattedLog field
    */
   formatLogEntry(log, format = 'full') {
     const timestamp = log.timestamp;
     let formattedLog = '';

     // Compact format: hide thread/device details, truncate message
     if (format === 'compact') {
       formattedLog = `(${log.filename}) ${timestamp} [${log.log_level}]`;

       if (log.component_name) {
         formattedLog += ` (${log.component_name})`;
       }

       // Truncate message to 750 chars for non-error levels
       const isError = log.log_level && log.log_level.toUpperCase() === 'ERROR';
       const message = (!isError && log.message && log.message.length > 750)
         ? log.message.substring(0, 750) + '...'
         : log.message;

       formattedLog += ` ${message}`;
       formattedLog = formattedLog.trim();
     } else {
       // Full format (default): build complete log line with all details
       formattedLog = `(${log.filename}) ${timestamp} [${log.log_level}] ${log.thread_name}:`;

       if (log.device_id) {
         formattedLog += ` <${log.device_id}>`;
       }

       if (log.component_name) {
         formattedLog += ` (${log.component_name})`;
       }

       formattedLog += ` ${log.message}`;
       formattedLog = formattedLog.trim();
     }

     // Return object with original log data + formatted string
     return {
       id: log.id,
       filename: log.filename,
       timestamp: log.timestamp,
       thread_name: log.thread_name,
       device_id: log.device_id,
       component_name: log.component_name,
       log_level: log.log_level,
       time_bucket: log.time_bucket,
       message: log.message,
       formattedLog: formattedLog
     };
   }
}

// Export singleton instance for stateless service
const logParserService = new LogParserService();

module.exports = {
  LogParserService,
  logParserService  // Singleton instance
};
