"""
Core migration logic: Alfresco extracted files → target file-manager system.

Responsibilities:
- ensure_folder_path: Create/find folder rows in the target DB for a given path.
- migrate_file_record: Insert a file row into the target DB and copy the file
  to target-storage/ with a UUID filename.
- revert_migration: Delete all target DB rows and local UUID files for a job,
  prune now-empty folders, and reset MigrationRecord rows.
- generate_migration_sql: Build a downloadable SQL INSERT script from completed
  MigrationRecords for manual audit or re-run.
"""
import logging
import os
import shutil
import uuid as uuid_lib
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.job import FileRecord, Job, JobStatus
from app.models.migration import MigrationRecord, MigrationStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Folder helpers
# ---------------------------------------------------------------------------

def _get_folder(target_session: Session, name: str, parent_id: str | None) -> str | None:
    """SELECT a folder by (name, parent_id). Returns UUID string or None."""
    if parent_id is None:
        row = target_session.execute(
            text("SELECT id::text FROM folders WHERE name = :n AND parent_id IS NULL"),
            {"n": name},
        ).fetchone()
    else:
        row = target_session.execute(
            text("SELECT id::text FROM folders WHERE name = :n AND parent_id = CAST(:pid AS uuid)"),
            {"n": name, "pid": parent_id},
        ).fetchone()
    return row[0] if row else None


def _create_folder(target_session: Session, name: str, parent_id: str | None) -> str:
    """INSERT a new folder row. Returns the new UUID string."""
    if parent_id is None:
        row = target_session.execute(
            text("INSERT INTO folders (name, parent_id) VALUES (:n, NULL) RETURNING id::text"),
            {"n": name},
        ).fetchone()
    else:
        row = target_session.execute(
            text("INSERT INTO folders (name, parent_id) VALUES (:n, CAST(:pid AS uuid)) RETURNING id::text"),
            {"n": name, "pid": parent_id},
        ).fetchone()
    target_session.commit()
    return row[0]


def ensure_folder_path(target_session: Session, site_name: str, path_parts: list[str]) -> str:
    """
    Ensure all folder rows exist in the target DB for the given path.
    A site-level root folder (named after site_name) is always created first.
    Returns the UUID of the leaf folder.

    Example:
        site_name="my-site", path_parts=["docs", "reports"]
        → folders: my-site → docs → reports
        → returns UUID of "reports"
    """
    all_parts = [site_name] + [p for p in path_parts if p]
    parent_id: str | None = None

    for part in all_parts:
        folder_id = _get_folder(target_session, part, parent_id)
        if folder_id is None:
            try:
                folder_id = _create_folder(target_session, part, parent_id)
            except Exception:
                # Race condition: another process created it — refetch
                target_session.rollback()
                folder_id = _get_folder(target_session, part, parent_id)
                if folder_id is None:
                    raise
        parent_id = folder_id

    return parent_id  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# File migration
# ---------------------------------------------------------------------------

def migrate_file_record(
    target_session: Session,
    file_record: FileRecord,
    folder_id: str,
) -> tuple[str, str]:
    """
    Copy the physical file to target-storage/ (UUID-named) and INSERT a row
    into the target DB files table.

    Returns (target_file_id, uuid_filename).
    Raises FileNotFoundError if the source file is missing.
    """
    if not file_record.local_export_path:
        raise ValueError(f"FileRecord {file_record.id} has no local_export_path")

    src = Path(file_record.local_export_path)
    if not src.exists():
        raise FileNotFoundError(f"Source file not found: {src}")

    ext = Path(file_record.file_name).suffix  # keeps e.g. ".pdf"
    new_uuid = str(uuid_lib.uuid4())
    uuid_filename = new_uuid + ext

    os.makedirs(str(settings.target_storage_path), exist_ok=True)
    dest = settings.target_storage_path / uuid_filename
    # If a file already exists at dest (extremely unlikely UUID collision or re-run),
    # remove it first so shutil.copy2 doesn't fail on some OS/FS combinations.
    if dest.exists():
        dest.unlink()
    shutil.copy2(str(src), str(dest))

    row = target_session.execute(
        text("""
            INSERT INTO files (
                folder_id, uuid_filename, original_name, title, description,
                mime_type, file_size_bytes, creator, modifier,
                created_at, modified_at, tags, source_node_ref, source_site
            ) VALUES (
                CAST(:folder_id AS uuid), :uuid_fn, :orig_name, :title, :desc,
                :mime, :size, :creator, :modifier,
                :created_at, :modified_at, :tags, :node_ref, :site
            ) RETURNING id::text
        """),
        {
            "folder_id": folder_id,
            "uuid_fn": uuid_filename,
            "orig_name": file_record.file_name,
            "title": file_record.title,
            "desc": file_record.description,
            "mime": file_record.mime_type,
            "size": file_record.file_size_bytes,
            "creator": file_record.creator,
            "modifier": file_record.modifier,
            "created_at": file_record.created_at,
            "modified_at": file_record.modified_at,
            "tags": file_record.tags,
            "node_ref": file_record.node_ref,
            "site": file_record.site,
        },
    ).fetchone()
    target_session.commit()
    return row[0], uuid_filename


