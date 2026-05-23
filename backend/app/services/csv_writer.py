"""
Writes the metadata CSV for a site extraction job.
CSV is generated from the FileRecord DB rows at job completion — always complete and accurate.
"""
import csv
import logging
from pathlib import Path
from sqlalchemy.orm import Session
from app.config import settings

logger = logging.getLogger(__name__)

CSV_COLUMNS = [
    "node_ref", "site", "full_path", "file_name", "title", "description",
    "creator", "modifier", "created_at", "modified_at",
    "mime_type", "file_size_bytes", "version",
    "content_url", "local_export_path", "tags", "categories",
]


def _csv_path(site_name: str) -> Path:
    return settings.export_dir / site_name / "metadata.csv"


def init_csv(site_name: str) -> None:
    """Create the CSV file with headers (overwrites if exists)."""
    csv_file = _csv_path(site_name)
    csv_file.parent.mkdir(parents=True, exist_ok=True)
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
    logger.info("Initialized CSV at %s", csv_file)


def write_csv_row(site_name: str, record) -> None:
    """Append a single FileRecord row to the site's metadata CSV during Phase 1."""
    csv_file = _csv_path(site_name)
    with open(csv_file, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writerow({
            "node_ref": record.node_ref,
            "site": record.site,
            "full_path": record.full_path,
            "file_name": record.file_name,
            "title": record.title or "",
            "description": record.description or "",
            "creator": record.creator or "",
            "modifier": record.modifier or "",
            "created_at": record.created_at.isoformat() if record.created_at else "",
            "modified_at": record.modified_at.isoformat() if record.modified_at else "",
            "mime_type": record.mime_type or "",
            "file_size_bytes": record.file_size_bytes or "",
            "version": record.version or "",
            "content_url": record.content_url or "",
            "local_export_path": record.local_export_path or "",
            "tags": record.tags or "",
            "categories": record.categories or "",
        })


def generate_csv_from_db(site_name: str, job_id: int, local_db: Session) -> Path:
    """
    Regenerate the complete metadata CSV from DB records.
    Called at end of Phase 2 (copy) so local_export_path is fully populated.
    This replaces the old O(n²) per-file rewrite approach.
    """
    from app.models.job import FileRecord
    csv_file = _csv_path(site_name)
    csv_file.parent.mkdir(parents=True, exist_ok=True)

    records = (
        local_db.query(FileRecord)
        .filter(FileRecord.job_id == job_id)
        .order_by(FileRecord.id)
        .all()
    )

    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for record in records:
            writer.writerow({
                "node_ref": record.node_ref,
                "site": record.site,
                "full_path": record.full_path,
                "file_name": record.file_name,
                "title": record.title or "",
                "description": record.description or "",
                "creator": record.creator or "",
                "modifier": record.modifier or "",
                "created_at": record.created_at.isoformat() if record.created_at else "",
                "modified_at": record.modified_at.isoformat() if record.modified_at else "",
                "mime_type": record.mime_type or "",
                "file_size_bytes": record.file_size_bytes or "",
                "version": record.version or "",
                "content_url": record.content_url or "",
                "local_export_path": record.local_export_path or "",
                "tags": record.tags or "",
                "categories": record.categories or "",
            })

    logger.info("Regenerated CSV at %s (%d records)", csv_file, len(records))
    return csv_file
