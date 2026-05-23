"""SQLAlchemy models stored in the local PostgreSQL tracking database."""
import enum
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, BigInteger, DateTime, Enum, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from app.db.local import Base


class JobStatus(str, enum.Enum):
    created = "created"
    scanning = "scanning"
    scanned = "scanned"
    copying = "copying"
    done = "done"
    paused = "paused"
    failed = "failed"
    migrating = "migrating"
    migrated = "migrated"


class FileStatus(str, enum.Enum):
    pending = "pending"
    copied = "copied"
    failed = "failed"
    skipped = "skipped"


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    site_name = Column(String(255), nullable=False, index=True)
    site_title = Column(String(512), nullable=True)
    status = Column(Enum(JobStatus), default=JobStatus.created, nullable=False)
    total_files = Column(Integer, default=0)
    scanned_files = Column(Integer, default=0)
    copied_files = Column(Integer, default=0)
    failed_files = Column(Integer, default=0)
    total_size_bytes = Column(BigInteger, default=0)
    copied_size_bytes = Column(BigInteger, default=0)
    celery_task_id = Column(String(255), nullable=True)
    error_msg = Column(Text, nullable=True)
    # JSON array of Alfresco node_ids (int) for targeted folder extraction.
    # NULL means extract all files under the site's documentLibrary root.
    selected_folders = Column(Text, nullable=True)
    # JSON array of individual Alfresco file node_ids to extract.
    # Used when the user selects specific files (not whole folders).
    selected_files = Column(Text, nullable=True)
    # JSON array of Alfresco file node_ids explicitly excluded by the user
    # (e.g. unchecked within a selected folder).
    excluded_files = Column(Text, nullable=True)
    copy_started_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    file_records = relationship("FileRecord", back_populates="job", lazy="dynamic")


class FileRecord(Base):
    __tablename__ = "file_records"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False, index=True)

    # Alfresco identity
    node_ref = Column(String(255), nullable=False, index=True)
    content_url = Column(Text, nullable=True)

    # Metadata
    site = Column(String(255), nullable=False)
    full_path = Column(Text, nullable=False)       # e.g. /Folder/Sub/file.pdf
    file_name = Column(String(512), nullable=False)
    title = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    creator = Column(String(255), nullable=True)
    modifier = Column(String(255), nullable=True)
    created_at = Column(DateTime, nullable=True)
    modified_at = Column(DateTime, nullable=True)
    mime_type = Column(String(255), nullable=True)
    file_size_bytes = Column(BigInteger, nullable=True)
    version = Column(String(50), nullable=True)
    tags = Column(Text, nullable=True)             # comma-separated
    categories = Column(Text, nullable=True)       # comma-separated

    # Copy tracking
    status = Column(Enum(FileStatus), default=FileStatus.pending, nullable=False, index=True)
    local_export_path = Column(Text, nullable=True)
    error_msg = Column(Text, nullable=True)
    transfer_speed_bps = Column(BigInteger, nullable=True)  # bytes/sec for this file

    job = relationship("Job", back_populates="file_records")
