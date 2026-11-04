"""Recruitment integration: synthetic data, no live Mongo/email/model calls."""

import asyncio
from datetime import timedelta
import httpx
import pytest
from app.main import app
from app.config import settings
from app.security.deps import get_db
from app.security.tokens import create_access_token
from app.models.recruitment import now
from migrations.recruitment_v2 import upgrade


def headers(role="super_admin", uid=None, org="default"):
    return {
        "Authorization": "Bearer "
        + create_access_token(
            user_id=uid or role, org_id=org, role=role, session_id="fixture"
        )
    }


@pytest.fixture
async def client(db, monkeypatch):
    monkeypatch.setattr(settings, "recruitment_portals_enabled", True)
    monkeypatch.setattr(settings, "email_dry_run", True)
    monkeypatch.setattr(settings, "recruitment_email_dry_run", None)
    monkeypatch.setattr(settings, "recruitment_zeptomail_api_key", "")
    monkeypatch.setattr(settings, "recruitment_email_test_recipient_allowlist", "")
    monkeypatch.setattr(settings, "recruitment_outbox_encryption_key", "")
    from cryptography.fernet import Fernet

    monkeypatch.setattr(
        settings, "outbox_encryption_key", Fernet.generate_key().decode()
    )
    await upgrade(db)
    for role in [
        "super_admin",
        "admin",
        "recruiter",
        "hr",
        "technical_interviewer",
        "managerial_interviewer",
        "viewer",
    ]:
        await db["users"].insert_one(
            {
                "orgId": "default",
                "userId": role,
                "role": role,
                "name": f"Test {role}",
                "email": f"{role}@example.test",
                "isActive": True,
            }
        )
    await db["users"].insert_one(
        {
            "orgId": "other",
            "userId": "other-tech",
            "role": "technical_interviewer",
            "name": "Other",
            "isActive": True,
        }
    )
    await db["jobs"].insert_one(
        {
            "orgId": "default",
            "jobId": "job",
            "title": "Backend Engineer",
            "assigneeUserId": "recruiter",
            "lifecycleStatus": "OPEN",
            "positionsTotal": 2,
            "positionsFilled": 0,
            "createdAt": now(),
            "keywords": ["Python"],
            "jdText": "Build Python services",
        }
    )
    for i in range(3):
        await db["applicants"].insert_one(
            {
                "orgId": "default",
                "applicantId": f"person{i}",
                "name": f"Synthetic Candidate {i}",
                "email": f"person{i}@example.test",
                "phone": "9876543210",
                "profile": {
                    "skills": ["Python"],
                    "experienceYears": 4,
                    "summary": "Builds services",
                },
                "createdAt": now(),
            }
        )
        await db["applications"].insert_one(
            {
                "orgId": "default",
                "applicationId": f"app{i}",
                "applicantId": f"person{i}",
                "jobId": "job",
                "currentStage": "ASSESSMENT_COMPLETED",
                "assessment": {"score": 82, "status": "completed"},
                "createdAt": now(),
            }
        )
    app.dependency_overrides[get_db] = lambda: db
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


def schedule(application="app0", round="technical", **extra):
    start = now() + timedelta(days=1)
    return {
        "applicationId": application,
        "round": round,
        "interviewerId": {
            "technical": "technical_interviewer",
            "managerial": "managerial_interviewer",
            "hr": "hr",
        }[round],
        "startsAt": start.isoformat(),
        "endsAt": (start + timedelta(hours=1)).isoformat(),
        "meetingLink": "https://meet.google.com/example-link",
        "reason": "Recruiter approved scheduling",
        **extra,
    }


async def create(client, **kwargs):
    response = await client.post(
        "/api/recruitment/interviews", json=schedule(**kwargs), headers=headers()
    )
    assert response.status_code == 201, response.text
    return response.json()


async def review(client, db, row, decision="advance", **extra):
    await db["recruit_interviews"].update_one(
        {"interviewId": row["interviewId"]},
        {"$set": {"startsAt": now() - timedelta(hours=1)}},
    )
    payload = {
        "expectedRevision": row["revision"],
        "decision": decision,
        "strengths": "Strong delivery and clear examples",
        "concerns": "Needs broader ownership",
        "comments": "Evidence supports this recommendation",
        "scorecard": {"communication": 4},
        **extra,
    }
    return await client.post(
        f'/api/recruitment/interviews/{row["interviewId"]}/review',
        json=payload,
        headers=headers(row["interviewerId"]),
    )


