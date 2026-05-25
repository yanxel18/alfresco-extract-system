"""
Queries for fetching file node lists and recursive size calculations from Alfresco.
Handles shortcut (app:filelink / app:folderlink) resolution transparently.
"""
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .constants import NS_CM
from .shortcuts import (
    _find_shortcuts_in_tree,
    _resolve_filelink_nodes,
    resolve_shortcut_target,
)

logger = logging.getLogger(__name__)


def get_all_file_nodes(
    db: Session,
    doclib_node_id: int,
    _visited: Optional[set[int]] = None,
    *,
    _path_prefix: str = "",
    _path_root_id: Optional[int] = None,
) -> list[dict]:
    """
    Return every file node (with cm:content property) reachable from doclib_node_id
    via the recursive cm:contains tree. Transparently follows app:folderlink shortcuts
    and resolves app:filelink shortcuts so that every returned dict is an actual file.

    Each dict contains:
        node_id, uuid, content_url, file_size_bytes,
        shortcut_path_prefix, shortcut_path_root_id
    """
    if _visited is None:
        _visited = set()
    _visited.add(doclib_node_id)

    if _path_root_id is None:
        _path_root_id = doclib_node_id

    sql = text("""
        WITH RECURSIVE
        contains_qid AS (
            SELECT q.id
            FROM alf_qname q
            JOIN alf_namespace ns ON q.ns_id = ns.id
            WHERE ns.uri = :ns_cm AND q.local_name = 'contains'
            LIMIT 1
        ),
        content_qid AS (
            SELECT q.id
            FROM alf_qname q
            JOIN alf_namespace ns ON q.ns_id = ns.id
            WHERE ns.uri = :ns_cm AND q.local_name = 'content'
            LIMIT 1
        ),
        tree AS (
            SELECT ca.child_node_id AS node_id, 0 AS depth
            FROM alf_child_assoc ca
            JOIN contains_qid cq ON ca.type_qname_id = cq.id
            WHERE ca.parent_node_id = :root_id AND ca.is_primary = TRUE

            UNION ALL

            SELECT ca.child_node_id, t.depth + 1
            FROM alf_child_assoc ca
            JOIN tree t ON ca.parent_node_id = t.node_id
            JOIN contains_qid cq ON ca.type_qname_id = cq.id
            WHERE t.depth < 50 AND ca.is_primary = TRUE
        )
        SELECT
            n.id   AS node_id,
            n.uuid AS uuid,
            cu.content_url,
            cu.content_size AS file_size_bytes
        FROM tree
        JOIN alf_node n ON n.id = tree.node_id
        JOIN alf_node_properties np
             ON np.node_id = tree.node_id
            AND np.qname_id = (SELECT id FROM content_qid)
        JOIN alf_content_data cd ON cd.id = np.long_value
        JOIN alf_content_url  cu ON cu.id = cd.content_url_id
    """)
    rows = db.execute(sql, {"root_id": doclib_node_id, "ns_cm": NS_CM}).fetchall()
    results = [
        {
            "node_id": r.node_id,
            "uuid": r.uuid,
            "content_url": r.content_url,
            "file_size_bytes": r.file_size_bytes,
            "shortcut_path_prefix": _path_prefix,
            "shortcut_path_root_id": _path_root_id,
        }
        for r in rows
    ]
    seen_ids: set[int] = {r["node_id"] for r in results}

    # 2. Find shortcut nodes in the same cm:contains tree
    shortcuts = _find_shortcuts_in_tree(db, doclib_node_id)

    # 3. Resolve app:filelink shortcuts (content from target, path from shortcut's position)
    if shortcuts["filelinks"]:
        logger.info(
            "Found %d app:filelink shortcut(s) under node %d",
            len(shortcuts["filelinks"]), doclib_node_id,
        )
        for node in _resolve_filelink_nodes(db, shortcuts["filelinks"]):
            if node["node_id"] not in seen_ids:
                seen_ids.add(node["node_id"])
                node["shortcut_path_prefix"] = _path_prefix
                node["shortcut_path_root_id"] = _path_root_id
                results.append(node)

    # 4. Folder shortcuts are intentionally not traversed.
    if shortcuts["folderlinks"]:
        logger.info(
            "Skipping %d folder shortcut(s) under node %d",
            len(shortcuts["folderlinks"]), doclib_node_id,
        )

    return results


