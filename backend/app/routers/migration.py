"""Migration API — Phase 3: move extracted files into the target file-manager system."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
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


def _migration_progress(job: Job, db: Session) -> MigrationProgressOut:
    records = (
        db.query(MigrationRecord)
        .filter(MigrationRecord.job_id == job.id)
        .all()
    )
    counts = {s: 0 for s in MigrationStatus}
    for r in records:
        counts[r.status] += 1

    return MigrationProgressOut(
        job_id=job.id,
        status=job.status,
        total=len(records),
        migrated=counts[MigrationStatus.migrated],
        failed=counts[MigrationStatus.failed],
        pending=counts[MigrationStatus.pending],
        skipped=counts[MigrationStatus.skipped],
        records=[MigrationRecordOut.model_validate(r) for r in records[-200:]],  # last 200
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
    description="Get current migration progress: counts per status and latest MigrationRecords.",
)
def get_migration(job_id: int, db: Session = Depends(get_local_db)):
    job = _get_job_or_404(job_id, db)
    return _migration_progress(job, db)


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
