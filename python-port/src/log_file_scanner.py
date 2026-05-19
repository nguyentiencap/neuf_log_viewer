"""
Log File Scanner Module (Python port skeleton of src/log-file-scanner.js)
Handles scanning log directories and reading log files.
Responsibility: File system operations ONLY - NO DATABASE CODE.
Uses service object pattern to encapsulate file scanning operations.
"""


class LogFileScannerService:
    """
    Log File Scanner Service.
    Encapsulates all file scanning and parsing operations.
    Port of JavaScript LogFileScannerService in src/log-file-scanner.js.
    """

    def __init__(self, parser_service, logger=print):
        """
        Inject parser dependency and optional logger callback.

        @param parser_service: LogParserService instance for line parsing
        @param logger: Callable logger (default: print)
        (JS: constructor)
        """
        self.parser_service = parser_service
        self.logger = logger

    def find_neuf_log_files(self, directory):
        """
        Find all NEUF log files in a directory (top level only, non-recursive).
        Files must match pattern: (NEUF|neuf)-*.log (case-insensitive prefix match).
        Returns sorted list of full file paths.

        @param directory: Path to directory to scan
        @returns: Sorted list of full absolute file paths matching the pattern
        (JS: findNeufLogFiles)
        """
        raise NotImplementedError("TODO: implement find_neuf_log_files")

    async def parse_files(self, log_folder_path, on_batch_ready, precomputed_files=None):
        """
        Scan all log files, parse each line to structured log dicts,
        and deliver them in batches via callback. No in-memory accumulation.
        Sorting is delegated to SQLite when inserting from temp table into logs.

        Multi-line log entries are supported: continuation lines (lines without a
        timestamp prefix) are appended to the previous entry's raw content.

        @param log_folder_path: Path to log folder
        @param on_batch_ready: Callable(batch: list[dict]) called for each batch of
                               parsed log dicts (batch size: 1000)
        @param precomputed_files: Optional pre-computed file list to skip double scan
        @returns: Dict {
                    'totalEntries': int,
                    'fileStats': [{'filename': str, 'lines': int, 'entries': int}, ...]
                  }
        (JS: parseFiles)
        """
        raise NotImplementedError("TODO: implement parse_files")
