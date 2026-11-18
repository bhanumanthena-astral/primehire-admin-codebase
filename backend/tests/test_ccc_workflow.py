"""CCC workflow integration uses synthetic records and provider mocks only."""

from datetime import timedelta
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from tests.test_recruitment import client, headers, schedule, create, review
from app.models.recruitment import now
from app.services import hiring_workflow as service
from app.services import recruitment_worker as worker
from app.services.resume_intake import matches
from app.api.hiring_workflow import Traits

BASE = "/api/hiring-workflow"
TEMPLATE = {
    "id": "reject",
    "name": "Approved rejection",
    "category": "rejection",
    "subject": "Update for {{job_title}}",
    "body": "Dear {{candidate_name}}, thank you for applying to {{company}}.",
}


async def templates(client):
    result = await client.put(
        BASE + "/settings",
        headers=headers("admin"),
        json={
            "expectedRevision": 0,
            "templates": [TEMPLATE],
            "defaultRejectionId": "reject",
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


async def test_templates_default_scope_and_rejection_intent(client, db):
    response = await client.get(
        BASE + "/applications/app0/rejection-preview", headers=headers("admin")
    )
    assert response.status_code == 409
    await templates(client)
    assert (
        await client.put(
            BASE + "/settings",
            headers=headers("recruiter"),
            json={"expectedRevision": 1, "templates": [], "defaultRejectionId": None},
        )
    ).status_code == 403
    app = await db.applications.find_one({"applicationId": "app0"})
    await service.prepare_rejection(db, "default", app, "admin")
    app = await db.applications.find_one({"applicationId": "app0"})
    await db.applications.update_one(
        {"applicationId": "app0"}, {"$set": {"currentStage": "REJECTED"}}
    )
    await service.queue_rejection(db, app)
    # A retry with stale in-memory intent still deduplicates the same rejection event.
    await service.queue_rejection(db, app)
    assert (
        await db.recruit_email_outbox.count_documents({"kind": "workflow_rejection"})
        == 1
    )
    message = await db.recruit_email_outbox.find_one({"kind": "workflow_rejection"})
    assert await service.delivery_allowed(db, message)
    await worker.deliver(db, message)
    outcome = await db.recruit_email_outbox.find_one(
        {"messageId": message["messageId"]}
    )
    assert outcome["sentVia"] == "dry_run"
    await db.applications.update_one(
        {"applicationId": "app0"}, {"$set": {"currentStage": "WITHDRAWN"}}
    )
    assert not await service.delivery_allowed(db, message)


async def test_transition_reject_queues_default_template(client, db):
    await templates(client)
    await db.applications.update_one(
        {"applicationId": "app0"},
        {
            "$set": {
                "currentStage": "REJECTION_PENDING_HR_REVIEW",
                "candidateKey": None,
                "assignedReviewers": [],
                "matchScore": None,
                "scoreBreakdown": {},
            }
        },
    )
    response = await client.post(
        "/api/applications/app0/transition",
        headers=headers("admin"),
        json={"toStage": "REJECTED", "reason": "HR confirmed rejection after review"},
    )
    assert response.status_code == 200, response.text
    assert (
        await db.recruit_email_outbox.count_documents({"kind": "workflow_rejection"})
        == 1
    )


async def test_concurrent_rejection_queues_one_message(client, db):
    import asyncio
    from app.services.transitions import transition_application, TransitionError

    await templates(client)
    await db.applications.update_one(
        {"applicationId": "app0"},
        {"$set": {"currentStage": "REJECTION_PENDING_HR_REVIEW"}},
    )
    results = await asyncio.gather(*(
        transition_application(db, org_id="default", application_id="app0",
                               to_stage="REJECTED", actor_user_id="admin",
                               reason="Confirmed rejection")
        for _ in range(2)
    ), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, (TransitionError, HTTPException)) for result in results) == 1
    assert await db.recruit_email_outbox.count_documents({"kind": "workflow_rejection"}) == 1


async def test_original_resume_endpoints_deny_recruiters(client, db):
    for path in [
        "/api/resume-intake/items/missing/download",
        "/api/resumes/files/missing/download",
        "/api/candidate-management/person0/resume",
        "/api/recruitment/interviews/missing/resume",
    ]:
        response = await client.get(path, headers=headers("recruiter"))
        assert response.status_code == 403, (path, response.text)
    app = await db.applicants.find_one({"applicantId": "person0"})
    await db.applicants.update_one(
        {"applicantId": "person0"},
        {
            "$set": {
                "updatedAt": now(),
                "resume": {
                    "fileId": "secret-file",
                    "parsedJson": {"rawText": "private original text"},
                },
            }
        },
    )
    response = await client.get("/api/applicants/person0", headers=headers("recruiter"))
    assert response.status_code == 200, response.text
    assert (
        "secret-file" not in response.text
        and "private original text" not in response.text
    )


async def test_source_persists_and_filters_by_application(client, db):
    response = await client.put(
        BASE + "/applications/app0/source",
        headers=headers("admin"),
        json={"source": "indeed"},
    )
    assert response.status_code == 200, response.text
    assert (await db.applications.find_one({"applicationId": "app0"}))[
        "applicationSource"
    ] == "indeed"
    response = await client.get(
        "/api/recruitment/applications?applicationSource=indeed",
        headers=headers("admin"),
    )
    assert response.status_code == 200, response.text
    assert {row["applicationId"] for row in response.json()["items"]} == {"app0"}
    assert (
        await client.put(
            BASE + "/applications/app0/source",
            headers=headers("admin"),
            json={"source": "made-up"},
        )
    ).status_code == 422


async def test_duplicate_matching_phone_email_and_same_identity_different_jobs(
    client, db
):
    await db.applicants.update_one(
        {"applicantId": "person0"},
        {
            "$set": {
                "email": "duplicate@example.test",
                "phoneDigits": ["919876543210", "9876543210"],
            }
        },
    )
    email = await matches(db, "default", {"email": "duplicate@example.test"})
    phone = await matches(
        db, "default", {"email": "other@example.test", "phone": "+91 98765 43210"}
    )
    assert email[0]["applicantId"] == phone[0]["applicantId"] == "person0"
    assert await matches(db, "other", {"email": "duplicate@example.test"}) == []


async def test_custom_traits_snapshot_and_limit(client, db):
    traits = [
        {
            "id": "customOwnership",
            "name": "Decision making",
            "description": "Explain a decision",
            "active": True,
        }
    ]
    response = await client.put(
        BASE + "/jobs/job/traits/technical",
        headers=headers("admin"),
        json={"expectedRevision": 0, "traits": traits},
    )
    assert response.status_code == 200, response.text
    row = await create(client)
    result = await review(client, db, row, scorecard={"customOwnership": 4})
    assert result.status_code == 200, result.text
    changed = [{**traits[0], "name": "Renamed later"}]
    assert (
        await client.put(
            BASE + "/jobs/job/traits/technical",
            headers=headers("admin"),
            json={"expectedRevision": 1, "traits": changed},
        )
    ).status_code == 200
    stored = await db.recruit_reviews.find_one({"interviewId": row["interviewId"]})
    assert stored["traitSnapshot"]["traits"][0]["name"] == "Decision making"
    seven = [
        {"id": "trait" + str(i), "name": "Trait " + str(i), "active": True}
        for i in range(7)
    ]
    assert (
        await client.put(
            BASE + "/jobs/job/traits/hr",
            headers=headers("admin"),
            json={"expectedRevision": 0, "traits": seven},
        )
    ).status_code == 422


async def test_reminder_templates_and_disabled_reminders(client, db):
    prefs = await templates(client)
    ts = [
        TEMPLATE,
        {
            "id": "cand",
            "name": "Candidate reminder",
            "category": "candidate_reminder",
            "subject": "Your interview",
            "body": "Hello {{candidate_name}}",
        },
        {
            "id": "staff",
            "name": "Company reminder",
            "category": "company_reminder",
            "subject": "Interviewer reminder",
            "body": "{{job_title}} at {{start_time}}",
        },
    ]
    assert (
        await client.put(
            BASE + "/settings",
            headers=headers("admin"),
            json={
                "expectedRevision": 1,
                "templates": ts,
                "defaultRejectionId": "reject",
            },
        )
    ).status_code == 200
    response = await client.post(
        "/api/recruitment/interviews",
        headers=headers("admin"),
        json=schedule(
            reminderMinutes=1440,
            candidateReminderTemplateId="cand",
            companyReminderTemplateId="staff",
            startsAt=(now() + timedelta(days=2)).isoformat(),
            endsAt=(now() + timedelta(days=2, hours=1)).isoformat(),
        ),
    )
    assert response.status_code == 201, response.text
    row = await db.recruit_interviews.find_one({"applicationId": "app0"})
    assert (
        row["candidateReminderTemplate"]["id"] == "cand"
        and row["companyReminderTemplate"]["id"] == "staff"
    )
    response = await client.post(
        "/api/recruitment/interviews",
        headers=headers("admin"),
        json=schedule(application="app1", sendReminder=False),
    )
    assert response.status_code == 201, response.text
    assert (await db.recruit_interviews.find_one({"applicationId": "app1"}))[
        "reminderQueued"
    ] is True


async def test_missing_google_connection_is_truthful(client, db):
    response = await client.get(BASE + "/integration-status", headers=headers("admin"))
    assert response.status_code == 200
    assert not response.json()["connected"] and not response.json()["gmailAuthorized"]


async def test_duplicate_review_records_reason_and_preserves_candidate(client, db):
    await db.resume_intake_batches.insert_one(
        {"_id": "batch", "orgId": "default", "jobId": "job", "createdBy": "admin"}
    )
    await db.resume_intake_items.insert_one(
        {
            "_id": "item",
            "orgId": "default",
            "jobId": "job",
            "batchId": "batch",
            "revision": 1,
            "status": "duplicate_suspected",
        }
    )
    response = await client.post(
        BASE + "/items/item/duplicate-review",
        headers=headers("admin"),
        json={
            "expectedRevision": 1,
            "decision": "dismiss",
            "reason": "Distinct individual after checking identity",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["duplicateReview"]["decision"] == "dismiss"
    assert await db.applicants.count_documents({"applicantId": "person0"}) == 1
    assert (
        await client.post(
            BASE + "/items/item/duplicate-review",
            headers=headers("recruiter"),
            json={
                "expectedRevision": 2,
                "decision": "dismiss",
                "reason": "Invalid reviewer",
            },
        )
    ).status_code == 403


async def test_source_bulk_excel_preserves_source_and_unknown(client, db):
    import io
    from openpyxl import Workbook
    from app.services.resume_intake_excel import parse_excel
    from app.services.resume_intake import add_item

    book = Workbook()
    book.active.append(["Candidate Name", "Email", "Application Source"])
    book.active.append(["Synthetic Person", "synthetic@example.test", "indeed"])
    output = io.BytesIO()
    book.save(output)
    rows = parse_excel(output.getvalue())["rows"]
    assert rows[0]["source"] == "indeed"
    batch = {
        "_id": "source-batch",
        "orgId": "default",
        "jobId": "job",
        "source": "unknown",
        "createdBy": "admin",
        "retentionUntil": now() + timedelta(days=1),
    }
    await add_item(db, batch, 1, profile=rows[0]["profile"], source=rows[0]["source"])
    await add_item(db, batch, 2, profile=rows[0]["profile"])
    assert (
        await db.resume_intake_items.find_one(
            {"batchId": "source-batch", "rowNumber": 1}
        )
    )["source"] == "indeed"
    assert (
        await db.resume_intake_items.find_one(
            {"batchId": "source-batch", "rowNumber": 2}
        )
    )["source"] == "unknown"


async def test_admin_resume_download_stays_available(client, db, tmp_path, monkeypatch):
    from app.services import storage

    file = tmp_path / "synthetic.pdf"
    file.write_bytes(b"%PDF-synthetic-resume")
    monkeypatch.setattr("app.api.resumes.resolve_storage_key", lambda key: file)
    await db.resume_files.insert_one(
        {
            "orgId": "default",
            "fileId": "synthetic-file",
            "status": "processed",
            "storageKey": "synthetic.pdf",
            "fileName": "synthetic.pdf",
        }
    )
    response = await client.get(
        "/api/resumes/files/synthetic-file/download", headers=headers("admin")
    )
    assert response.status_code == 200 and response.content == b"%PDF-synthetic-resume"


async def test_position_count_uses_hired_identity_and_handles_cancellation(client, db):
    import asyncio
    from app.services.transitions import transition_application

    async def hire(key):
        return await transition_application(
            db,
            org_id="default",
            application_id=key,
            to_stage="HIRED",
            actor_user_id="super_admin",
            reason="Joining confirmed",
            is_override=True,
        )

    outcomes = await asyncio.gather(hire("app0"), hire("app1"), return_exceptions=True)
    for key, result in zip(["app0", "app1"], outcomes):
        if isinstance(result, HTTPException):
            assert result.status_code == 409
            await hire(key)
        else:
            assert not isinstance(result, Exception), result
    assert (await db.jobs.find_one({"jobId": "job"}))["positionsFilled"] == 2
    # A legacy duplicate hired application must not fill a second position.
    await db.applications.insert_one(
        {
            "orgId": "default",
            "applicationId": "legacy-duplicate",
            "jobId": "job",
            "applicantId": "person0",
            "currentStage": "HIRED",
        }
    )
    await transition_application(
        db,
        org_id="default",
        application_id="app1",
        to_stage="WITHDRAWN",
        actor_user_id="super_admin",
        reason="Joining canceled",
        is_override=True,
    )
    assert (await db.jobs.find_one({"jobId": "job"}))["positionsFilled"] == 1


async def test_share_finalized_reports_preview_and_durable_idempotent_queue(client, db):
    await db.recruit_reviews.insert_one(
        {
            "orgId": "default",
            "applicationId": "app0",
            "interviewId": "finished",
            "reviewId": "review-final",
            "round": "technical",
            "locked": True,
            "applied": True,
            "decision": "advance",
            "strengths": "Strong evidence",
            "comments": "Final report",
            "createdAt": now(),
        }
    )
    template = {
        **TEMPLATE,
        "id": "share",
        "name": "HR handoff",
        "category": "report_share",
        "body": "Reports for {{candidate_name}}\n{{report_summary}}",
    }
    assert (
        await client.put(
            BASE + "/settings",
            headers=headers("admin"),
            json={
                "expectedRevision": 0,
                "templates": [template],
                "defaultRejectionId": None,
            },
        )
    ).status_code == 200
    payload = {
        "reportIds": ["review-final"],
        "recipientUserId": "admin",
        "templateId": "share",
        "provider": "company",
        "requestId": "synthetic-share-request",
    }
    preview = await client.post(
        BASE + "/applications/app0/share-preview",
        headers=headers("admin"),
        json=payload,
    )
    assert preview.status_code == 200, preview.text
    assert "Strong evidence" in preview.json()["html"]
    assert (
        await db.recruit_email_outbox.count_documents({"kind": "workflow_share"}) == 0
    )
    for _ in range(2):
        response = await client.post(
            BASE + "/applications/app0/share", headers=headers("admin"), json=payload
        )
        assert response.status_code == 200, response.text
    assert (
        await db.recruit_email_outbox.count_documents({"kind": "workflow_share"}) == 1
    )
    message = await db.recruit_email_outbox.find_one({"kind": "workflow_share"})
    assert await service.delivery_allowed(db, message)
    await db.users.update_one({"userId": "admin"}, {"$set": {"isActive": False}})
    assert not await service.delivery_allowed(db, message)


async def test_gmail_refresh_scope_and_provider_acceptance(client, db, monkeypatch):
    from types import SimpleNamespace
    from app.services import gmail_send, google_oauth as oauth
    from app.config import settings
    from cryptography.fernet import Fernet

    monkeypatch.setattr(
        settings, "google_token_encryption_key", Fernet.generate_key().decode()
    )
    monkeypatch.setattr(oauth, "configured", lambda: True)
    await db.google_connections.insert_one(
        {
            "orgId": "default",
            "userId": "admin",
            "status": "connected",
            "scopes": [oauth.GMAIL_SCOPE],
            "accessTokenEncrypted": oauth.encrypt("old-test-token"),
            "refreshTokenEncrypted": oauth.encrypt("test-refresh"),
            "expiresAt": now() - timedelta(minutes=1),
        }
    )
    refresh = AsyncMock(
        return_value={"access_token": "refreshed-test-token", "expires_in": 3600}
    )
    monkeypatch.setattr(oauth, "post_token", refresh)
    calls = []

    class Google:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            calls.append((url, kwargs))
            return SimpleNamespace(
                is_success=True,
                status_code=200,
                json=lambda: {"id": "provider-confirmed-test-id"},
            )

    monkeypatch.setattr(gmail_send.httpx, "AsyncClient", Google)
    assert (
        await gmail_send.send(
            db,
            "default",
            "admin",
            "hr@example.test",
            "Final reports",
            "<p>Secure reports</p>",
        )
        == "provider-confirmed-test-id"
    )
    assert refresh.await_count == 1 and calls[0][0].endswith("/messages/send")
    assert calls[0][1]["headers"]["Authorization"] == "Bearer refreshed-test-token"
    await db.google_connections.update_one(
        {"userId": "admin"}, {"$set": {"scopes": [oauth.CALENDAR_SCOPE]}}
    )
    with pytest.raises(HTTPException) as exc:
        await gmail_send.send(db, "default", "admin", "hr@example.test", "Reports", "x")
    assert exc.value.status_code == 409


async def test_hr_handoff_follows_configured_rounds_and_deduplicates(client, db):
    await db.jobs.update_one(
        {"jobId": "job"}, {"$set": {"requiredInterviewRounds": ["technical"]}}
    )
    await db.recruit_reviews.insert_one(
        {
            "orgId": "default",
            "applicationId": "app0",
            "interviewId": "technical-done",
            "reviewId": "technical-done",
            "round": "technical",
            "locked": True,
            "applied": True,
        }
    )
    await service.notify_hr_handoff(db, "default", "app0")
    await service.notify_hr_handoff(db, "default", "app0")
    assert (
        await db.recruit_notifications.count_documents(
            {"userId": "hr", "kind": "reports_ready_for_hr"}
        )
        == 1
    )


async def test_additive_migration_repairs_legacy_identity_and_position_cache(
    client, db
):
    from migrations.hiring_workflow_v1 import upgrade

    await db.applicants.update_one(
        {"applicantId": "person0"},
        {
            "$set": {"email": "Legacy@Example.Test", "phone": "+91 98765 43210"},
            "$unset": {"phoneDigits": ""},
        },
    )
    await db.jobs.update_one(
        {"jobId": "job"}, {"$set": {"positionsTotal": 3, "positionsFilled": 99}}
    )
    await db.applications.update_one(
        {"applicationId": "app0"}, {"$set": {"currentStage": "HIRED"}}
    )
    await upgrade(db)
    assert (await db.jobs.find_one({"jobId": "job"}))["positionsFilled"] == 1
    person = await db.applicants.find_one({"applicantId": "person0"})
    assert person["email"] == "Legacy@Example.Test"
    assert person["normalizedEmail"] == "legacy@example.test"
    assert (await matches(db, "default", {"email": " LEGACY@EXAMPLE.TEST "}))[0][
        "applicantId"
    ] == "person0"
    assert "9876543210" in person["phoneDigits"]
    await upgrade(db)
    assert (await db.jobs.find_one({"jobId": "job"}))["positionsTotal"] == 3

async def test_joining_capacity_is_checked_before_stage_mutation(client,db):
    from app.services.transitions import transition_application,TransitionError
    await db.jobs.update_one({'jobId':'job'},{'$set':{'positionsTotal':1}})
    await db.applications.update_many({'applicationId':{'$in':['app0','app1']}},{'$set':{'currentStage':'OFFER'}})
    await transition_application(db,org_id='default',application_id='app0',to_stage='HIRED',actor_user_id='admin',reason='Joining confirmed')
    with pytest.raises(TransitionError):
        await transition_application(db,org_id='default',application_id='app1',to_stage='HIRED',actor_user_id='admin',reason='Another joining confirmed')
    assert (await db.applications.find_one({'applicationId':'app1'}))['currentStage']=='OFFER'
    assert (await db.jobs.find_one({'jobId':'job'}))['positionsFilled']==1

async def test_rescheduling_restores_reminder_choices(client,db):
    body=schedule(sendReminder=False,reminderMinutes=30)
    response=await client.post('/api/recruitment/interviews',headers=headers('admin'),json=body)
    assert response.status_code==201,response.text
    row=response.json()
    assert row['sendReminder'] is False and row['reminderMinutes']==30
    legacy=schedule(expectedRevision=row['revision'])
    response=await client.put('/api/recruitment/interviews/'+row['interviewId'],headers=headers('admin'),json=legacy)
    assert response.status_code==200,response.text
    assert response.json()['sendReminder'] is False and response.json()['reminderMinutes']==30


@pytest.mark.parametrize("role,round_name", [("technical_interviewer", "technical"), ("managerial_interviewer", "managerial"), ("hr", "hr")])
async def test_portal_reviewer_traits_are_scoped_and_visible_to_admin(client, db, role, round_name):
    row = await create(client)
    await db.recruit_interviews.update_one({"interviewId": row["interviewId"]}, {"$set": {"round": round_name, "interviewerId": role}})
    path = BASE + "/interviews/" + row["interviewId"] + "/traits"
    payload = {"expectedRevision": 0, "traits": [{"id": "ownership", "name": "Ownership", "description": "Evidence of accountability", "active": True}]}
    response = await client.put(path, headers=headers(role), json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["reviewerId"] == role
    for actor in (role, "admin"):
        detail = await client.get("/api/recruitment/interviews/" + row["interviewId"], headers=headers(actor))
        assert detail.status_code == 200, detail.text
        assert detail.json()["traitConfig"]["traits"][0]["name"] == "Ownership"
        assert detail.json()["canEditTraits"] is True
    assert (await client.put(path, headers=headers("technical_interviewer", uid="unassigned"), json=payload)).status_code == 404
    assert (await client.put(path, headers=headers("technical_interviewer", uid="other-tech", org="other"), json=payload)).status_code == 404
    assert (await client.put(path, headers=headers(role), json=payload)).status_code == 409
    assert (await service.traits(db, "default", "job", round_name))["revision"] == 0
    assert (await service.traits(db, "default", "job", round_name, "someone-else"))["revision"] == 0


async def test_portal_trait_ratings_reach_next_reviewer_and_keep_snapshot(client, db):
    row = await create(client)
    path = BASE + "/interviews/" + row["interviewId"] + "/traits"
    payload = {"expectedRevision": 0, "traits": [{"id": "reasoning", "name": "Problem reasoning", "description": "Explains tradeoffs", "active": True}]}
    assert (await client.put(path, headers=headers("technical_interviewer"), json=payload)).status_code == 200
    submitted = await review(client, db, row, scorecard={"reasoning": 5}, traitRevision=1)
    assert submitted.status_code == 200, submitted.text
    assert (await client.put(path, headers=headers("technical_interviewer"), json={**payload, "expectedRevision": 1})).status_code == 409
    next_round = await create(client, round="managerial")
    detail = await client.get("/api/recruitment/interviews/" + next_round["interviewId"], headers=headers("managerial_interviewer"))
    assert detail.status_code == 200, detail.text
    previous = detail.json()["previousReviews"][0]
    assert previous["traitSnapshot"]["traits"][0]["name"] == "Problem reasoning"
    assert previous["scorecard"] == {"reasoning": 5}
    assert detail.json()["traitConfig"]["revision"] == 0
    old = await client.get("/api/recruitment/interviews/" + row["interviewId"], headers=headers("admin"))
    assert old.json()["traitConfig"]["traits"][0]["name"] == "Problem reasoning"
    assert old.json()["canEditTraits"] is False
