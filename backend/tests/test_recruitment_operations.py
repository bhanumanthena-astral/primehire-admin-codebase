"""Recovery, notification safety, HR privacy and filter behavior."""

import asyncio
import json
from datetime import timedelta
import httpx
import pytest
from fastapi import HTTPException
from tests.test_recruitment import client, headers, create, review, schedule
from app.config import settings
from app.models.recruitment import now, RecruitmentRepository
from app.services import recruitment_worker as worker
from app.services import recruitment as service


async def test_delayed_reminders_are_not_delivered_after_interview_start(client, db, monkeypatch):
    row = await create(client)
    stored = await db['recruit_interviews'].find_one({'interviewId':row['interviewId']})
    message = await worker.enqueue_email(db, stored, 'reminder')
    await db['recruit_interviews'].update_one({'interviewId':row['interviewId']},{'$set':{'startsAt':now()-timedelta(minutes=1)}})
    pending = await worker.RecruitmentOutbox(db).get(message['messageId'],'default',include_body=True)
    await worker.deliver(db, pending)
    assert (await db['recruit_email_outbox'].find_one({'messageId':message['messageId']}))['status']=='cancelled'


async def test_private_recruitment_key_works_without_assessment_outbox_key(client, db, monkeypatch):
    from cryptography.fernet import Fernet
    monkeypatch.setattr(settings, 'outbox_encryption_key', '')
    monkeypatch.setattr(settings, 'recruitment_outbox_encryption_key', Fernet.generate_key().decode())
    await create(client)
    await worker.tick(db)
    message = await db['recruit_email_outbox'].find_one({})
    assert message['status'] == 'sent' and message['sentVia'] == 'dry_run'
    body = json.loads(worker.decrypt_recruitment_body(message['payloadEncrypted']))
    assert body['to'] == 'technical_interviewer@example.test'
    assert settings.outbox_encryption_key == ''


def test_invalid_private_recruitment_key_fails_startup():
    from app.config import Settings, validate_settings
    candidate = Settings(recruitment_portals_enabled=True, mongodb_database='primehire_admin_v2', recruitment_outbox_encryption_key='invalid')
    with pytest.raises(RuntimeError, match='RECRUITMENT_OUTBOX_ENCRYPTION_KEY'):
        validate_settings(candidate)


async def test_restricted_profile_fields_cannot_leak_through_saved_questions(client, db):
    row = await create(client, round='hr', overrideReason='Approved direct HR fixture')
    key = row['interviewId']
    generated = await client.post(f'/api/recruitment/interviews/{key}/questions', json={'expectedRevision':1}, headers=headers('hr'))
    assert generated.status_code == 200
    await client.put('/api/recruitment/access/hr', json={'visibleFields':['skills','previousReviews'],'expectedRevision':0,'reason':'Restrict experience and summary'}, headers=headers())
    visible = (await client.get(f'/api/recruitment/interviews/{key}',headers=headers('hr'))).json()
    assert 'questions' not in visible and visible['questionAccessRestricted']
    denied = await client.post(f'/api/recruitment/interviews/{key}/questions',json={'expectedRevision':1},headers=headers('hr'))
    assert denied.status_code == 403


async def test_revoked_review_access_also_revokes_derived_hr_questions(client, db):
    row = await create(client, round='hr', overrideReason='Approved direct HR review for fixture')
    key = row['interviewId']
    generated = await client.post(f'/api/recruitment/interviews/{key}/questions', json={'expectedRevision':1}, headers=headers('hr'))
    assert generated.status_code == 200
    await client.put('/api/recruitment/access/hr', json={'visibleFields':['skills'],'expectedRevision':0,'reason':'Revoke review context access'}, headers=headers())
    visible = await client.get(f'/api/recruitment/interviews/{key}',headers=headers('hr'))
    assert 'questions' not in visible.json() and 'previousReviews' not in visible.json()
    denied = await client.post(f'/api/recruitment/interviews/{key}/questions',json={'expectedRevision':1},headers=headers('hr'))
    assert denied.status_code == 403


