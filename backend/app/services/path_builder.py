"""
Recursively resolves the full folder path of a node relative to its site's documentLibrary.
"""
import logging
from functools import lru_cache
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_PATH_CACHE: dict[int, str] = {}


def resolve_path(db: Session, node_id: int, doclib_node_id: int) -> str:
    """
    Walk alf_child_assoc upward from node_id to doclib_node_id.
    Returns the full path string, e.g. '/Marketing/Campaigns/Q1/file.pdf'
    The file_name (last segment) is included.
    """
    if node_id in _PATH_CACHE:
        return _PATH_CACHE[node_id]

    segments = []
    current_id = node_id

    for _ in range(100):  # depth guard
        sql = text("""
            SELECT ca.parent_node_id, ca.child_node_name
            FROM alf_child_assoc ca
            WHERE ca.child_node_id = :child_id
              AND ca.is_primary = TRUE
            LIMIT 1
        """)
        row = db.execute(sql, {"child_id": current_id}).fetchone()

        if not row:
            logger.warning("Path traversal: no parent found for node_id=%s", current_id)
            break

        segments.append(row.child_node_name or "")
        parent_id = row.parent_node_id

        if parent_id == doclib_node_id:
            break

        current_id = parent_id

    segments.reverse()
    path = "/" + "/".join(s for s in segments if s)
    _PATH_CACHE[node_id] = path
    return path


def clear_cache():
    """Clear the path cache between jobs."""
    _PATH_CACHE.clear()
