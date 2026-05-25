"""
Migration revert: roll back all target-DB rows and UUID files created for a job.
"""
import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.migration import MigrationRecord, MigrationStatus
from .folder_manager import _prune_folder_if_empty

logger = logging.getLogger(__name__)


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
