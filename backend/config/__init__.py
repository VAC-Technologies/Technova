import pymysql

pymysql.install_as_MySQLdb()

# ---------------------------------------------------------------------------
# TiDB Cloud Compatibility Patch
#
# TiDB's distributed DDL engine does not support:
# 1. Combining ADD COLUMN and ADD CONSTRAINT ... FOREIGN KEY in a single
#    ALTER TABLE statement (fails with MySQL error 1072).
# 2. Inline UNIQUE constraints on ALTER TABLE ... ADD COLUMN (fails with
#    TiDB error 8200: "unsupported add column constraint UNIQUE KEY").
#
# This patch:
# - Sets sql_create_column_inline_fk = None on the 'default' (TiDB) connection
#   so foreign keys are always deferred to separate standalone ALTER statements.
# - Overrides add_field() for fields with unique=True so that the column is
#   created without the inline UNIQUE keyword, and the unique constraint is
#   deferred to a separate standalone ALTER TABLE ADD CONSTRAINT ... UNIQUE.
#
# Crucially, field.unique is NOT mutated, preventing duplicate index generation.
# Any non-default connection (e.g. SQLite, another MySQL) retains default behavior.
# ---------------------------------------------------------------------------
from django.db.backends.mysql.base import DatabaseWrapper as MySQLDatabaseWrapper
from django.db.backends.mysql.schema import DatabaseSchemaEditor

_original_inline_fk = DatabaseSchemaEditor.sql_create_column_inline_fk


class TiDBDatabaseSchemaEditor(DatabaseSchemaEditor):
    @property
    def sql_create_column_inline_fk(self):
        # Database-specific: Disable inline foreign keys ONLY on default TiDB database
        if getattr(self.connection, 'alias', None) == 'default':
            return None
        return _original_inline_fk

    def add_field(self, model, field):
        if (
            getattr(self.connection, 'alias', None) == 'default'
            and field.unique
            and not field.primary_key
        ):
            # Extract column definition without mutating field.unique
            definition, params = self.column_sql(model, field, include_default=True)
            if definition.endswith(' UNIQUE'):
                definition = definition[:-7]
            elif ' UNIQUE ' in definition:
                definition = definition.replace(' UNIQUE ', ' ')

            # Execute standalone ADD COLUMN
            sql = self.sql_create_column % {
                'table': self.quote_name(model._meta.db_table),
                'column': self.quote_name(field.column),
                'definition': definition,
            }
            self.execute(sql, params or None)

            # Drop temporary default if needed (matching BaseDatabaseSchemaEditor logic)
            if (
                not field.has_db_default()
                and not self.skip_default_on_alter(field)
                and self.effective_default(field) is not None
            ):
                changes_sql, params = self._alter_column_default_sql(model, None, field, drop=True)
                sql = self.sql_alter_column % {
                    'table': self.quote_name(model._meta.db_table),
                    'changes': changes_sql,
                }
                self.execute(sql, params)

            # Defer the unique constraint to a subsequent standalone ALTER statement
            self.deferred_sql.append(self._create_unique_sql(model, [field]))
            return

        super().add_field(model, field)


MySQLDatabaseWrapper.SchemaEditorClass = TiDBDatabaseSchemaEditor
