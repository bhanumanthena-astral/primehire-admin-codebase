"""Organization-local upload dates are converted once to UTC."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


async def org_timezone(db, org_id):
    org = await db["organizations"].find_one({"orgId": org_id})
    name = ((org or {}).get("settings") or {}).get("timezone") or "Asia/Kolkata"
    try:
        ZoneInfo(name)
    except (KeyError, ValueError):
        return "UTC"
    return name


def local_to_utc(value: datetime, zone: str) -> datetime:
    return (value.replace(tzinfo=ZoneInfo(zone)) if value.tzinfo is None else value).astimezone(timezone.utc)
