"""Tests for the organization model and default-org seeding."""

import pytest
import mongomock_motor

from app.models.organization import (
    OrganizationRepository,
    seed_default_org,
    DEFAULT_ORG_ID,
    DEFAULT_ORG_NAME,
)


@pytest.fixture()
def db():
    return mongomock_motor.AsyncMongoMockClient()["testdb"]


# --- seed_default_org ---

async def test_seed_default_org_creates_on_empty_db(db):
    """First boot: seed inserts the default organization."""
    created = await seed_default_org(db)
    assert created is True

    repo = OrganizationRepository(db)
    org = await repo.get_by_org_id(DEFAULT_ORG_ID)
    assert org is not None
    assert org["orgId"] == DEFAULT_ORG_ID
    assert org["name"] == DEFAULT_ORG_NAME
    assert "settings" in org
    assert org["settings"]["matchThreshold"] == 60


async def test_seed_default_org_noop_when_exists(db):
    """Subsequent boots: seed does nothing if an org already exists."""
    await seed_default_org(db)
    created_again = await seed_default_org(db)
    assert created_again is False

    # Still only one org.
    repo = OrganizationRepository(db)
    all_orgs = await repo.list_all()
    assert len(all_orgs) == 1


# --- OrganizationRepository ---

async def test_create_and_get(db):
    repo = OrganizationRepository(db)
    org = await repo.create({"orgId": "org-1", "name": "Test Org"})
    assert org["orgId"] == "org-1"
    assert org["name"] == "Test Org"
    assert "createdAt" in org
    assert "updatedAt" in org

    fetched = await repo.get_by_org_id("org-1")
    assert fetched is not None
    assert fetched["orgId"] == "org-1"


async def test_get_nonexistent_returns_none(db):
    repo = OrganizationRepository(db)
    assert await repo.get_by_org_id("does-not-exist") is None


async def test_update_settings(db):
    repo = OrganizationRepository(db)
    await repo.create({"orgId": "org-2", "name": "Org Two"})
    updated = await repo.update_by_org_id("org-2", {"settings.matchThreshold": 80})
    assert updated is not None
    assert updated["settings"]["matchThreshold"] == 80


async def test_update_nonexistent_returns_none(db):
    repo = OrganizationRepository(db)
    assert await repo.update_by_org_id("nope", {"name": "x"}) is None


async def test_list_all(db):
    repo = OrganizationRepository(db)
    await repo.create({"orgId": "a", "name": "A"})
    await repo.create({"orgId": "b", "name": "B"})
    all_orgs = await repo.list_all()
    assert len(all_orgs) == 2


async def test_count(db):
    repo = OrganizationRepository(db)
    assert await repo.count() == 0
    await repo.create({"orgId": "x", "name": "X"})
    assert await repo.count() == 1


async def test_to_public_strips_mongo_id(db):
    """The MongoDB _id is converted to string 'id', not leaked."""
    repo = OrganizationRepository(db)
    org = await repo.create({"orgId": "test", "name": "T"})
    assert "_id" not in org
    assert "id" in org
    assert isinstance(org["id"], str)
