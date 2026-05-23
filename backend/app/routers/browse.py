"""
Browse endpoint — lazily explore an Alfresco site's folder/file tree.
Used by the React frontend's Site Explorer page.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.alfresco import get_alfresco_db
from app.models.schemas import BrowseResult, FolderNodeOut, FileNodeBrief, FolderSizeOut
from app.services import alfresco_db as adb

router = APIRouter(prefix="/api/sites", tags=["browse"])


@router.get(
    "/{site_name}/browse",
    response_model=BrowseResult,
    summary="Browse site folder tree",
    description=(
        "Lazily browse the documentLibrary folder/file tree of an Alfresco site. "
        "Omit `parent_id` to start at the documentLibrary root. "
        "Pass `parent_id` (a node_id returned by a previous call) to drill into a folder. "
        "This endpoint is used by the Site Explorer UI to build the interactive tree."
    ),
    operation_id="browse_site_tree",
)
def browse_site(
    site_name: str,
    parent_id: Optional[int] = Query(
        default=None,
        description="Alfresco node_id to list children of. Omit for documentLibrary root.",
    ),
    db: Session = Depends(get_alfresco_db),
) -> BrowseResult:
    info = adb.get_site_node_and_doclib(db, site_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Site '{site_name}' not found in Alfresco")

    doclib_node_id: Optional[int] = info["doclib_node_id"]
    if not doclib_node_id:
        raise HTTPException(
            status_code=404,
            detail=f"documentLibrary folder not found for site '{site_name}'",
        )

    current_node_id = parent_id if parent_id is not None else doclib_node_id

    # Determine parent for breadcrumb/navigation (None at root)
    parent_node_id: Optional[int] = None
    if current_node_id != doclib_node_id:
        parent_node_id = adb.get_parent_node_id(db, current_node_id)
        # Clamp to doclib root so the UI doesn't navigate above the site
        if parent_node_id == doclib_node_id:
            parent_node_id = None  # we are one level below root — "go up" returns to root

    children = adb.get_folder_children(db, current_node_id)

    return BrowseResult(
        site_name=site_name,
        current_node_id=current_node_id,
        parent_node_id=parent_node_id,
        folders=[FolderNodeOut(**f) for f in children["folders"]],
        files=[FileNodeBrief(**f) for f in children["files"]],
    )


@router.get(
    "/{site_name}/search",
    response_model=list[FileNodeBrief],
    summary="Search files in a site",
    description=(
        "Search for files by name (case-insensitive substring match) within the entire "
        "documentLibrary of a site. Queries the Alfresco database directly — no API call to Alfresco. "
        "Use `q` parameter (minimum 2 characters) to specify the search term."
    ),
    operation_id="search_site_files",
)
def search_site_files(
    site_name: str,
    q: str = Query(..., min_length=2, description="Substring to search in file names (case-insensitive)"),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum results to return"),
    db: Session = Depends(get_alfresco_db),
) -> list[FileNodeBrief]:
    info = adb.get_site_node_and_doclib(db, site_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Site '{site_name}' not found in Alfresco")
    doclib_node_id: Optional[int] = info["doclib_node_id"]
    if not doclib_node_id:
        raise HTTPException(status_code=404, detail=f"documentLibrary not found for site '{site_name}'")
    results = adb.search_files(db, doclib_node_id, q, limit)
    return [FileNodeBrief(**r) for r in results]


@router.get(
    "/{site_name}/folder-size",
    response_model=list[FolderSizeOut],
    summary="Get recursive file size for folder nodes",
    description=(
        "Returns the total recursive file size (sum of all descendant files) for one or more "
        "folder node IDs. Used by the Site Explorer to show accurate total size for selected "
        "folders without requiring the user to expand them first. "
        "Pass one or more `node_ids` query parameters."
    ),
    operation_id="get_folder_size",
)
def get_folder_size(
    site_name: str,
    node_ids: list[int] = Query(..., description="Folder node_ids to compute sizes for"),
    db: Session = Depends(get_alfresco_db),
) -> list[FolderSizeOut]:
    if not node_ids:
        return []
    size_map = adb.get_folder_recursive_size(db, node_ids)
    return [FolderSizeOut(node_id=nid, total_size_bytes=size) for nid, size in size_map.items()]
