"""
All queries against Alfresco's PostgreSQL database (alf_* tables).
This is the ONLY file that should contain raw SQL against Alfresco's schema.
All connections are read-only.
"""
import logging
from typing import Optional
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Namespace constants
NS_CM = "http://www.alfresco.org/model/content/1.0"
NS_ST = "http://www.alfresco.org/model/site/1.0"
NS_SYS = "http://www.alfresco.org/model/system/1.0"
NS_APP = "http://www.alfresco.org/model/application/1.0"


def list_sites(db: Session) -> list[dict]:
    """Return all st:site nodes with their short name and title."""
    sql = text("""
        SELECT
            n.id                                        AS node_id,
            n.uuid                                      AS uuid,
            prop_name.string_value                      AS short_name,
            prop_title.string_value                     AS title,
            prop_desc.string_value                      AS description
        FROM alf_node n
        JOIN alf_qname type_qname  ON n.type_qname_id  = type_qname.id
        JOIN alf_namespace type_ns ON type_qname.ns_id  = type_ns.id
        -- short name property (cm:name)
        LEFT JOIN alf_node_properties prop_name
            ON prop_name.node_id = n.id
           AND prop_name.qname_id = (
               SELECT q.id FROM alf_qname q
               JOIN alf_namespace ns2 ON q.ns_id = ns2.id
               WHERE ns2.uri = :ns_cm AND q.local_name = 'name'
               LIMIT 1)
        -- title property (cm:title)
        LEFT JOIN alf_node_properties prop_title
            ON prop_title.node_id = n.id
           AND prop_title.qname_id = (
               SELECT q.id FROM alf_qname q
               JOIN alf_namespace ns2 ON q.ns_id = ns2.id
               WHERE ns2.uri = :ns_cm AND q.local_name = 'title'
               LIMIT 1)
        -- description property (cm:description)
        LEFT JOIN alf_node_properties prop_desc
            ON prop_desc.node_id = n.id
           AND prop_desc.qname_id = (
               SELECT q.id FROM alf_qname q
               JOIN alf_namespace ns2 ON q.ns_id = ns2.id
               WHERE ns2.uri = :ns_cm AND q.local_name = 'description'
               LIMIT 1)
        WHERE type_ns.uri = :ns_st
          AND type_qname.local_name = 'site'
        ORDER BY prop_name.string_value
    """)
    rows = db.execute(sql, {"ns_cm": NS_CM, "ns_st": NS_ST}).fetchall()
    return [
        {
            "node_id": r.node_id,
            "uuid": r.uuid,
            "short_name": r.short_name or r.uuid,
            "title": r.title or r.short_name or r.uuid,
            "description": r.description,
        }
        for r in rows
    ]


def get_site_doclib_node_id(db: Session, site_node_id: int) -> Optional[int]:
    """Return the node_id of the documentLibrary child of a site node."""
    sql = text("""
        SELECT ca.child_node_id
        FROM alf_child_assoc ca
        WHERE ca.parent_node_id = :site_node_id
          AND lower(ca.child_node_name) = 'documentlibrary'
        LIMIT 1
    """)
    row = db.execute(sql, {"site_node_id": site_node_id}).fetchone()
    return row.child_node_id if row else None


def resolve_shortcut_target(db: Session, node_id: int) -> Optional[int]:
    """
    If node_id is an app:filelink or app:folderlink shortcut, return the target node_id
    via the app:linkedNode peer association. Returns None if the node is not a shortcut.
    """
    sql = text("""
        SELECT na.target_node_id
        FROM alf_node n
        JOIN alf_qname  type_q  ON n.type_qname_id  = type_q.id
        JOIN alf_namespace type_ns ON type_q.ns_id  = type_ns.id
        JOIN alf_node_assoc na   ON na.source_node_id = n.id
        JOIN alf_qname  assoc_q  ON na.type_qname_id  = assoc_q.id
        JOIN alf_namespace assoc_ns ON assoc_q.ns_id  = assoc_ns.id
        WHERE n.id = :node_id
          AND type_ns.uri  = :ns_app
          AND type_q.local_name  IN ('filelink', 'folderlink')
          AND assoc_ns.uri = :ns_app
          AND assoc_q.local_name = 'linkedNode'
        LIMIT 1
    """)
    row = db.execute(sql, {"node_id": node_id, "ns_app": NS_APP}).fetchone()
    return row.target_node_id if row else None


