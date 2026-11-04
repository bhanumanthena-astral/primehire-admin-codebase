"""Manual scheduling and human decisions, isolated from intake/assessments."""

import hashlib
import uuid
from datetime import timedelta
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from ..models.recruitment import RecruitmentRepository, lease, now, aware, clean
from ..models.hiring import AuditLogRepository
from ..schemas.hiring import Stage
from ..security.recruitment import (
    MANAGERS,
    app_allowed,
    job_allowed,
    interview_allowed,
    fields_for,
    project_candidate,
    project_application,
    writable,
)
from .transitions import transition_application, TransitionError

ROUND_ROLE = {
    "technical": "technical_interviewer",
    "managerial": "managerial_interviewer",
    "hr": "hr",
}
ROUND_START = {
    "technical": "ROUND1_SCHEDULED",
    "managerial": "ROUND2_SCHEDULED",
    "hr": "HR_ROUND",
}
READY = {
    "technical": {"ASSESSMENT_COMPLETED", "ROUND1_PENDING_ASSIGNMENT"},
    "managerial": {"ROUND2_PENDING_ASSIGNMENT"},
    "hr": {"HR_ROUND"},
}


def pending_scheduling_pipeline(org_id, round_name=None):
    """Ready applications without a scheduled booking, before counts/pagination.

    HR uses the same application stage before and after booking, so its stage
    alone cannot identify the scheduling queue. Keep historical reviews and
    cancelled bookings out of the active-booking test.
    """
    stages = READY[round_name] if round_name else set().union(*READY.values())
    return [
        {"$match": {"currentStage": {"$in": sorted(stages)}}},
        {"$lookup": {"from": "recruit_interviews", "localField": "applicationId",
                      "foreignField": "applicationId", "as": "schedulingBookings"}},
        {"$match": {"schedulingBookings": {"$not": {"$elemMatch": {
            "orgId": org_id, "status": "scheduled"}}}}},
        {"$project": {"schedulingBookings": 0}},
    ]


async def latest_interviews(db, user, application_ids):
    if not application_ids:
        return {}
    query = {"orgId": user.org_id, "applicationId": {"$in": application_ids},
             "status": {"$ne": "cancelled"}}
    if user.role not in MANAGERS:
        query["interviewerId"] = user.user_id
    rows = await db["recruit_interviews"].aggregate([
        {"$match": query}, {"$sort": {"createdAt": -1, "interviewId": -1}},
        {"$group": {"_id": "$applicationId", "interviewId": {"$first": "$interviewId"},
                    "round": {"$first": "$round"}, "status": {"$first": "$status"}}},
    ]).to_list(len(application_ids))
    return {row["_id"]: {key: row[key] for key in ["interviewId", "round", "status"]} for row in rows}


async def audit(db, user, action, key, details=None):
    await AuditLogRepository(db).log(
        org_id=user.org_id,
        actor_user_id=user.user_id,
        action=f"recruitment.{action}",
        resource_type="recruitment",
        resource_id=key,
        details=details or {},
    )


async def move(db, org, application_id, target, actor, reason, *, override=False):
    row = await db["applications"].find_one(
        {"orgId": org, "applicationId": application_id}
    )
    if not row:
        raise HTTPException(404, "Application not found")
    if row["currentStage"] == target:
        return
    if row["currentStage"] in {"HIRED", "REJECTED", "WITHDRAWN"}:
        raise HTTPException(
            409,
            "Application reached a terminal stage; administrator review is required",
        )
    try:
        await transition_application(
            db,
            org_id=org,
            application_id=application_id,
            to_stage=target,
            actor_user_id=actor,
            reason=reason,
            is_override=override,
        )
    except TransitionError:
        raise HTTPException(
            409, "The application stage changed; refresh and review the timeline"
        ) from None


