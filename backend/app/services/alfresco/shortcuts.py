"""
Helpers for resolving Alfresco app:filelink and app:folderlink shortcut nodes.
All functions are read-only queries against the Alfresco PostgreSQL schema.
"""
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .constants import NS_CM, NS_APP

logger = logging.getLogger(__name__)

NODE_REF_PREFIX = "workspace://SpacesStore/"


def _extract_uuid_from_node_ref(node_ref: Optional[str]) -> Optional[str]:
    if not node_ref or not node_ref.startswith(NODE_REF_PREFIX):
        return None
    return node_ref[len(NODE_REF_PREFIX):]


def resolve_shortcut_targets(db: Session, node_ids: list[int]) -> dict[int, int]:
    """
    Resolve shortcut node_ids to their target node_ids.

    Supports both modern app:linkedNode associations and legacy cm:destination
    properties seen in some Alfresco deployments.
    """
    if not node_ids:
        return {}

    placeholders = ", ".join(f":nid_{i}" for i in range(len(node_ids)))
    params = {f"nid_{i}": nid for i, nid in enumerate(node_ids)}
    params["ns_app"] = NS_APP

    assoc_sql = text(f"""
        SELECT n.id AS node_id, na.target_node_id
        FROM alf_node n
        JOIN alf_qname type_q ON n.type_qname_id = type_q.id
        JOIN alf_namespace type_ns ON type_q.ns_id = type_ns.id
        JOIN alf_node_assoc na ON na.source_node_id = n.id
        JOIN alf_qname assoc_q ON na.type_qname_id = assoc_q.id
        JOIN alf_namespace assoc_ns ON assoc_q.ns_id = assoc_ns.id
        WHERE n.id IN ({placeholders})
          AND type_ns.uri = :ns_app
          AND type_q.local_name IN ('filelink', 'folderlink')
          AND assoc_ns.uri = :ns_app
          AND assoc_q.local_name = 'linkedNode'
    """)
    targets = {
        r.node_id: r.target_node_id
        for r in db.execute(assoc_sql, params).fetchall()
        if r.target_node_id is not None
    }

    unresolved = [nid for nid in node_ids if nid not in targets]
    if not unresolved:
        return targets

    unresolved_placeholders = ", ".join(f":uid_{i}" for i in range(len(unresolved)))
    legacy_params = {f"uid_{i}": nid for i, nid in enumerate(unresolved)}
    legacy_params["ns_app"] = NS_APP
    legacy_params["ns_cm"] = NS_CM

    legacy_sql = text(f"""
        SELECT n.id AS node_id, np.string_value AS destination_ref
        FROM alf_node n
        JOIN alf_qname type_q ON n.type_qname_id = type_q.id
        JOIN alf_namespace type_ns ON type_q.ns_id = type_ns.id
        JOIN alf_node_properties np ON np.node_id = n.id
        JOIN alf_qname prop_q ON np.qname_id = prop_q.id
        JOIN alf_namespace prop_ns ON prop_q.ns_id = prop_ns.id
        WHERE n.id IN ({unresolved_placeholders})
          AND type_ns.uri = :ns_app
          AND type_q.local_name IN ('filelink', 'folderlink')
          AND prop_ns.uri = :ns_cm
          AND prop_q.local_name = 'destination'
    """)
    legacy_rows = db.execute(legacy_sql, legacy_params).fetchall()

    uuid_by_shortcut = {
        r.node_id: _extract_uuid_from_node_ref(r.destination_ref)
        for r in legacy_rows
        if _extract_uuid_from_node_ref(r.destination_ref)
    }
    if not uuid_by_shortcut:
        return targets

    unique_uuids = sorted(set(uuid_by_shortcut.values()))
    uuid_placeholders = ", ".join(f":uuid_{i}" for i in range(len(unique_uuids)))
    uuid_params = {f"uuid_{i}": value for i, value in enumerate(unique_uuids)}
    target_sql = text(f"""
        SELECT id, uuid
        FROM alf_node
        WHERE uuid IN ({uuid_placeholders})
    """)
    target_rows = db.execute(target_sql, uuid_params).fetchall()
    target_by_uuid = {r.uuid: r.id for r in target_rows}

    for shortcut_id, target_uuid in uuid_by_shortcut.items():
        target_id = target_by_uuid.get(target_uuid)
        if target_id is not None:
            targets[shortcut_id] = target_id

    return targets


def resolve_shortcut_target(db: Session, node_id: int) -> Optional[int]:
    """
    If node_id is an app:filelink or app:folderlink shortcut, return the target node_id
    via the app:linkedNode peer association or legacy cm:destination property.
    Returns None if the node is not a shortcut.
    """
    return resolve_shortcut_targets(db, [node_id]).get(node_id)


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

    target_by_shortcut = resolve_shortcut_targets(db, shortcut_node_ids)
    if not target_by_shortcut:
        return []

    shortcut_placeholders = ", ".join(f":sid_{i}" for i in range(len(shortcut_node_ids)))
    shortcut_params = {f"sid_{i}": nid for i, nid in enumerate(shortcut_node_ids)}
    shortcut_sql = text(f"""
        SELECT id AS node_id, uuid
        FROM alf_node
        WHERE id IN ({shortcut_placeholders})
    """)
    shortcut_rows = db.execute(shortcut_sql, shortcut_params).fetchall()
    shortcut_uuid_map = {r.node_id: r.uuid for r in shortcut_rows}

    content_qid_row = db.execute(text("""
        SELECT q.id FROM alf_qname q JOIN alf_namespace ns ON q.ns_id = ns.id
        WHERE ns.uri = :ns_cm AND q.local_name = 'content' LIMIT 1
    """), {"ns_cm": NS_CM}).fetchone()
    if not content_qid_row:
        return []

    target_ids = sorted(set(target_by_shortcut.values()))
    target_placeholders = ", ".join(f":tid_{i}" for i in range(len(target_ids)))
    content_params = {f"tid_{i}": nid for i, nid in enumerate(target_ids)}
    content_params["content_qid"] = content_qid_row.id
    content_sql = text(f"""
        SELECT
            n.id AS target_node_id,
            cu.content_url,
            cu.content_size AS file_size_bytes
        FROM alf_node n
        JOIN alf_node_properties np
             ON np.node_id = n.id
            AND np.qname_id = :content_qid
        JOIN alf_content_data cd ON cd.id = np.long_value
        JOIN alf_content_url cu ON cu.id = cd.content_url_id
        WHERE n.id IN ({target_placeholders})
    """)
    content_rows = db.execute(content_sql, content_params).fetchall()
    content_by_target = {
        r.target_node_id: {
            "content_url": r.content_url,
            "file_size_bytes": r.file_size_bytes,
        }
        for r in content_rows
    }

    results: list[dict] = []
    for shortcut_id in shortcut_node_ids:
        target_id = target_by_shortcut.get(shortcut_id)
        target_content = content_by_target.get(target_id)
        shortcut_uuid = shortcut_uuid_map.get(shortcut_id)
        if target_content is None or shortcut_uuid is None:
            continue
        results.append(
            {
                "node_id": shortcut_id,
                "uuid": shortcut_uuid,
                "content_url": target_content["content_url"],
                "file_size_bytes": target_content["file_size_bytes"],
                "shortcut_path_prefix": None,
                "shortcut_path_root_id": None,
            }
        )

    return results
