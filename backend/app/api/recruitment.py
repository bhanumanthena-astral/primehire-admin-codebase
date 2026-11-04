"""V2 recruitment tracker, calendar and interview workspaces."""

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pymongo import ReturnDocument
from ..security.deps import require_permission, get_db
from ..security.recruitment import (
    enabled,
    writable,
    MANAGERS,
    ADMIN,
    visible_query,
    app_allowed,
    job_allowed,
    interview_allowed,
    fields_for,
    project_candidate,
    project_application,
)
from ..models.recruitment import RecruitmentRepository, lease, now, aware, clean
from ..schemas.recruitment import (
    Schedule,
    Reschedule,
    Action,
    Review,
    ManagerialDraft,
    AccessProfile,
    Compensation,
    OfferAction,
    QuestionsAction,
    QuestionAnswer,
    Reveal,
)
from ..services import recruitment as service

router = APIRouter(prefix="/api/recruitment", tags=["recruitment"])


def database(db=Depends(get_db)):
    enabled(db)
    return db


@router.get("/capabilities")
async def capabilities(
    user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    heartbeat = await db["recruit_leases"].find_one(
        {"_id": "recruit-worker-heartbeat", "expiresAt": {"$gt": now()}}
    )
    return {
        "enabled": True,
        "canManage": user.role in MANAGERS,
        "canReview": user.role
        in {"hr", "technical_interviewer", "managerial_interviewer"},
        "canAdmin": user.role in ADMIN,
        "workerReady": bool(heartbeat),
        "emailDryRun": __import__("app.services.recruitment_mail", fromlist=["dry_run"]).dry_run(),
        "emailTestRestricted": not __import__('app.config',fromlist=['settings']).settings.is_production,
    }


@router.get("/jobs")
async def jobs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    query = {"orgId": user.org_id}
    if user.role not in ADMIN:
        if user.role == "recruiter":
            query["assigneeUserId"] = user.user_id
            query['jobId']=(await visible_query(db,user))['jobId']
        else:
            scoped = await visible_query(db, user)
            ids = await db["applications"].distinct("jobId", scoped)
            query["jobId"] = {"$in": ids}
    rows = [
        {
            k: r.get(k)
            for k in [
                "jobId",
                "jobKey",
                "title",
                "companyName",
                "positionsTotal",
                "positionsFilled",
                "lifecycleStatus",
                "status",
            ]
        }
        async for r in db["jobs"]
        .find(query)
        .sort("createdAt", -1)
        .skip(skip)
        .limit(limit)
    ]
    return {"items": rows, "total": await db["jobs"].count_documents(query)}


@router.get("/staff")
async def staff(
    role: (
        Literal["technical_interviewer", "managerial_interviewer", "hr"] | None
    ) = None,
    search: str = Query("", max_length=100),
    skip: int = Query(0, ge=0),
    selectedUserId: str = Query("", max_length=100),
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    query = {
        "orgId": user.org_id,
        "isActive": True,
        "role": role
        or {"$in": ["technical_interviewer", "managerial_interviewer", "hr"]},
    }
    selected_query = {**query, 'userId': selectedUserId}
    if search:
        query["name"] = {"$regex": re.escape(search), "$options": "i"}
    rows = [
        {k: r.get(k) for k in ['userId', 'name', 'role']}
        async for r in db['users'].find(query, {'userId': 1, 'name': 1, 'role': 1}).sort('name', 1).skip(skip).limit(50)
    ]
    selected = next((r for r in rows if r['userId'] == selectedUserId), None)
    if selectedUserId and not selected:
        item = await db['users'].find_one(selected_query, {'userId': 1, 'name': 1, 'role': 1})
        if item:
            selected = {k: item.get(k) for k in ['userId', 'name', 'role']}
    from ..services import google_calendar, google_oauth
    connected = set()
    if google_oauth.configured() and (rows or selected):
        ids = [r['userId'] for r in rows] + ([selected['userId']] if selected else [])
        connected = {r['userId'] async for r in db['google_connections'].find(
            google_calendar.connected_query(user.org_id, {'$in': ids}), {'userId': 1}).limit(51)}
    for row in rows + ([selected] if selected else []):
        row['googleCalendarConnected'] = row['userId'] in connected
    return {
        "items": rows,
        "selected": selected,
        "total": await db["users"].count_documents(query),
    }


@router.get("/applications")
async def applications(
    jobId: str = Query("", max_length=100),
    stage: str = Query("", max_length=50),
    search: str = Query("", max_length=100),
    schedulingRound: Literal["technical", "managerial", "hr"] | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=100),
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    scope = await visible_query(db, user)
    filters = {}
    if jobId:
        filters["jobId"] = jobId
    if stage:
        from ..schemas.hiring import Stage

        if stage not in {s.value for s in Stage}:
            raise HTTPException(422, "Invalid recruitment stage")
        filters["currentStage"] = stage
    query = {"$and": [scope, filters]}
    fields = await fields_for(db, user)
    pipeline = [{"$match": query}]
    if schedulingRound:
        pipeline.extend(service.pending_scheduling_pipeline(user.org_id, schedulingRound))
    pipeline.extend([
        {
            "$lookup": {
                "from": "applicants",
                "localField": "applicantId",
                "foreignField": "applicantId",
                "as": "candidateRows",
            }
        },
        {"$unwind": "$candidateRows"},
        {"$match": {"candidateRows.orgId": user.org_id}},
    ])
    search = search.strip()
    if search:
        search_fields = ["name", "email"] if "contact" in fields else ["name"]
        pipeline.append(
            {
                "$match": {
                    "$or": [{f"candidateRows.{field}": {"$regex": re.escape(search), "$options": "i"}} for field in search_fields]
                }
            }
        )
    counts = (
        await db["applications"].aggregate(pipeline + [{"$count": "total"}]).to_list(1)
    )
    rows = (
        await db["applications"]
        .aggregate(
            pipeline
            + [
                {"$sort": {"createdAt": -1, "applicationId": 1}},
                {"$skip": skip},
                {"$limit": limit},
            ]
        )
        .to_list(limit)
    )
    items = []
    bookings=await service.active_bookings(db,user,[row['applicationId'] for row in rows])
    latest=await service.latest_interviews(db,user,[row['applicationId'] for row in rows])
    for row in rows:
        job = (
            await db["jobs"].find_one({"orgId": user.org_id, "jobId": row["jobId"]})
            or {}
        )
        items.append(
            {
                **project_application(row, fields),
                "candidate": project_candidate(row["candidateRows"], fields),
                "jobTitle": job.get("title", "Job"),
                "activeInterview": bookings.get(row['applicationId']),
                "latestInterview": latest.get(row['applicationId']),
            }
        )
    return {"items": items, "total": counts[0]["total"] if counts else 0}


@router.get("/tracker")
async def tracker(
    jobId: str = Query("", max_length=100),
    applicationId: str = Query("", max_length=100),
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    scope = await visible_query(db, user)
    extra = {}
    if jobId:
        extra["jobId"] = jobId
    if applicationId:
        await app_allowed(db, user, applicationId)
        extra["applicationId"] = applicationId
    query = {"$and": [scope, extra]}
    counts = {
        r["_id"]: r["count"]
        async for r in db["applications"].aggregate(
            [
                {"$match": query},
                {"$group": {"_id": "$currentStage", "count": {"$sum": 1}}},
            ]
        )
    }
    pending_counts = {row["_id"]: row["count"] async for row in db["applications"].aggregate(
        [{"$match": query}] + service.pending_scheduling_pipeline(user.org_id) +
        [{"$group": {"_id": "$currentStage", "count": {"$sum": 1}}}])}
    scheduling_pending = {name: sum(pending_counts.get(stage, 0) for stage in stages)
                          for name, stages in service.READY.items()}
    interview_query = {"$and": [scope, extra]}
    if user.role not in MANAGERS:
        interview_query["$and"].append({"interviewerId": user.user_id})
    reviewer_summary = None
    if user.role not in MANAGERS:
        # BSON stores UTC instants. Keep aggregate literals in the same naive-UTC
        # form returned by the default Motor codec (also used by isolated tests).
        clock = now().astimezone(timezone.utc).replace(tzinfo=None)
        ist = timezone(timedelta(hours=5, minutes=30))
        today = aware(clock).astimezone(ist).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).replace(tzinfo=None)
        def tally(condition):
            return {"$sum": {"$cond": [condition, 1, 0]}}
        scheduled = {"$eq": ["$status", "scheduled"]}
        reviewed = {"$eq": ["$status", "reviewed"]}
        summaries = await db["recruit_interviews"].aggregate([
            {"$match": {"$and": [interview_query, {"status": {"$ne": "cancelled"}}]}},
            {"$group": {
                "_id": None,
                "assigned": {"$sum": 1},
                "today": tally({"$and": [{"$gte": ["$startsAt", today]}, {"$lt": ["$startsAt", today + timedelta(days=1)]}]}),
                "upcoming": tally({"$and": [scheduled, {"$gt": ["$endsAt", clock]}]}),
                "pendingReview": tally({"$and": [scheduled, {"$lte": ["$endsAt", clock]}]}),
                "completed": tally(reviewed),
                "advanced": tally({"$and": [reviewed, {"$in": [{"$ifNull": ["$reviewDecision", ""]}, ["advance", "hire"]]}]}),
                "held": tally({"$and": [reviewed, {"$eq": [{"$ifNull": ["$reviewDecision", ""]}, "hold"]}]}),
            }},
        ]).to_list(1)
        reviewer_summary = {key: (summaries[0].get(key, 0) if summaries else 0)
                            for key in ["assigned", "today", "upcoming", "pendingReview", "completed", "advanced", "held"]}
    outcome_rows = [
        r
        async for r in db["recruit_interviews"].aggregate(
            [
                {"$match": interview_query},
                {"$sort": {"createdAt": -1}},
                {
                    "$group": {
                        "_id": {"application": "$applicationId", "round": "$round"},
                        "status": {"$first": "$status"},
                        "decision": {"$first": "$reviewDecision"},
                    }
                },
                {
                    "$group": {
                        "_id": {
                            "round": "$_id.round",
                            "status": "$status",
                            "decision": "$decision",
                        },
                        "count": {"$sum": 1},
                    }
                },
            ]
        )
    ]
    outcomes = [{**r["_id"], "count": r["count"]} for r in outcome_rows]
    # History counts are cumulative milestones; stage counts are current occupancy.
    milestone_pipeline = [
        {"$match": query},
        {
            "$lookup": {
                "from": "stage_history",
                "localField": "applicationId",
                "foreignField": "applicationId",
                "as": "history",
            }
        },
        {"$addFields": {"history": {"$filter": {"input": "$history", "as": "event", "cond": {
            "$eq": [{"$ifNull": ["$$event.orgId", user.org_id]}, user.org_id]}}}}},
        {"$project": {"events": {"$setUnion": [
            "$history.toStage", ["$currentStage"],
            {"$cond": [{"$or": [
                {"$in": [{"$ifNull": ["$assessment.status", ""]}, ["completed", "Completed", "COMPLETED", "Report pending", "report_pending"]]},
                {"$in": [{"$ifNull": ["$assessment.state", ""]}, ["completed", "report_pending"]]},
                {"$eq": ["$currentStage", "ASSESSMENT_COMPLETED"]},
                {"$in": ["ASSESSMENT_COMPLETED", "$history.toStage"]},
                {"$ne": [{"$ifNull": ["$assessment.submittedAt", None]}, None]},
                {"$ne": [{"$ifNull": ["$assessment.completedAt", None]}, None]},
                {"$ne": [{"$ifNull": ["$assessment.score", None]}, None]}
            ]}, ["ASSESSMENT_SENT", "ASSESSMENT_COMPLETED"], []]},
            {"$cond": [{"$or": [
                {"$ne": [{"$ifNull": ["$assessment.sentAt", None]}, None]},
                {"$eq": [{"$ifNull": ["$assessment.state", ""]}, "email_sent"]}
            ]}, ["ASSESSMENT_SENT"], []]}
        ]}}},
        {"$unwind": "$events"},
        {"$group": {"_id": "$events", "count": {"$sum": 1}}},
    ]
    milestones = {
        r["_id"]: r["count"]
        async for r in db["applications"].aggregate(milestone_pipeline)
    }
    job_query = {"orgId": user.org_id}
    if user.role not in ADMIN:
        if user.role == "recruiter":
            job_query["assigneeUserId"] = user.user_id
            job_query['jobId']=scope['jobId']
        else:
            job_query["jobId"] = {
                "$in": await db["applications"].distinct("jobId", query)
            }
    if jobId:
        job_query = {"$and": [job_query, {"jobId": jobId}]}
    positions = (
        await db["jobs"]
        .aggregate(
            [
                {"$match": {"$and": [job_query, {"lifecycleStatus": "OPEN"}]}},
                {
                    "$group": {
                        "_id": None,
                        "total": {"$sum": "$positionsTotal"},
                        "filled": {"$sum": "$positionsFilled"},
                    }
                },
            ]
        )
        .to_list(1)
    )
    timeline = []
    if applicationId:
        # Legacy history omits orgId. Its parent application was authorized above;
        # retain that history without backfilling or changing assessment writes.
        timeline = [
            {
                k: r.get(k)
                for k in [
                    "historyId",
                    "fromStage",
                    "toStage",
                    "transitionAt",
                    "actorUserId",
                    "reason",
                    "isOverride",
                ]
            }
            async for r in db["stage_history"]
            .find(
                {
                    "applicationId": applicationId,
                    "$or": [{"orgId": user.org_id}, {"orgId": {"$exists": False}}],
                }
            )
            .sort("transitionAt", 1)
            .limit(200)
        ]
        # Display existing intake milestones without writing to intake or ATS.
        source = await db["resume_intake_items"].find_one(
            {"orgId": user.org_id, "applicationId": applicationId},
            {"batchId": 1, "createdAt": 1, "ats.evaluatedAt": 1},
        )
        if source:
            batch = (
                await db["resume_intake_batches"].find_one(
                    {"orgId": user.org_id, "_id": source.get("batchId")},
                    {"createdAt": 1, "createdBy": 1},
                )
                or {}
            )
            intake_events = [
                (
                    "RESUME_UPLOADED",
                    batch.get("createdAt") or source.get("createdAt"),
                    "Resume received for this job.",
                ),
                (
                    "ATS_EVALUATED",
                    (source.get("ats") or {}).get("evaluatedAt"),
                    "Existing application ATS result became available.",
                ),
            ]
            for stage_name, timestamp, reason in intake_events:
                if not timestamp:
                    continue
                try:
                    timestamp = (
                        aware(timestamp)
                        if isinstance(timestamp, datetime)
                        else aware(
                            datetime.fromisoformat(
                                str(timestamp).replace("Z", "+00:00")
                            )
                        )
                    )
                except ValueError:
                    continue
                timeline.append(
                    {
                        "historyId": f"intake:{source.get('_id')}:{stage_name}",
                        "toStage": stage_name,
                        "fromStage": "",
                        "transitionAt": timestamp,
                        "actorUserId": (
                            batch.get("createdBy", "system")
                            if stage_name == "RESUME_UPLOADED"
                            else "system"
                        ),
                        "reason": reason,
                        "isOverride": False,
                        "derivedEvent": True,
                    }
                )
            timeline.sort(key=lambda entry: aware(entry["transitionAt"]))
    if timeline:
        actors = {
            entry["actorUserId"] for entry in timeline if entry.get("actorUserId")
        }
        names = {
            person["userId"]: person.get("name", "Team member")
            async for person in db["users"]
            .find(
                {"orgId": user.org_id, "userId": {"$in": list(actors)}},
                {"userId": 1, "name": 1},
            )
            .limit(200)
        }
        for entry in timeline:
            entry["actorName"] = names.get(
                entry.get("actorUserId"),
                "System" if entry.get("actorUserId") == "system" else "Team member",
            )
    return clean(
        {
            "stages": counts,
            "milestones": milestones,
            "total": sum(counts.values()),
            "positions": positions[0] if positions else {"total": 0, "filled": 0},
            "interviews": outcomes,
            "timeline": timeline,
            "reviewerSummary": reviewer_summary,
            "schedulingPending": scheduling_pending,
        }
    )


@router.get("/interviews")
async def interviews(
    jobId: str = Query("", max_length=100),
    applicationId: str = Query("", max_length=100),
    status: Literal["scheduled", "reviewed", "cancelled"] | None = None,
    round: Literal["technical", "managerial", "hr"] | None = None,
    bucket: Literal["all", "upcoming", "pending_review", "held", "completed", "today"] = "all",
    startsFrom: datetime | None = None,
    startsTo: datetime | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    query = await visible_query(db, user)
    extra = {}
    if user.role not in MANAGERS:
        extra['interviewerId']=user.user_id
    if jobId:
        extra["jobId"] = jobId
    if applicationId:
        extra["applicationId"] = applicationId
    if status:
        extra["status"] = status
    if round:
        extra["round"] = round
    if bucket == "upcoming":
        extra.update(status="scheduled", endsAt={"$gt": now()})
    elif bucket == "pending_review":
        extra.update(status="scheduled", endsAt={"$lte": now()})
    elif bucket == "held":
        extra.update(reviewDecision="hold")
    elif bucket == "completed":
        extra.update(status="reviewed")
    elif bucket == "today":
        today = now().astimezone(timezone(timedelta(hours=5, minutes=30))).replace(hour=0, minute=0, second=0, microsecond=0)
        extra.update(status={"$ne": "cancelled"}, startsAt={"$gte": today, "$lt": today + timedelta(days=1)})
    if startsFrom or startsTo:
        if (
            not startsFrom
            or not startsTo
            or not startsFrom.tzinfo
            or not startsTo.tzinfo
            or not timedelta(0) < startsTo - startsFrom <= timedelta(days=93)
        ):
            raise HTTPException(
                422,
                "Calendar range must include timezone-aware start/end within 93 days",
            )
        extra["startsAt"] = {"$gte": startsFrom, "$lt": startsTo}
    query = {"$and": [query, extra]}
    keys = [
        r["interviewId"]
        async for r in db["recruit_interviews"]
        .find(query)
        .sort("startsAt", 1)
        .skip(skip)
        .limit(limit)
    ]
    return {
        "items": [await service.detail(db, user, key) for key in keys],
        "total": await db["recruit_interviews"].count_documents(query),
    }


@router.post("/interviews", status_code=201)
async def create_interview(
    payload: Schedule,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    return await service.schedule(db, user, payload)


@router.get("/interviews/{key}")
async def interview(
    key: str, user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    return await service.detail(db, user, key)


@router.put("/interviews/{key}")
async def reschedule(
    key: str,
    payload: Reschedule,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row)
    return await service.schedule(db, user, payload, existing=row)


@router.post("/interviews/{key}/cancel")
async def cancel(
    key: str,
    payload: Action,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    return await service.cancel(db, user, key, payload)


@router.post("/interviews/{key}/review")
async def review(
    key: str,
    payload: Review,
    user=Depends(require_permission("recruitment.review")),
    db=Depends(database),
):
    return await service.submit_review(db, user, key, payload)


@router.post("/interviews/{key}/send-invitation")
async def invitation(
    key: str,
    payload: Action,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    writable(user)
    repo = RecruitmentRepository(db, user.org_id)
    async with lease(db, user.org_id, [f"interview:{key}"]):
        row = await repo.interview(key)
        await interview_allowed(db, user, row)
        if row["status"] != "scheduled" or row["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Schedule changed; refresh first")
        person = (
            await db["applicants"].find_one(
                {"orgId": user.org_id, "applicantId": row["applicantId"]}
            )
            or {}
        )
        if not person.get("email") or person["email"].endswith("@placeholder.local"):
            raise HTTPException(422, "A verified candidate email is required")
        await repo.db["recruit_interviews"].update_one(
            {
                "orgId": user.org_id,
                "interviewId": key,
                "revision": payload.expectedRevision,
            },
            {"$set": {"candidateEmailRequested": True}},
        )
        await service.audit(
            db, user, "candidate_invitation_requested", key, {"reason": payload.reason}
        )
    return {
        "queued": True,
        "note": "Delivery occurs through the recruitment outbox; dry-run mode is labelled in email status.",
    }


@router.post("/interviews/{key}/confirm-rejection")
async def confirm_rejection(
    key: str,
    payload: Action,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    writable(user)
    repo = RecruitmentRepository(db, user.org_id)
    row = await repo.interview(key)
    await interview_allowed(db, user, row)
    async with lease(
        db, user.org_id, [f"interview:{key}", f'app:{row["applicationId"]}']
    ):
        application = await db["applications"].find_one(
            {"orgId": user.org_id, "applicationId": row["applicationId"]}
        )
        if application["currentStage"] != "REJECTION_PENDING_HR_REVIEW":
            raise HTTPException(
                409, "This candidate is not awaiting rejection approval"
            )
        row = await repo.update(
            key,
            payload.expectedRevision,
            {
                "pendingTransition": {
                    "id": uuid.uuid4().hex,
                    "stages": ["REJECTED"],
                    "actor": user.user_id,
                    "reason": payload.reason,
                }
            },
        )
        await service.finish_pending(db, row)
        await db["applications"].update_one(
            {"orgId": user.org_id, "applicationId": row["applicationId"]},
            {
                "$set": {
                    "talentPool": {
                        "inPool": True,
                        "rejectedAtStage": row["round"],
                        "reasonCategory": "human_rejection_review",
                        "recontactFlag": "eligible",
                        "reason": payload.reason,
                    }
                }
            },
        )
        await service.audit(
            db, user, "rejection_confirmed", key, {"reason": payload.reason}
        )
    return await service.detail(db, user, key)


@router.get("/interviews/{key}/invitation.pdf")
async def invitation_pdf(
    key: str, user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row)
    from zoneinfo import ZoneInfo
    import pymupdf

    stamp = (
        aware(row["startsAt"])
        .astimezone(ZoneInfo("Asia/Kolkata"))
        .strftime("%d %B %Y, %I:%M %p IST")
    )
    candidate = (
        await db["applicants"].find_one(
            {"orgId": user.org_id, "applicantId": row["applicantId"]}
        )
        or {}
    )
    with pymupdf.open() as document:
        page = document.new_page()
        page.draw_rect(pymupdf.Rect(0, 0, 595, 16), color=None, fill=(0.95, 0.67, 0.35))
        page.insert_text((48, 70), "INTERVIEW INVITATION", fontsize=22)
        text = f"Dear {candidate.get('name','Candidate')},\n\nCongratulations on progressing to the next interview stage.\n\nRole: {row.get('jobTitle','Job')}\nRound: {row['round'].title()}\nDate and time: {stamp}\nLocation: {row.get('location') or 'Online meeting'}\n\nMeeting: {row.get('meetingLink') or 'Your recruiter will share joining details.'}\n\nPlease be available at the scheduled time. Contact your recruiter\nif you need assistance or a reschedule.\n\nRegards,\nRecruitment team"
        from ..services.recruitment_worker import invitation_html

        body = re.sub(
            r"<h1>.*?</h1>",
            "",
            invitation_html(row, candidate.get("name", "Candidate"), "candidate"),
            count=1,
        )
        page.insert_htmlbox(
            pymupdf.Rect(32, 90, 563, 785),
            body,
            css="body {font-size:12pt; line-height:1.5} h2 {font-size:16pt} a {color:#765128}",
        )
        data = document.tobytes()
    await service.audit(db, user, "invitation_download", key)
    return Response(
        data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="interview-invitation.pdf"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


@router.post("/interviews/{key}/reveal")
async def reveal(
    key: str,
    payload: Reveal,
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    writable(user)
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row)
    if "contact" not in await fields_for(db, user):
        raise HTTPException(403, "Contact access is not enabled for your profile")
    person = (
        await db["applicants"].find_one(
            {"orgId": user.org_id, "applicantId": row["applicantId"]}
        )
        or {}
    )
    await service.audit(db, user, "contact_reveal", key, {"reason": payload.reason})
    return {k: person.get(k, "") for k in ["email", "phone"]}


@router.get("/interviews/{key}/resume")
async def resume(
    key: str, user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row)
    if "resume" not in await fields_for(db, user):
        raise HTTPException(403, "Resume access is not enabled")
    person = (
        await db["applicants"].find_one(
            {"orgId": user.org_id, "applicantId": row["applicantId"]}
        )
        or {}
    )
    file_id = person.get("resume", {}).get("fileId")
    file = (
        await db["resume_files"].find_one({"orgId": user.org_id, "fileId": file_id})
        if file_id
        else None
    )
    item = (
        await db["resume_intake_items"].find_one(
            {"orgId": user.org_id, "fileId": file_id}
        )
        if file_id
        else None
    )
    if not file or (
        item and (item.get("scanStatus") != "clean" or item.get("status") == "deleted")
    ):
        raise HTTPException(404, "A clean original resume is not available")
    if (
        file.get("quarantined")
        or file.get("status") == "quarantined"
        or (file.get("retentionUntil") and aware(file["retentionUntil"]) <= now())
    ):
        raise HTTPException(410, "Resume is unavailable under retention policy")
    from ..services.storage import resolve_storage_key
    from fastapi.responses import FileResponse

    try:
        path = resolve_storage_key(file.get("storageKey", ""))
    except ValueError:
        raise HTTPException(404, "Resume is unavailable") from None
    if not path.is_file():
        raise HTTPException(404, "Resume file is unavailable")
    await service.audit(db, user, "resume_download", key)
    return FileResponse(
        path,
        filename="candidate-resume" + path.suffix,
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
    )


async def hr_access(db, user, key, *, salary=True):
    writable(user)
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row)
    if not salary and "previousReviews" not in await fields_for(db, user):
        raise HTTPException(403, "Previous-review access is required for feedback-based HR questions")
    if (
        row["round"] != "hr"
        or salary
        and "compensation" not in await fields_for(db, user)
    ):
        raise HTTPException(403, "HR compensation access is required")
    return row


@router.put("/interviews/{key}/compensation")
async def compensation(
    key: str,
    payload: Compensation,
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    await hr_access(db, user, key)
    await RecruitmentRepository(db, user.org_id).update(
        key,
        payload.expectedRevision,
        {"compensation": payload.model_dump(exclude={"expectedRevision", "reason"})},
    )
    await service.audit(
        db, user, "compensation_updated", key, {"reason": payload.reason}
    )
    return await service.detail(db, user, key)


@router.post("/interviews/{key}/offer")
async def offer(
    key: str,
    payload: OfferAction,
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    row = await hr_access(db, user, key)
    async with lease(
        db,
        user.org_id,
        [f"interview:{key}", f'app:{row["applicationId"]}', f'job:{row["jobId"]}'],
    ):
        row = await RecruitmentRepository(db, user.org_id).interview(key)
        decision = await db["recruit_reviews"].find_one(
            {"orgId": user.org_id, "interviewId": key}
        )
        if not decision or decision["decision"] not in {"hire", "advance"}:
            raise HTTPException(
                409, "Submit a positive HR review before recording an offer"
            )
        transitions = {
            "none": {"negotiating", "offered"},
            "negotiating": {"offered", "declined"},
            "offered": {"accepted", "declined", "negotiating"},
            "accepted": {"joined", "declined"},
            "declined": set(),
            "joined": set(),
        }
        if payload.status not in transitions.get(row.get("offerStatus", "none"), set()):
            raise HTTPException(409, "Invalid offer transition")
        if payload.status in {"offered", "accepted", "joined"} and not (
            row.get("compensation", {}).get("agreedAmount")
            or row.get("compensation", {}).get("proposedOffer")
        ):
            raise HTTPException(422, "Record the proposed or agreed compensation first")
        if payload.status == "joined":
            job = (
                await db["jobs"].find_one({"orgId": user.org_id, "jobId": row["jobId"]})
                or {}
            )
            if int(job.get("positionsFilled", 0)) >= int(job.get("positionsTotal", 0)):
                raise HTTPException(409, "The job has no remaining positions")
        stages = (
            ["HIRED"]
            if payload.status == "joined"
            else ["REJECTED"] if payload.status == "declined" else []
        )
        row = await RecruitmentRepository(db, user.org_id).update(
            key,
            payload.expectedRevision,
            {
                "offerStatus": payload.status,
                "pendingTransition": {
                    "id": uuid.uuid4().hex,
                    "stages": stages,
                    "actor": user.user_id,
                    "reason": payload.reason,
                },
            },
        )
        await service.finish_pending(db, row)
        await service.audit(
            db,
            user,
            "offer_updated",
            key,
            {"status": payload.status, "reason": payload.reason},
        )
    return await service.detail(db, user, key)


@router.post("/interviews/{key}/questions")
async def questions(
    key: str,
    payload: QuestionsAction,
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    row = await hr_access(db, user, key, salary=False)
    async with lease(db, user.org_id, [f"interview:{key}", f"questions:{key}"]):
        row = await RecruitmentRepository(db, user.org_id).interview(key)
        if row["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Interview changed; refresh first")
        existing = await db["recruit_questions"].find_one(
            {"orgId": user.org_id, "interviewId": key}
        )
        if existing:
            from ..security.recruitment import questions_allowed
            if not questions_allowed(existing, await fields_for(db, user)):
                raise HTTPException(403, "Access to the original question context has been revoked")
            if not payload.regenerate:
                return clean(existing)
            if existing["revision"] != payload.expectedQuestionRevision:
                raise HTTPException(409, "Question set changed; refresh first")
            if existing["revision"] != existing.get("generatedRevision", 1) or any(
                q.get("asked") or q.get("answer") for q in existing["questions"]
            ):
                raise HTTPException(409, "Saved questions and answers are preserved. Edit questions individually instead.")
        elif payload.regenerate:
            raise HTTPException(409, "Question set changed; refresh first")
        from ..services.recruitment_questions import generate

        result = await generate(
            db, user, row,
            replace_revision=existing["revision"] if existing else None,
        )
        await service.audit(
            db, user, "questions_regenerated" if existing else "questions_generated",
            key, {"method": result["method"]}
        )
        return result


@router.put("/interviews/{key}/questions")
async def answer(
    key: str,
    payload: QuestionAnswer,
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    await hr_access(db, user, key, salary=False)
    async with lease(db, user.org_id, [f"questions:{key}"]):
        row = await db["recruit_questions"].find_one(
            {
                "orgId": user.org_id,
                "interviewId": key,
                "revision": payload.expectedRevision,
            }
        )
        if not row:
            raise HTTPException(409, "Question set changed; refresh first")
        from ..security.recruitment import questions_allowed
        if not questions_allowed(row, await fields_for(db, user)):
            raise HTTPException(403, "Access to the original question context has been revoked")
        question = next(
            (q for q in row["questions"] if q["questionId"] == payload.questionId), None
        )
        if not question:
            raise HTTPException(404, "Question not found")
        question.update(
            question=payload.question, asked=payload.asked, answer=payload.answer
        )
        await db["recruit_questions"].update_one(
            {
                "orgId": user.org_id,
                "interviewId": key,
                "revision": payload.expectedRevision,
            },
            {"$set": {"questions": row["questions"]}, "$inc": {"revision": 1}},
        )
        await service.audit(
            db, user, "question_answer_saved", key, {"questionId": payload.questionId}
        )
    return clean(
        await db["recruit_questions"].find_one(
            {"orgId": user.org_id, "interviewId": key}
        )
    )


@router.get("/notifications")
async def notifications(
    skip: int = Query(0, ge=0),
    user=Depends(require_permission("recruitment.view")),
    db=Depends(database),
):
    query = {"orgId": user.org_id, "userId": user.user_id}
    return {
        "items": [
            clean(n)
            async for n in db["recruit_notifications"]
            .find(query)
            .sort("createdAt", -1)
            .skip(skip)
            .limit(25)
        ],
        "total": await db["recruit_notifications"].count_documents(query),
        "unread": await db["recruit_notifications"].count_documents(
            {**query, "readAt": None}
        ),
    }


@router.post("/notifications/{key}/read")
async def mark_read(
    key: str, user=Depends(require_permission("recruitment.view")), db=Depends(database)
):
    writable(user)
    result = await db["recruit_notifications"].update_one(
        {"orgId": user.org_id, "userId": user.user_id, "notificationId": key},
        {"$set": {"readAt": now()}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Notification not found")
    return {"read": True}


@router.get("/access/{user_id}")
async def access(
    user_id: str, user=Depends(require_permission("users.manage")), db=Depends(database)
):
    target = await db["users"].find_one({"orgId": user.org_id, "userId": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    row = await db["recruit_profiles"].find_one(
        {"orgId": user.org_id, "userId": user_id}
    )
    from ..security.recruitment import DEFAULT_FIELDS

    defaults = (
        DEFAULT_FIELDS
        | (
            {"previousReviews"}
            if target["role"] in {"managerial_interviewer", "hr"}
            else set()
        )
        | ({"compensation"} if target["role"] == "hr" else set())
    )
    return (
        clean(row)
        if row
        else {"userId": user_id, "visibleFields": sorted(defaults), "revision": 0}
    )


@router.put("/access/{user_id}")
async def set_access(
    user_id: str,
    payload: AccessProfile,
    user=Depends(require_permission("users.manage")),
    db=Depends(database),
):
    writable(user)
    if not await db["users"].find_one(
        {
            "orgId": user.org_id,
            "userId": user_id,
            "role": {"$in": ["technical_interviewer", "managerial_interviewer", "hr"]},
        }
    ):
        raise HTTPException(404, "Interviewer not found")
    async with lease(db, user.org_id, [f"profile:{user_id}"]):
        old = await db["recruit_profiles"].find_one(
            {"orgId": user.org_id, "userId": user_id}
        )
        if (old or {}).get("revision", 0) != payload.expectedRevision:
            raise HTTPException(409, "Permissions changed; refresh first")
        await db["recruit_profiles"].update_one(
            {"orgId": user.org_id, "userId": user_id},
            {
                "$set": {
                    "visibleFields": sorted(set(payload.visibleFields)),
                    "updatedBy": user.user_id,
                    "updatedAt": now(),
                },
                "$inc": {"revision": 1},
            },
            upsert=True,
        )
        await service.audit(
            db,
            user,
            "access_updated",
            user_id,
            {
                "before": old.get("visibleFields") if old else None,
                "after": payload.visibleFields,
                "reason": payload.reason,
            },
        )
    return await access(user_id, user, db)


@router.post("/interviews/{key}/evaluation-draft")
async def managerial_draft(key: str, payload: ManagerialDraft,
    user=Depends(require_permission("recruitment.review")), db=Depends(database)):
    writable(user)
    repo = RecruitmentRepository(db, user.org_id)
    async with lease(db, user.org_id, [f"interview:{key}"]):
        row = await repo.interview(key)
        await interview_allowed(db, user, row, review=True)
        if row["round"] != "managerial" or row["status"] != "scheduled" or await db.recruit_reviews.find_one({"orgId": user.org_id, "interviewId": key}):
            raise HTTPException(409, "Only an unsubmitted managerial evaluation can be saved as a draft")
        previous = row.get("evaluationDraft") or {}
        draft = {**payload.model_dump(exclude={"expectedRevision"}), "status": "draft",
            "applicationId": row["applicationId"], "interviewId": key,
            "createdBy": previous.get("createdBy", user.user_id), "createdAt": previous.get("createdAt", now()),
            "updatedBy": user.user_id, "updatedAt": now()}
        await repo.update(key, payload.expectedRevision, {"evaluationDraft": draft})
        await service.audit(db, user, "managerial_draft_saved", key, {"applicationId": row["applicationId"]})
    return await service.detail(db, user, key)


@router.post("/interviews/{key}/managerial-summary")
async def managerial_summary(key: str, user=Depends(require_permission("recruitment.review")), db=Depends(database)):
    writable(user)
    row = await RecruitmentRepository(db, user.org_id).interview(key)
    await interview_allowed(db, user, row, review=True)
    if row["round"] != "managerial":
        raise HTTPException(409, "A managerial interview is required")
    from ..services.managerial_feedback import generate_summary
    await generate_summary(db, user, key)
    return await service.detail(db, user, key)
