"""
Phase 2: Copy physical files from Alfresco contentstore → export directory.
Idempotent — only processes FileRecords with status 'pending' or 'failed'.
Uses a ThreadPoolExecutor for concurrent I/O with a configurable batch size.
"""
import logging
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from sqlalchemy.orm import Session
from app.config import settings
from app.models.job import Job, FileRecord, JobStatus, FileStatus
from app.services.csv_writer import generate_csv_from_db

logger = logging.getLogger(__name__)


def run_copy(job_id: int, local_db: Session) -> None:
    """
    Main Phase 2 entry point called from the Celery task.
    Copies files from contentstore to export directory using a thread pool.
    Commits after every completed file so the frontend polls see live progress.
    Checks for pause signal between batches.
    """
    job: Job = local_db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise ValueError(f"Job {job_id} not found")

    job.status = JobStatus.copying
    job.copy_started_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    local_db.commit()

    pending_records = (
        local_db.query(FileRecord)
        .filter(
            FileRecord.job_id == job_id,
            FileRecord.status.in_([FileStatus.pending, FileStatus.failed]),
            FileRecord.content_url.isnot(None),
        )
        .all()
    )

    total = len(pending_records)
    concurrency = settings.copy_concurrency
    logger.info(
        "Copying %d files for job %d with concurrency=%d", total, job_id, concurrency
    )

    idx = 0
    while idx < total:
        # Pause check between batches (re-read job status from DB)
        local_db.refresh(job)
        if job.status == JobStatus.paused:
            logger.info("[Copy] Job %d paused at file %d/%d", job_id, idx, total)
            local_db.commit()
            return

        batch = pending_records[idx : idx + concurrency]

        with ThreadPoolExecutor(max_workers=len(batch)) as pool:
            future_to_rec = {
                pool.submit(
                    _copy_file,
                    rec.content_url,
                    job.site_name,
                    rec.full_path,
                    rec.file_name,
                ): rec
                for rec in batch
            }
            for future in as_completed(future_to_rec):
                rec = future_to_rec[future]
                try:
                    dest_path, elapsed = future.result()
                    rec.status = FileStatus.copied
                    rec.local_export_path = str(dest_path)
                    rec.error_msg = None
                    file_bytes = rec.file_size_bytes or 0
                    rec.transfer_speed_bps = (
                        int(file_bytes / elapsed) if elapsed > 0 else None
                    )
                    job.copied_files += 1
                    job.copied_size_bytes += file_bytes
                except Exception as exc:
                    logger.exception("Failed copying node %s: %s", rec.node_ref, exc)
                    rec.status = FileStatus.failed
                    rec.error_msg = str(exc)
                    job.failed_files += 1

                # Commit per-file so frontend sees live progress
                job.updated_at = datetime.utcnow()
                local_db.commit()

        idx += concurrency
        if idx % 100 == 0 or idx >= total:
            logger.info(
                "Copied %d/%d files, %d bytes so far…",
                job.copied_files,
                total,
                job.copied_size_bytes,
            )

    # Regenerate final CSV from DB so local_export_path is fully populated
    try:
        generate_csv_from_db(job.site_name, job_id, local_db)
    except Exception as exc:
        logger.error("Failed to regenerate CSV for job %d: %s", job_id, exc)

    if job.failed_files == 0:
        job.status = JobStatus.done
    else:
        job.status = JobStatus.failed
        logger.warning("Job %d finished with %d failed files", job_id, job.failed_files)

    job.updated_at = datetime.utcnow()
    local_db.commit()
    logger.info("Copy phase complete for job %d", job_id)


def _copy_file(
    content_url: str, site_name: str, full_path: str, file_name: str
) -> tuple[Path, float]:
    """
    Worker function: resolve source path, build destination, copy the file.
    Returns (dest_path, elapsed_seconds). Runs in a thread-pool thread.
    """
    src_path = _resolve_content_path(content_url)
    if not src_path.exists():
        raise FileNotFoundError(f"Content file not found: {src_path}")

    dest_path = _build_dest_path(site_name, full_path, file_name)
    _safe_mkdir(dest_path.parent)

    t0 = time.perf_counter()
    shutil.copy2(src_path, dest_path)
    return dest_path, time.perf_counter() - t0


def _safe_mkdir(path: Path) -> None:
    """Create directory tree safely — works around Windows WinError 183 pathlib bug."""
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as exc:
        if path.is_dir():
            return
        raise


def _resolve_content_path(content_url: str) -> Path:
    """
    Convert a store:// URL to an absolute host path.
    e.g. 'store://2024/1/15/10/30/abc.bin'
      → {ALF_DATA_PATH}/contentstore/2024/1/15/10/30/abc.bin
    """
    relative = content_url.replace("store://", "", 1)
    return settings.contentstore_path / relative


def _build_dest_path(site_name: str, full_path: str, file_name: str) -> Path:
    """
    Build the destination path under exports/{site}/files/{folder_path}/{file_name}.
    full_path already includes the file name as the last segment.
    """
    parts = [p for p in full_path.strip("/").split("/") if p]
    folder_parts = parts[:-1] if len(parts) > 1 else []

    base = settings.export_dir / site_name / "files"
    for part in folder_parts:
        base = base / _safe_name(part)

    return base / _safe_name(file_name)


def _safe_name(name: str) -> str:
    """Strip characters unsafe for file systems."""
    unsafe = r'\/:*?"<>|'
    for ch in unsafe:
        name = name.replace(ch, "_")
    return name.strip()
