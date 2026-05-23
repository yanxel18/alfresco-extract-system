"""Migration API — Phase 3: move extracted files into the target file-manager system."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.db.local import get_local_db
from app.models.job import Job, JobStatus
from app.models.migration import MigrationRecord, MigrationStatus
from app.models.schemas import MigrationProgressOut, MigrationRecordOut
from worker.tasks import migrate_site_task

router = APIRouter(prefix="/api/jobs", tags=["migration"])


def _get_job_or_404(job_id: int, db: Session) -> Job:
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _migration_progress(
    job: Job,
    db: Session,
    page: int = 1,
    limit: int = 100,
) -> MigrationProgressOut:
    base_q = db.query(MigrationRecord).filter(MigrationRecord.job_id == job.id)

    # Status counts from all records (not just the current page)
    all_records = base_q.all()
    counts = {s: 0 for s in MigrationStatus}
    for r in all_records:
        counts[r.status] += 1

    total_records = len(all_records)

    # Paginated, sorted: most recently migrated first, then pending/failed
    from sqlalchemy import case as sa_case, nulls_last
    status_priority = sa_case(
        (MigrationRecord.status == MigrationStatus.migrated, 0),
        (MigrationRecord.status == MigrationStatus.failed, 1),
        (MigrationRecord.status == MigrationStatus.pending, 2),
        else_=3,
    )
    page_records = (
        base_q
        .order_by(status_priority, MigrationRecord.migrated_at.desc().nulls_last(), MigrationRecord.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return MigrationProgressOut(
        job_id=job.id,
        status=job.status,
        total=total_records,
        total_records=total_records,
        migrated=counts[MigrationStatus.migrated],
        failed=counts[MigrationStatus.failed],
        pending=counts[MigrationStatus.pending],
        skipped=counts[MigrationStatus.skipped],
        migration_started_at=job.migration_started_at,
        records=[_mr_out(r) for r in page_records],
    )


def _mr_out(r: MigrationRecord) -> MigrationRecordOut:
    """Build MigrationRecordOut, adding original filename/path from the joined FileRecord."""
    fr = r.file_record
    return MigrationRecordOut(
        id=r.id,
        job_id=r.job_id,
        file_record_id=r.file_record_id,
        target_file_id=r.target_file_id,
        target_folder_id=r.target_folder_id,
        uuid_filename=r.uuid_filename,
        status=r.status,
        error_msg=r.error_msg,
        migrated_at=r.migrated_at,
        duration_ms=r.duration_ms,
        original_name=fr.file_name if fr else None,
        original_path=fr.full_path if fr else None,
    )


@router.post(
    "/{job_id}/migrate",
    response_model=MigrationProgressOut,
    status_code=202,
    summary="Start migration",
    description=(
        "Trigger Phase 3: insert folder/file rows into the target DB and copy files "
        "to target-storage/ renamed as UUIDs. "
        "Job must be in `done` or `migrated` (re-run) state. Idempotent."
    ),
)
def start_migration(job_id: int, db: Session = Depends(get_local_db)):
    job = _get_job_or_404(job_id, db)
    if job.status not in (JobStatus.done, JobStatus.migrated, JobStatus.failed):
        raise HTTPException(
            status_code=400,
            detail=f"Job is in state '{job.status}' — migration requires 'done' or 'migrated'",
        )
    task = migrate_site_task.delay(job_id)
    job.celery_task_id = task.id
    job.status = JobStatus.migrating
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return _migration_progress(job, db)


@router.get(
    "/{job_id}/migration",
    response_model=MigrationProgressOut,
    summary="Migration progress",
    description="Get current migration progress with paginated records sorted by most recently migrated first.",
)
def get_migration(
    job_id: int,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=100, le=500),
    db: Session = Depends(get_local_db),
):
    job = _get_job_or_404(job_id, db)
    return _migration_progress(job, db, page=page, limit=limit)


@router.get(
    "/{job_id}/migration/sql",
    response_class=PlainTextResponse,
    summary="Download migration SQL script",
    description=(
        "Generate a self-contained SQL INSERT script from all successfully migrated records. "
        "Can be reviewed and executed manually against the real target database."
    ),
)
def download_migration_sql(job_id: int, db: Session = Depends(get_local_db)):
    _get_job_or_404(job_id, db)
    from app.services.migration_service import generate_migration_sql
    sql = generate_migration_sql(job_id, db)
    return PlainTextResponse(
        content=sql,
        headers={
            "Content-Disposition": f'attachment; filename="migration_job_{job_id}.sql"',
            "Content-Type": "text/plain; charset=utf-8",
        },
    )


@router.post(
    "/{job_id}/migration/pause",
    response_model=MigrationProgressOut,
    summary="Pause migration",
    description="Signal the migration worker to pause. The worker checks this flag between files.",
)
def pause_migration(job_id: int, db: Session = Depends(get_local_db)):
    job = _get_job_or_404(job_id, db)
    if job.status != JobStatus.migrating:
        raise HTTPException(status_code=400, detail="Job is not currently migrating")
    job.status = JobStatus.paused
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return _migration_progress(job, db)


@router.delete(
    "/{job_id}/migration",
    response_model=MigrationProgressOut,
    summary="Revert migration",
    description=(
        "Delete all target-DB rows (files + empty folders) and UUID files from target-storage "
        "that were created for this job. Resets migration records so the job can be re-migrated. "
        "Only available when job is NOT actively migrating."
    ),
)
def revert_migration(job_id: int, db: Session = Depends(get_local_db)):
    from app.db.target_db import TargetSession
    from app.services.migration_service import revert_migration as do_revert

    job = _get_job_or_404(job_id, db)
    if job.status == JobStatus.migrating:
        raise HTTPException(status_code=400, detail="Cannot revert while migration is in progress — pause first")

    target_db: Session = TargetSession()
    try:
        do_revert(job_id, db, target_db)
        job.status = JobStatus.done
        job.error_msg = None
        job.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(job)
    finally:
        target_db.close()

    return _migration_progress(job, db)


@router.post(
    "/{job_id}/migration/resume",
    response_model=MigrationProgressOut,
    summary="Resume migration",
    description="Resume a paused or partially-failed migration from where it stopped.",
)
def resume_migration(job_id: int, db: Session = Depends(get_local_db)):
    job = _get_job_or_404(job_id, db)
    if job.status not in (JobStatus.paused, JobStatus.failed):
        raise HTTPException(status_code=400, detail="Job is not paused or failed")
    task = migrate_site_task.delay(job_id)
    job.celery_task_id = task.id
    job.status = JobStatus.migrating
    job.error_msg = None
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return _migration_progress(job, db)