async def finish_pending(db, row):
    """Replay journaled stage effects after a crash, without duplicate history."""
    pending = row.get("pendingTransition")
    if not pending:
        return
    for target in pending["stages"]:
        current = await db["applications"].find_one(
            {"orgId": row["orgId"], "applicationId": row["applicationId"]}
        )
        if current and current["currentStage"] in pending["stages"]:
            current_index = pending["stages"].index(current["currentStage"])
            if pending["stages"].index(target) <= current_index:
                continue
        await move(
            db,
            row["orgId"],
            row["applicationId"],
            target,
            pending["actor"],
            pending["reason"],
            override=pending.get("override", False),
        )
    await db["recruit_interviews"].update_one(
        {
            "orgId": row["orgId"],
            "interviewId": row["interviewId"],
            "pendingTransition.id": pending["id"],
        },
        {"$unset": {"pendingTransition": ""}},
    )


async def schedule(db, user, payload, *, existing=None):
    writable(user)
    app = await app_allowed(db, user, payload.applicationId)
    job = await job_allowed(db, user, app["jobId"])
    if app["currentStage"] in {"HIRED", "REJECTED", "WITHDRAWN"}:
        raise HTTPException(409, "This application is terminal")
    if str(job.get("lifecycleStatus", job.get("status", "OPEN"))).upper() in {
        "ARCHIVED",
        "CLOSED",
        "DRAFT",
        "ON_HOLD",
    }:
        raise HTTPException(409, "Open the job before scheduling an interview")
    if payload.startsAt <= now():
        raise HTTPException(422, "Choose a future interview time")
    if payload.startsAt > now() + timedelta(days=365):
        raise HTTPException(422, "Schedule within the next year")
    interviewer = await db["users"].find_one(
        {
            "orgId": user.org_id,
            "userId": payload.interviewerId,
            "isActive": True,
            "role": ROUND_ROLE[payload.round],
        }
    )
    if not interviewer:
        raise HTTPException(422, "Choose an active interviewer with the matching role")
    key = existing["interviewId"] if existing else uuid.uuid4().hex
    async with lease(
        db,
        user.org_id,
        [
            f'app:{app["applicationId"]}',
            f"user:{payload.interviewerId}",
            f'candidate:{app["applicantId"]}',
            f"interview:{key}",
        ],
    ):
        if existing:
            existing = await RecruitmentRepository(db, user.org_id).interview(key)
            if existing["revision"] != payload.expectedRevision:
                raise HTTPException(409, "Interview changed; refresh first")
            if existing["status"] != "scheduled":
                raise HTTPException(409, "Only scheduled interviews can be rescheduled")
            if (
                existing["applicationId"] != payload.applicationId
                or existing["round"] != payload.round
            ):
                raise HTTPException(
                    422, "Rescheduling cannot change application or round"
                )
            if await db["recruit_reviews"].find_one(
                {"orgId": user.org_id, "interviewId": key}
            ):
                raise HTTPException(409, "A submitted review is being finalized")
        overlap = {
            "orgId": user.org_id,
            "status": "scheduled",
            "startsAt": {"$lt": payload.endsAt},
            "endsAt": {"$gt": payload.startsAt},
            "interviewId": {"$ne": key},
            "$or": [
                {"interviewerId": payload.interviewerId},
                {"applicantId": app["applicantId"]},
            ],
        }
        if await db["recruit_interviews"].find_one(overlap):
            raise HTTPException(
                409, "The candidate or interviewer already has an overlapping interview"
            )
        app = await app_allowed(db, user, payload.applicationId)
        if not existing and await db["recruit_interviews"].find_one(
            {
                "orgId": user.org_id,
                "applicationId": app["applicationId"],
                "active": True,
            }
        ):
            raise HTTPException(
                409,
                "Complete or cancel the active interview before scheduling another round",
            )
        manual_override = (
            not existing and app["currentStage"] not in READY[payload.round]
        )
        if manual_override and len(payload.overrideReason.strip()) < 10:
            raise HTTPException(
                409,
                "This round is not ready. An explicit manual exception reason (10+ characters) is required.",
            )
        if existing and existing.get("pendingTransition"):
            await finish_pending(db, existing)
        from . import google_calendar, google_oauth
        if existing and existing.get('googleCalendar') and not google_oauth.configured():
            raise HTTPException(503, 'Restore Google Calendar configuration before rescheduling a linked interview')
        if existing and existing.get('googleCalendarPrevious'):
            raise HTTPException(409, 'Retry Google Calendar sync to remove the previous event before rescheduling again')
        availability = await google_calendar.check_availability(
            db, user.org_id, payload.interviewerId, payload.startsAt, payload.endsAt, existing=existing)
        if availability['available'] is False:
            raise HTTPException(409, availability['message'])
        values = payload.model_dump(exclude={"overrideReason", "expectedRevision"})
        revision = (existing["revision"] + 1) if existing else 1
        values.update(
            orgId=user.org_id,
            interviewId=key,
            jobId=app["jobId"],
            applicantId=app["applicantId"],
            status="scheduled",
            active=True,
            revision=revision,
            createdBy=(
                existing.get("createdBy", user.user_id) if existing else user.user_id
            ),
            updatedBy=user.user_id,
            createdAt=existing.get("createdAt", now()) if existing else now(),
            updatedAt=now(),
            reminderAt=payload.startsAt - timedelta(minutes=payload.reminderMinutes),
            candidateEmailRequested=False,
            assignmentEmailQueued=False,
            candidateEmailQueued=False,
            reminderQueued=False,
            jobTitle=job.get("title", "Job"),
            scheduleRevision=(
                (existing.get("scheduleRevision", 1) + 1) if existing else 1
            ),
        )
        values['googleCalendarStatus'] = (
            'pending' if availability['available'] is True
            else 'not_connected' if availability.get('status') == 'not_connected'
            else 'not_configured'
        )
        values['googleCalendarError'] = None
        if existing and existing.get('googleCalendar'):
            values['googleCalendar'] = existing['googleCalendar']
            if existing['interviewerId'] != payload.interviewerId:
                values['googleCalendarPrevious'] = existing['googleCalendar']
        elif existing and google_oauth.configured() and existing['interviewerId'] != payload.interviewerId:
            previous = await google_calendar.assigned_mapping(db, existing)
            if previous:
                values['googleCalendarPrevious'] = previous
        # Write the durable delivery intent before committing the local booking.
        # Workers take the same lease and discard intents without a matching booking.
        await google_calendar.enqueue(db, values)
        if not existing:
            from .reporting import pin_snapshot
            values['reportSummarySnapshot']=await pin_snapshot(db,app)
            stages = []
            if not manual_override and app["currentStage"] == "ASSESSMENT_COMPLETED":
                stages.append("ROUND1_PENDING_ASSIGNMENT")
            stages.append(ROUND_START[payload.round])
            values["pendingTransition"] = {
                "id": uuid.uuid4().hex,
                "stages": stages,
                "actor": user.user_id,
                "reason": payload.overrideReason if manual_override else payload.reason,
                "override": manual_override,
            }
            try:
                await db["recruit_interviews"].insert_one(values)
            except DuplicateKeyError:
                raise HTTPException(
                    409,
                    "An active interview already exists for this application and round",
                ) from None
        else:
            values.pop("revision")
            values = await RecruitmentRepository(db, user.org_id).update(
                key, payload.expectedRevision, values
            )
            await db["recruit_email_outbox"].update_many(
                {
                    "orgId": user.org_id,
                    "entityType": "recruit_interview",
                    "entityKey": key,
                    "status": "pending",
                },
                {"$set": {"status": "cancelled", "lastError": "Interview rescheduled"}},
            )
        if google_oauth.configured():
            await google_calendar.sync_interview(db, values)
        await finish_pending(db, values)
        await audit(
            db,
            user,
            "rescheduled" if existing else "scheduled",
            key,
            {
                "revision": revision,
                "round": payload.round,
                "reason": payload.reason,
                "manualException": manual_override,
                **({"before": {k:existing.get(k) for k in ['startsAt','endsAt','interviewerId','meetingLink','location']},
                    "after": {k:values.get(k) for k in ['startsAt','endsAt','interviewerId','meetingLink','location']}}
                   if existing else {}),
            },
        )
        await RecruitmentRepository(db, user.org_id).notify(
            payload.interviewerId,
            f'{key}:{values.get("scheduleRevision",revision)}:assigned',
            "interview_assigned",
            key,
            app["applicationId"],
        )
    return await detail(db, user, key)


