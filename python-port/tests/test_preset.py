import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from preset import PresetService


class TestPresetServiceSkeleton(unittest.TestCase):
    def test_get_presets_path(self):
        self.assertEqual(
            PresetService.get_presets_path("/tmp/log-filter-db"),
            "/tmp/log-filter-db/neuf-presets.json",
        )


if __name__ == "__main__":
    unittest.main()