# ---------------------------------------------------------------------------
# Migration revert
# ---------------------------------------------------------------------------

def revert_migration(job_id: int, local_session: Session, target_session: Session) -> int:
    """
    Roll back all target-DB rows and local UUID files created for this job.

    Steps:
    1. Collect target_file_id and uuid_filename from MigrationRecords (status=migrated).
    2. DELETE from target files table.
    3. Delete UUID files from target-storage/.
    4. Prune now-empty folders (bottom-up, only if no remaining files or children).
    5. Delete ALL MigrationRecord rows for this job (clean slate for retry).
    6. Reset job.status → 'done'.

    Returns the number of files reverted.
    """
    migrated_records = (
        local_session.query(MigrationRecord)
        .filter(
            MigrationRecord.job_id == job_id,
            MigrationRecord.status == MigrationStatus.migrated,
        )
        .all()
    )

    reverted = 0
    folder_ids_used: set[str] = set()

    for mr in migrated_records:
        # Delete from target files table
        if mr.target_file_id:
            try:
                target_session.execute(
                    text("DELETE FROM files WHERE id = CAST(:fid AS uuid)"),
                    {"fid": mr.target_file_id},
                )
                target_session.commit()
            except Exception:
                target_session.rollback()
                logger.warning("Could not delete target file id=%s", mr.target_file_id)

        # Delete UUID file from disk
        if mr.uuid_filename:
            try:
                dest = settings.target_storage_path / mr.uuid_filename
                if dest.exists():
                    dest.unlink()
            except Exception:
                logger.warning("Could not delete file on disk: %s", mr.uuid_filename)

        if mr.target_folder_id:
            folder_ids_used.add(mr.target_folder_id)

        reverted += 1

    # Prune empty folders (bottom-up — deeper folders first, no remaining files/children)
    for folder_id in folder_ids_used:
        _prune_folder_if_empty(target_session, folder_id)

    # Remove all MigrationRecord rows for this job (clean slate)
    local_session.query(MigrationRecord).filter(
        MigrationRecord.job_id == job_id
    ).delete(synchronize_session=False)
    local_session.commit()

    logger.info("[Revert] Reverted %d migrated files for job %d", reverted, job_id)
    return reverted


def _prune_folder_if_empty(target_session: Session, folder_id: str) -> None:
    """
    Delete a folder (and walk up to its ancestors) if it has no remaining files
    and no child folders. Shared folders used by other jobs are preserved.
    """
    current = folder_id
    while current:
        try:
            has_files = target_session.execute(
                text("SELECT 1 FROM files WHERE folder_id = CAST(:fid AS uuid) LIMIT 1"),
                {"fid": current},
            ).fetchone()
            if has_files:
                break  # Still has files — stop pruning

            has_children = target_session.execute(
                text("SELECT 1 FROM folders WHERE parent_id = CAST(:fid AS uuid) LIMIT 1"),
                {"fid": current},
            ).fetchone()
            if has_children:
                break  # Still has sub-folders — stop pruning

            # Fetch parent before deleting
            parent_row = target_session.execute(
                text("SELECT parent_id::text FROM folders WHERE id = CAST(:fid AS uuid)"),
                {"fid": current},
            ).fetchone()
            parent_id = parent_row[0] if parent_row else None

            target_session.execute(
                text("DELETE FROM folders WHERE id = CAST(:fid AS uuid)"),
                {"fid": current},
            )
            target_session.commit()
            logger.debug("[Revert] Deleted empty folder id=%s", current)
            current = parent_id  # Walk up
        except Exception:
            target_session.rollback()
            break


# ---------------------------------------------------------------------------
# SQL script generator
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Path parsing helper
# ---------------------------------------------------------------------------

def parse_folder_parts(full_path: str) -> list[str]:
    """
    Extract folder segments from a full_path string.
    e.g. '/docs/reports/file.pdf' → ['docs', 'reports']
         '/file.pdf'               → []
    """
    parts = [p for p in full_path.strip("/").split("/") if p]
    return parts[:-1] if len(parts) > 1 else []
