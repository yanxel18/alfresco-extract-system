"""
Phase 1: Scan Alfresco DB for all file nodes in a site and write FileRecord rows.
Idempotent — skips nodes that already have a FileRecord for this job.
"""
import json
import logging
from datetime import datetime
from sqlalchemy.orm import Session
from app.db.alfresco import AlfrescoSession
from app.models.job import Job, FileRecord, JobStatus, FileStatus
from app.services import alfresco_db as adb
from app.services.path_builder import resolve_path, clear_cache
from app.services.csv_writer import write_csv_row, init_csv

logger = logging.getLogger(__name__)
PROGRESS_LOG_EVERY = 20


def run_extraction(job_id: int, local_db: Session) -> None:
    """
    Main Phase 1 entry point called from the Celery task.
    Queries Alfresco PG → writes FileRecord rows to PostgreSQL → writes metadata CSV.

    If job.selected_folders is set (JSON array of node_ids), only those subtrees
    are scanned. Otherwise the full documentLibrary tree is scanned.
    """
    job: Job = local_db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise ValueError(f"Job {job_id} not found")

    job.status = JobStatus.scanning
    job.updated_at = datetime.utcnow()
    local_db.commit()

    clear_cache()

    selected_folder_ids: list[int] = json.loads(job.selected_folders) if job.selected_folders else []
    selected_file_ids: list[int] = json.loads(job.selected_files) if job.selected_files else []
    excluded_file_ids: set[int] = set(json.loads(job.excluded_files)) if job.excluded_files else set()

    with AlfrescoSession() as alf_db:
        # Locate the site node
        sites = adb.list_sites(alf_db)
        site_info = next((s for s in sites if s["short_name"] == job.site_name), None)
        if not site_info:
            raise ValueError(f"Site '{job.site_name}' not found in Alfresco")

        job.site_title = site_info["title"]
        local_db.commit()

        doclib_id = adb.get_site_doclib_node_id(alf_db, site_info["node_id"])
        if not doclib_id:
            raise ValueError(f"documentLibrary not found for site '{job.site_name}'")

        # Determine which file nodes to scan
        if selected_file_ids and selected_folder_ids:
            # Both individual files and folders selected — merge, deduplicate
            logger.info(
                "Scanning %d folder(s) + %d individual file(s) for job %d",
                len(selected_folder_ids), len(selected_file_ids), job_id,
            )
            file_nodes: list[dict] = []
            seen_ids: set[int] = set()
            for folder_id in selected_folder_ids:
                for node in adb.get_all_file_nodes(alf_db, folder_id):
                    if node["node_id"] not in seen_ids:
                        seen_ids.add(node["node_id"])
                        file_nodes.append(node)
            for node in adb.get_file_nodes_by_ids(alf_db, selected_file_ids):
                if node["node_id"] not in seen_ids:
                    seen_ids.add(node["node_id"])
                    file_nodes.append(node)
        elif selected_file_ids:
            # Only individual files selected
            logger.info("Fetching %d individually selected file(s) for job %d", len(selected_file_ids), job_id)
            file_nodes = adb.get_file_nodes_by_ids(alf_db, selected_file_ids)
        elif selected_folder_ids:
            # Only folders selected (existing behaviour)
            logger.info(
                "Scanning %d selected folder(s) for job %d: %s",
                len(selected_folder_ids), job_id, selected_folder_ids,
            )
            file_nodes = []
            seen_ids = set()
            for folder_id in selected_folder_ids:
                for node in adb.get_all_file_nodes(alf_db, folder_id):
                    if node["node_id"] not in seen_ids:
                        seen_ids.add(node["node_id"])
                        file_nodes.append(node)
        else:
            logger.info("Fetching all file nodes under documentLibrary (node_id=%s)…", doclib_id)
            file_nodes = adb.get_all_file_nodes(alf_db, doclib_id)

        logger.info("Found %d file nodes", len(file_nodes))

        # Apply user-specified exclusions (files unchecked within a selected folder)
        if excluded_file_ids:
            before = len(file_nodes)
            file_nodes = [n for n in file_nodes if n["node_id"] not in excluded_file_ids]
            logger.info(
                "Excluded %d file(s) by user request — %d remaining",
                before - len(file_nodes), len(file_nodes),
            )

        # Pre-compute total size for progress tracking
        job.total_size_bytes = sum(
            (n.get("file_size_bytes") or 0) for n in file_nodes
        )

        # Get set of already-recorded node_refs for this job (resumability)
        existing_node_refs: set[str] = {
            r[0]
            for r in local_db.query(FileRecord.node_ref)
                              .filter(FileRecord.job_id == job_id)
                              .all()
        }

        job.total_files = len(file_nodes)
        local_db.commit()

        init_csv(job.site_name)

        for idx, node in enumerate(file_nodes):
            node_ref = f"workspace://SpacesStore/{node['uuid']}"

            if node_ref in existing_node_refs:
                continue  # already scanned — resumable

            try:
                props = adb.get_node_properties(alf_db, node["node_id"])
                audit = adb.get_node_audit_info(alf_db, node["node_id"])
                mime = adb.get_node_mime_type(alf_db, node["node_id"])
                tags = adb.get_node_tags(alf_db, node["node_id"])

                # Resolve path — shortcuts use a prefix + relative path within target
                path_root_id = node.get("shortcut_path_root_id") or doclib_id
                raw_path = resolve_path(alf_db, node["node_id"], path_root_id)
                prefix = node.get("shortcut_path_prefix") or ""
                full_path = prefix + raw_path
                file_name = props.get("name") or full_path.split("/")[-1]

                record = FileRecord(
                    job_id=job_id,
                    node_ref=node_ref,
                    content_url=node["content_url"],
                    site=job.site_name,
                    full_path=full_path,
                    file_name=file_name,
                    title=props.get("title"),
                    description=props.get("description"),
                    creator=audit.get("creator"),
                    modifier=audit.get("modifier"),
                    created_at=_parse_date(audit.get("created")),
                    modified_at=_parse_date(audit.get("modified")),
                    mime_type=mime,
                    file_size_bytes=node["file_size_bytes"],
                    version=props.get("versionLabel"),
                    tags=",".join(tags) if tags else None,
                    status=FileStatus.pending,
                )
                local_db.add(record)
                local_db.flush()

                write_csv_row(job.site_name, record)

                job.scanned_files += 1
                if (idx + 1) % PROGRESS_LOG_EVERY == 0:
                    logger.info("Scanned %d / %d files", idx + 1, len(file_nodes))
                    local_db.commit()

            except Exception as exc:
                logger.exception("Failed scanning node %s: %s", node_ref, exc)
                local_db.add(FileRecord(
                    job_id=job_id,
                    node_ref=node_ref,
                    content_url=node.get("content_url"),
                    site=job.site_name,
                    full_path="",
                    file_name="",
                    status=FileStatus.failed,
                    error_msg=str(exc),
                ))

        local_db.commit()

    job.status = JobStatus.scanned
    job.updated_at = datetime.utcnow()
    local_db.commit()
    logger.info("Extraction scan complete for job %d — %d files", job_id, job.scanned_files)


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None
