"""Local resume file storage: UUID filenames outside the web root.

Security (§3 ENGINEERING_STANDARDS):
- Random UUID filename (`uuid4 + ext`); client filename never used in a path.
- Traversal-safe: basename check rejects `..`, `/`, `\\`, NUL.
- Files live under `<storage_dir>/resumes/<orgId>/` — never web-served.
- Serving only via the authed download endpoint (`attachment` + `nosniff`).
"""

from __future__ import annotations

import uuid
from pathlib import Path

from ..config import settings

_RESUME_SUBDIR = "resumes"


def _org_dir(org_id: str) -> Path:
    base = settings.resolved_storage_dir / _RESUME_SUBDIR / org_id
    base.mkdir(parents=True, exist_ok=True)
    return base


def validate_client_filename(name: str) -> str:
    """Return a safe display name or raise ValueError.

    Rejects path traversal (`..`, `/`, `\\`, NUL) and blank names.
    The returned value is for display/record only — never a filesystem path.
    """
    if not name or not name.strip():
        raise ValueError("File must have a name.")
    cleaned = name.strip()
    if "\x00" in cleaned or ".." in cleaned or "/" in cleaned or "\\" in cleaned:
        raise ValueError("Invalid file name (path traversal).")
    if len(cleaned) > 255:
        raise ValueError("File name too long.")
    return cleaned


def new_storage_key(org_id: str, ext: str) -> tuple[Path, str]:
    """Return (absolute path, storageKey) for a new upload.

    `ext` must already be validated (e.g. ".pdf"). The storageKey is the
    path relative to the storage root, safe to persist in Mongo.
    """
    filename = f"{uuid.uuid4().hex}{ext.lower()}"
    dest = _org_dir(org_id) / filename
    storage_key = f"{_RESUME_SUBDIR}/{org_id}/{filename}"
    return dest, storage_key


def resolve_storage_key(storage_key: str) -> Path:
    """Resolve a stored storageKey back to an absolute path, traversal-safe."""
    parts = (storage_key or "").replace("\\", "/").split("/")
    if len(parts) != 3 or parts[0] != _RESUME_SUBDIR or ".." in parts or "" in parts:
        raise ValueError("Invalid storage key.")
    base = settings.resolved_storage_dir
    dest = base / parts[0] / parts[1] / parts[2]
    # Containment: resolved path must stay inside the storage root.
    try:
        dest.resolve().relative_to(base.resolve())
    except ValueError:
        raise ValueError("Invalid storage key.") from None
    return dest


def write_bytes(dest: Path, data: bytes) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)
    return len(data)


def read_bytes(storage_key: str) -> bytes:
    with open(resolve_storage_key(storage_key), "rb") as fh:
        return fh.read()


def delete_key(storage_key: str) -> bool:
    try:
        resolve_storage_key(storage_key).unlink(missing_ok=True)
        return True
    except (ValueError, OSError):
        return False
