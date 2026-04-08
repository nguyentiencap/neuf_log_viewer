# AGENTS.md

Agent guidance for NEUF Log Viewer - Node.js log viewer with SQLite backend.

## Non-Obvious Patterns

### Entry Point & Database
- CLI Entry: `node neuf-log-viewer-cli.js <command> <log-folder-path>` (commands: scan, clear, filter, options)
- API Entry: `node neuf-log-viewer-api.js <log-folder-path>` or `npm start <log-folder-path>`
- DB: `<log-folder>/log-filter-db/neuf-logs.db` (inside log folder, not project root)
- Re-index: delete DB file and run scan command again

### Service Object Pattern
- All modules use service classes with injected dependencies
- Services instantiated in `neuf-log-viewer-cli.js` and `neuf-log-viewer-api.js`
- Example: `NEUFLogService` receives `logParserService` and logger function

### Log Format Parsing (Critical)
- Format: `YYYY.MM.DD HH:mm:ss.SSS [LEVEL] [class ClassName]: ThreadName: <DeviceID> (ComponentName) Message`
- `normalizeComponentName()` extracts before last dot: `"com.example.ClassName"` → `"com.example"`
- Special: `"java:133"` → `"java:133"` (no dot = as-is), `"HistoricalSessionManager.java:273"` → `"HistoricalSessionManager"`
- Timestamps: keep original `YYYY.MM.DD HH:mm:ss.SSS` (NOT ISO)

### Database Wrapper
- Custom `DatabaseWrapper` wrapping sql.js (NOT better-sqlite3)
- Methods: `.prepare()`, `.exec()`, `.transaction()`
- Transaction pattern: `db.transaction(fn)(items)`

### Testing
- Import helpers from `test/test-helpers.js`
- Run: `node test/<file>.test.js` (NOT npm test/jest)
- Use custom `runTest()` and `assertEqual()` (NOT jest/mocha)

**Helper Functions:**
- `assertEqual(actual, expected, message)` - compare & report
- `runTest(testName, testFn)` - run test & track stats
- `printSection(title)` - section header
- `printSummary(suiteName)` - summary & exit (0=pass, 1=fail)
- `resetStats()` - reset stats
- `getStats()` - returns `{total, passed, failed}`

**Create Test:**
1. Create file in `test/`
2. Import: `const { assertEqual, runTest, printSection, printSummary } = require('./test-helpers');`
3. Import module: `const { MyService } = require('../lib/my-service');`
4. Write tests with `runTest()` + descriptive names
5. Group with `printSection()`
6. End with `printSummary('SUITE NAME')`
7. Run: `node test/my-service.test.js`

**Best Practices:** Clear names, one assertion/test, test edge cases, use `printSection()` to organize, document in `assertEqual()` messages

### Filter Presets
- Defined in `filter_preset.json` at root
- Keys: `logLevelInclude`, `threadExclude`, `componentInclude`, `filenameExclude`, `deviceInclude`
- Wildcards supported in excludes (e.g., `"*.html"`)

### Context Lines Feature
- When search + contextLines > 0, creates `temp_context_filter` table
- Filter options must query temp table, not `logs` table
- Check temp table existence before querying

### Code Style
- Constructor injection for dependencies
- Logger function as parameter (default: `console.log`)
- JSDoc comments with `@param` and `@returns`
- File headers document module responsibility

### Documentation Rules
- Do NOT create .md files unless explicitly requested
- Only create docs when user specifically asks