def _detect_shortcut_types(db: Session, node_ids: list[int]) -> dict[int, str]:
    """
    For a batch of node_ids, return a dict of {node_id: type_local_name} for those
    that are app:filelink or app:folderlink shortcuts. Non-shortcuts are omitted.
    """
    if not node_ids:
        return {}
    placeholders = ", ".join(f":nid_{i}" for i in range(len(node_ids)))
    sql = text(f"""
        SELECT n.id AS node_id, q.local_name AS type_local_name
        FROM alf_node n
        JOIN alf_qname q    ON n.type_qname_id = q.id
        JOIN alf_namespace ns ON q.ns_id = ns.id
        WHERE n.id IN ({placeholders})
          AND ns.uri = :ns_app
          AND q.local_name IN ('filelink', 'folderlink')
    """)
    params = {f"nid_{i}": nid for i, nid in enumerate(node_ids)}
    params["ns_app"] = NS_APP
    rows = db.execute(sql, params).fetchall()
    return {r.node_id: r.type_local_name for r in rows}


def _find_shortcuts_in_tree(db: Session, root_id: int) -> dict[str, list[int]]:
    """
    Scan the cm:contains tree rooted at root_id and return two lists:
      - filelinks:   node_ids of app:filelink nodes
      - folderlinks: node_ids of app:folderlink nodes
    """
    sql = text("""
        WITH RECURSIVE
        contains_qid AS (
            SELECT q.id FROM alf_qname q JOIN alf_namespace ns ON q.ns_id = ns.id
            WHERE ns.uri = :ns_cm AND q.local_name = 'contains' LIMIT 1
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
        SELECT DISTINCT n.id AS node_id, q.local_name AS type_local_name
        FROM tree
        JOIN alf_node n     ON n.id  = tree.node_id
        JOIN alf_qname q    ON q.id  = n.type_qname_id
        JOIN alf_namespace ns ON ns.id = q.ns_id
        WHERE ns.uri = :ns_app AND q.local_name IN ('filelink', 'folderlink')
    """)
    rows = db.execute(sql, {"root_id": root_id, "ns_cm": NS_CM, "ns_app": NS_APP}).fetchall()
    result: dict[str, list[int]] = {"filelinks": [], "folderlinks": []}
    for r in rows:
        key = "filelinks" if r.type_local_name == "filelink" else "folderlinks"
        result[key].append(r.node_id)
    return result


def _resolve_filelink_nodes(db: Session, shortcut_node_ids: list[int]) -> list[dict]:
    """
    For a list of app:filelink shortcut node_ids, resolve content_url and file_size_bytes
    from each shortcut's linked target node. The returned node_id and uuid belong to the
    shortcut itself (so path resolution uses the shortcut's location in the tree).
    Shortcuts whose target has no content are silently skipped.
    """
    if not shortcut_node_ids:
        return []
    content_qid_row = db.execute(text("""
        SELECT q.id FROM alf_qname q JOIN alf_namespace ns ON q.ns_id = ns.id
        WHERE ns.uri = :ns_cm AND q.local_name = 'content' LIMIT 1
    """), {"ns_cm": NS_CM}).fetchone()
    if not content_qid_row:
        return []
    content_qid = content_qid_row.id

    placeholders = ", ".join(f":sid_{i}" for i in range(len(shortcut_node_ids)))
    sql = text(f"""
        SELECT
            shortcut.id   AS node_id,
            shortcut.uuid AS uuid,
            cu.content_url,
            cu.content_size AS file_size_bytes
        FROM alf_node shortcut
        JOIN alf_node_assoc na ON na.source_node_id = shortcut.id
        JOIN alf_qname  assoc_q  ON na.type_qname_id = assoc_q.id
        JOIN alf_namespace assoc_ns ON assoc_q.ns_id = assoc_ns.id
        JOIN alf_node_properties np
             ON np.node_id  = na.target_node_id
            AND np.qname_id = :content_qid
        JOIN alf_content_data cd  ON cd.id = np.long_value
        JOIN alf_content_url  cu  ON cu.id = cd.content_url_id
        WHERE shortcut.id IN ({placeholders})
          AND assoc_ns.uri = :ns_app
          AND assoc_q.local_name = 'linkedNode'
    """)
    params = {f"sid_{i}": nid for i, nid in enumerate(shortcut_node_ids)}
    params["content_qid"] = content_qid
    params["ns_app"] = NS_APP
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


