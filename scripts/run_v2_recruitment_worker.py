"""Dedicated V2 recruitment reminders and encrypted outbox delivery."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import settings, validate_settings
from app.db.mongodb import get_database
from app.services.recruitment_worker import run

if __name__ == "__main__":
    if settings.mongodb_database != "primehire_admin_v2" or not settings.has_mongo:
        raise SystemExit(
            "Refusing to run recruitment worker outside the persistent V2 database"
        )
    settings.recruitment_portals_enabled = True
    validate_settings(settings)
    asyncio.run(run(get_database(settings.mongodb_uri, settings.mongodb_database)))
