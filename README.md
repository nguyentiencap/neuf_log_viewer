# NEUF Log Viewer - User Guide

## Introduction

NEUF Log Viewer is a tool for viewing and analyzing DWS logs with a web interface for browsing and filtering logs.

The tool stores logs in a SQLite database for fast searching and filtering.

---

## Installation & Running

### Requirements
- Node.js v12+
- npm

### Install Dependencies
```bash
npm install
```

### Run API Server (Web UI)
```bash
npm start <path-to-log-folder>
```

Example:
```bash
npm start ./logs
```

The server will be available at: **http://localhost:3001**

---

## Web Interface (Web UI)

### Access
Open a web browser and go to: **http://localhost:3001**

### Features

#### 1. Log Filtering
Enter filter criteria in the sidebar:
- **Log Level** - Select the log levels to show
- **Thread** - Filter by thread name
- **Device** - Filter by device ID
- **Component** - Filter by component name
- **Filename** - Filter by filename
- **Search** - Search for text in the message (supports Regex)

#### 2. Presets (Filter Presets)

| Preset | Description |
|-----|-------|
| `errors_and_warnings` | Show ERROR and WARN |
| `errors_only` | Show only ERROR |
| `exclude_top_components` | Exclude top components that generate many logs |
| `component_not_null` | Show only logs that have a component |
| `component_null` | Show only logs without a component |
| `exclude_endpoint_tester` | Exclude components containing "Endpoint" |
| `exclude_historical_data` | Exclude components containing "Historical" |
| `exclude_dws` | Exclude components starting with "Dws" |
| `exclude_wiring` | Exclude components containing "Wiring" |

**How to use:** Select a preset from the Presets list in the Web UI or add custom presets in `preset.json`.

#### Adding Custom Presets

You can define your own presets by editing the `preset.json` file located at the project root (same directory as `neuf-log-viewer-api.js`).

Each entry in the file follows this structure:

```json
{
  "my_preset_id": {
    "id": "my_preset_id",
    "label": "🏷️ My Preset Label",
    "description": "Short description shown in the UI",
    "filters": {
      "componentExclude": ["%MyComponent%"],
      "logLevelInclude": ["ERROR"]
    }
  }
}
```

**Supported filter fields:**

| Field | Type | Description |
|---|---|---|
| `logLevelInclude` | `string[]` | Include only these log levels (e.g. `["ERROR", "WARN"]`) |
| `logLevelExclude` | `string[]` | Exclude these log levels |
| `componentInclude` | `string[]` | Include only these components (supports SQL `%LIKE%` wildcards) |
| `componentExclude` | `string[]` | Exclude these components (supports SQL `%LIKE%` wildcards; use `null` to exclude entries with no component) |
| `threadInclude` | `string[]` | Include only these threads |
| `threadExclude` | `string[]` | Exclude these threads |
| `deviceInclude` | `string[]` | Include only these device IDs |
| `deviceExclude` | `string[]` | Exclude these device IDs |
| `filenameInclude` | `string[]` | Include only logs from these filenames |
| `filenameExclude` | `string[]` | Exclude logs from these filenames |

**Notes:**
- Changes to `preset.json` take effect immediately on the next API request — no restart required.
- Data-derived presets (generated automatically from your log data at scan time) take precedence over entries in `preset.json` if they share the same `id`.

#### 3. Pagination
- Adjust the number of logs per page (default: 50)
- Navigate between pages using the navigation buttons
- View total matching logs and number of pages

#### 4. Export Log
Export all logs that match the current filters to a `.log` file:
- Click the "Export" button
- The file will be downloaded to your computer
- Filename format: `neuf-logs-export-<timestamp>.log`

#### 5. Context Lines
When searching logs you can show additional surrounding lines for context:
- Enter the number of context lines (e.g., 5)
- The system will display the specified number of lines before and after each matching log

---

## Log Format

NEUF Log Viewer supports the DWS standard log format:

```
YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: <DeviceID> (ComponentName) Message
```

Example:
```
2026.04.01 14:23:45.123 [ERROR] [class DeviceManager]: pool-1: <TC101514400004> (DwsCoreImpl) Device connection timeout
```

Notes:
- `YYYY.MM.DD HH:mm:ss.SSS` - Timestamp
- `[LEVEL]` - ERROR, WARN, INFO, DEBUG, TRACE
- `ClassName` - Class name
- `ThreadName` - Thread name
- `DeviceID` - Device ID (if present)
- `ComponentName` - Component name
- `Message` - Log message

---

## Directory Structure

```
📁 logs/
├── NEUF-DWS-Core.81.log
├── NEUF-Impl-Bundle.145.log
├── ... (other log files)
└── log-filter-db/
    └── neuf-logs.db      (database created automatically)
```

**Note:** The `log-filter-db/` folder is created automatically when the web server starts. Do not delete `neuf-logs.db` unless you want to re-scan from scratch.

---

## Common Scenarios

## Database Management

### Storage Location
The database is stored inside the log folder:
```
<log-folder>/log-filter-db/neuf-logs.db
```

### Rebuilding the Database

Delete the database file and restart the server:
```bash
rm logs/log-filter-db/neuf-logs.db
npm start ./logs
```

---

**Version:** 1.0.0  
**Last updated:** 2026-05-05


````
