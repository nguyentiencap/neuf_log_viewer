import asyncio
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from neuf_log_service import NEUFLogService


class TestNEUFLogServiceSkeleton(unittest.TestCase):
    def test_get_db_path_structure(self):
        service = NEUFLogService()
        result = service.get_db_path("/tmp/logs")
        self.assertIn("db_path", result)

    def test_scan_logs_returns_success(self):
        service = NEUFLogService()
        result = asyncio.run(service.scan_logs("/tmp/logs"))
        self.assertTrue(result["success"])


if __name__ == "__main__":
    unittest.main()
