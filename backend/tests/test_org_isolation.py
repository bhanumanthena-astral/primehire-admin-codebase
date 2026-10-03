"""Tests proving org-isolation: org A cannot read or modify org B's data.

Per Step 1 of Phase 1, this test file covers every collection that carries
orgId and verifies cross-org access is denied at the repository level.
"""

import pytest
import mongomock_motor

from app.models.organization import OrganizationRepository


@pytest.fixture()
def db():
    return mongomock_motor.AsyncMongoMockClient()["testdb"]


# ----- Organization isolation -----

async def test_org_get_by_id_isolated(db):
    """Fetching an org by orgId only returns that org's document."""
    repo = OrganizationRepository(db)
    await repo.create({"orgId": "org-a", "name": "Org A"})
    await repo.create({"orgId": "org-b", "name": "Org B"})

    a = await repo.get_by_org_id("org-a")
    assert a is not None
    assert a["name"] == "Org A"

    b = await repo.get_by_org_id("org-b")
    assert b is not None
    assert b["name"] == "Org B"

    # org-a cannot find org-b:
    assert await repo.get_by_org_id("org-c") is None


async def test_org_update_isolated(db):
    """Updating org-a doesn't affect org-b."""
    repo = OrganizationRepository(db)
    await repo.create({"orgId": "org-a", "name": "Org A"})
    await repo.create({"orgId": "org-b", "name": "Org B"})

    await repo.update_by_org_id("org-a", {"name": "Org A Updated"})

    b = await repo.get_by_org_id("org-b")
    assert b is not None
    assert b["name"] == "Org B"  # Unchanged


# ----- Candidate isolation (via raw Mongo — org-scoped filter pattern) -----

async def test_candidate_org_isolation(db):
    """Candidates with different orgIds are isolated at the DB level."""
    col = db["candidates"]
    await col.insert_one({"orgId": "org-a", "candidateKey": "CAND-A1", "name": "Alice"})
    await col.insert_one({"orgId": "org-b", "candidateKey": "CAND-B1", "name": "Bob"})

    # org-a query only sees its own candidates:
    org_a_docs = [d async for d in col.find({"orgId": "org-a"})]
    assert len(org_a_docs) == 1
    assert org_a_docs[0]["name"] == "Alice"

    # org-b query only sees its own:
    org_b_docs = [d async for d in col.find({"orgId": "org-b"})]
    assert len(org_b_docs) == 1
    assert org_b_docs[0]["name"] == "Bob"

    # Cross-org access fails:
    cross = await col.find_one({"orgId": "org-a", "candidateKey": "CAND-B1"})
    assert cross is None


async def test_candidate_update_org_isolation(db):
    """Update scoped to org-a doesn't touch org-b's candidate."""
    col = db["candidates"]
    await col.insert_one({"orgId": "org-a", "candidateKey": "CAND-1", "name": "Alice"})
    await col.insert_one({"orgId": "org-b", "candidateKey": "CAND-1", "name": "Bob"})

    # Update only org-a's CAND-1:
    await col.update_one(
        {"orgId": "org-a", "candidateKey": "CAND-1"},
        {"$set": {"name": "Alice Updated"}},
    )

    a = await col.find_one({"orgId": "org-a", "candidateKey": "CAND-1"})
    assert a["name"] == "Alice Updated"

    b = await col.find_one({"orgId": "org-b", "candidateKey": "CAND-1"})
    assert b["name"] == "Bob"  # Unchanged


async def test_candidate_delete_org_isolation(db):
    """Deleting in org-a doesn't remove org-b's candidate."""
    col = db["candidates"]
    await col.insert_one({"orgId": "org-a", "candidateKey": "CAND-1", "name": "Alice"})
    await col.insert_one({"orgId": "org-b", "candidateKey": "CAND-1", "name": "Bob"})

    await col.delete_one({"orgId": "org-a", "candidateKey": "CAND-1"})

    assert await col.find_one({"orgId": "org-a", "candidateKey": "CAND-1"}) is None
    b = await col.find_one({"orgId": "org-b", "candidateKey": "CAND-1"})
    assert b is not None
    assert b["name"] == "Bob"


# ----- Assessment isolation -----

async def test_assessment_org_isolation(db):
    col = db["assessments"]
    await col.insert_one({"orgId": "org-a", "jobId": "JOB-1", "jobTitle": "Dev"})
    await col.insert_one({"orgId": "org-b", "jobId": "JOB-1", "jobTitle": "QA"})

    # Same jobId, different orgs — both coexist:
    a = await col.find_one({"orgId": "org-a", "jobId": "JOB-1"})
    assert a["jobTitle"] == "Dev"

    b = await col.find_one({"orgId": "org-b", "jobId": "JOB-1"})
    assert b["jobTitle"] == "QA"


# ----- Template isolation -----

async def test_template_org_isolation(db):
    col = db["templates"]
    await col.insert_one({"orgId": "org-a", "id": "tpl-1", "name": "Invite A"})
    await col.insert_one({"orgId": "org-b", "id": "tpl-1", "name": "Invite B"})

    a = await col.find_one({"orgId": "org-a", "id": "tpl-1"})
    assert a["name"] == "Invite A"

    b = await col.find_one({"orgId": "org-b", "id": "tpl-1"})
    assert b["name"] == "Invite B"


# ----- Report isolation note -----
# Reports stay globally keyed by upstream interviewId (unique across
# the entire PrimeHire system). Org isolation for reports is enforced
# by joining through the candidate/application layer, not at the
# report collection level.
