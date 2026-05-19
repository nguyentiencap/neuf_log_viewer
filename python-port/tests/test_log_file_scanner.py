import asyncio
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from log_file_scanner import LogFileScannerService
from log_parser import LogParserService


class TestLogFileScannerServiceSkeleton(unittest.TestCase):
    def test_find_neuf_log_files_top_level(self):
        scanner = LogFileScannerService(LogParserService())
        self.assertEqual(scanner.find_neuf_log_files("/tmp/logs"), ["/tmp/logs/NEUF-main.log"])

    def test_parse_files_returns_stats(self):
        scanner = LogFileScannerService(LogParserService())
        result = asyncio.run(scanner.parse_files("/tmp/logs", lambda batch: None))
        self.assertEqual(result["totalEntries"], 1)


if __name__ == "__main__":
    unittest.main()
