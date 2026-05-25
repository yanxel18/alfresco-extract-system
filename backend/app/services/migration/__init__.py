"""
Migration service package.
Re-exports all public functions so existing imports continue to work unchanged:
    from app.services.migration_service import ensure_folder_path, migrate_file_record, ...
"""
from .folder_manager import ensure_folder_path
from .file_migrator import migrate_file_record, parse_folder_parts
from .revert import revert_migration
from .sql_exporter import generate_migration_sql

__all__ = [
    "ensure_folder_path",
    "migrate_file_record",
    "parse_folder_parts",
    "revert_migration",
    "generate_migration_sql",
]
