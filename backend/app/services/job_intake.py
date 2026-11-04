"""Shared application intake policy for API, upload, and worker."""
from datetime import datetime, timezone


def intake_error(job: dict, now: datetime | None = None) -> str | None:
    now = now or datetime.now(timezone.utc)
    status = getattr(job.get("lifecycleStatus"), "value", job.get("lifecycleStatus")) or "DRAFT"
    if status != "OPEN":
        return f"Job is {str(status).lower()}; new applications are not accepted"
    for key, future in (("openedAt", True), ("closesAt", False)):
        value = job.get(key)
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if value is not None:
            value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
            if future and value > now:
                return "Job has not opened yet; new applications are not accepted"
            if not future and value <= now:
                return "Job closing time has passed; new applications are not accepted"
    if job.get("positionsFilled", 0) >= job.get("positionsTotal", 1):
        return "All positions are filled; new applications are not accepted"
    return None
