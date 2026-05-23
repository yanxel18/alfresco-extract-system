from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.local import get_local_db
from app.models.job import Job, JobStatus
from app.models.schemas import JobCreate, JobOut
from worker.tasks import extract_site_task, copy_site_task

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobOut])
def list_jobs(db: Session = Depends(get_local_db)):
    return db.query(Job).order_by(Job.created_at.desc()).all()


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_local_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("", response_model=JobOut, status_code=201,
             summary="Create extraction job",
             description="Create a new extraction job. Pass `selected_folder_node_ids` to restrict extraction to specific folders; omit or pass an empty list to extract the entire site.")
def create_job(payload: JobCreate, db: Session = Depends(get_local_db)):
    """Create a new extraction job and immediately start Phase 1 (scan)."""
    selected = payload.selected_folder_node_ids or []
    selected_files = payload.selected_file_node_ids or []
    excluded_files = payload.excluded_file_node_ids or []
    job = Job(
        site_name=payload.site_name,
        status=JobStatus.created,
        selected_folders=json.dumps(selected) if selected else None,
        selected_files=json.dumps(selected_files) if selected_files else None,
        excluded_files=json.dumps(excluded_files) if excluded_files else None,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    task = extract_site_task.delay(job.id)
    job.celery_task_id = task.id
    job.status = JobStatus.scanning
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/start-copy", response_model=JobOut)
def start_copy(job_id: int, db: Session = Depends(get_local_db)):
    """Manually trigger Phase 2 (file copy) after scanning is complete."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.scanned, JobStatus.failed, JobStatus.paused):
        raise HTTPException(status_code=400, detail=f"Job is in state '{job.status}' — cannot start copy")

    task = copy_site_task.delay(job.id)
    job.celery_task_id = task.id
    job.status = JobStatus.copying
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/pause", response_model=JobOut)
def pause_job(job_id: int, db: Session = Depends(get_local_db)):
    """Signal a job to pause (worker checks this flag between files)."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.scanning, JobStatus.copying):
        raise HTTPException(status_code=400, detail="Job cannot be paused in current state")
    job.status = JobStatus.paused
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/resume", response_model=JobOut)
def resume_job(job_id: int, db: Session = Depends(get_local_db)):
    """Resume a paused or failed job from where it left off."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in (JobStatus.paused, JobStatus.failed) and job.scanned_files == 0:
        task = extract_site_task.delay(job.id)
        job.status = JobStatus.scanning
    elif job.status in (JobStatus.paused, JobStatus.failed):
        task = copy_site_task.delay(job.id)
        job.status = JobStatus.copying
    else:
        raise HTTPException(status_code=400, detail="Job is not paused or failed")

    job.celery_task_id = task.id
    job.error_msg = None
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


@router.delete(
    "/{job_id}",
    status_code=204,
    summary="Delete an extraction job",
    description="Permanently delete a job and all its associated file records. This cannot be undone.",
)
def delete_job(job_id: int, db: Session = Depends(get_local_db)):
    """Delete a job and cascade-delete all its file records."""
    from app.models.job import FileRecord  # avoid circular at module level
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.query(FileRecord).filter(FileRecord.job_id == job_id).delete(synchronize_session=False)
    db.delete(job)
    db.commit()