async def test_end_to_end_rounds_hr_questions_offer_join(client, db):
    row = await create(client)
    assert row["application"]["currentStage"] == "ROUND1_SCHEDULED"
    response = await review(client, db, row)
    assert response.status_code == 200, response.text
    row = await create(client, round="managerial")
    as_manager = await client.get(
        f'/api/recruitment/interviews/{row["interviewId"]}',
        headers=headers("managerial_interviewer"),
    )
    assert len(as_manager.json()["previousReviews"]) == 1
    response = await review(client, db, row)
    assert response.status_code == 200, response.text
    row = await create(client, round="hr")
    questions = await client.post(
        f'/api/recruitment/interviews/{row["interviewId"]}/questions',
        json={"expectedRevision": row["revision"]},
        headers=headers("hr"),
    )
    assert questions.status_code == 200, questions.text
    assert (
        len(questions.json()["questions"]) == 10
        and questions.json()["method"] == "local_guidance"
    )
    response = await review(client, db, row, decision="hire")
    assert response.status_code == 200, response.text
    row = response.json()
    response = await client.put(
        f'/api/recruitment/interviews/{row["interviewId"]}/compensation',
        json={
            "expectedRevision": row["revision"],
            "proposedOffer": 1000000,
            "reason": "Approved annual package",
        },
        headers=headers("hr"),
    )
    assert response.status_code == 200, response.text
    for status in ["offered", "accepted", "joined"]:
        row = response.json()
        response = await client.post(
            f'/api/recruitment/interviews/{row["interviewId"]}/offer',
            json={
                "expectedRevision": row["revision"],
                "status": status,
                "reason": "Human confirmed outcome",
            },
            headers=headers("hr"),
        )
        assert response.status_code == 200, response.text
    assert response.json()["application"]["currentStage"] == "HIRED"
    assert (await db["jobs"].find_one({"jobId": "job"}))["positionsFilled"] == 1
    assert await db["recruit_reviews"].count_documents({}) == 3
    assert await db["email_outbox"].count_documents({}) == 0
    for suffix in ['', '?jobId=job', '?jobId=job&applicationId=app0']:
        tracked = (await client.get('/api/recruitment/tracker'+suffix,headers=headers())).json()
        assert tracked['stages']['HIRED'] == 1
        assert tracked['milestones']['ASSESSMENT_COMPLETED'] >= 1
        assert sum(r['count'] for r in tracked['interviews'] if r['status']=='reviewed') == 3
    candidate_tracker=(await client.get('/api/recruitment/tracker?applicationId=app0',headers=headers())).json()
    assert candidate_tracker['positions']['filled']==1
    assert candidate_tracker['timeline'][-1]['toStage']=='HIRED'


async def test_scope_projection_and_contact_reveal(client, db):
    row = await create(client)
    key = row["interviewId"]
    response = await client.get(
        f"/api/recruitment/interviews/{key}", headers=headers("technical_interviewer")
    )
    assert response.status_code == 200 and "person0@example.test" not in response.text
    assert (
        await client.get(
            f"/api/recruitment/interviews/{key}",
            headers=headers("managerial_interviewer"),
        )
    ).status_code == 404
    assert (
        await client.get(
            f"/api/recruitment/interviews/{key}",
            headers=headers("technical_interviewer", org="other"),
        )
    ).status_code == 404
    assert (
        await client.post(
            f"/api/recruitment/interviews/{key}/reveal",
            json={"reason": "Contact candidate"},
            headers=headers("technical_interviewer"),
        )
    ).status_code == 403
    updated = await client.put(
        "/api/recruitment/access/technical_interviewer",
        json={
            "expectedRevision": 0,
            "visibleFields": ["skills", "contact"],
            "reason": "Approved contact access",
        },
        headers=headers(),
    )
    assert updated.status_code == 200, updated.text
    assert (
        await client.post(
            f"/api/recruitment/interviews/{key}/reveal",
            json={"reason": "Contact candidate"},
            headers=headers("technical_interviewer"),
        )
    ).json()["email"] == "person0@example.test"
    restricted = (
        await client.get(
            f"/api/recruitment/interviews/{key}",
            headers=headers("technical_interviewer"),
        )
    ).json()
    assert (
        "experienceYears" not in restricted["candidate"]
        and "assessment" not in restricted["application"]
    )


