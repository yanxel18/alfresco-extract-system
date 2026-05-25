"""
Backward-compatibility shim.
All migration logic now lives in app.services.migration (sub-package).
This file re-exports everything so existing imports continue to work unchanged:
    from app.services.migration_service import ensure_folder_path, migrate_file_record, ...
"""
from app.services.migration import (  # noqa: F401
    ensure_folder_path,
    migrate_file_record,
    parse_folder_parts,
    revert_migration,
    generate_migration_sql,
)
