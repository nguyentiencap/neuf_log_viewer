import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import DatabaseService, DatabaseWrapper


class TestDatabaseSkeleton(unittest.TestCase):
    def test_wrapper_exec_runs_sql(self):
        wrapper = DatabaseWrapper(db=None)
        self.assertIsNone(wrapper.exec("SELECT 1"))

    def test_service_build_where_clause_returns_shape(self):
        service = DatabaseService(db=None)
        result = service.build_where_clause({"logLevelInclude": ["ERROR"]})
        self.assertIn("where", result)


if __name__ == "__main__":
    unittest.main()