async def active_bookings(db, user, application_ids):
    """Booking summaries for an authorized application page, independent of view filters."""
    if not application_ids:
        return {}
    query={'orgId':user.org_id,'applicationId':{'$in':application_ids},'status':'scheduled'}
    if user.role not in MANAGERS:
        query['interviewerId']=user.user_id
    rows=await db['recruit_interviews'].aggregate([
        {'$match':query}, {'$sort':{'createdAt':-1,'interviewId':-1}},
        {'$group':{'_id':'$applicationId','booking':{'$first':'$$ROOT'}}},
        {'$replaceRoot':{'newRoot':'$booking'}},
    ]).to_list(len(application_ids))
    names={r['userId']:r.get('name','Assigned interviewer') async for r in db['users'].find(
        {'orgId':user.org_id,'userId':{'$in':list({r['interviewerId'] for r in rows})}}, {'userId':1,'name':1}).limit(len(rows))} if rows else {}
    from .resume_intake_projection import redact_contacts
    result={}
    for row in rows:
        summary={k:row.get(k) for k in ['interviewId','round','interviewerId','startsAt','endsAt','meetingLink','location','status','revision']}
        summary['interviewerName']=names.get(row['interviewerId'],'Assigned interviewer')
        if row.get('scheduleRevision',1)>1:
            summary['rescheduleReason']=redact_contacts(row.get('reason',''))
        result[row['applicationId']]=clean(summary)
    return result