def get_all_file_nodes(
    db: Session,
    doclib_node_id: int,
    _visited: Optional[set[int]] = None,
    _path_prefix: Optional[str] = None,
    _path_root_id: Optional[int] = None,
) -> list[dict]:
    """
    Recursively fetch all file nodes (nodes with cm:content type) under doclib.
    Also transparently resolves app:filelink and app:folderlink shortcuts:
      - app:filelink: included with content from target, path from shortcut's own location.
      - app:folderlink: target folder is recursed; paths use the shortcut folder's location
        as prefix and resolve relative within the target subtree.

    _visited: cycle guard for shortcut chains (auto-initialized on first call).
    _path_prefix / _path_root_id: internal — set when recursing into folder shortcuts.
    """
    if _visited is None:
        _visited = set()
    if doclib_node_id in _visited:
        logger.warning("Circular shortcut detected at node %d — skipping", doclib_node_id)
        return []
    _visited.add(doclib_node_id)

    # 1. Regular file nodes via recursive CTE
    sql = text("""
        WITH RECURSIVE
        contains_qid AS (
            SELECT q.id
            FROM alf_qname q
            JOIN alf_namespace ns ON q.ns_id = ns.id
            WHERE ns.uri = :ns_cm AND q.local_name = 'contains'
            LIMIT 1
        ),
        tree AS (
            SELECT ca.child_node_id AS node_id, 0 AS depth
            FROM alf_child_assoc ca
            JOIN contains_qid cq ON ca.type_qname_id = cq.id
            WHERE ca.parent_node_id = :root_id
              AND ca.is_primary = TRUE

            UNION ALL

            SELECT ca.child_node_id, t.depth + 1
            FROM alf_child_assoc ca
            JOIN tree t ON ca.parent_node_id = t.node_id
            JOIN contains_qid cq ON ca.type_qname_id = cq.id
            WHERE t.depth < 50
              AND ca.is_primary = TRUE
        )
        SELECT DISTINCT
            n.id            AS node_id,
            n.uuid          AS uuid,
            cu.content_url  AS content_url,
            cu.content_size AS file_size_bytes
        FROM tree
        JOIN alf_node n ON n.id = tree.node_id
        JOIN alf_content_data cd ON cd.id = (
            SELECT np.long_value
            FROM alf_node_properties np
            WHERE np.node_id = n.id
              AND np.qname_id = (
                  SELECT q.id FROM alf_qname q
                  JOIN alf_namespace ns ON q.ns_id = ns.id
                  WHERE ns.uri = :ns_cm AND q.local_name = 'content'
                  LIMIT 1)
            LIMIT 1)
        JOIN alf_content_url cu ON cu.id = cd.content_url_id
    """)
    rows = db.execute(sql, {"root_id": doclib_node_id, "ns_cm": NS_CM}).fetchall()
    results: list[dict] = [
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

    # 4. Recurse into app:folderlink targets
    if shortcuts["folderlinks"]:
        logger.info(
            "Found %d app:folderlink shortcut(s) under node %d",
            len(shortcuts["folderlinks"]), doclib_node_id,
        )
        # Import here to avoid circular import; path_builder is a sibling module
        from app.services.path_builder import resolve_path as _resolve_path  # noqa: PLC0415
        for folderlink_id in shortcuts["folderlinks"]:
            target_id = resolve_shortcut_target(db, folderlink_id)
            if target_id is None or target_id in _visited:
                if target_id in _visited:
                    logger.warning(
                        "Circular folder shortcut: node %d → %d already visited",
                        folderlink_id, target_id,
                    )
                continue
            # Compute the shortcut folder's own path in the current site tree
            try:
                shortcut_path = _resolve_path(db, folderlink_id, doclib_node_id)
            except Exception:
                shortcut_path = ""
            logger.info(
                "Following folder shortcut node %d (path=%s) → target %d",
                folderlink_id, shortcut_path, target_id,
            )
            sub_nodes = get_all_file_nodes(
                db, target_id, _visited,
                _path_prefix=shortcut_path,
                _path_root_id=target_id,
            )
            for node in sub_nodes:
                if node["node_id"] not in seen_ids:
                    seen_ids.add(node["node_id"])
                    results.append(node)

    return results


def get_node_properties(db: Session, node_id: int) -> dict:
    """Fetch all relevant metadata properties for a single node."""
    sql = text("""
        SELECT
            q.local_name,
            ns.uri          AS namespace,
            np.string_value,
            np.long_value,
            np.float_value,
            np.boolean_value,
            np.serializable_value
        FROM alf_node_properties np
        JOIN alf_qname q     ON np.qname_id = q.id
        JOIN alf_namespace ns ON q.ns_id = ns.id
        WHERE np.node_id = :node_id
          AND ns.uri = :ns_cm
    """)
    rows = db.execute(sql, {"node_id": node_id, "ns_cm": NS_CM}).fetchall()
    props = {}
    for r in rows:
        key = r.local_name
        value = r.string_value or r.serializable_value
        if value is None and r.long_value is not None:
            value = r.long_value
        props[key] = value
    return props


def get_node_audit_info(db: Session, node_id: int) -> dict:
    """Fetch creator, modifier, createdDate, modifiedDate from alf_node audit columns."""
    sql = text("""
        SELECT audit_creator, audit_created, audit_modifier, audit_modified
        FROM alf_node
        WHERE id = :node_id
    """)
    row = db.execute(sql, {"node_id": node_id}).fetchone()
    if not row:
        return {}
    return {
        "creator":  row.audit_creator,
        "created":  row.audit_created,
        "modifier": row.audit_modifier,
        "modified": row.audit_modified,
    }


def get_node_mime_type(db: Session, node_id: int) -> Optional[str]:
    """Fetch MIME type from alf_mimetype via alf_content_data."""
    sql = text("""
        SELECT mt.mimetype_str
        FROM alf_node_properties np
        JOIN alf_content_data cd  ON cd.id = np.long_value
        JOIN alf_mimetype mt      ON mt.id = cd.content_mimetype_id
        WHERE np.node_id = :node_id
          AND np.qname_id = (
              SELECT q.id FROM alf_qname q
              JOIN alf_namespace ns ON q.ns_id = ns.id
              WHERE ns.uri = :ns_cm AND q.local_name = 'content'
              LIMIT 1)
        LIMIT 1
    """)
    row = db.execute(sql, {"node_id": node_id, "ns_cm": NS_CM}).fetchone()
    return row.mimetype_str if row else None


def get_node_tags(db: Session, node_id: int) -> list[str]:
    """Return tag names applied to a node via the taggable aspect."""
    sql = text("""
        SELECT tag_name.string_value AS tag
        FROM alf_child_assoc ca
        JOIN alf_node tag_node ON tag_node.id = ca.child_node_id
        JOIN alf_node_properties tag_name
             ON tag_name.node_id = tag_node.id
            AND tag_name.qname_id = (
                SELECT q.id FROM alf_qname q
                JOIN alf_namespace ns ON q.ns_id = ns.id
                WHERE ns.uri = :ns_cm AND q.local_name = 'name'
                LIMIT 1)
        WHERE ca.parent_node_id = :node_id
          AND ca.type_qname_id = (
              SELECT q.id FROM alf_qname q
              JOIN alf_namespace ns ON q.ns_id = ns.id
              WHERE ns.uri = 'http://www.alfresco.org/model/tagging/1.0'
                AND q.local_name = 'taggedWith'
              LIMIT 1)
    """)
    rows = db.execute(sql, {"node_id": node_id, "ns_cm": NS_CM}).fetchall()
    return [r.tag for r in rows if r.tag]


# ---------------------------------------------------------------------------
# Browse / Explorer API helpers
# ---------------------------------------------------------------------------

def get_site_node_and_doclib(db: Session, site_name: str) -> Optional[dict]:
    """
    Return the site node_id and documentLibrary node_id for a given site short name.
    Returns None if the site is not found.
    """
    sql = text("""
        SELECT
            n.id                        AS site_node_id,
            doclib.child_node_id        AS doclib_node_id
        FROM alf_node n
        JOIN alf_qname type_qname  ON n.type_qname_id  = type_qname.id
        JOIN alf_namespace type_ns ON type_qname.ns_id  = type_ns.id
        JOIN alf_node_properties prop_name
             ON prop_name.node_id = n.id
            AND prop_name.qname_id = (
                SELECT q.id FROM alf_qname q
                JOIN alf_namespace ns2 ON q.ns_id = ns2.id
                WHERE ns2.uri = :ns_cm AND q.local_name = 'name'
                LIMIT 1)
        LEFT JOIN alf_child_assoc doclib
             ON doclib.parent_node_id = n.id
            AND lower(doclib.child_node_name) = 'documentlibrary'
        WHERE type_ns.uri  = :ns_st
          AND type_qname.local_name = 'site'
          AND prop_name.string_value  = :site_name
        LIMIT 1
    """)
    row = db.execute(sql, {"ns_cm": NS_CM, "ns_st": NS_ST, "site_name": site_name}).fetchone()
    if not row:
        return None
    return {
        "site_node_id": row.site_node_id,
        "doclib_node_id": row.doclib_node_id,
    }


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

