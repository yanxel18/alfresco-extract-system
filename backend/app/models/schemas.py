"""Pydantic schemas for API request/response."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_serializer
from app.models.job import JobStatus, FileStatus


class SiteOut(BaseModel):
    short_name: str
    title: str
    description: Optional[str] = None
    node_ref: Optional[str] = None


class JobCreate(BaseModel):
    site_name: str
    # Optional list of Alfresco folder node_ids to extract from. Empty list = extract all.
    selected_folder_node_ids: list[int] = []
    # Optional list of individual file node_ids to extract.
    selected_file_node_ids: list[int] = []
    # Optional list of file node_ids to explicitly exclude (e.g. unchecked within a selected folder).
    excluded_file_node_ids: list[int] = []


class JobOut(BaseModel):
    id: int
    site_name: str
    site_title: Optional[str]
    status: JobStatus
    total_files: int
    scanned_files: int
    copied_files: int
    failed_files: int
    total_size_bytes: int
    copied_size_bytes: int
    copy_started_at: Optional[datetime]
    migration_started_at: Optional[datetime]
    celery_task_id: Optional[str]
    error_msg: Optional[str]
    selected_folders: Optional[str]
    selected_files: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("copy_started_at", "migration_started_at", "created_at", "updated_at")
    def serialize_dt(self, v: datetime | None) -> str | None:
        # Naive datetimes are stored as UTC in PostgreSQL. Append 'Z' so
        # browsers parse them as UTC instead of local time.
        return v.isoformat() + "Z" if v is not None else None


class FileRecordOut(BaseModel):
    id: int
    node_ref: str
    site: str
    full_path: str
    file_name: str
    title: Optional[str]
    description: Optional[str]
    creator: Optional[str]
    modifier: Optional[str]
    created_at: Optional[datetime]
    modified_at: Optional[datetime]
    mime_type: Optional[str]
    file_size_bytes: Optional[int]
    version: Optional[str]
    tags: Optional[str]
    categories: Optional[str]
    content_url: Optional[str]
    status: FileStatus
    local_export_path: Optional[str]
    error_msg: Optional[str]
    transfer_speed_bps: Optional[int]

    model_config = {"from_attributes": True}

    @field_serializer("created_at", "modified_at")
    def serialize_dt(self, v: datetime | None) -> str | None:
        return v.isoformat() + "Z" if v is not None else None


# --- Browse / Explorer API schemas ---


class FolderNodeOut(BaseModel):
    node_id: int
    name: str
    has_children: bool
    is_shortcut: bool = False
    selectable: bool = True


class FileNodeBrief(BaseModel):
    node_id: int
    name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    modifier: Optional[str] = None
    modified_at: Optional[str] = None
    is_shortcut: bool = False


class FolderSizeOut(BaseModel):
    node_id: int
    total_size_bytes: int


class BrowseResult(BaseModel):
    site_name: str
    current_node_id: int
    parent_node_id: Optional[int] = None
    folders: list[FolderNodeOut]
    files: list[FileNodeBrief]


class FileRecordPage(BaseModel):
    total: int
    files: list[FileRecordOut]


# --- Migration schemas ---

class MigrationRecordOut(BaseModel):
    id: int
    job_id: int
    file_record_id: int
    target_file_id: Optional[str]
    target_folder_id: Optional[str]
    uuid_filename: Optional[str]
    status: str
    error_msg: Optional[str]
    migrated_at: Optional[datetime]
    duration_ms: Optional[int] = None
    original_name: Optional[str] = None
    original_path: Optional[str] = None

    model_config = {"from_attributes": True}

    @field_serializer("migrated_at")
    def serialize_dt(self, v: datetime | None) -> str | None:
        return v.isoformat() + "Z" if v is not None else None


class MigrationProgressOut(BaseModel):
    job_id: int
    status: str
    total: int
    total_records: int  # total count for pagination
    migrated: int
    failed: int
    pending: int
    skipped: int
    migration_started_at: Optional[datetime] = None
    records: list[MigrationRecordOut]
