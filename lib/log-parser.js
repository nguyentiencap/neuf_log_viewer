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
   * Parse a single log entry line
   * Format: YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: <DeviceID> (ComponentName) Message
   */
  parseLogEntry(line) {
    const timestampRegex = /^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/;
    const match = line.match(timestampRegex);
    
    if (!match) return null;
    
    const timestamp = match[1];  // Giữ nguyên format YYYY.MM.DD HH:mm:ss.SSS
    let remaining = line.substring(timestamp.length).trim();
    
    const levelMatch = remaining.match(/^\[(\w+)\]/);
    if (!levelMatch) return null;
    
    const logLevel = levelMatch[1];
    remaining = remaining.substring(levelMatch[0].length).trim();
    
    let className = null;
    const classMatch = remaining.match(/^(class\s+[\w.]+):\s+/);
    if (classMatch) {
      className = classMatch[1];
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
    
    return {
      timestamp,  // YYYY.MM.DD HH:mm:ss.SSS - giữ nguyên format gốc
      logLevel,
      className,
      threadName,
      deviceId,
      componentName,
      message: remaining,
      rawLine: line
    };
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
   * Calculate time bucket from timestamp (30-minute intervals)
   * Used for grouping logs by time ranges
   * Format: YYYY.MM.DD HH:mm:ss.SSS -> YYYY-MM-DD HH:00 or YYYY-MM-DD HH:30
   */
  getTimeBucket(timestamp) {
    try {
      // timestamp format: YYYY.MM.DD HH:mm:ss.SSS
      const match = timestamp.match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})/);
      if (!match) return 'unknown';
      
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const hour = match[4];
      const minute = parseInt(match[5], 10);
      
      // Round to 30-minute intervals (0 or 30)
      const roundedMinute = minute < 30 ? '00' : '30';
      const timeBucket = `${year}-${month}-${day} ${hour}:${roundedMinute}`;
      
      return timeBucket;
    } catch (error) {
      return 'unknown';
    }
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
