"""
Celery tasks for the Alfresco extraction system.
Both tasks are idempotent and resumable — safe to re-run on the same job_id.
"""
import logging
import time
from datetime import datetime
from celery import shared_task
from sqlalchemy.orm import Session
from app.db.local import LocalSession
from app.models.job import Job, JobStatus, FileRecord, FileStatus
from app.services.extractor import run_extraction
from app.services.file_copier import run_copy
from worker.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="tasks.extract_site", max_retries=3, default_retry_delay=30)
def extract_site_task(self, job_id: int):
    """
    Phase 1: Scan Alfresco DB and populate FileRecord rows + metadata CSV.
    Resumes from where it left off if interrupted.
    """
    db: Session = LocalSession()
    try:
        logger.info("[Task] extract_site_task started for job_id=%d", job_id)
        run_extraction(job_id, db)
        logger.info("[Task] extract_site_task complete for job_id=%d", job_id)
    except Exception as exc:
        logger.exception("[Task] extract_site_task failed for job_id=%d: %s", job_id, exc)
        job: Job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = JobStatus.failed
            job.error_msg = str(exc)
            db.commit()
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery_app.task(bind=True, name="tasks.copy_site", max_retries=3, default_retry_delay=60)
def copy_site_task(self, job_id: int):
    """
    Phase 2: Copy physical files from contentstore to the export directory.
    Resumes from where it left off — only processes pending/failed FileRecords.
    """
    db: Session = LocalSession()
    try:
        logger.info("[Task] copy_site_task started for job_id=%d", job_id)
        run_copy(job_id, db)
        logger.info("[Task] copy_site_task complete for job_id=%d", job_id)
    except Exception as exc:
        logger.exception("[Task] copy_site_task failed for job_id=%d: %s", job_id, exc)
        job: Job = db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = JobStatus.failed
            job.error_msg = str(exc)
            db.commit()
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery_app.task(bind=True, name="tasks.migrate_site", max_retries=3, default_retry_delay=60)
def migrate_site_task(self, job_id: int):
    """
    Phase 3: Migrate exported files into the target file-manager system.
    - Inserts folder and file rows into the target PostgreSQL DB.
    - Copies files to target-storage/ renamed as UUIDs.
    - Idempotent: already-migrated MigrationRecords are skipped.
    - Pause-aware: checks job.status between files.
    - Records per-file duration_ms for frontend display.
    """
    from app.db.target_db import TargetSession
    from app.models.migration import MigrationRecord, MigrationStatus
    from app.services.migration_service import (
        ensure_folder_path,
        migrate_file_record,
        parse_folder_parts,
    )

    local_db: Session = LocalSession()
    target_db: Session = TargetSession()

    try:
        job: Job | None = local_db.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise ValueError(f"Job {job_id} not found")

        job.status = JobStatus.migrating
        job.error_msg = None
        job.migration_started_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        local_db.commit()
        logger.info("[Task] migrate_site_task started for job_id=%d", job_id)

        # Fetch all successfully copied FileRecords
        copied_records = (
            local_db.query(FileRecord)
            .filter(FileRecord.job_id == job_id, FileRecord.status == FileStatus.copied)
            .all()
        )
        logger.info("Found %d copied files to migrate for job %d", len(copied_records), job_id)

        # Pre-create all pending MigrationRecord rows that don't already exist.
        # This makes "Not Yet Migrated" count down live as migration progresses.
        existing_mr_ids = {
            mr.file_record_id
            for mr in local_db.query(MigrationRecord.file_record_id)
            .filter(MigrationRecord.job_id == job_id)
            .all()
        }
        new_mrs = [
            MigrationRecord(job_id=job_id, file_record_id=fr.id, status=MigrationStatus.pending)
            for fr in copied_records
            if fr.id not in existing_mr_ids
        ]
        if new_mrs:
            local_db.bulk_save_objects(new_mrs)
            local_db.commit()
            logger.info("Pre-created %d pending MigrationRecord rows for job %d", len(new_mrs), job_id)

        failed_count = 0

        for idx, fr in enumerate(copied_records):
            # Check job status on every file — stops immediately on pause or revert.
            local_db.refresh(job)
            if job.status != JobStatus.migrating:
                logger.info(
                    "[Task] migrate_site_task stopping at idx=%d, job status=%s for job %d",
                    idx, job.status, job_id,
                )
                return

            # Fetch the (now pre-existing) MigrationRecord
            mr: MigrationRecord | None = (
                local_db.query(MigrationRecord)
                .filter(
                    MigrationRecord.job_id == job_id,
                    MigrationRecord.file_record_id == fr.id,
                )
                .first()
            )

            if mr and mr.status == MigrationStatus.migrated:
                continue  # Already done — idempotent skip

            if mr is None:
                # Defensive fallback (shouldn't happen after pre-creation above)
                mr = MigrationRecord(job_id=job_id, file_record_id=fr.id, status=MigrationStatus.pending)
                local_db.add(mr)
                local_db.flush()

            t0 = time.perf_counter()

            try:
                # Skip nodes with no exported file (folders / skipped nodes)
                if not fr.local_export_path:
                    mr.status = MigrationStatus.skipped
                    local_db.commit()
                    continue

                folder_parts = parse_folder_parts(fr.full_path)
                folder_id = ensure_folder_path(target_db, job.site_name, folder_parts)

                target_file_id, uuid_fn = migrate_file_record(target_db, fr, folder_id)

                mr.target_file_id = target_file_id
                mr.target_folder_id = folder_id
                mr.uuid_filename = uuid_fn
                mr.status = MigrationStatus.migrated
                mr.error_msg = None
                mr.migrated_at = datetime.utcnow()
                mr.duration_ms = int((time.perf_counter() - t0) * 1000)

            except Exception as exc:
                logger.exception(
                    "Failed to migrate file_record_id=%d for job %d: %s", fr.id, job_id, exc
                )
                target_db.rollback()  # Clear the broken transaction before the next file
                mr.status = MigrationStatus.failed
                mr.error_msg = str(exc)
                mr.duration_ms = int((time.perf_counter() - t0) * 1000)
                failed_count += 1

            job.updated_at = datetime.utcnow()
            local_db.commit()

            if (idx + 1) % 100 == 0:
                logger.info(
                    "[Task] Migrated %d/%d files for job %d",
                    idx + 1, len(copied_records), job_id,
                )

        if failed_count == 0:
            job.status = JobStatus.migrated
        else:
            job.status = JobStatus.failed
            job.error_msg = f"{failed_count} file(s) failed during migration"
            logger.warning(
                "Job %d migration finished with %d failures", job_id, failed_count
            )

        job.updated_at = datetime.utcnow()
        local_db.commit()
        logger.info("[Task] migrate_site_task complete for job_id=%d", job_id)

    except Exception as exc:
        logger.exception("[Task] migrate_site_task failed for job_id=%d: %s", job_id, exc)
        job = local_db.query(Job).filter(Job.id == job_id).first()
        if job:
            job.status = JobStatus.failed
            job.error_msg = str(exc)
            job.updated_at = datetime.utcnow()
            local_db.commit()
        raise self.retry(exc=exc)
    finally:
        local_db.close()
        target_db.close()