async def detail(db, user, key):
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row)
    fields = await fields_for(db, user)
    candidate = (
        await db["applicants"].find_one(
            {"orgId": user.org_id, "applicantId": row["applicantId"]}
        )
        or {}
    )
    app = (
        await db["applications"].find_one(
            {"orgId": user.org_id, "applicationId": row["applicationId"]}
        )
        or {}
    )
    job = await db["jobs"].find_one({"orgId": user.org_id, "jobId": row["jobId"]}) or {}
    result = {
        k: row.get(k)
        for k in [
            "interviewId",
            "applicationId",
            "jobId",
            "round",
            "interviewerId",
            "startsAt",
            "endsAt",
            "meetingLink",
            "location",
            "status",
            "revision",
            "reminderMinutes",
            "createdAt",
            "updatedAt",
            "jobTitle",
            "offerStatus",
            "googleCalendarStatus",
            "googleCalendarError",
            "googleCalendarSyncedAt",
        ]
    }
    result.update(
        candidate=project_candidate(candidate, fields),
        application=project_application(app, fields),
        job={
            k: job.get(k)
            for k in [
                "jobId",
                "title",
                "jobRole",
                "department",
                "location",
                "workMode",
                "jdHtml",
                "jdText",
                "keywords",
                "minExperienceYears",
                "maxExperienceYears",
            ]
        },
        canManage=user.role in MANAGERS,
        canReview=row["interviewerId"] == user.user_id and row["status"] == "scheduled",
        canReveal="contact" in fields,
        canDownload="resume" in fields
        and bool(candidate.get("resume", {}).get("fileId")),
        canCompensate="compensation" in fields and row["round"] == "hr",
        serverTime=now(),
    )
    if "compensation" in fields:
        result["compensation"] = row.get("compensation")
    if "previousReviews" in fields:
        result["previousReviews"] = [
            clean(r)
            async for r in db["recruit_reviews"]
            .find(
                {
                    "orgId": user.org_id,
                    "applicationId": row["applicationId"],
                    "interviewId": {"$ne": key},
                    **({"createdAt": {"$lte": row["createdAt"]}} if user.role not in MANAGERS else {}),
                }
            )
            .sort("createdAt", 1)
            .limit(50)
        ]
    if row["round"] == "managerial" and row["interviewerId"] == user.user_id:
        result["evaluationDraft"] = row.get("evaluationDraft")
    result["review"] = clean(
        await db["recruit_reviews"].find_one({"orgId": user.org_id, "interviewId": key})
    )
    if row["round"] == "hr" and "previousReviews" in fields and (
        row["interviewerId"] == user.user_id or user.role in MANAGERS
    ):
        result["questions"] = clean(
            await db["recruit_questions"].find_one(
                {"orgId": user.org_id, "interviewId": key}
            )
        )
    result["emailStatus"] = [
        {k: m.get(k) for k in ["kind", "status", "sentVia", "lastError", "sentAt"]}
        async for m in db["recruit_email_outbox"]
        .find(
            {"orgId": user.org_id, "entityType": "recruit_interview", "entityKey": key}
        )
        .sort("createdAt", -1)
        .limit(10)
    ]
    interviewer = await db["users"].find_one({"orgId": user.org_id, "userId": row["interviewerId"]}, {"name": 1})
    from ..security.recruitment import questions_allowed
    if not questions_allowed(result.get("questions"), fields):
        result.pop("questions", None)
        result["questionAccessRestricted"] = True
    result["interviewerName"] = (interviewer or {}).get("name", "Assigned interviewer")
    from .resume_intake_projection import redact_contacts
    result['scheduleChanges']=[{
        'changedAt':event['createdAt'],
        'reason':redact_contacts(event.get('details',{}).get('reason','')),
        'before':{k:event.get('details',{}).get('before',{}).get(k) for k in ['startsAt','endsAt']},
        'after':{k:event.get('details',{}).get('after',{}).get(k) for k in ['startsAt','endsAt']},
    } async for event in db['audit_log'].find({'orgId':user.org_id,'action':'recruitment.rescheduled','resourceId':key}).sort('createdAt',-1).limit(20)]
    return clean(result)