async def test_conflicts_duplicates_and_revision(client, db):
    payload = schedule()
    first = await client.post(
        "/api/recruitment/interviews", json=payload, headers=headers()
    )
    assert first.status_code == 201
    duplicate = await client.post(
        "/api/recruitment/interviews", json=payload, headers=headers()
    )
    assert duplicate.status_code == 409
    conflict = await client.post(
        "/api/recruitment/interviews",
        json={**payload, "applicationId": "app1"},
        headers=headers(),
    )
    assert conflict.status_code == 409
    row = first.json()
    key = row["interviewId"]
    bad = await client.put(
        f"/api/recruitment/interviews/{key}",
        json={**payload, "expectedRevision": 99},
        headers=headers(),
    )
    assert bad.status_code == 409
    changed = await client.put(
        f"/api/recruitment/interviews/{key}",
        json={**payload, "expectedRevision": row["revision"]},
        headers=headers(),
    )
    assert changed.status_code == 200, changed.text
    cancelled = await client.post(
        f"/api/recruitment/interviews/{key}/cancel",
        json={
            "expectedRevision": changed.json()["revision"],
            "reason": "Candidate requested another date",
        },
        headers=headers(),
    )
    assert cancelled.status_code == 200, cancelled.text
    assert (
        cancelled.json()["status"] == "cancelled"
        and cancelled.json()["application"]["currentStage"]
        == "ROUND1_PENDING_ASSIGNMENT"
    )


async def test_worker_outbox_is_deduplicated_and_cancelled(client, db):
    from app.services.recruitment_worker import tick

    row = await create(client)
    key = row["interviewId"]
    request = await client.post(
        f"/api/recruitment/interviews/{key}/send-invitation",
        json={"expectedRevision": 1, "reason": "Recruiter approved email"},
        headers=headers(),
    )
    assert request.status_code == 200
    await tick(db)
    await tick(db)
    assert await db["recruit_email_outbox"].count_documents({}) == 2
    assert (
        await db["recruit_email_outbox"].count_documents(
            {"status": "sent", "sentVia": "dry_run"}
        )
        == 2
    )
    assert await db["email_outbox"].count_documents({}) == 0
    assert (
        await db["recruit_notifications"].count_documents(
            {"kind": "interview_assigned"}
        )
        == 1
    )


async def test_tracker_and_readonly_role(client, db):
    row = await create(client)
    response = await client.get(
        "/api/recruitment/tracker", headers=headers("recruiter")
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["total"] == 3
        and response.json()["stages"]["ROUND1_SCHEDULED"] == 1
    )
    response = await client.get(
        "/api/recruitment/applications", headers=headers("technical_interviewer")
    )
    assert response.status_code == 200 and response.json()["total"] == 1
    for method, path in [
        ("get", "/api/recruitment/tracker"),
        ("post", "/api/recruitment/interviews"),
    ]:
        response = await getattr(client, method)(
            path,
            headers=headers("viewer"),
            **({"json": schedule()} if method == "post" else {}),
        )
        assert response.status_code == 403


async def test_locked_review_and_hold_validation(client, db):
    row = await create(client)
    premature = await client.post(
        f'/api/recruitment/interviews/{row["interviewId"]}/review',
        json={
            "expectedRevision": 1,
            "decision": "advance",
            "strengths": "Good skills",
            "comments": "Proceed with next round",
        },
        headers=headers("technical_interviewer"),
    )
    assert premature.status_code == 409
    result = await review(client, db, row, "hold")
    assert result.status_code == 422
    result = await review(client, db, row, "advance")
    assert result.status_code == 200, result.text
    again = await review(client, db, row, "reject")
    assert again.status_code == 409
    assert await db["recruit_reviews"].count_documents({}) == 1


@pytest.mark.parametrize(
    "bad",
    [
        {"meetingLink": "javascript:alert(1)"},
        {"interviewerId": "other-tech"},
        {"endsAt": (now() + timedelta(days=2)).isoformat()},
    ],
)
async def test_invalid_schedule(client, bad):
    result = await client.post(
        "/api/recruitment/interviews", json=schedule(**bad), headers=headers()
    )
    assert result.status_code == 422, result.text
