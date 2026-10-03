"""Tests for the migration runner and 001_add_orgid migration."""

import pytest
import mongomock_motor

from migrations.runner import run_migrations, get_applied, discover_migrations


@pytest.fixture()
def db():
    return mongomock_motor.AsyncMongoMockClient()["testdb"]


# --- Migration runner ---

async def test_discover_migrations():
    """At least the 001_add_orgid migration is discovered."""
    migrations = discover_migrations()
    assert len(migrations) >= 1
    names = [name for name, _mod in migrations]
    assert "001_add_orgid" in names


async def test_run_migrations_applies_pending(db):
    """First run applies all pending migrations."""
    results = await run_migrations(db)
    assert len(results) >= 1
    assert all(r["status"] == "applied" for r in results)

    # Check the migrations collection was updated.
    applied = await get_applied(db)
    assert "001_add_orgid" in applied


async def test_run_migrations_idempotent(db):
    """Running twice doesn't re-apply."""
    await run_migrations(db)
    second_run = await run_migrations(db)
    assert len(second_run) == 0


async def test_run_migrations_dry_run(db):
    """Dry-run lists pending migrations without applying."""
    results = await run_migrations(db, dry_run=True)
    assert len(results) >= 1
    assert all(r["status"] == "pending" for r in results)

    # Nothing was actually applied.
    applied = await get_applied(db)
    assert len(applied) == 0


# --- 001_add_orgid migration ---

async def test_001_adds_orgid_to_existing_docs(db):
    """Migration adds orgId to documents that lack it."""
    # Insert docs WITHOUT orgId into all four collections.
    await db["assessments"].insert_one({"jobId": "JOB-1", "jobTitle": "Test"})
    await db["candidates"].insert_one({"candidateKey": "CAND-1", "name": "Alice"})
    await db["reports"].insert_one({"interviewId": "INT-1"})
    await db["templates"].insert_one({"id": "tpl-1", "name": "Invite"})

    results = await run_migrations(db)
    assert any(r["version"] == "001_add_orgid" for r in results)

    # Verify orgId was added.
    for col_name in ("assessments", "candidates", "reports", "templates"):
        doc = await db[col_name].find_one()
        assert doc is not None
        assert doc.get("orgId") == "default", f"{col_name} missing orgId"


async def test_001_preserves_existing_orgid(db):
    """Migration doesn't overwrite documents that already have orgId."""
    await db["candidates"].insert_one({
        "candidateKey": "CAND-99",
        "name": "Bob",
        "orgId": "custom-org",
    })

    await run_migrations(db)

    doc = await db["candidates"].find_one({"candidateKey": "CAND-99"})
    assert doc is not None
    assert doc["orgId"] == "custom-org"  # NOT overwritten


async def test_001_handles_empty_collections(db):
    """Migration succeeds even when collections are empty."""
    results = await run_migrations(db)
    migration_001 = [r for r in results if r["version"] == "001_add_orgid"]
    assert len(migration_001) == 1
    assert migration_001[0]["status"] == "applied"


# --- 002_fix_application_uniqueness migration ---

async def test_002_dry_run_reports_without_applying(db):
    """Dry-run lists 002 as pending and applies nothing (backup-first flow)."""
    results = await run_migrations(db, dry_run=True)
    assert any(r["version"] == "002_fix_application_uniqueness" and r["status"] == "pending"
               for r in results)
    assert await get_applied(db) == set()


async def test_002_detects_active_duplicates(db):
    """002 reports duplicate ACTIVE groups that would block the partial index."""
    from migrations.versions import __package__ as _pkg  # noqa: F401  (import guard)
    import importlib

    mod = importlib.import_module("migrations.versions.002_fix_application_uniqueness")
    for i in range(2):
        await db["applications"].insert_one({
            "applicationId": f"app-{i}", "orgId": "default",
            "jobId": "job-1", "applicantId": "apl-1", "currentStage": "SHORTLISTED",
        })
    report = await mod.upgrade(db)
    assert report["activeDuplicates"] == 1


async def test_002_terminal_states_not_duplicates(db):
    """REJECTED/WITHDRAWN rows for the same triple are NOT counted as duplicates."""
    import importlib

    mod = importlib.import_module("migrations.versions.002_fix_application_uniqueness")
    await db["applications"].insert_one({
        "applicationId": "app-old", "orgId": "default",
        "jobId": "job-1", "applicantId": "apl-1", "currentStage": "REJECTED",
    })
    await db["applications"].insert_one({
        "applicationId": "app-new", "orgId": "default",
        "jobId": "job-1", "applicantId": "apl-1", "currentStage": "SHORTLISTED",
    })
    report = await mod.upgrade(db)
    assert report["activeDuplicates"] == 0
