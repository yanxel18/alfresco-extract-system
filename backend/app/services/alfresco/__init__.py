"""
Alfresco database query package.
Re-exports all public functions so existing code that does
    ``from app.services import alfresco_db as adb``
continues to work unchanged after the package split.
"""
from .sites import list_sites, get_site_doclib_node_id, get_site_node_and_doclib
from .shortcuts import resolve_shortcut_target
from .file_nodes import get_all_file_nodes, get_file_nodes_by_ids, get_folder_recursive_size
from .node_properties import get_node_properties, get_node_audit_info, get_node_mime_type, get_node_tags
from .browse import get_parent_node_id, get_folder_children, search_files

__all__ = [
    "list_sites",
    "get_site_doclib_node_id",
    "get_site_node_and_doclib",
    "resolve_shortcut_target",
    "get_all_file_nodes",
    "get_file_nodes_by_ids",
    "get_folder_recursive_size",
    "get_node_properties",
    "get_node_audit_info",
    "get_node_mime_type",
    "get_node_tags",
    "get_parent_node_id",
    "get_folder_children",
    "search_files",
]
