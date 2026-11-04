"""Run the bounded, dedicated Module 2 worker pool against V2 only."""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import settings, validate_settings
from app.db.mongodb import get_database
from app.services.resume_intake_jobs import supervise_intake_workers

if __name__ == "__main__":
    if settings.mongodb_database != "primehire_admin_v2" or not settings.has_mongo:
        raise SystemExit("Refusing to run: a persistent primehire_admin_v2 database is required.")
    settings.resume_module_v2_enabled = True
    from v2_local_tools import configure_local_tools
    configure_local_tools(settings)
    validate_settings()
    asyncio.run(supervise_intake_workers(get_database(settings.mongodb_uri, settings.mongodb_database),
        concurrency=settings.resume_worker_concurrency))
