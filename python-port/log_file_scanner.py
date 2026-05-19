"""Python skeleton port of src/log-file-scanner.js for test scaffolding only."""


class LogFileScannerService:
    """Skeleton scanner service; dependencies and methods mirror JavaScript version."""

    def __init__(self, parser_service, logger=print):
        """Inject parser dependency and logger callback (JS: constructor)."""
        self.parser_service = parser_service
        self.logger = logger

    def find_neuf_log_files(self, directory):
        """List top-level NEUF*.log files in a directory (JS: findNeufLogFiles)."""
        raise NotImplementedError("TODO: implement find_neuf_log_files")

    async def parse_files(self, log_folder_path, on_batch_ready, precomputed_files=None):
        """Stream files and emit parsed batches through callback (JS: parseFiles)."""
        raise NotImplementedError("TODO: implement parse_files")
