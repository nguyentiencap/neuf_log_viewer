import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from log_parser import LogParserService


class TestLogParserServiceSkeleton(unittest.TestCase):
    def test_normalize_component_name_full_package(self):
        parser = LogParserService()
        self.assertEqual(
            parser.normalize_component_name("com.example.package.ClassName"),
            "com.example.package",
        )


if __name__ == "__main__":
    unittest.main()
