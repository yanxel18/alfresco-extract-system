import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import case
from sqlalchemy.orm import Session
from app.db.local import get_local_db
from app.models.job import Job, FileRecord, FileStatus
from app.models.schemas import FileRecordOut, FileRecordPage
from app.config import settings

router = APIRouter(prefix="/api/jobs", tags=["files"])


@router.get("/{job_id}/files", response_model=FileRecordPage)
def list_files(
    job_id: int,
    status: FileStatus | None = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0),
    db: Session = Depends(get_local_db),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    q = db.query(FileRecord).filter(FileRecord.job_id == job_id)
    if status:
        q = q.filter(FileRecord.status == status)

    # Sort: active/completed files bubble to top so live copy activity is visible.
    # Priority: copied(0) → failed(1) → pending(2) → skipped/other(3), then newest ID first.
    status_priority = case(
        (FileRecord.status == FileStatus.copied, 0),
        (FileRecord.status == FileStatus.failed, 1),
        (FileRecord.status == FileStatus.pending, 2),
        else_=3,
    )
    q = q.order_by(status_priority, FileRecord.id.desc())

    total = q.count()
    files = q.offset(offset).limit(limit).all()
    return FileRecordPage(total=total, files=files)


@router.get("/{job_id}/csv")
def download_csv(job_id: int, db: Session = Depends(get_local_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    csv_path = settings.export_dir / job.site_name / "metadata.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="CSV not yet generated")

    return FileResponse(
        path=str(csv_path),
        media_type="text/csv",
        filename=f"{job.site_name}_metadata.csv",
    )
