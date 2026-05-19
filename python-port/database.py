"""Python skeleton port of src/database.js for test scaffolding only."""


class DatabaseWrapper:
    """Skeleton database adapter around sqlite/sql.js equivalent."""

    def __init__(self, db):
        """Store raw DB handle (JS: constructor)."""
        self.db = db

    def exec(self, sql):
        """Execute SQL statement without returning rows (JS: exec)."""
        raise NotImplementedError("TODO: implement exec")

    def prepare(self, sql):
        """Return statement-like object with run/get/all/each methods (JS: prepare)."""
        raise NotImplementedError("TODO: implement prepare")

    def transaction(self, fn):
        """Wrap callback execution inside begin/commit/rollback (JS: transaction)."""
        raise NotImplementedError("TODO: implement transaction")

    def register_function(self, name, fn):
        """Register custom SQL function (JS: registerFunction)."""
        raise NotImplementedError("TODO: implement register_function")

    def export(self):
        """Export DB bytes for persistence (JS: export)."""
        raise NotImplementedError("TODO: implement export")


class DatabaseService:
    """Skeleton service containing all filtering/query helpers from JS module."""

    def __init__(self, db, logger=print):
        """Inject database wrapper and logger callback (JS: constructor)."""
        self.db = db
        self.logger = logger

    def build_where_clause(self, filters, exclude_field=None):
        """Build WHERE SQL and params from include/exclude filters (JS: buildWhereClause)."""
        raise NotImplementedError("TODO: implement build_where_clause")

    def register_custom_functions(self):
        """Register REGEXP and helper SQL functions (JS: registerCustomFunctions)."""
        raise NotImplementedError("TODO: implement register_custom_functions")

    def init_database(self):
        """Create logs schema and indexes (JS: initDatabase)."""
        raise NotImplementedError("TODO: implement init_database")

    def get_filter_options(self, table_name="logs", limited_options=True):
        """Return grouped distinct values for UI filter options (JS: getFilterOptions)."""
        raise NotImplementedError("TODO: implement get_filter_options")

    def init_temp_logs_table(self):
        """Create temporary staging table for scan inserts (JS: initTempLogsTable)."""
        raise NotImplementedError("TODO: implement init_temp_logs_table")

    def prepare_insert_temp(self):
        """Prepare insert statement for temp table writes (JS: prepareInsertTemp)."""
        raise NotImplementedError("TODO: implement prepare_insert_temp")

    def create_batch_insert_temp(self, insert_stmt):
        """Create batch inserter closure for temp table (JS: createBatchInsertTemp)."""
        raise NotImplementedError("TODO: implement create_batch_insert_temp")

    def insert_from_temp_to_logs(self):
        """Move normalized rows from temp table into logs table (JS: insertFromTempToLogs)."""
        raise NotImplementedError("TODO: implement insert_from_temp_to_logs")

    def drop_temp_logs_table(self):
        """Drop temporary staging table after scan (JS: dropTempLogsTable)."""
        raise NotImplementedError("TODO: implement drop_temp_logs_table")

    def execute_filter_step(self, filters, input_table, output_table):
        """Execute one filtering pipeline step into output table (JS: executeFilterStep)."""
        raise NotImplementedError("TODO: implement execute_filter_step")

    def prepare_insert(self):
        """Prepare insert statement for logs table (JS: prepareInsert)."""
        raise NotImplementedError("TODO: implement prepare_insert")

    def create_batch_insert(self, insert_stmt):
        """Create batch inserter closure for logs table (JS: createBatchInsert)."""
        raise NotImplementedError("TODO: implement create_batch_insert")
