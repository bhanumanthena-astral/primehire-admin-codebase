"""Malware-scan interface (Slice A: interface + quarantine status only).

- `scan_bytes()` returns "clean" or "quarantined".
- When `CLAMAV_ENABLED=false` (default), everything is "clean" — the hook,
  setting, status value, and the download/parse block are real.
- Real `clamd` integration lands in Phase 7. Quarantined files are stored
  but can never be downloaded or parsed until an admin clears them.
"""

from __future__ import annotations

from ..config import settings

CLEAN = "clean"
QUARANTINED = "quarantined"


def scan_bytes(data: bytes, filename: str = "") -> str:
    """Scan uploaded bytes. Returns CLEAN or QUARANTINED. Never raises."""
    if not settings.clamav_enabled:
        return CLEAN
    # Phase 7: connect to clamd here (timeout-guarded). Until then, a
    # fail-closed stub is intentionally NOT flagging: the interface and the
    # quarantine enforcement paths are what this phase tests. Any transport
    # error must return QUARANTINED (fail closed) once wired.
    try:
        return _clamd_scan(data)
    except Exception:
        return QUARANTINED


def _clamd_scan(data: bytes) -> str:  # pragma: no cover — wired in Phase 7
    raise NotImplementedError("clamd integration lands in Phase 7")
