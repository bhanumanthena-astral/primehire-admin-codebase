"""Migration runner — discovers and applies versioned migrations.

Records applied migrations in the ``migrations`` collection with version,
appliedAt, checksum, and durationMs.  Supports ``--dry-run`` and
``--apply`` modes (per §6.2 of ENGINEERING_STANDARDS).

Usage (from repo root):
    # Dry-run (CI or pre-deploy):
    python -m migrations.runner --dry-run

    # Apply (deploy-time):
    python -m migrations.runner --apply
"""

from __future__ import annotations

import hashlib
import importlib
import logging
import pkgutil
import time
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _module_checksum(module: Any) -> str:
    """SHA-256 of the migration module's source file."""
    import inspect

    try:
        source = inspect.getsource(module)
    except (OSError, TypeError):
        source = ""
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def discover_migrations() -> list[tuple[str, Any]]:
    """Return [(version_name, module)] sorted by version name.

    Convention: files in ``migrations/versions/`` named ``NNN_description.py``
    where NNN is a zero-padded sequence number.  Each module must expose an
    async ``async def upgrade(db) -> dict`` function.
    """
    from migrations import versions as versions_pkg

    found: list[tuple[str, Any]] = []
    for importer, modname, _ispkg in pkgutil.iter_modules(versions_pkg.__path__):
        module = importlib.import_module(f"migrations.versions.{modname}")
        if not hasattr(module, "upgrade"):
            logger.warning("Migration %s has no upgrade(); skipping", modname)
            continue
        found.append((modname, module))
    found.sort(key=lambda x: x[0])
    return found


async def get_applied(db: Any) -> set[str]:
    """Return the set of already-applied migration version names."""
    col = db["migrations"]
    return {doc["version"] async for doc in col.find({}, {"version": 1})}


async def run_migrations(
    db: Any, *, dry_run: bool = False
) -> list[dict[str, Any]]:
    """Discover and apply pending migrations.

    Returns a list of dicts describing what was applied (or would be applied).
    """
    all_migrations = discover_migrations()
    already_applied = await get_applied(db)
    results: list[dict[str, Any]] = []

    for version, module in all_migrations:
        if version in already_applied:
            logger.debug("Migration %s already applied — skipping", version)
            continue

        checksum = _module_checksum(module)

        if dry_run:
            logger.info("[DRY-RUN] Would apply migration: %s", version)
            results.append({"version": version, "status": "pending", "checksum": checksum})
            continue

        logger.info("Applying migration: %s", version)
        start = time.monotonic()
        try:
            detail = await module.upgrade(db)
        except Exception:
            logger.exception("Migration %s FAILED", version)
            raise
        elapsed_ms = int((time.monotonic() - start) * 1000)

        record = {
            "version": version,
            "appliedAt": _utcnow(),
            "checksum": checksum,
            "durationMs": elapsed_ms,
        }
        await db["migrations"].insert_one(record)
        logger.info("Migration %s applied in %d ms", version, elapsed_ms)
        results.append({
            "version": version,
            "status": "applied",
            "checksum": checksum,
            "durationMs": elapsed_ms,
            "detail": detail,
        })

    if not results:
        logger.info("No pending migrations.")
    return results


# CLI entry-point: ``python -m migrations.runner --dry-run|--apply``
if __name__ == "__main__":  # pragma: no cover
    import argparse
    import asyncio
    import sys

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))

    from app.config import settings
    from app.db.mongodb import get_database

    parser = argparse.ArgumentParser(description="PrimeHire migration runner")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="List pending migrations without applying")
    group.add_argument("--apply", action="store_true", help="Apply pending migrations")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

    if not settings.has_mongo:
        logger.error("MONGODB_URI is not configured. Cannot run migrations.")
        sys.exit(1)

    db = get_database(settings.mongodb_uri, settings.mongodb_database)
    results = asyncio.run(run_migrations(db, dry_run=args.dry_run))
    for r in results:
        print(f"  {r['version']}: {r['status']}")
    sys.exit(0)
