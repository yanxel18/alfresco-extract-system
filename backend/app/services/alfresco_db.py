"""
Backward-compatibility shim.
All Alfresco DB query logic now lives in app.services.alfresco (sub-package).
This file re-exports everything so existing imports continue to work unchanged:
    from app.services import alfresco_db as adb   # still works
    adb.list_sites(...)                            # still works
"""
# ruff: noqa: F401, F403
from app.services.alfresco import (  # noqa: F401
    list_sites,
    get_site_doclib_node_id,
    get_site_node_and_doclib,
    resolve_shortcut_target,
    get_all_file_nodes,
    get_file_nodes_by_ids,
    get_folder_recursive_size,
    get_node_properties,
    get_node_audit_info,
    get_node_mime_type,
    get_node_tags,
    get_parent_node_id,
    get_folder_children,
    search_files,
)
