/**
 * NEUF Log Viewer - Client-Side Application (SSR-Style)
 * Pure JavaScript with jQuery for API calls
 */

(function() {
  'use strict';

  // Application state
  const state = {
    currentPage: 1,
    pageSize: 1000,
    totalPages: 1,
    total: 0,
    folderPath: './logs',
    filters: {},
    filterOptions: {},
    presetSteps: [],    // history of applied preset suggestions
    activeFilterStep: 0   // step number to query filter options from (0 = logs, N = filter_N)
  };

  // API base URL
  const API_BASE = '';

  // Initialize application
  $(document).ready(function() {
    initEventHandlers();
    checkHealth();
  });

  /**
   * Initialize event handlers
   */
  function initEventHandlers() {
    // Filter actions
    $('#applyFilterBtn').on('click', applyFilters);
    $('#clearFilterBtn').on('click', clearFilters);

    // Pagination
    $('#prevPageBtn').on('click', previousPage);
    $('#nextPageBtn').on('click', nextPage);
    $('#jumpPageBtn').on('click', jumpToPage);
    $('#jumpPageInput').on('keypress', function(e) {
      if (e.key === 'Enter') {
        jumpToPage();
      }
    });
  }

  /**
   * Check API health and load initial data
   */
  function checkHealth() {
    $.ajax({
      url: API_BASE + '/health?folderPath=' + encodeURIComponent(state.folderPath),
      method: 'GET',
      success: function(response) {
        if (response.databaseScanned) {
          loadLogs();
        } else {
          showStatus('⚠️ No database found. Please start the server with a log folder path.', 'warning');
          clearLogsDisplay();
        }
      },
      error: function() {
        showStatus('❌ Cannot connect to API server', 'error');
      }
    });
  }

  /**
   * Load filter options
   */
  function loadFilterOptions() {
    // In chain mode, stepNumber already points to the correct temp table — no need to send manual filters
    const filtersPayload = state.presetSteps.length > 0 ? {} : state.filters;
    $.ajax({
      url: API_BASE + '/filter_option',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        folderPath: state.folderPath,
        filters: filtersPayload,
        stepNumber: state.activeFilterStep
      }),
      success: function(response) {
        if (response.success) {
          state.filterOptions = response.data;
          renderFilterOptions();
          loadPresetSuggestions();
        }
      },
      error: function(xhr) {
        const error = xhr.responseJSON ? xhr.responseJSON.error : 'Unknown error';
        showStatus('❌ Failed to load filter options: ' + error, 'error');
      }
    });
  }

  /**
   * Load preset suggestions based on current filters
   */
  function loadPresetSuggestions() {
    // In chain mode, stepNumber already points to the correct temp table — no need to send manual filters
    const filtersPayload = state.presetSteps.length > 0 ? {} : state.filters;
    $.ajax({
      url: API_BASE + '/preset_suggestions',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({ filters: filtersPayload, stepNumber: state.activeFilterStep }),
      success: function(response) {
        if (response.success) {
          renderPresetSuggestions(response.suggestions || []);
        }
      },
      error: function() {
        // Silently hide suggestions panel on error
        $('#presetGroup').hide();
      }
    });
  }

  /**
   * Render preset suggestions as clickable links
   * @param {Array} suggestions - List of suggestion objects
   */
  function renderPresetSuggestions(suggestions) {
    const container = $('#presetSuggestions');
    container.empty();

    if (!suggestions || suggestions.length === 0) {
      $('#presetGroup').hide();
      return;
    }

    suggestions.forEach(function(suggestion) {
      const btn = $('<button class="preset-btn" type="button"></button>');
      btn.attr('title', suggestion.description);
      btn.html('<span class="preset-btn-label">' + escapeHtml(suggestion.label) + '</span>' +
               '<span class="preset-btn-desc">' + escapeHtml(suggestion.description) + '</span>');
      btn.on('click', function() {
        applyPresetSuggestion(suggestion);
      });
      container.append(btn);
    });

    // Update subtitle showing step count
    const stepCount = state.presetSteps.length;
    if (stepCount > 0) {
      $('#presetSubtitle').html('Step ' + (stepCount + 1) + ' &mdash; ' + stepCount + ' step' + (stepCount > 1 ? 's' : '') + ' applied');
    } else {
      $('#presetSubtitle').text('Click a suggestion to apply it');
    }

    $('#presetGroup').show();
  }

  /**
   * Apply a preset suggestion by sending its preset ID to the API
   * @param {Object} suggestion - Suggestion object with id and label
   */
  function applyPresetSuggestion(suggestion) {
    // Accumulate preset steps — each step is a separate preset filter in the chain
    state.presetSteps.push({ id: suggestion.id, label: suggestion.label });

    // Reset to page 1 and reload using the full chain
    state.currentPage = 1;
    loadLogs();
  }

  /**
   * Sync a filters object back into the checkbox UI.
   * Used after programmatically applying a preset suggestion.
   * @param {Object} filters - Filters to reflect in the UI
   */
  function syncFiltersToUI(filters) {
    if (!filters) return;

    const fieldMap = {
      logLevelInclude: '.logLevelInclude-checkbox',
      logLevelExclude: '.logLevelExclude-checkbox',
      threadInclude: '.threadInclude-checkbox',
      threadExclude: '.threadExclude-checkbox',
      componentInclude: '.componentInclude-checkbox',
      componentExclude: '.componentExclude-checkbox',
      deviceInclude: '.deviceInclude-checkbox',
      deviceExclude: '.deviceExclude-checkbox',
      filenameInclude: '.filenameInclude-checkbox',
      filenameExclude: '.filenameExclude-checkbox'
    };

    Object.keys(fieldMap).forEach(function(field) {
      if (!filters[field]) return;
      const selector = fieldMap[field];
      filters[field].forEach(function(value) {
        $(selector).each(function() {
          if ($(this).val() === value) {
            $(this).prop('checked', true);
          }
        });
      });
      // Update "select all" state for each field
      updateSelectAll(field);
    });
  }

  /**
   * Render filter options
   */
  function renderFilterOptions() {
    const options = state.filterOptions;

    // Render checkboxes for each filter type
    renderCheckboxes('timeBucket', options.timeBuckets || [], false); // Time: single column
    renderCheckboxes('filenameInclude', options.filenames || [], true);
    renderCheckboxes('filenameExclude', options.filenames || [], true);
    renderCheckboxes('logLevelInclude', options.logLevels || [], true);
    renderCheckboxes('logLevelExclude', options.logLevels || [], true);
    renderCheckboxes('deviceInclude', options.devices || [], true);
    renderCheckboxes('deviceExclude', options.devices || [], true);
    renderCheckboxes('componentInclude', options.components || [], true);
    renderCheckboxes('componentExclude', options.components || [], true);
    renderCheckboxes('threadInclude', options.threads || [], true);
    renderCheckboxes('threadExclude', options.threads || [], true);

    // Show/hide advanced filters based on total logs
    const showAdvanced = options.totalLogs > 200;
    $('#componentFilterGroup').toggle(showAdvanced);
    $('#threadFilterGroup').toggle(showAdvanced);
  }

  /**
   * Render checkboxes for a filter type
   */
  function renderCheckboxes(fieldName, items, isColumn) {
    const container = $('#' + fieldName + 'Checkboxes');
    container.empty();

    if (!items || items.length === 0) {
      if (!isColumn) {
        container.append('<div class="checkbox-item"><label>No options available</label></div>');
      }
      return;
    }

    items.forEach(function(item) {
      // Extract value and count from item
      let value, count;
      if (typeof item === 'object') {
        value = item.filename || item.log_level || item.thread_name ||
                item.device_id || item.component_name || item.time_label || '';
        count = item.count || 0;
      } else {
        value = item;
        count = 0;
      }

      const id = fieldName + '_' + value.replace(/[^a-zA-Z0-9]/g, '_');
      const countText = count ? ' <span class="count">(' + count.toLocaleString() + ')</span>' : '';
      
      const html = `
        <div class="checkbox-item">
          <input type="checkbox" id="${id}" value="${escapeHtml(value)}" class="${fieldName}-checkbox" onchange="updateSelectAll('${fieldName}')">
          <label for="${id}">${escapeHtml(value)}${countText}</label>
        </div>
      `;
      container.append(html);
    });
  }

  /**
   * Get selected values from checkboxes
   */
  function getSelectedValues(fieldName) {
    const values = [];
    $('.' + fieldName + '-checkbox:checked').each(function() {
      values.push($(this).val());
    });
    return values;
  }

  /**
   * Apply filters
   */
  function applyFilters() {
    state.currentPage = 1;
    
    // Build filters object
    const timeBucketValues = getSelectedValues('timeBucket');
    const filenameIncludeValues = getSelectedValues('filenameInclude');
    const filenameExcludeValues = getSelectedValues('filenameExclude');
    const logLevelIncludeValues = getSelectedValues('logLevelInclude');
    const logLevelExcludeValues = getSelectedValues('logLevelExclude');
    const deviceIncludeValues = getSelectedValues('deviceInclude');
    const deviceExcludeValues = getSelectedValues('deviceExclude');
    const componentIncludeValues = getSelectedValues('componentInclude');
    const componentExcludeValues = getSelectedValues('componentExclude');
    const threadIncludeValues = getSelectedValues('threadInclude');
    const threadExcludeValues = getSelectedValues('threadExclude');

    state.filters = {
      search: $('#searchFilter').val(),
      contextLines: parseInt($('#contextLinesFilter').val()) || 0
    };

    // Add filters only if they have values
    if (timeBucketValues.length > 0) {
      state.filters.timeBucket = timeBucketValues;
    }
    if (filenameIncludeValues.length > 0) {
      state.filters.filenameInclude = filenameIncludeValues;
    }
    if (filenameExcludeValues.length > 0) {
      state.filters.filenameExclude = filenameExcludeValues;
    }
    if (logLevelIncludeValues.length > 0) {
      state.filters.logLevelInclude = logLevelIncludeValues;
    }
    if (logLevelExcludeValues.length > 0) {
      state.filters.logLevelExclude = logLevelExcludeValues;
    }
    if (deviceIncludeValues.length > 0) {
      state.filters.deviceInclude = deviceIncludeValues;
    }
    if (deviceExcludeValues.length > 0) {
      state.filters.deviceExclude = deviceExcludeValues;
    }
    if (componentIncludeValues.length > 0) {
      state.filters.componentInclude = componentIncludeValues;
    }
    if (componentExcludeValues.length > 0) {
      state.filters.componentExclude = componentExcludeValues;
    }
    if (threadIncludeValues.length > 0) {
      state.filters.threadInclude = threadIncludeValues;
    }
    if (threadExcludeValues.length > 0) {
      state.filters.threadExclude = threadExcludeValues;
    }

    loadLogs();
  }

  /**
   * Clear filters UI
   */
  function clearFiltersUI() {
    $('#searchFilter').val('');
    $('#contextLinesFilter').val('0');
    $('.checkbox-item input[type="checkbox"]').prop('checked', false);
  }

  /**
   * Clear filters
   */
  function clearFilters() {
    state.filters = {};
    state.currentPage = 1;
    state.presetSteps = [];
    state.activeFilterStep = 0;

    // Clear UI
    clearFiltersUI();

    loadLogs();
  }

  /**
   * Load logs
   * Uses /filter_log for all cases (single or multi-step)
   */
  function loadLogs() {
    // Build steps array: preset steps + manual filters
    const steps = state.presetSteps.map(function(s) {
      return { filters: { preset: s.id } };
    });
    const hasManualFilters = state.filters && Object.keys(state.filters).some(function(k) {
      const v = state.filters[k];
      return v !== '' && v !== 0 && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
    });
    if (steps.length === 0 || hasManualFilters) {
      steps.push({ filters: state.filters });
    }
    $.ajax({
      url: API_BASE + '/filter_log',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        steps: steps,
        page: state.currentPage,
        pageSize: state.pageSize
      }),
      success: function(response) {
        if (response.success) {
          state.total = response.total;
          state.totalPages = response.totalPages;
          state.activeFilterStep = steps.length;
          renderLogs(response.logs);
          updatePagination();
          loadFilterOptions();
        } else {
          showStatus('❌ Failed to load logs: ' + response.error, 'error');
        }
      },
      error: function(xhr) {
        const error = xhr.responseJSON ? xhr.responseJSON.error : 'Unknown error';
        showStatus('❌ Failed to load logs: ' + error, 'error');
      }
    });
  }

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
   * Highlight search term in text
   */
  function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !text) return escapeHtml(text);
    
    const escapedText = escapeHtml(text);
    const escapedSearchTerm = escapeHtml(searchTerm);
    
    // Case-insensitive search and replace
    const regex = new RegExp('(' + escapedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escapedText.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  /**
   * Render logs
   */
  function renderLogs(logs) {
    const container = $('#log-container');
    container.empty();

    if (!logs || logs.length === 0) {
      container.append('<div class="loading">No logs found with current filters.</div>');
      return;
    }

    // Get search term from filters
    const searchTerm = state.filters.search || '';

    // Render each log as a div with CSS class for log level
    logs.forEach(function(log) {
      // Use formattedLog from API if available, otherwise fallback to manual formatting
      const logLine = log.formattedLog || (log.timestamp + ' [' + log.log_level + '] ' + log.message);
      const displayLine = searchTerm ? highlightSearchTerm(logLine, searchTerm) : escapeHtml(logLine);
      const logDiv = $('<div class="log-entry ' + log.log_level + '"></div>');
      logDiv.html(displayLine);
      container.append(logDiv);
    });
  }

  /**
   * Clear logs display
   */
  function clearLogsDisplay() {
    $('#log-container').html('<div class="logs-placeholder">No logs loaded. Please start the server with a log folder path.</div>');
    $('#resultsInfo').text('Log from 0 to 0/0 logs');
    $('#pageInfo').text('Page 1/1');
    state.currentPage = 1;
    state.totalPages = 1;
    state.total = 0;
    updatePagination();
  }

  /**
   * Update pagination
   */
  function updatePagination() {
    const start = (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, state.total);
    
    $('#pageInfo').text('Page ' + state.currentPage + '/' + state.totalPages);
    $('#resultsInfo').text('Log from ' + start.toLocaleString() + ' to ' + end.toLocaleString() + '/' + state.total.toLocaleString() + ' logs');
    $('#jumpPageInput').attr('max', state.totalPages);
    $('#jumpPageInput').val(state.currentPage);

    // Enable/disable buttons
    $('#prevPageBtn').prop('disabled', state.currentPage <= 1);
    $('#nextPageBtn').prop('disabled', state.currentPage >= state.totalPages);
  }

  /**
   * Previous page
   */
  function previousPage() {
    if (state.currentPage > 1) {
      state.currentPage--;
      loadLogs();
    }
  }

  /**
   * Next page
   */
  function nextPage() {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      loadLogs();
    }
  }

  /**
   * Jump to page
   */
  function jumpToPage() {
    const targetPage = parseInt($('#jumpPageInput').val());
    
    if (targetPage >= 1 && targetPage <= state.totalPages) {
      state.currentPage = targetPage;
      loadLogs();
    } else {
      alert('Please enter a valid page number between 1 and ' + state.totalPages);
    }
  }

  /**
   * Show status message
   */
  function showStatus(message, type) {
    const statusBar = $('#statusBar');
    statusBar.removeClass('success error warning info');
    statusBar.addClass(type);
    statusBar.text(message);
    statusBar.show();

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
      setTimeout(function() {
        statusBar.fadeOut();
      }, 5000);
    }
  }

  // Global functions for inline event handlers
  window.toggleFilter = function(header) {
    const content = $(header).next('.filter-content');
    const toggle = $(header).find('.toggle');
    content.toggleClass('collapsed');
    toggle.toggleClass('collapsed');
  };

  window.toggleAll = function(selectAllCheckbox, fieldName) {
    const checkboxes = $('.' + fieldName + '-checkbox');
    checkboxes.prop('checked', selectAllCheckbox.checked);
  };

  window.updateSelectAll = function(fieldName) {
    const checkboxes = $('.' + fieldName + '-checkbox');
    const selectAllCheckbox = $('#selectAll_' + fieldName);
    const allChecked = checkboxes.length > 0 && checkboxes.length === checkboxes.filter(':checked').length;
    selectAllCheckbox.prop('checked', allChecked);
  };

})();
