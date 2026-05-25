"""
Target-DB folder management: create, find, and prune folder rows
for the migration phase (Alfresco → target file-manager system).
"""
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


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
