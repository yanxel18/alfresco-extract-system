"""MigrationRecord model — tracks per-file migration into the target system."""
import enum
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.db.local import Base


class MigrationStatus(str, enum.Enum):
    pending = "pending"
    migrated = "migrated"
    failed = "failed"
    skipped = "skipped"  # FileRecord had no local_export_path (folder/skipped node)


class MigrationRecord(Base):
    __tablename__ = "migration_records"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    file_record_id = Column(Integer, ForeignKey("file_records.id", ondelete="CASCADE"), nullable=False, index=True)

    # Populated after a successful INSERT into the target DB
    target_file_id = Column(String(36), nullable=True)    # UUID returned from target files table
    target_folder_id = Column(String(36), nullable=True)  # UUID of the leaf folder in target DB
    uuid_filename = Column(String(300), nullable=True)    # e.g. "550e8400-...-.pdf" on disk

    status = Column(Enum(MigrationStatus), default=MigrationStatus.pending, nullable=False, index=True)
    error_msg = Column(Text, nullable=True)
    migrated_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)  # milliseconds taken to migrate this file

    file_record = relationship("FileRecord", lazy="joined", foreign_keys=[file_record_id])
