"""
SQL script generator: builds a downloadable SQL INSERT script from completed
MigrationRecords for manual audit or re-run against the real target database.
"""
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.job import FileRecord
from app.models.migration import MigrationRecord, MigrationStatus

logger = logging.getLogger(__name__)


def _esc(v: object) -> str:
    """Escape a value for inclusion in a SQL literal."""
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def generate_migration_sql(job_id: int, local_session: Session) -> str:
    """
    Build a self-contained SQL INSERT script from completed MigrationRecords.
    The script can be reviewed and executed manually against the real target DB.
    """
    records = (
        local_session.query(MigrationRecord)
        .filter(
            MigrationRecord.job_id == job_id,
            MigrationRecord.status == MigrationStatus.migrated,
        )
        .all()
    )

    lines: list[str] = [
        f"-- Migration SQL export for job #{job_id}",
        f"-- Generated: {datetime.utcnow().isoformat()}Z",
        f"-- Total records: {len(records)}",
        "",
        "-- ⚠️  Update table/column names to match your real target system schema.",
        "",
        "BEGIN;",
        "",
        "-- ============================================================",
        "-- FILES",
        "-- ============================================================",
        "",
    ]

    for mr in records:
        fr: FileRecord | None = local_session.get(FileRecord, mr.file_record_id)
        if not fr:
            continue
        lines.append(
            f"INSERT INTO files "
            f"(id, folder_id, uuid_filename, original_name, title, description, "
            f"mime_type, file_size_bytes, creator, modifier, created_at, modified_at, "
            f"tags, source_node_ref, source_site) VALUES ("
            f"{_esc(mr.target_file_id)}::uuid, "
            f"{_esc(mr.target_folder_id)}::uuid, "
            f"{_esc(mr.uuid_filename)}, "
            f"{_esc(fr.file_name)}, "
            f"{_esc(fr.title)}, "
            f"{_esc(fr.description)}, "
            f"{_esc(fr.mime_type)}, "
            f"{fr.file_size_bytes if fr.file_size_bytes is not None else 'NULL'}, "
            f"{_esc(fr.creator)}, "
            f"{_esc(fr.modifier)}, "
            f"{_esc(str(fr.created_at)) if fr.created_at else 'NULL'}, "
            f"{_esc(str(fr.modified_at)) if fr.modified_at else 'NULL'}, "
            f"{_esc(fr.tags)}, "
            f"{_esc(fr.node_ref)}, "
            f"{_esc(fr.site)}"
            f");"
        )

    lines += ["", "COMMIT;", ""]
    return "\n".join(lines)
