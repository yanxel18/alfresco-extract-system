"""
Backward-compatibility shim.
All file-copy logic now lives in app.services.copy (sub-package).
This file re-exports run_copy so existing imports continue to work unchanged:
    from app.services.file_copier import run_copy
"""
from app.services.copy import run_copy  # noqa: F401
