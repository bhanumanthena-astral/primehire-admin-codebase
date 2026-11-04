"""V2-scoped additive migration; never discovered/applied by the V1 runner."""
from app.models.resume_intake import ensure_intake_indexes
from app.config import settings
from datetime import datetime, timezone
import hashlib
import time
from pathlib import Path

VERSION = "006_resume_intake_v2"


async def upgrade(db, dry_run=False):
    if db.name != "primehire_admin_v2" or not settings.resume_module_v2_enabled:
        raise RuntimeError("Resume intake migration requires the enabled primehire_admin_v2 database.")
    if dry_run:
        return {"version": VERSION, "status": "pending", "additiveOnly": True}
    started = time.monotonic()
    await ensure_intake_indexes(db)
    await db["migrations"].update_one({"version": VERSION}, {"$setOnInsert": {
        "version": VERSION, "appliedAt": datetime.now(timezone.utc), "additiveOnly": True,
        "checksum": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "durationMs": round((time.monotonic() - started) * 1000)}}, upsert=True)
    return {"version": VERSION, "status": "applied"}


if __name__ == "__main__":
    import argparse
    import asyncio
    from app.db.mongodb import get_database
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(asyncio.run(upgrade(get_database(settings.mongodb_uri, settings.mongodb_database), dry_run=args.dry_run)))
