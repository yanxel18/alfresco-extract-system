"""
Path and filename helpers for the file-copy phase.
Runs in thread-pool threads — must be thread-safe (no shared mutable state).
"""
import os
import shutil
import time
from pathlib import Path

from app.config import settings


def copy_file(
    content_url: str, site_name: str, full_path: str, file_name: str
) -> tuple[Path, float]:
    """
    Worker function: resolve source path, build destination, copy the file.
    Returns (dest_path, elapsed_seconds). Runs in a thread-pool thread.
    """
    src_path = resolve_content_path(content_url)
    if not src_path.exists():
        raise FileNotFoundError(f"Content file not found: {src_path}")

    dest_path = build_dest_path(site_name, full_path, file_name)
    safe_mkdir(dest_path.parent)

    t0 = time.perf_counter()
    shutil.copy2(src_path, dest_path)
    return dest_path, time.perf_counter() - t0


def safe_mkdir(path: Path) -> None:
    """Create directory tree safely — works around Windows WinError 183 pathlib bug."""
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        if path.is_dir():
            return
        raise


def resolve_content_path(content_url: str) -> Path:
    """
    Convert a store:// URL to an absolute host path.
    e.g. 'store://2024/1/15/10/30/abc.bin'
      → {ALF_DATA_PATH}/contentstore/2024/1/15/10/30/abc.bin
    """
    relative = content_url.replace("store://", "", 1)
    return settings.contentstore_path / relative


def build_dest_path(site_name: str, full_path: str, file_name: str) -> Path:
    """
    Build the destination path under exports/{site}/files/{folder_path}/{file_name}.
    full_path already includes the file name as the last segment.
    """
    parts = [p for p in full_path.strip("/").split("/") if p]
    folder_parts = parts[:-1] if len(parts) > 1 else []

    base = settings.export_dir / site_name / "files"
    for part in folder_parts:
        base = base / safe_name(part)

    return base / safe_name(file_name)


def safe_name(name: str) -> str:
    """Strip characters unsafe for file systems."""
    unsafe = r'\/:*?"<>|'
    for ch in unsafe:
        name = name.replace(ch, "_")
    return name.strip()