async def test_candidate_tracker_reads_intake_milestones_without_mutation(client, db):
    await create(client)
    uploaded = now() - timedelta(days=2)
    evaluated = now() - timedelta(days=1)
    await db["resume_intake_batches"].insert_one(
        {
            "_id": "timeline-batch",
            "orgId": "default",
            "createdAt": uploaded,
            "createdBy": "recruiter",
        }
    )
    source = {
        "_id": "timeline-item",
        "orgId": "default",
        "applicationId": "app0",
        "batchId": "timeline-batch",
        "createdAt": uploaded,
        "ats": {"evaluatedAt": evaluated.isoformat()},
    }
    await db["resume_intake_items"].insert_one(source)
    history_count = await db["stage_history"].count_documents({})
    response = await client.get(
        "/api/recruitment/tracker?applicationId=app0", headers=headers()
    )
    assert response.status_code == 200, response.text
    events = {entry["toStage"]: entry for entry in response.json()["timeline"]}
    assert isinstance(response.json()['milestones'], dict)
    assert response.json()['milestones']['ASSESSMENT_COMPLETED'] == 1
    assert events["RESUME_UPLOADED"]["derivedEvent"]
    assert events["ATS_EVALUATED"]["actorName"] == "System"
    assert await db["stage_history"].count_documents({}) == history_count
    assert (await db["resume_intake_items"].find_one({"_id": "timeline-item"}))[
        "ats"
    ] == source["ats"]


async def test_utc_timestamps_and_no_assessment_mutation(client, db):
    before = await db["applications"].find_one({"applicationId": "app0"})
    row = await create(client)
    assert row["startsAt"].endswith(("+00:00", "Z"))
    assert row["endsAt"].endswith(("+00:00", "Z"))
    after = await db["applications"].find_one({"applicationId": "app0"})
    assert before["assessment"] == after["assessment"]
    assert await db["assessments"].count_documents({}) == 0
    assert await db["resume_files"].count_documents({}) == 0


async def test_recruitment_write_rate_returns_retry_after(client):
    from app.security.rate_limit import limiter

    key = "recruitment:default:super_admin"
    limiter.reset(key)
    try:
        for _ in range(120):
            limiter.check(key, 120, 60)
        result = await client.post(
            "/api/recruitment/interviews", json=schedule(), headers=headers()
        )
        assert result.status_code == 429 and int(result.headers["retry-after"]) > 0
    finally:
        limiter.reset(key)


async def test_directories_filters_and_notification_ownership(client, db):
    row = await create(client)
    assert (
        await client.get("/api/recruitment/capabilities", headers=headers())
    ).json()["canManage"]
    assert (
        await client.get(
            "/api/recruitment/jobs", headers=headers("technical_interviewer")
        )
    ).json()["total"] == 1
    assert (
        await client.get(
            "/api/recruitment/staff?role=technical_interviewer&search=Test",
            headers=headers("recruiter"),
        )
    ).json()["total"] == 1
    assert (
        await client.get(
            "/api/recruitment/applications?search=Synthetic%20Candidate%200",
            headers=headers(),
        )
    ).json()["total"] == 1
    assert (
        await client.get(
            "/api/recruitment/applications?stage=invalid", headers=headers()
        )
    ).status_code == 422
    assert (
        await client.get(
            "/api/recruitment/interviews?bucket=upcoming", headers=headers()
        )
    ).json()["total"] == 1
    assert (
        await client.get(
            "/api/recruitment/interviews?startsFrom=2026-01-01T00:00:00Z&startsTo=2027-01-01T00:00:00Z",
            headers=headers(),
        )
    ).status_code == 422
    notes = (
        await client.get(
            "/api/recruitment/notifications", headers=headers("technical_interviewer")
        )
    ).json()
    assert notes["unread"] == 1
    key = notes["items"][0]["notificationId"]
    assert (
        await client.post(
            f"/api/recruitment/notifications/{key}/read",
            headers=headers("managerial_interviewer"),
        )
    ).status_code == 404
    assert (
        await client.post(
            f"/api/recruitment/notifications/{key}/read",
            headers=headers("technical_interviewer"),
        )
    ).status_code == 200
    tracker = (
        await client.get(
            "/api/recruitment/tracker?jobId=job&applicationId=app0", headers=headers()
        )
    ).json()
    assert tracker["total"] == 1 and len(tracker["timeline"]) == 2
    pdf = await client.get(
        f'/api/recruitment/interviews/{row["interviewId"]}/invitation.pdf',
        headers=headers("technical_interviewer"),
    )
    assert (
        pdf.status_code == 200
        and pdf.content.startswith(b"%PDF")
        and pdf.headers["cache-control"] == "no-store"
    )
    assert (
        await client.get(
            f'/api/recruitment/interviews/{row["interviewId"]}/resume',
            headers=headers("technical_interviewer"),
        )
    ).status_code == 404


