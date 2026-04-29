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
   * Phase 1: Detect if a line starts a new log entry (timestamp boundary detection)
   * Only extracts timestamp; the rest of the line is kept as rawContent for Phase 2.
   * Handles multi-line log entries by returning null for continuation lines.
   * @param {string} line - Raw log line
   * @returns {{timestamp: string, rawContent: string}|null} Phase 1 entry or null if not a new log entry
   */
  parsePhase1Line(line) {
    const timestampRegex = /^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;
    const match = line.match(timestampRegex);
    if (!match) return null;

    const timestamp = match[1];
    const rawContent = line.substring(timestamp.length).trim();
    const timeBucket = this.getTimeBucket(timestamp);
    return { timestamp, rawContent, timeBucket };
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
   *   - "YYYY.MM.DD HH:mm:ss.SSS" (raw log timestamp format)
   * @param {string|number|null} value - Input value
   * @returns {number|null}
   */
  getTimeBucket(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    try {
      // Log timestamp format: "YYYY.MM.DD HH:mm:ss.SSS"
      const tsMatch = String(value).match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})/);
      if (!tsMatch) return null;

      const year = parseInt(tsMatch[1], 10);
      const month = parseInt(tsMatch[2], 10) - 1;
      const day = parseInt(tsMatch[3], 10);
      const hour = parseInt(tsMatch[4], 10);
      const minute = parseInt(tsMatch[5], 10);

      const date = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
      return Math.floor(date.getTime() / 1000);
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Phase 2: Parse a raw Phase 1 entry to extract all structured log fields.
   * Input comes from the temp table (filename, timestamp, rawContent where rawContent may be multi-line).
   * @param {{filename: string, timestamp: string, timeBucket: number, rawContent: string}} rawEntry - Phase 1 entry
   * @returns {Object|null} Complete log object or null if parsing fails
   */
  parsePhase2Entry(rawEntry) {
    const { filename, timestamp, timeBucket, rawContent } = rawEntry;

    // Split rawContent: first line contains structured fields; rest are continuation lines
    const newlineIndex = rawContent.indexOf('\n');
    const firstLine = newlineIndex >= 0 ? rawContent.substring(0, newlineIndex) : rawContent;
    const continuationLines = newlineIndex >= 0 ? rawContent.substring(newlineIndex + 1) : '';

    let remaining = firstLine;

    const levelMatch = remaining.match(/^\[(\w+)\]/);
    if (!levelMatch) return null;

    const logLevel = levelMatch[1];
    remaining = remaining.substring(levelMatch[0].length).trim();

    const classMatch = remaining.match(/^(?:class\s+[\w.]+):\s+/);
    if (classMatch) {
      remaining = remaining.substring(classMatch[0].length);
    }

    const threadMatch = remaining.match(/^([^:]+):/);
    if (!threadMatch) return null;

    const threadName = threadMatch[1].trim();
    remaining = remaining.substring(threadMatch[0].length).trim();

    let deviceId = null;
    const deviceMatch = remaining.match(/^<([^>]+)>\s+/);
    if (deviceMatch) {
      deviceId = deviceMatch[1];
      remaining = remaining.substring(deviceMatch[0].length);
    }

    let componentName = null;
    const componentMatch = remaining.match(/^\(([^)]+)\)/);
    if (componentMatch) {
      componentName = this.normalizeComponentName(componentMatch[1]);
      remaining = remaining.substring(componentMatch[0].length).trim();
    }

    // Message is the remaining structured part plus any continuation lines
    let message = remaining;
    if (continuationLines) {
      message += '\n' + continuationLines;
    }

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
   * Format log entry for display/export
   * Used for exporting filtered logs
   */
  formatLogEntry(log) {
    // Timestamp đã ở format gốc YYYY.MM.DD HH:mm:ss.SSS - không cần convert
    const timestamp = log.timestamp;
    
    // Build log line in original format with filename prefix
    let logLine = `(${log.filename}) ${timestamp} [${log.log_level}] ${log.thread_name}:`;
    
    if (log.device_id) {
      logLine += ` <${log.device_id}>`;
    }
    
    if (log.component_name) {
      logLine += ` (${log.component_name})`;
    }
    
    logLine += ` ${log.message}`;
    
    return logLine.trim();
  }
}

// Export singleton instance for stateless service
const logParserService = new LogParserService();

module.exports = {
  LogParserService,
  logParserService  // Singleton instance
};
