/**
 * Renderer Module
 * Handles HTML rendering for the log viewer interface
 */

const { formatLogEntry } = require('./log-parser');
const { searchWithContextLines, getFilterOptions } = require('./db-operations');

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Highlight search term in text with yellow background
 */
function highlightSearchTerm(text, searchTerm) {
  if (!searchTerm || !text) return escapeHtml(text);
  
  const escapedText = escapeHtml(text);
  const escapedSearchTerm = escapeHtml(searchTerm);
  
  // Case-insensitive search and replace
  const regex = new RegExp(`(${escapedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escapedText.replace(regex, '<mark class="search-highlight">$1</mark>');
}

/**
 * Build export URL with proper handling of array parameters
 */
function buildExportUrl(filters) {
  const params = new URLSearchParams();
  
  // Handle each filter field
  Object.keys(filters).forEach(key => {
    const value = filters[key];
    
    if (Array.isArray(value)) {
      // Add each array element as a separate parameter
      value.forEach(item => {
        params.append(key, item);
      });
    } else if (value !== null && value !== undefined && value !== '') {
      // Add single value
      params.append(key, value);
    }
  });
  
  return params.toString();
}

/**
 * Render checkboxes for filter options
 */
function renderCheckboxes(options, fieldName, selectedValues, showModeToggle = false, isExcludeMode = false) {
  const allChecked = options.length > 0 && options.every(opt => {
    const value = opt.filename || opt.time_bucket || opt.log_level || opt.thread_name || opt.device_id || opt.component_name;
    return selectedValues.includes(value);
  });
  
  const selectAllId = `selectAll_${fieldName}`;
  let html = '';
  
  // Mode toggle and select all on same line
  if (showModeToggle) {
    html += `
      <div class="filter-controls">
        <label class="toggle-switch-inline">
          <input type="checkbox" name="${fieldName}Exclude" value="true" ${isExcludeMode ? 'checked' : ''} onchange="updateModeBadge('${fieldName}', this.checked)">
          <span class="toggle-slider-inline"></span>
          <span class="toggle-label-inline">Exclude</span>
        </label>
        <div class="select-all-inline">
          <input type="checkbox" id="${selectAllId}" ${allChecked ? 'checked' : ''} onchange="toggleAll(this, '${fieldName}')">
          <label for="${selectAllId}">Select All</label>
        </div>
      </div>
      <div class="mode-note-inline" id="${fieldName}ModeNote">
        ${isExcludeMode ? '⚠️ Filter all items <strong>exclude</strong>' : 'ℹ️ Filter only items <strong>includes</strong>'}
      </div>
    `;
  } else {
    html += `
      <div class="checkbox-item select-all">
        <input type="checkbox" id="${selectAllId}" ${allChecked ? 'checked' : ''} onchange="toggleAll(this, '${fieldName}')">
        <label for="${selectAllId}"><strong>Select All / Deselect All</strong></label>
      </div>
      <div class="checkbox-divider"></div>
    `;
  }
  
  html += options.map(opt => {
    const value = opt.filename || opt.time_bucket || opt.log_level || opt.thread_name || opt.device_id || opt.component_name;
    const count = opt.count;
    const checked = selectedValues.includes(value) ? ' checked' : '';
    const id = `${fieldName}_${value.replace(/[^a-zA-Z0-9]/g, '_')}`;
    return `
      <div class="checkbox-item">
        <input type="checkbox" name="${fieldName}" value="${escapeHtml(value)}" id="${id}"${checked} class="${fieldName}-checkbox" onchange="updateSelectAll('${fieldName}')">
        <label for="${id}">${escapeHtml(value)} <span class="count">(${count.toLocaleString()})</span></label>
      </div>
    `;
  }).join('');
  
  return html;
}

/**
 * Render log entries
 */
function renderLogs(logs, searchTerm) {
  if (logs.length === 0) {
    return '<div class="loading">No logs found</div>';
  }
  
  return logs.map(log => {
    const logLine = formatLogEntry(log);
    // Highlight search term if present
    const displayLine = searchTerm ? highlightSearchTerm(logLine, searchTerm) : escapeHtml(logLine);
    return `<div class="log-entry ${log.log_level}">${displayLine}</div>`;
  }).join('');
}

/**
 * Render the complete HTML page
 */
function renderPage(db, filters = {}, page = 1) {
  const pageSize = 1000;
  
  // Parse multi-select filters (arrays)
  const selectedTimeBuckets = Array.isArray(filters.timeBucket) ? filters.timeBucket : (filters.timeBucket ? [filters.timeBucket] : []);
  const selectedLogLevels = Array.isArray(filters.logLevel) ? filters.logLevel : (filters.logLevel ? [filters.logLevel] : []);
  const selectedThreads = Array.isArray(filters.thread) ? filters.thread : (filters.thread ? [filters.thread] : []);
  const selectedDevices = Array.isArray(filters.device) ? filters.device : (filters.device ? [filters.device] : []);
  const selectedComponents = Array.isArray(filters.component) ? filters.component : (filters.component ? [filters.component] : []);
  const selectedFilenames = Array.isArray(filters.filename) ? filters.filename : (filters.filename ? [filters.filename] : []);
  
  // Get filter options and data
  const filterOptions = getFilterOptions(db, filters);
  const { logs, total, totalPages } = searchWithContextLines(db, filters, { page, pageSize, orderBy: 'timestamp ASC' });
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NEUF Log Viewer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: #f5f5f5;
      color: #333;
    }
    
    #log-viewer {
      flex: 1;
      display: flex;
      flex-direction: column;
      order: 1;
      min-width: 0;
    }
    
    #log-container {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      background: #fff;
    }
    
    .log-entry {
      padding: 4px 8px;
      margin-bottom: 1px;
      border-radius: 2px;
      line-height: 1.4;
      color: #333;
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    
    .log-entry:hover { background: #e9ecef; }
    
    .log-entry.ERROR {
      background: #ffe6e6 !important;
      color: #c62828 !important;
      border-color: #ef5350 !important;
      font-weight: 500;
    }
    
    .log-entry.WARN {
      background: #fff8e1 !important;
      color: #f57c00 !important;
      border-color: #ffb74d !important;
    }
    
    .log-meta {
      font-size: 11px;
      margin-bottom: 4px;
      opacity: 0.9;
    }
    
    .log-timestamp { color: #0066cc; margin-right: 10px; }
    .log-level { font-weight: bold; margin-right: 10px; }
    .log-thread { color: #6f42c1; margin-right: 10px; }
    .log-component { color: #007bff; margin-right: 10px; }
    .log-device { color: #e83e8c; margin-right: 10px; }
    .log-message { color: #333; margin-top: 2px; }
    
    #pagination {
      padding: 15px;
      background: #fff;
      border-top: 1px solid #dee2e6;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #333;
    }
    
    #pagination button, #pagination a {
      padding: 8px 16px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 12px;
      text-decoration: none;
      display: inline-block;
    }
    
    #pagination button:disabled, #pagination a.disabled {
      background: #ccc;
      cursor: not-allowed;
      opacity: 0.5;
      pointer-events: none;
    }
    
    #pagination button:hover:not(:disabled), #pagination a:hover:not(.disabled) {
      background: #0056b3;
    }
    
    .page-info { font-size: 12px; }
    
    .jump-to-page {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .jump-to-page input {
      width: 60px;
      padding: 6px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 12px;
      text-align: center;
    }
    
    .jump-to-page button {
      padding: 6px 12px;
      font-size: 12px;
    }
    
    #filter-panel {
      width: 500px;
      min-width: 500px;
      flex-shrink: 0;
      height: 100vh;
      background: #fff;
      border-left: 1px solid #dee2e6;
      padding: 15px;
      overflow-y: auto;
      order: 2;
    }
    
    #filter-panel h3 {
      margin-bottom: 15px;
      color: #007bff;
      font-size: 16px;
      border-bottom: 2px solid #007bff;
      padding-bottom: 8px;
    }
    
    .filter-group {
      margin-bottom: 15px;
      border: 1px solid #dee2e6;
      border-radius: 4px;
      background: #f8f9fa;
    }
    
    .filter-header {
      padding: 10px;
      background: #e9ecef;
      cursor: pointer;
      user-select: none;
      font-weight: bold;
      font-size: 13px;
      color: #495057;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 3px 3px 0 0;
    }
    
    .filter-header:hover {
      background: #dee2e6;
    }
    
    .filter-header .toggle {
      font-size: 10px;
      transition: transform 0.2s;
    }
    
    .filter-header .toggle.collapsed {
      transform: rotate(-90deg);
    }
    
    .filter-content {
      padding: 10px;
      max-height: 200px;
      overflow-y: auto;
    }
    
    .filter-content.collapsed {
      display: none;
    }
    
    .checkbox-item {
      display: flex;
      align-items: center;
      padding: 4px 0;
      font-size: 12px;
    }
    
    .checkbox-item.select-all {
      padding: 8px 0;
      margin-bottom: 8px;
      border-bottom: 2px solid #007bff;
    }
    
    .checkbox-item.select-all label {
      color: #007bff;
    }
    
    .checkbox-divider {
      height: 1px;
      background: #dee2e6;
      margin: 8px 0;
    }
    
    .checkbox-item input[type="checkbox"] {
      margin-right: 8px;
      cursor: pointer;
    }
    
    .checkbox-item label {
      cursor: pointer;
      flex: 1;
      color: #333;
    }
    
    .checkbox-item .count {
      color: #6c757d;
      font-size: 11px;
      margin-left: 5px;
    }
    
    #search-input {
      width: 100%;
      padding: 8px;
      border: 1px solid #ced4da;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      background: #fff;
      color: #333;
    }
    
    .search-group {
      margin-bottom: 15px;
    }
    
    .search-group label {
      display: block;
      margin-bottom: 6px;
      font-weight: bold;
      color: #495057;
      font-size: 12px;
    }
    
    .info-note {
      background: #e7f3ff;
      border-left: 4px solid #007bff;
      padding: 12px;
      margin-bottom: 15px;
      border-radius: 4px;
      font-size: 12px;
      color: #004085;
      line-height: 1.5;
    }
    
    .info-note strong {
      color: #007bff;
    }
    
    .mode-badge {
      display: inline-block;
      color: white;
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 6px;
      font-weight: bold;
      vertical-align: middle;
      background: #28a745;
    }
    
    .filter-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      margin-bottom: 8px;
      border-bottom: 1px solid #dee2e6;
    }
    
    .toggle-switch-inline {
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    
    .toggle-switch-inline input[type="checkbox"] {
      position: relative;
      width: 36px;
      height: 18px;
      -webkit-appearance: none;
      appearance: none;
      background: #28a745;
      outline: none;
      border-radius: 18px;
      cursor: pointer;
      transition: 0.3s;
      margin-right: 8px;
    }
    
    .toggle-switch-inline input[type="checkbox"]:checked {
      background: #dc3545;
    }
    
    .toggle-switch-inline input[type="checkbox"]:before {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      top: 2px;
      left: 2px;
      background: #fff;
      transition: 0.3s;
    }
    
    .toggle-switch-inline input[type="checkbox"]:checked:before {
      left: 20px;
    }
    
    .toggle-label-inline {
      font-size: 11px;
      font-weight: bold;
      color: #495057;
    }
    
    .select-all-inline {
      display: flex;
      align-items: center;
      font-size: 11px;
    }
    
    .select-all-inline input[type="checkbox"] {
      margin-right: 5px;
      cursor: pointer;
    }
    
    .select-all-inline label {
      cursor: pointer;
      font-weight: bold;
      color: #495057;
    }
    
    .mode-note-inline {
      background: #e7f3ff;
      border-left: 3px solid #007bff;
      padding: 6px 8px;
      margin-bottom: 8px;
      border-radius: 3px;
      font-size: 10px;
      color: #004085;
    }
    
    .mode-note-inline strong {
      font-weight: bold;
    }
    
    button[type="submit"] {
      width: 100%;
      padding: 12px;
      background: #28a745;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 10px;
    }
    
    button[type="submit"]:hover {
      background: #218838;
    }
    
    button[type="button"] {
      width: 100%;
      padding: 10px;
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      margin-bottom: 10px;
    }
    
    button[type="button"]:hover {
      background: #5a6268;
    }
    
    .export-button {
      width: 100%;
      padding: 12px;
      background: #17a2b8;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 10px;
      text-decoration: none;
      display: block;
      text-align: center;
    }
    
    .export-button:hover {
      background: #138496;
    }
    
    .loading {
      text-align: center;
      padding: 20px;
      color: #6c757d;
    }
    
    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    
    ::-webkit-scrollbar-track {
      background: #f1f1f1;
    }
    
    ::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 5px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
    
    .search-highlight {
      background-color: #ffeb3b;
      color: #000;
      font-weight: bold;
      padding: 2px 0;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div id="log-viewer">
    <div id="log-container">
      ${renderLogs(logs, filters.search)}
    </div>
    <div id="pagination">
      ${page > 1 ? `<a href="/?page=${page - 1}&${buildExportUrl(filters)}">← Previous</a>` : '<a class="disabled">← Previous</a>'}
      <span class="page-info">
        Page ${page}/${totalPages} | Log from ${((page - 1) * pageSize + 1).toLocaleString()} to ${Math.min(page * pageSize, total).toLocaleString()}/${total.toLocaleString()} logs
      </span>
      <div class="jump-to-page">
        <span>Jump to:</span>
        <input type="number" id="jumpPageInput" min="1" max="${totalPages}" value="${page}" />
        <button onclick="jumpToPage()">Go</button>
      </div>
      ${page < totalPages ? `<a href="/?page=${page + 1}&${buildExportUrl(filters)}">Next →</a>` : '<a class="disabled">Next →</a>'}
    </div>
    
    <script>
      function jumpToPage() {
        const pageInput = document.getElementById('jumpPageInput');
        const targetPage = parseInt(pageInput.value);
        const maxPage = ${totalPages};
        
        if (targetPage >= 1 && targetPage <= maxPage) {
          const params = new URLSearchParams(window.location.search);
          params.set('page', targetPage);
          window.location.href = '/?' + params.toString();
        } else {
          alert('Please enter a valid page number between 1 and ' + maxPage);
        }
      }
      
      // Allow Enter key to jump to page
      document.getElementById('jumpPageInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          jumpToPage();
        }
      });
    </script>
  </div>
  
  <div id="filter-panel">
    <h3>🔍 Filters</h3>
    
    <form method="GET" action="/">
      <button type="submit">Apply Filters</button>
      <a href="/export?${buildExportUrl(filters)}" class="export-button" target="_blank">📤 Export Filtered Logs</a>
      <button type="button" onclick="window.location.href='/'">Clear All Filters</button>
      
      ${!filterOptions.showAdvancedFilters ? `
      <div class="info-note">
        ℹ️ <strong>Note:</strong> Thread Name and Component Name filters are hidden because there are only ${filterOptions.totalLogs} log entries. These filters will appear when you have more than 200 entries.
      </div>
      ` : ''}
      
      <div class="search-group">
        <label>🔎 Search Message</label>
        <input type="text" name="search" id="search-input" placeholder="Enter search text..." value="${escapeHtml(filters.search || '')}">
        <div style="margin-top: 8px;">
          <label style="font-size: 11px; font-weight: normal; color: #6c757d;">
            Context Lines (before/after):
            <input type="number" name="contextLines" min="0" max="50" value="${filters.contextLines || 0}"
                   style="width: 60px; padding: 4px; margin-left: 5px; border: 1px solid #ced4da; border-radius: 3px; font-size: 11px;">
          </label>
          <div style="font-size: 10px; color: #6c757d; margin-top: 4px; line-height: 1.4;">
            💡 Set to 0 for exact matches only. Set to N to include N lines before and after each match.
          </div>
        </div>
      </div>
      
      <div class="filter-group">
        <div class="filter-header" onclick="toggleFilter(this)">
          <span>📄 Log File <span class="mode-badge" id="filenameModeBadge">${filters.filenameExclude ? 'EXCLUDE' : 'INCLUDE'}</span></span>
          <span class="toggle">▼</span>
        </div>
        <div class="filter-content">
          ${renderCheckboxes(filterOptions.filenames, 'filename', selectedFilenames, true, filters.filenameExclude)}
        </div>
      </div>
      
      <div class="filter-group">
        <div class="filter-header" onclick="toggleFilter(this)">
          <span>⏰ Time (1-hour intervals)</span>
          <span class="toggle">▼</span>
        </div>
        <div class="filter-content">
          ${renderCheckboxes(filterOptions.timeBuckets, 'timeBucket', selectedTimeBuckets)}
        </div>
      </div>
      
      <div class="filter-group">
        <div class="filter-header" onclick="toggleFilter(this)">
          <span>📊 Log Level</span>
          <span class="toggle">▼</span>
        </div>
        <div class="filter-content">
          ${renderCheckboxes(filterOptions.logLevels, 'logLevel', selectedLogLevels)}
        </div>
      </div>
      
      <div class="filter-group">
        <div class="filter-header" onclick="toggleFilter(this)">
          <span>📱 Device ID <span class="mode-badge" id="deviceModeBadge">${filters.deviceExclude ? 'EXCLUDE' : 'INCLUDE'}</span></span>
          <span class="toggle">▼</span>
        </div>
        <div class="filter-content">
          ${renderCheckboxes(filterOptions.devices, 'device', selectedDevices, true, filters.deviceExclude)}
        </div>
      </div>
      
      ${filterOptions.showAdvancedFilters ? `
      <div class="filter-group">
        <div class="filter-header" onclick="toggleFilter(this)">
          <span>🔧 Component Name <span class="mode-badge" id="componentModeBadge">${filters.componentExclude ? 'EXCLUDE' : 'INCLUDE'}</span></span>
          <span class="toggle">▼</span>
        </div>
        <div class="filter-content">
          ${renderCheckboxes(filterOptions.components, 'component', selectedComponents, true, filters.componentExclude)}
        </div>
      </div>
      
      <div class="filter-group">
        <div class="filter-header" onclick="toggleFilter(this)">
          <span>🧵 Thread Name <span class="mode-badge" id="threadModeBadge">${filters.threadExclude ? 'EXCLUDE' : 'INCLUDE'}</span></span>
          <span class="toggle">▼</span>
        </div>
        <div class="filter-content">
          ${renderCheckboxes(filterOptions.threads, 'thread', selectedThreads, true, filters.threadExclude)}
        </div>
      </div>
      ` : ''}
    </form>
  </div>
  
  <script>
    function toggleFilter(header) {
      const content = header.nextElementSibling;
      const toggle = header.querySelector('.toggle');
      content.classList.toggle('collapsed');
      toggle.classList.toggle('collapsed');
    }
    
    function toggleAll(selectAllCheckbox, fieldName) {
      const checkboxes = document.querySelectorAll('.' + fieldName + '-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
      });
    }
    
    function updateSelectAll(fieldName) {
      const checkboxes = document.querySelectorAll('.' + fieldName + '-checkbox');
      const selectAllCheckbox = document.getElementById('selectAll_' + fieldName);
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      selectAllCheckbox.checked = allChecked;
    }
    
    function updateModeBadge(filterType, isExclude) {
      const badge = document.getElementById(filterType + 'ModeBadge');
      const note = document.getElementById(filterType + 'ModeNote');
      
      if (badge) {
        if (isExclude) {
          badge.textContent = 'EXCLUDE';
          badge.style.background = '#dc3545';
        } else {
          badge.textContent = 'INCLUDE';
          badge.style.background = '#28a745';
        }
      }
      
      if (note) {
        if (isExclude) {
          note.innerHTML = '⚠️ Filter all items <strong>exclude</strong>';
          note.style.background = '#fff3cd';
          note.style.borderLeftColor = '#ffc107';
          note.style.color = '#856404';
        } else {
          note.innerHTML = 'ℹ️ Filter only items <strong>includes</strong>';
          note.style.background = '#e7f3ff';
          note.style.borderLeftColor = '#007bff';
          note.style.color = '#004085';
        }
      }
    }
  </script>
</body>
</html>
  `;
}

module.exports = {
  escapeHtml,
  highlightSearchTerm,
  buildExportUrl,
  renderCheckboxes,
  renderLogs,
  renderPage
};
