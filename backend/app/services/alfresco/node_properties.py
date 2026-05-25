"""Queries for fetching metadata properties of individual Alfresco nodes."""
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .constants import NS_CM

logger = logging.getLogger(__name__)


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