async def submit_review(db, user, key, payload):
    writable(user)
    repo = RecruitmentRepository(db, user.org_id)
    async with lease(db, user.org_id, [f"interview:{key}"]):
        row = await repo.interview(key)
        await interview_allowed(db, user, row, review=True)
        async with lease(db, user.org_id, [f'app:{row["applicationId"]}']):
            if (
                row["revision"] != payload.expectedRevision
                or row["status"] != "scheduled"
            ):
                raise HTTPException(
                    409, "Review already submitted or interview changed"
                )
            if await db["recruit_reviews"].find_one(
                {"orgId": user.org_id, "interviewId": key}
            ):
                raise HTTPException(
                    409, "A submitted review is being finalized; refresh shortly"
                )
            if aware(row["startsAt"]) > now():
                raise HTTPException(409, "Submit the review after the interview starts")
            if payload.decision == "hire" and row["round"] != "hr":
                raise HTTPException(422, "Only the HR round can recommend an offer")
            if row.get("pendingTransition"):
                await finish_pending(db, row)
            targets = []
            if row["round"] == "technical":
                targets = ["ROUND1_REVIEW_PENDING"]
            elif row["round"] == "managerial":
                targets = ["ROUND2_REVIEW_PENDING"]
            target = {
                "advance": {
                    "technical": "ROUND2_PENDING_ASSIGNMENT",
                    "managerial": "HR_ROUND",
                    "hr": "OFFER",
                },
                "reject": {
                    "technical": "REJECTION_PENDING_HR_REVIEW",
                    "managerial": "REJECTION_PENDING_HR_REVIEW",
                    "hr": "REJECTION_PENDING_HR_REVIEW",
                },
            }
            if payload.decision in target:
                targets.append(target[payload.decision][row["round"]])
            elif payload.decision == "hire":
                targets.append("OFFER")
            elif payload.decision == "hold":
                targets.append("ON_HOLD")
            elif payload.decision == "another_round":
                if row["round"] == "hr":
                    raise HTTPException(422, "Use hold or a final HR recommendation")
                targets.append(
                    "ROUND1_PENDING_ASSIGNMENT"
                    if row["round"] == "technical"
                    else "ROUND2_PENDING_ASSIGNMENT"
                )
            if row["round"] == "hr" and payload.decision == "reject":
                targets.append("REJECTED")
            review = {
                **payload.model_dump(exclude={"expectedRevision"}),
                "orgId": user.org_id,
                "interviewId": key,
                "applicationId": row["applicationId"],
                "reviewId": key,
                "round": row["round"],
                "reviewerId": user.user_id,
                "createdAt": now(),
                "locked": True,
            }
            pending = {
                "id": uuid.uuid4().hex,
                "stages": targets,
                "actor": user.user_id,
                "reason": payload.comments,
                "override": payload.decision == "another_round",
            }
            review.update(
                transitionPlan=pending,
                expectedRevision=payload.expectedRevision,
                applied=False,
            )
            await db["recruit_reviews"].insert_one(review)
            await finalize_review(db, review)
    if row["round"] == "managerial":
        from .managerial_feedback import generate_summary
        await generate_summary(db, user, key)
    return await detail(db, user, key)


