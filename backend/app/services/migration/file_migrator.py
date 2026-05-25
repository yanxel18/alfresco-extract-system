"""
File migration: copy an extracted file to target-storage/ (UUID-named) and
insert a row into the target DB files table.
"""
import logging
import os
import shutil
import uuid as uuid_lib
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.job import FileRecord

logger = logging.getLogger(__name__)


def migrate_file_record(
    target_session: Session,
    file_record: FileRecord,
    folder_id: str,
) -> tuple[str, str, bool]:
    """
    Copy the physical file to target-storage/ (UUID-named) and INSERT a row
    into the target DB files table.

    Returns (target_file_id, uuid_filename, is_duplicate).
    is_duplicate=True means the node_ref already existed in the target DB —
    no file was copied and the existing record was reused.
    Raises FileNotFoundError if the source file is missing.
    """
    if not file_record.local_export_path:
        raise ValueError(f"FileRecord {file_record.id} has no local_export_path")

    # Deduplication check: if this Alfresco node was already migrated (from another
    # job or a re-run), reuse the existing target file row instead of inserting a duplicate.
    if file_record.node_ref:
        existing = target_session.execute(
            text("SELECT id::text, uuid_filename FROM files WHERE source_node_ref = :nr LIMIT 1"),
            {"nr": file_record.node_ref},
        ).fetchone()
        if existing:
            return existing[0], existing[1], True

    src = Path(file_record.local_export_path)
    if not src.exists():
        raise FileNotFoundError(f"Source file not found: {src}")

    ext = Path(file_record.file_name).suffix  # keeps e.g. ".pdf"
    new_uuid = str(uuid_lib.uuid4())
    uuid_filename = new_uuid + ext

    os.makedirs(str(settings.target_storage_path), exist_ok=True)
    dest = settings.target_storage_path / uuid_filename
    if dest.exists():
        dest.unlink()

    # Hard-link is instantaneous when source and dest share the same filesystem.
    # Falls back to a full copy (cross-device / cross-volume).
    try:
        os.link(str(src), str(dest))
    except OSError:
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
    return row[0], uuid_filename, False


def parse_folder_parts(full_path: str) -> list[str]:
    """
    Extract folder segments from a full_path string.
    e.g. '/docs/reports/file.pdf' → ['docs', 'reports']
         '/file.pdf'               → []
    """
    parts = [p for p in full_path.strip("/").split("/") if p]
    return parts[:-1] if len(parts) > 1 else []
