"""Queries for listing and looking up Alfresco sites and their documentLibrary nodes."""
import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from .constants import NS_CM, NS_ST

logger = logging.getLogger(__name__)


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