async def finalize_review(db, review):
    """Replay a locked review journal, including notifications and audit."""
    org, key = review["orgId"], review["interviewId"]
    repo = RecruitmentRepository(db, org)
    row = await repo.interview(key)
    if row["status"] == "scheduled":
        row = await repo.update(
            key,
            review["expectedRevision"],
            {
                "status": "reviewed",
                "active": False,
                "reviewDecision": review["decision"],
                "pendingTransition": review["transitionPlan"],
                "followUpAt": review.get("followUpAt"),
                "followUpQueued": False,
            },
        )
    if row["status"] != "reviewed":
        raise HTTPException(
            409,
            "Review conflicts with the current schedule; administrator review is required",
        )
    await finish_pending(db, row)
    if row["round"] == "hr" and review["decision"] == "reject":
        await db["applications"].update_one(
            {"orgId": org, "applicationId": row["applicationId"]},
            {
                "$set": {
                    "talentPool": {
                        "inPool": True,
                        "rejectedAtStage": "HR_ROUND",
                        "reasonCategory": "hr_decision",
                        "recontactFlag": "eligible",
                        "reason": review["comments"],
                    }
                }
            },
        )
    job = await db["jobs"].find_one({"orgId": org, "jobId": row["jobId"]}) or {}
    await repo.notify(
        job.get("assigneeUserId"),
        f"{key}:review",
        "review_submitted",
        key,
        row["applicationId"],
    )
    identity = f"recruit-review:{org}:{key}"
    await db["audit_log"].update_one(
        {"_id": identity},
        {
            "$setOnInsert": {
                "auditId": identity,
                "orgId": org,
                "actorUserId": review["reviewerId"],
                "action": "recruitment.review_submitted",
                "resourceType": "recruitment",
                "resourceId": key,
                "details": {"decision": review["decision"], "reviewId": key},
                "createdAt": now(),
            }
        },
        upsert=True,
    )
    await db["recruit_reviews"].update_one(
        {"orgId": org, "interviewId": key}, {"$set": {"applied": True}}
    )


async def cancel(db, user, key, payload):
    writable(user)
    repo = RecruitmentRepository(db, user.org_id)
    async with lease(db, user.org_id, [f"interview:{key}"]):
        row = await repo.interview(key)
        await interview_allowed(db, user, row)
        if user.role not in MANAGERS:
            raise HTTPException(403, "Only recruiters and administrators can cancel")
        if row["status"] != "scheduled":
            raise HTTPException(409, "Only scheduled interviews can be cancelled")
        if await db["recruit_reviews"].find_one(
            {"orgId": user.org_id, "interviewId": key}
        ):
            raise HTTPException(409, "A submitted review is being finalized")
        target = {
            "technical": "ROUND1_PENDING_ASSIGNMENT",
            "managerial": "ROUND2_PENDING_ASSIGNMENT",
            "hr": "HR_ROUND",
        }[row["round"]]
        from . import google_calendar
        await google_calendar.enqueue(db, {**row, 'status': 'cancelled'})
        row = await repo.update(
            key,
            payload.expectedRevision,
            {
                "status": "cancelled",
                "active": False,
                "pendingTransition": {
                    "id": uuid.uuid4().hex,
                    "stages": [target],
                    "actor": user.user_id,
                    "reason": payload.reason,
                    "override": True,
                },
            },
        )
        await google_calendar.sync_interview(db, row)
        await finish_pending(db, row)
        await db["recruit_email_outbox"].update_many(
            {
                "orgId": user.org_id,
                "entityType": "recruit_interview",
                "entityKey": key,
                "status": "pending",
            },
            {"$set": {"status": "cancelled", "lastError": "Interview cancelled"}},
        )
        await repo.notify(
            row["interviewerId"],
            f"{key}:cancelled",
            "interview_cancelled",
            key,
            row["applicationId"],
        )
        await audit(db, user, "cancelled", key, {"reason": payload.reason})
    return await detail(db, user, key)