async def test_concurrent_booking_and_cross_round_guard(client, db):
    payload = schedule()
    results = await asyncio.gather(
        *(
            client.post(
                "/api/recruitment/interviews",
                json={**payload, "applicationId": f"app{i}"},
                headers=headers(),
            )
            for i in range(3)
        )
    )
    assert sorted(r.status_code for r in results) == [201, 409, 409]
    first = next(r.json() for r in results if r.status_code == 201)
    another = schedule(
        application=first["applicationId"],
        round="managerial",
        overrideReason="Explicit exception request",
    )
    another["startsAt"] = (now() + timedelta(days=2)).isoformat()
    another["endsAt"] = (now() + timedelta(days=2, hours=1)).isoformat()
    assert (
        await client.post(
            "/api/recruitment/interviews", json=another, headers=headers()
        )
    ).status_code == 409


async def test_review_crash_journal_replays_once(client, db, monkeypatch):
    row = await create(client)
    original = RecruitmentRepository.update

    async def interrupted(self, *args, **kwargs):
        raise HTTPException(503, "Synthetic interruption after review journaling")

    monkeypatch.setattr(RecruitmentRepository, "update", interrupted)
    result = await review(client, db, row)
    assert result.status_code == 503
    assert await db["recruit_reviews"].count_documents({"applied": False}) == 1
    monkeypatch.setattr(RecruitmentRepository, "update", original)
    await worker.tick(db)
    await worker.tick(db)
    assert (await db["applications"].find_one({"applicationId": "app0"}))[
        "currentStage"
    ] == "ROUND2_PENDING_ASSIGNMENT"
    assert await db["recruit_reviews"].count_documents({"applied": True}) == 1
    assert (
        await db["audit_log"].count_documents(
            {"action": "recruitment.review_submitted"}
        )
        == 1
    )
    assert (
        await db["recruit_notifications"].count_documents({"kind": "review_submitted"})
        == 1
    )


async def test_rejection_and_hold_follow_up(client, db):
    row = await create(client)
    result = await review(client, db, row, "reject")
    assert result.status_code == 200
    done = await client.post(
        f'/api/recruitment/interviews/{row["interviewId"]}/confirm-rejection',
        json={
            "expectedRevision": result.json()["revision"],
            "reason": "Recruiter confirmed the documented skills gap",
        },
        headers=headers("recruiter"),
    )
    assert done.status_code == 200, done.text
    application = await db["applications"].find_one({"applicationId": "app0"})
    assert (
        application["currentStage"] == "REJECTED"
        and application["talentPool"]["inPool"]
    )
    row = await create(client, application="app1")
    result = await review(
        client, db, row, "hold", followUpAt=(now() + timedelta(days=2)).isoformat()
    )
    assert result.status_code == 200, result.text
    await db["recruit_interviews"].update_one(
        {"interviewId": row["interviewId"]},
        {"$set": {"followUpAt": now() - timedelta(minutes=1)}},
    )
    await worker.tick(db)
    await worker.tick(db)
    assert (
        await db["recruit_notifications"].count_documents({"kind": "hold_follow_up"})
        == 2
    )


