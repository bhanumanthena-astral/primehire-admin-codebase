"""Upload validation: allowlist by magic bytes, size caps, zip-bomb guard.

Allowlist: PDF, DOCX, DOC — verified by file header, never by extension or
Content-Type alone. Extension must also match the detected kind.

Slice A ships the scan *interface* + `quarantined` status (blocks download
and parsing). Real `clamd` integration lands in Phase 7 (see DECISIONS.md).
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

from ..config import settings

ALLOWED_EXTS = frozenset({".pdf", ".docx", ".doc"})

_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0"

# Executable / script suffixes that must never appear, even mid-name.
_DANGEROUS_SUFFIXES = frozenset({
    ".exe", ".js", ".bat", ".cmd", ".scr", ".msi", ".ps1", ".sh",
    ".com", ".jar", ".vbs", ".dll",
})


@dataclass(frozen=True)
class ValidatedUpload:
    ext: str
    kind: str  # "pdf" | "docx" | "doc"
    size_bytes: int


def _check_double_extension(client_name: str) -> None:
    lower = client_name.lower()
    parts = lower.split(".")
    # parts[0] is the stem before the first dot; every suffix must be safe.
    for suffix in ("." + p for p in parts[1:]):
        if suffix in _DANGEROUS_SUFFIXES:
            raise ValueError(f"File type '{suffix}' is not allowed.")


def detect_kind(data: bytes) -> str | None:
    """Detect pdf/docx/doc by magic bytes. None if unrecognized."""
    if data.startswith(_PDF_MAGIC):
        return "pdf"
    if data.startswith(_ZIP_MAGIC):
        # DOCX is a zip containing [Content_Types].xml near the top.
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = zf.namelist()[:20]
                if "[Content_Types].xml" in names or any(n.startswith("word/") for n in names):
                    return "docx"
        except zipfile.BadZipFile:
            return None
        return None
    if data.startswith(_OLE_MAGIC):
        return "doc"
    return None


def check_docx_bomb(data: bytes) -> None:
    """Enforce the DOCX (zip) decompression cap against zip bombs."""
    cap = settings.upload_max_uncompressed_mb * 1024 * 1024
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            total = 0
            for info in zf.infolist():
                total += info.file_size
                if total > cap:
                    raise ValueError("Archive decompresses beyond the allowed limit.")
    except zipfile.BadZipFile:
        raise ValueError("Corrupt archive file.") from None


def validate_upload(client_name: str, data: bytes) -> ValidatedUpload:
    """Validate one uploaded file. Raises ValueError with a safe message."""
    if not data:
        raise ValueError("Empty file.")
    max_bytes = settings.upload_max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise ValueError(f"File exceeds the {settings.upload_max_mb} MB limit.")

    lower = client_name.lower()
    dot = lower.rfind(".")
    if dot < 0:
        raise ValueError("Only PDF, DOCX or DOC files are allowed.")
    ext = lower[dot:]
    if ext not in ALLOWED_EXTS:
        raise ValueError("Only PDF, DOCX or DOC files are allowed.")
    _check_double_extension(client_name)

    kind = detect_kind(data)
    if kind is None:
        raise ValueError("File content does not match its type (magic bytes).")
    if (ext == ".pdf" and kind != "pdf") or (ext == ".docx" and kind != "docx") or (ext == ".doc" and kind != "doc"):
        raise ValueError("File extension does not match its content.")

    if kind == "docx":
        check_docx_bomb(data)

    return ValidatedUpload(ext=ext, kind=kind, size_bytes=len(data))
