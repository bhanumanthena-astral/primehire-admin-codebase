"""Talent matching stays advisory, consented, bounded and tenant/job scoped."""

import asyncio
import json
from datetime import timedelta
import pytest
from app.config import settings
from app.services import talent
from app.models.recruitment import now
from migrations.talent_v2 import upgrade
from tests.test_recruitment import client, headers


async def seed(db, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    await upgrade(db)
    await db["jobs"].insert_one(
        {
            "orgId": "default",
            "jobId": "old",
            "title": "Previous role",
            "assigneeUserId": "recruiter",
            "lifecycleStatus": "CLOSED",
        }
    )
    await db["applicants"].update_one(
        {"applicantId": "person0"},
        {
            "$set": {
                "consent": {"given": True},
                "retentionUntil": now() + timedelta(days=30),
            }
        },
    )
    await db["applications"].insert_one(
        {
            "orgId": "default",
            "applicationId": "old-app",
            "jobId": "old",
            "applicantId": "person0",
            "currentStage": "REJECTED",
            "assessment": {"score": 81, "status": "completed"},
            "createdAt": now() - timedelta(days=60),
            "updatedAt": now() - timedelta(days=30),
            "talentPool": {
                "inPool": True,
                "recontactFlag": "eligible",
                "rejectedAtStage": "HR_ROUND",
                "reason": "Availability mismatch",
            },
        }
    )
    await db["recruit_reviews"].insert_one(
        {
            "orgId": "default",
            "reviewId": "old-review",
            "applicationId": "old-app",
            "round": "technical",
            "decision": "advance",
            "strengths": "Strong Python delivery",
            "concerns": "Limited architecture examples",
            "comments": "Discuss tradeoffs; person0@example.test",
            "createdAt": now() - timedelta(days=40),
            "applied": True,
        }
    )


async def start(client, **extra):
    response = await client.post(
        "/api/recruitment/talent/runs",
        json={"jobId": "job", "requestId": "synthetic-request-00001", **extra},
        headers=headers("recruiter"),
    )
    assert response.status_code == 202, response.text
    return response.json()


async def matched(client, db, monkeypatch):
    await seed(db, monkeypatch)
    run = await start(client)
    await talent.tick(db)
    result = await client.get(
        "/api/recruitment/talent/matches?runId=" + run["runId"],
        headers=headers("recruiter"),
    )
    assert result.status_code == 200, result.text
    return run, result.json()["items"][0]


async def test_matching_reuses_history_without_creating_candidate_application_or_email(
    client, db, monkeypatch
):
    run, match = await matched(client, db, monkeypatch)
    assert run["total"] == 1
    assert (
        match["method"] == "local_rules" and match["providerStatus"] == "not_configured"
    )
    assert match["previousAssessment"]["score"] == 81 and match["reviewCount"] == 1
    assert "person0@example.test" not in str(match)
    assert (
        await db["applications"].count_documents({}) == 4
        and await db["applicants"].count_documents({}) == 3
    )
    assert await db["recruit_email_outbox"].count_documents({}) == 0
    detail = await client.get(
        "/api/recruitment/talent/matches/" + match["matchId"],
        headers=headers("recruiter"),
    )
    assert (
        detail.status_code == 200
        and detail.json()["reviews"][0]["reviewId"] == "old-review"
    )
    assert "person0@example.test" not in detail.text
    replay = await start(client)
    assert replay["runId"] == run["runId"]


async def test_reuse_is_human_approved_idempotent_and_does_not_copy_old_scores(
    client, db, monkeypatch
):
    _, match = await matched(client, db, monkeypatch)
    await db["applications"].delete_one({"applicationId": "app0"})
    responses = await asyncio.gather(
        *[
            client.post(
                "/api/recruitment/talent/matches/" + match["matchId"] + "/reuse",
                json={
                    "reason": "Recruiter reviewed historic feedback and approved reconsideration"
                },
                headers=headers("recruiter"),
            )
            for _ in range(2)
        ]
    )
    assert all(r.status_code in {200, 409} for r in responses)
    response = next(r for r in responses if r.status_code == 200)
    created = await db["applications"].find_one(
        {"applicationId": response.json()["applicationId"]}
    )
    assert (
        created["currentStage"] == "PARSED"
        and created["matchScore"] is None
        and "assessment" not in created
    )
    assert created["talentSourceApplicationId"] == "old-app"
    assert (
        await db["applications"].count_documents(
            {"jobId": "job", "applicantId": "person0"}
        )
        == 1
    )
    assert (
        await db["stage_history"].count_documents(
            {"applicationId": created["applicationId"]}
        )
        == 1
    )
    assert (await db["applications"].find_one({"applicationId": "old-app"}))[
        "currentStage"
    ] == "REJECTED"


@pytest.mark.parametrize(
    "mutation",
    [{"consent": {"given": False}}, {"retentionUntil": now() - timedelta(days=1)}],
)
async def test_matching_skips_unconsented_or_expired_profiles(
    client, db, monkeypatch, mutation
):
    await seed(db, monkeypatch)
    await db["applicants"].update_one({"applicantId": "person0"}, {"$set": mutation})
    run = await start(client)
    await talent.tick(db)
    stored = await db["talent_match_runs"].find_one({"runId": run["runId"]})
    assert stored["status"] == "completed" and stored["skipped"] == 1
    assert await db["talent_matches"].count_documents({}) == 0


async def test_stale_evidence_and_closed_job_block_reuse(client, db, monkeypatch):
    _, match = await matched(client, db, monkeypatch)
    await db["jobs"].update_one({"jobId": "job"}, {"$set": {"keywords": ["Go"]}})
    detail = await client.get(
        "/api/recruitment/talent/matches/" + match["matchId"], headers=headers()
    )
    assert detail.json()["stale"]
    reuse = await client.post(
        "/api/recruitment/talent/matches/" + match["matchId"] + "/reuse",
        json={"reason": "Approved reconsideration"},
        headers=headers(),
    )
    assert reuse.status_code == 409
    await db["jobs"].update_one(
        {"jobId": "job"}, {"$set": {"lifecycleStatus": "CLOSED"}}
    )
    assert (
        await client.post(
            "/api/recruitment/talent/runs",
            json={"jobId": "job", "requestId": "another-synthetic-key"},
            headers=headers(),
        )
    ).status_code == 409


async def test_recommendations_expire_and_consent_revocation_hides_counts(
    client, db, monkeypatch
):
    run, match = await matched(client, db, monkeypatch)
    row = await db["talent_matches"].find_one({"matchId": match["matchId"]})
    person = await db["applicants"].find_one({"applicantId": "person0"})
    assert row["expiresAt"] <= person["retentionUntil"]
    await db["applicants"].update_one(
        {"applicantId": "person0"}, {"$set": {"consent.given": False}}
    )
    response = await client.get(
        "/api/recruitment/talent/matches?runId=" + run["runId"], headers=headers()
    )
    assert response.json()["items"] == [] and response.json()["total"] == 0
    await db["talent_matches"].update_one(
        {"matchId": match["matchId"]},
        {"$set": {"expiresAt": now() - timedelta(seconds=1)}},
    )
    assert (
        await client.get(
            "/api/recruitment/talent/matches/" + match["matchId"], headers=headers()
        )
    ).status_code in {404, 410}


async def test_source_reassignment_and_cross_org_access_are_denied(
    client, db, monkeypatch
):
    run, match = await matched(client, db, monkeypatch)
    key = match["matchId"]
    assert (
        await client.get(
            "/api/recruitment/talent/matches/" + key,
            headers=headers("technical_interviewer"),
        )
    ).status_code == 403
    assert (
        await client.get(
            "/api/recruitment/talent/matches/" + key,
            headers=headers("super_admin", org="other"),
        )
    ).status_code == 404
    await db["jobs"].update_one(
        {"jobId": "old"}, {"$set": {"assigneeUserId": "another-recruiter"}}
    )
    assert (
        await client.get(
            "/api/recruitment/talent/matches/" + key, headers=headers("recruiter")
        )
    ).status_code == 404
    result = (
        await client.get(
            "/api/recruitment/talent/matches?runId=" + run["runId"],
            headers=headers("recruiter"),
        )
    ).json()
    assert result["items"] == [] and result["total"] == 0


async def test_worker_rechecks_account_permissions_and_job_revision(
    client, db, monkeypatch
):
    await seed(db, monkeypatch)
    run = await start(client)
    await db["jobs"].update_one(
        {"jobId": "job"}, {"$set": {"jdText": "Changed requirements"}}
    )
    await talent.tick(db)
    assert (await db["talent_match_runs"].find_one({"runId": run["runId"]}))[
        "status"
    ] == "blocked"
    assert await db["talent_matches"].count_documents({}) == 0


async def test_removing_job_view_grant_revokes_saved_recommendation_access(
    client, db, monkeypatch
):
    run, match = await matched(client, db, monkeypatch)
    await db["jobs"].update_one(
        {"jobId": "old"}, {"$set": {"assigneeAccess": ["upload"]}}
    )
    response = await client.get(
        "/api/recruitment/talent/matches?runId=" + run["runId"],
        headers=headers("recruiter"),
    )
    assert response.json()["items"] == [] and response.json()["total"] == 0
    assert (
        await client.get(
            "/api/recruitment/talent/matches/" + match["matchId"],
            headers=headers("recruiter"),
        )
    ).status_code == 403
    await db["users"].update_one(
        {"userId": "recruiter"}, {"$set": {"jobAccess": ["upload"]}}
    )
    assert (
        await client.get("/api/recruitment/jobs", headers=headers("recruiter"))
    ).json()["items"] == []


async def test_new_job_automatically_queues_advice_once_without_application_changes(
    client, db, monkeypatch
):
    await seed(db, monkeypatch)
    await db["jobs"].update_one(
        {"jobId": "job"}, {"$set": {"createdAt": now(), "createdBy": "recruiter"}}
    )
    await talent.tick(db)
    await talent.tick(db)
    assert await db["talent_match_runs"].count_documents({"jobId": "job"}) == 1
    assert await db["talent_matches"].count_documents({}) == 1
    assert await db["applications"].count_documents({}) == 4


async def test_talent_llm_receives_review_context_with_stripped_identity(
    db, monkeypatch
):
    monkeypatch.setattr(settings, "openrouter_api_key", "synthetic-key")
    monkeypatch.setattr(settings, "resume_ats_model", "synthetic-model")
    captured = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "score": 78,
                                    "reasons": [
                                        "Strong skills; verify architecture depth"
                                    ],
                                    "cautions": [
                                        "Historic availability issue needs reconfirmation"
                                    ],
                                }
                            )
                        }
                    }
                ]
            }

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            captured.update(kwargs["json"])
            return Response()

    monkeypatch.setattr(talent.httpx, "AsyncClient", Client)
    profile = {
        "name": "Secret Candidate",
        "email": "secret@example.test",
        "skills": ["Python"],
        "summary": "Secret Candidate builds Python services",
    }
    reviews = [
        {
            "round": "technical",
            "decision": "reject",
            "strengths": "Secret Candidate knows Python",
            "comments": "Contact secret@example.test",
            "concerns": "Limited depth",
        }
    ]
    user = type("User", (), {"org_id": "default"})()
    result = await talent.advise(
        db,
        user,
        {"title": "Python Engineer", "keywords": ["Python"]},
        {"assessment": {"score": 82}},
        profile,
        reviews,
        "fake-output",
    )
    assert result["method"] == "llm" and result["score"] == 78 and result['providerStatus']=='done'
    prompt = str(captured["messages"])
    assert (
        "Secret Candidate" not in prompt
        and "secret@example.test" not in prompt
        and "Limited depth" in prompt
    )
    assert (
        await db["llm_runs"].count_documents({"promptVersion": "talent-match-v1"}) == 1
    )
    assert "messages" not in str(await db["llm_runs"].find_one({}))


async def test_migration_is_additive_and_dry_run_does_not_write(db):
    report = await upgrade(db, dry_run=True)
    assert report["backfill"] is False and set(report["collections"]) == {
        "talent_match_runs",
        "talent_matches",
    }
    assert await db["migrations"].count_documents({}) == 0
