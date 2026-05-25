"""
Browser/explorer queries: folder children, parent lookup, and file search.
Used by the Site Explorer API to let users lazily navigate the Alfresco tree.
"""
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .constants import NS_CM, NS_APP
from .shortcuts import _detect_shortcut_types, _resolve_filelink_nodes, resolve_shortcut_target

logger = logging.getLogger(__name__)


def get_parent_node_id(db: Session, node_id: int) -> Optional[int]:
    """Return the primary parent node_id of a given node, or None."""
    sql = text("""
        SELECT parent_node_id
        FROM alf_child_assoc
        WHERE child_node_id = :node_id AND is_primary = TRUE
        LIMIT 1
    """)
    row = db.execute(sql, {"node_id": node_id}).fetchone()
    return row.parent_node_id if row else None


def get_folder_children(db: Session, parent_node_id: int) -> dict:
    """
    Return all direct child folders and files of a node via cm:contains associations.
    Nodes with cm:content property are treated as files; others as folders.
    Transparently resolves app:folderlink and app:filelink shortcuts:
      - app:folderlink parent → redirected to target folder's children.
      - app:filelink children → resolved to their target's file content info.
    """
    # If this node itself is a folder shortcut, browse the target instead
    shortcut_target = resolve_shortcut_target(db, parent_node_id)
    if shortcut_target is not None:
        logger.info(
            "Node %d is a folder shortcut → redirecting browse to target %d",
            parent_node_id, shortcut_target,
        )
        return get_folder_children(db, shortcut_target)

    # Resolve the cm:contains and cm:content qname IDs once
    qname_sql = text("""
        SELECT q.local_name, q.id
        FROM alf_qname q
        JOIN alf_namespace ns ON q.ns_id = ns.id
        WHERE ns.uri = :ns_cm AND q.local_name IN ('contains', 'content')
    """)
    qname_rows = db.execute(qname_sql, {"ns_cm": NS_CM}).fetchall()
    qname_map = {r.local_name: r.id for r in qname_rows}
    contains_qid = qname_map.get("contains")
    content_qid = qname_map.get("content")

    if not contains_qid or not content_qid:
        return {"folders": [], "files": []}

    # Fetch all primary children via cm:contains
    children_sql = text("""
        SELECT ca.child_node_id AS node_id, ca.child_node_name AS name
        FROM alf_child_assoc ca
        WHERE ca.parent_node_id = :parent_id
          AND ca.type_qname_id  = :contains_qid
          AND ca.is_primary = TRUE
        ORDER BY ca.child_node_name
    """)
    children = db.execute(children_sql, {
        "parent_id": parent_node_id,
        "contains_qid": contains_qid,
    }).fetchall()

    if not children:
        return {"folders": [], "files": []}

    child_ids = [c.node_id for c in children]
    child_name_map = {c.node_id: (c.name or "") for c in children}

    # Identify which children are files (have cm:content property)
    placeholders = ", ".join(f":id_{i}" for i in range(len(child_ids)))
    file_sql = text(f"""
        SELECT DISTINCT np.node_id
        FROM alf_node_properties np
        WHERE np.node_id IN ({placeholders})
          AND np.qname_id = :content_qid
    """)
    params = {f"id_{i}": nid for i, nid in enumerate(child_ids)}
    params["content_qid"] = content_qid
    file_node_ids = {r.node_id for r in db.execute(file_sql, params).fetchall()}

    # For files: fetch mime type and size in bulk
    file_info: dict[int, dict] = {}
    if file_node_ids:
        finfo_placeholders = ", ".join(f":fid_{i}" for i, _ in enumerate(file_node_ids))
        finfo_sql = text(f"""
            SELECT
                np.node_id,
                mt.mimetype_str,
                cu.content_size,
                n.audit_modifier,
                n.audit_modified
            FROM alf_node_properties np
            JOIN alf_content_data  cd  ON cd.id = np.long_value
            JOIN alf_content_url   cu  ON cu.id = cd.content_url_id
            LEFT JOIN alf_mimetype mt  ON mt.id = cd.content_mimetype_id
            JOIN alf_node n            ON n.id  = np.node_id
            WHERE np.node_id IN ({finfo_placeholders})
              AND np.qname_id = :content_qid
        """)
        fparams = {f"fid_{i}": nid for i, nid in enumerate(file_node_ids)}
        fparams["content_qid"] = content_qid
        for r in db.execute(finfo_sql, fparams).fetchall():
            file_info[r.node_id] = {
                "mime_type": r.mimetype_str,
                "size_bytes": r.content_size,
                "modifier": r.audit_modifier,
                "modified_at": str(r.audit_modified) if r.audit_modified else None,
            }

    # For folders: check which ones have further children
    folder_node_ids = [nid for nid in child_ids if nid not in file_node_ids]

    # Detect app:filelink and app:folderlink shortcuts among folder-type children
    shortcut_type_map = _detect_shortcut_types(db, folder_node_ids) if folder_node_ids else {}
    filelink_ids = [nid for nid, t in shortcut_type_map.items() if t == "filelink"]

    # Resolve file info for app:filelink children (treat them as files)
    filelink_info: dict[int, dict] = {}
    if filelink_ids:
        logger.info("Resolving %d app:filelink child shortcut(s)", len(filelink_ids))
        content_qid_row = db.execute(text("""
            SELECT q.id FROM alf_qname q JOIN alf_namespace ns ON q.ns_id = ns.id
            WHERE ns.uri = :ns_cm AND q.local_name = 'content' LIMIT 1
        """), {"ns_cm": NS_CM}).fetchone()
        if content_qid_row:
            fl_placeholders = ", ".join(f":flid_{i}" for i in range(len(filelink_ids)))
            fl_sql = text(f"""
                SELECT
                    na.source_node_id AS shortcut_id,
                    mt.mimetype_str   AS mime_type,
                    cu.content_size   AS size_bytes,
                    target_n.audit_modifier,
                    target_n.audit_modified
                FROM alf_node_assoc na
                JOIN alf_qname  assoc_q  ON na.type_qname_id = assoc_q.id
                JOIN alf_namespace assoc_ns ON assoc_q.ns_id = assoc_ns.id
                JOIN alf_node target_n   ON target_n.id = na.target_node_id
                JOIN alf_node_properties np
                     ON np.node_id  = na.target_node_id
                    AND np.qname_id = :content_qid
                JOIN alf_content_data cd  ON cd.id = np.long_value
                JOIN alf_content_url  cu  ON cu.id = cd.content_url_id
                LEFT JOIN alf_mimetype mt ON mt.id = cd.content_mimetype_id
                WHERE na.source_node_id IN ({fl_placeholders})
                  AND assoc_ns.uri = :ns_app
                  AND assoc_q.local_name = 'linkedNode'
            """)
            fl_params = {f"flid_{i}": nid for i, nid in enumerate(filelink_ids)}
            fl_params["content_qid"] = content_qid_row.id
            fl_params["ns_app"] = NS_APP
            for r in db.execute(fl_sql, fl_params).fetchall():
                filelink_info[r.shortcut_id] = {
                    "mime_type": r.mime_type,
                    "size_bytes": r.size_bytes,
                    "modifier": r.audit_modifier,
                    "modified_at": str(r.audit_modified) if r.audit_modified else None,
                }

    # True folder node_ids (exclude filelink shortcuts from folder list)
    true_folder_ids = [nid for nid in folder_node_ids if nid not in shortcut_type_map or shortcut_type_map[nid] == "folderlink"]

    folders_with_children: set[int] = set()
    if true_folder_ids:
        hc_placeholders = ", ".join(f":hcid_{i}" for i, _ in enumerate(true_folder_ids))
        hc_sql = text(f"""
            SELECT DISTINCT parent_node_id
            FROM alf_child_assoc
            WHERE parent_node_id IN ({hc_placeholders})
              AND is_primary = TRUE
        """)
        hcparams = {f"hcid_{i}": nid for i, nid in enumerate(true_folder_ids)}
        folders_with_children = {r.parent_node_id for r in db.execute(hc_sql, hcparams).fetchall()}

    # app:folderlink shortcuts always show as expandable (target may have children)
    folderlink_ids_set = {nid for nid, t in shortcut_type_map.items() if t == "folderlink"}

    folders = [
        {
            "node_id": nid,
            "name": child_name_map[nid],
            "has_children": nid in folders_with_children or nid in folderlink_ids_set,
            "is_shortcut": nid in folderlink_ids_set,
        }
        for nid in child_ids
        if nid not in file_node_ids and nid not in filelink_info
    ]

    # Regular files + resolved app:filelink shortcuts
    files = [
        {
            "node_id": nid,
            "name": child_name_map[nid],
            **file_info.get(nid, {"mime_type": None, "size_bytes": None, "modifier": None, "modified_at": None}),
            "is_shortcut": False,
        }
        for nid in child_ids
        if nid in file_node_ids
    ] + [
        {
            "node_id": nid,
            "name": child_name_map[nid],
            **filelink_info[nid],
            "is_shortcut": True,
        }
        for nid in filelink_ids
        if nid in filelink_info
    ]

    return {"folders": folders, "files": files}