async def test_reminder_and_reschedule_invalidate_old_delivery(client, db):
    row = await create(client)
    key = row["interviewId"]
    await db["recruit_interviews"].update_one(
        {"interviewId": key},
        {
            "$set": {
                "startsAt": now() + timedelta(minutes=5),
                "reminderAt": now() - timedelta(minutes=1),
            }
        },
    )
    await worker.tick(db)
    await worker.tick(db)
    assert (
        await db["recruit_notifications"].count_documents(
            {"kind": "interview_reminder"}
        )
        == 1
    )
    assert (
        await db["recruit_email_outbox"].count_documents({"kind": "recruit_reminder"})
        == 1
    )
    await client.post(
        f"/api/recruitment/interviews/{key}/send-invitation",
        json={"expectedRevision": 1, "reason": "Send candidate invitation"},
        headers=headers(),
    )
    await worker.tick(db)
    changed = await client.put(
        f"/api/recruitment/interviews/{key}",
        json={**schedule(), "expectedRevision": 1},
        headers=headers(),
    )
    assert changed.status_code == 200, changed.text
    await client.post(
        f"/api/recruitment/interviews/{key}/send-invitation",
        json={"expectedRevision": 2, "reason": "Send revised candidate invitation"},
        headers=headers(),
    )
    await worker.tick(db)
    assert (
        await db["recruit_email_outbox"].count_documents({"kind": "recruit_candidate"})
        == 2
    )


async def test_real_delivery_boundary_uses_gate_and_encrypted_outbox(
    client, db, monkeypatch
):
    row = await create(client)
    sent = []

    async def send(*args):
        sent.append(args)
        return "synthetic-id"

    monkeypatch.setattr(worker, "send_via_zepto", send)
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "@example.test")
    await worker.tick(db)
    assert len(sent) == 1
    msg = await db["recruit_email_outbox"].find_one({})
    assert (
        msg["wiped"] and msg["payloadEncrypted"] is None and msg["sentVia"] == "zepto"
    )
    await worker.tick(db)
    assert len(sent) == 1


async def test_email_failure_backoff_and_allowlist(client, db, monkeypatch):
    from app.services.email_send import EmailSendError

    row = await create(client)
    monkeypatch.setattr(settings, "email_dry_run", False)
    monkeypatch.setattr(
        settings, "email_test_recipient_allowlist", "nobody@example.test"
    )
    await worker.tick(db)
    assert (await db["recruit_email_outbox"].find_one({}))["status"] == "failed"
    await db["recruit_email_outbox"].delete_many({})
    await db["recruit_interviews"].update_one(
        {"interviewId": row["interviewId"]}, {"$set": {"assignmentEmailQueued": False}}
    )
    monkeypatch.setattr(settings, "email_test_recipient_allowlist", "@example.test")

    async def unavailable(*args):
        raise EmailSendError("Synthetic unavailable")

    monkeypatch.setattr(worker, "send_via_zepto", unavailable)
    await worker.tick(db)
    msg = await db["recruit_email_outbox"].find_one({})
    assert msg["status"] == "pending" and msg["attempts"] == 1


async def test_compensation_permissions_and_question_answers(client, db):
    row = await create(
        client, round="hr", overrideReason="Approved direct HR review for fixture"
    )
    key = row["interviewId"]
    assert (
        await client.put(
            f"/api/recruitment/interviews/{key}/compensation",
            json={
                "expectedRevision": 1,
                "proposedOffer": 500,
                "reason": "Proposed offer",
            },
            headers=headers("technical_interviewer"),
        )
    ).status_code == 404
    profile = await client.put(
        "/api/recruitment/access/hr",
        json={
            "expectedRevision": 0,
            "visibleFields": ["skills", "previousReviews"],
            "reason": "No financial access approved",
        },
        headers=headers(),
    )
    assert profile.status_code == 200
    assert (
        await client.put(
            f"/api/recruitment/interviews/{key}/compensation",
            json={
                "expectedRevision": 1,
                "proposedOffer": 500,
                "reason": "Proposed offer",
            },
            headers=headers("hr"),
        )
    ).status_code == 403
    questions = await client.post(
        f"/api/recruitment/interviews/{key}/questions",
        json={"expectedRevision": 1},
        headers=headers("hr"),
    )
    assert questions.status_code == 200, questions.text
    same = await client.post(
        f"/api/recruitment/interviews/{key}/questions",
        json={"expectedRevision": 1},
        headers=headers("hr"),
    )
    assert same.json()["inputHash"] == questions.json()["inputHash"]
    q = questions.json()["questions"][0]
    body = {
        "expectedRevision": 1,
        "questionId": q["questionId"],
        "question": q["question"],
        "asked": True,
        "answer": "Candidate described an improvement plan",
    }
    answer = await client.put(
        f"/api/recruitment/interviews/{key}/questions", json=body, headers=headers("hr")
    )
    assert answer.status_code == 200 and answer.json()["revision"] == 2
    assert (
        await client.put(
            f"/api/recruitment/interviews/{key}/questions",
            json=body,
            headers=headers("hr"),
        )
    ).status_code == 409


