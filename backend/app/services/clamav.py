"""Shared upload scanning through the configured ClamAV INSTREAM service."""
from __future__ import annotations

from ..config import settings

CLEAN = "clean"
QUARANTINED = "quarantined"
SCAN_UNAVAILABLE = "scan_unavailable"
UNAVAILABLE_MESSAGE = "The security scanning service is temporarily unavailable. Please retry the upload shortly."


def scan_bytes(data: bytes, filename: str = "") -> str:
    """Distinguish detected malware from an incomplete scan; never fail open."""
    if not settings.clamav_enabled:
        return CLEAN
    try:
        return _clamd_scan(data)
    except Exception:
        return SCAN_UNAVAILABLE


def _clamd_scan(data: bytes) -> str:
    # Import lazily because intake validation also imports upload validators.
    from .resume_intake_security import scan

    verdict = scan(data)
    if verdict == "clean":
        return CLEAN
    if verdict == "virus_detected":
        return QUARANTINED
    return SCAN_UNAVAILABLE