def get_file_nodes_by_ids(db: Session, node_ids: list[int]) -> list[dict]:
    """
    Fetch minimal file node info (uuid, content_url, size) for a specific list of node IDs.
    Only nodes that have actual content (cm:content property) are returned.
    """
    if not node_ids:
        return []
    content_qid_row = db.execute(text("""
        SELECT q.id FROM alf_qname q
        JOIN alf_namespace ns ON q.ns_id = ns.id
        WHERE ns.uri = :ns_cm AND q.local_name = 'content'
        LIMIT 1
    """), {"ns_cm": NS_CM}).fetchone()
    if not content_qid_row:
        return []
    content_qid = content_qid_row.id

    placeholders = ", ".join(f":id_{i}" for i in range(len(node_ids)))
    sql = text(f"""
        SELECT
            n.id        AS node_id,
            n.uuid      AS uuid,
            cu.content_url  AS content_url,
            cu.content_size AS file_size_bytes
        FROM alf_node n
        JOIN alf_node_properties np ON np.node_id = n.id AND np.qname_id = :content_qid
        JOIN alf_content_data cd    ON cd.id = np.long_value
        JOIN alf_content_url cu     ON cu.id = cd.content_url_id
        WHERE n.id IN ({placeholders})
    """)
    params = {f"id_{i}": nid for i, nid in enumerate(node_ids)}
    params["content_qid"] = content_qid
    rows = db.execute(sql, params).fetchall()
    return [
        {
            "node_id": r.node_id,
            "uuid": r.uuid,
            "content_url": r.content_url,
            "file_size_bytes": r.file_size_bytes,
            "shortcut_path_prefix": None,
            "shortcut_path_root_id": None,
        }
        for r in rows
    ]


def get_folder_recursive_size(db: Session, folder_node_ids: list[int]) -> dict[int, int]:
    """
    For each folder node_id in the list, return its total recursive file size in bytes.
    Uses a recursive CTE (cm:contains tree) + sum of alf_content_url.content_size.
    Returns {node_id: total_size_bytes}. Missing/empty folders return 0.
    """
    if not folder_node_ids:
        return {}

    results: dict[int, int] = {nid: 0 for nid in folder_node_ids}

    for folder_id in folder_node_ids:
        sql = text("""
            WITH RECURSIVE
            contains_qid AS (
                SELECT q.id
                FROM alf_qname q
                JOIN alf_namespace ns ON q.ns_id = ns.id
                WHERE ns.uri = :ns_cm AND q.local_name = 'contains'
                LIMIT 1
            ),
            content_qid AS (
                SELECT q.id
                FROM alf_qname q
                JOIN alf_namespace ns ON q.ns_id = ns.id
                WHERE ns.uri = :ns_cm AND q.local_name = 'content'
                LIMIT 1
            ),
            tree AS (
                SELECT ca.child_node_id AS node_id, 0 AS depth
                FROM alf_child_assoc ca
                JOIN contains_qid cq ON ca.type_qname_id = cq.id
                WHERE ca.parent_node_id = :root_id AND ca.is_primary = TRUE

                UNION ALL

                SELECT ca.child_node_id, t.depth + 1
                FROM alf_child_assoc ca
                JOIN tree t ON ca.parent_node_id = t.node_id
                JOIN contains_qid cq ON ca.type_qname_id = cq.id
                WHERE t.depth < 50 AND ca.is_primary = TRUE
            )
            SELECT COALESCE(SUM(cu.content_size), 0) AS total_bytes
            FROM tree
            JOIN alf_node_properties np
                 ON np.node_id = tree.node_id
                AND np.qname_id = (SELECT id FROM content_qid)
            JOIN alf_content_data cd ON cd.id = np.long_value
            JOIN alf_content_url  cu ON cu.id = cd.content_url_id
        """)
        row = db.execute(sql, {"root_id": folder_id, "ns_cm": NS_CM}).fetchone()
        results[folder_id] = int(row.total_bytes) if row and row.total_bytes else 0

    return results