@pytest.mark.parametrize("valid", [True, False])
async def test_hr_llm_is_stripped_validated_and_audited(client, db, monkeypatch, valid):
    row = await create(
        client, round="hr", overrideReason="Approved direct HR review for fixture"
    )
    monkeypatch.setattr(settings, "openrouter_api_key", "synthetic-secret")
    monkeypatch.setattr(settings, "openrouter_model", "synthetic-model")
    seen = []
    await db['jobs'].update_one({'jobId':'job'},{'$unset':{'jdText':''},'$set':{'jdHtml':'<p>Design resilient event pipelines.</p>'}})

    class Provider:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, *, json, headers):
            seen.append(json)
            content = (
                __import__("json").dumps(
                    {
                        "questions": [
                            {
                                "question": f"Please explain a relevant example of skill development number {i}.",
                                "source": "profile",
                            }
                            for i in range(10)
                        ]
                    }
                )
                if valid
                else "{}"
            )
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": content}}]},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr(
        "app.services.recruitment_questions.httpx.AsyncClient", Provider
    )
    result = await client.post(
        f'/api/recruitment/interviews/{row["interviewId"]}/questions',
        json={"expectedRevision": 1},
        headers=headers("hr"),
    )
    assert result.status_code == 200, result.text
    assert result.json()["method"] == ("llm" if valid else "local_guidance")
    assert result.json()['error'] == (None if valid else 'provider_unavailable_or_invalid')
    assert 'Design resilient event pipelines.' in json.dumps(seen)
    assert '<p>' not in json.dumps(seen)
    assert (
        "Synthetic Candidate" not in json.dumps(seen)
        and "example.test" not in json.dumps(seen)
        and "9876543210" not in json.dumps(seen)
    )
    assert (
        await db["llm_runs"].count_documents({"promptVersion": "hr-questions-v2"}) == 1
    )


async def test_recovery_never_reverses_a_terminal_decision(client, db):
    row = await create(client)
    await db["applications"].update_one(
        {"applicationId": "app0"}, {"$set": {"currentStage": "HIRED"}}
    )
    row = {
        **row,
        "orgId": "default",
        "pendingTransition": {
            "id": "fixture",
            "stages": ["ROUND1_SCHEDULED"],
            "actor": "super_admin",
            "reason": "Earlier scheduling intent",
            "override": True,
        },
    }
    with pytest.raises(HTTPException):
        await service.finish_pending(db, row)
    assert (await db["applications"].find_one({"applicationId": "app0"}))[
        "currentStage"
    ] == "HIRED"


async def test_assessment_totals_keep_completions_after_candidate_advances(client, db):
    await db['applications'].update_one({'applicationId':'app0'}, {'$set':{
        'currentStage':'ROUND1_SCHEDULED','assessment':{'state':'completed','status':'Completed','score':0}}})
    await db['applications'].update_one({'applicationId':'app1'}, {'$set':{
        'currentStage':'ASSESSMENT_COMPLETED','assessment':{'submittedAt':'2026-10-28T10:00:00Z','reportPending':True}}})
    await db['applications'].update_one({'applicationId':'app2'}, {'$set':{
        'currentStage':'ASSESSMENT_SENT','assessment':{'state':'email_sent'}}})
    # Repeated stage events count one application only.
    for event in ['sent-a','sent-b']:
        await db['stage_history'].insert_one({'historyId':event,'orgId':'default','applicationId':'app0','toStage':'ASSESSMENT_SENT'})
    response=await client.get('/api/recruitment/tracker?jobId=job',headers=headers())
    assert response.status_code==200
    result=response.json()
    assert result['milestones']['ASSESSMENT_SENT']==3
    assert result['milestones']['ASSESSMENT_COMPLETED']==2
    assert result['stages']['ASSESSMENT_SENT']==1
    assert result['stages']['ROUND1_SCHEDULED']==1