def search_files(db: Session, doclib_node_id: int, query: str, limit: int = 50) -> list[dict]:
    """
    Search for file nodes by name (case-insensitive substring) within the doclib subtree.
    Uses a recursive CTE to traverse the full tree without depth-limited N+1 queries.
    Returns FileNodeBrief-compatible dicts.
    """
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
            SELECT ca.child_node_id AS node_id, ca.child_node_name AS node_name, 0 AS depth
            FROM alf_child_assoc ca
            JOIN contains_qid cq ON ca.type_qname_id = cq.id
            WHERE ca.parent_node_id = :doclib_id AND ca.is_primary = TRUE

            UNION ALL

            SELECT ca.child_node_id, ca.child_node_name, t.depth + 1
            FROM alf_child_assoc ca
            JOIN tree t ON ca.parent_node_id = t.node_id
            JOIN contains_qid cq ON ca.type_qname_id = cq.id
            WHERE t.depth < 50 AND ca.is_primary = TRUE
        )
        SELECT
            t.node_id,
            t.node_name AS name,
            mt.mimetype_str     AS mime_type,
            cu.content_size     AS size_bytes,
            n.audit_modifier    AS modifier,
            n.audit_modified    AS modified_at
        FROM tree t
        JOIN alf_node n          ON n.id  = t.node_id
        -- only nodes that have actual content (files)
        JOIN alf_node_properties np
             ON np.node_id = t.node_id
            AND np.qname_id = (SELECT id FROM content_qid)
        JOIN alf_content_data  cd ON cd.id = np.long_value
        JOIN alf_content_url   cu ON cu.id = cd.content_url_id
        LEFT JOIN alf_mimetype mt ON mt.id = cd.content_mimetype_id
        WHERE LOWER(t.node_name) LIKE LOWER(:q)
        ORDER BY t.node_name
        LIMIT :lim
    """)
    rows = db.execute(sql, {
        "ns_cm": NS_CM,
        "doclib_id": doclib_node_id,
        "q": f"%{query}%",
        "lim": limit,
    }).fetchall()
    return [
        {
            "node_id": r.node_id,
            "name": r.name,
            "mime_type": r.mime_type,
            "size_bytes": r.size_bytes,
            "modifier": r.modifier,
            "modified_at": str(r.modified_at) if r.modified_at else None,
        }
        for r in rows
    ]
