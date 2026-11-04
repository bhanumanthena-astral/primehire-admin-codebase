"""V2-only talent recommendations; recruiter actions never send outreach."""

from fastapi import APIRouter, Depends, HTTPException, Query
from ..security.deps import require_permission
from ..security.recruitment import (
    fields_for,
    project_candidate,
    project_application,
    visible_query,
)
from ..services.resume_intake_projection import redact_contacts
from ..models.recruitment import clean, now, aware
from ..schemas.talent import MatchRequest, ReuseRequest
from ..services import talent
from .recruitment import database, tracker

router = APIRouter(prefix="/api/recruitment/talent", tags=["talent"])


@router.post("/runs", status_code=202)
async def start(
    payload: MatchRequest,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    return await talent.start(db, user, payload)


@router.get("/runs")
async def runs(
    jobId: str = Query(..., min_length=1, max_length=100),
    skip: int = Query(0, ge=0),
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    await talent.target(db, user, jobId)
    rows = (
        await db["talent_match_runs"]
        .find({"orgId": user.org_id, "jobId": jobId})
        .sort("createdAt", -1)
        .skip(skip)
        .limit(21)
        .to_list(21)
    )
    return {
        "items": [talent.public_run(r) for r in rows[:20]],
        "hasMore": len(rows) > 20,
    }


@router.get("/runs/{key}")
async def run(
    key: str,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    row = await db["talent_match_runs"].find_one({"orgId": user.org_id, "runId": key})
    if not row:
        raise HTTPException(404, "Matching run not found")
    if row.get("expiresAt") and aware(row["expiresAt"]) <= now():
        raise HTTPException(410, "Talent matching run expired under retention policy")
    await talent.target(db, user, row["jobId"])
    return talent.public_run(row)


@router.get("/matches")
async def matches(
    runId: str = Query(..., min_length=1, max_length=100),
    minimum: int = Query(0, ge=0, le=100),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    await run(runId, user, db)
    query = {"orgId": user.org_id, "runId": runId, "score": {"$gte": minimum}}
    scope = await visible_query(db, user)
    pipeline = [
        {"$match": query},
        {
            "$lookup": {
                "from": "applications",
                "localField": "sourceApplicationId",
                "foreignField": "applicationId",
                "as": "source",
            }
        },
        {"$unwind": "$source"},
        {"$match": {f"source.{k}": v for k, v in scope.items()}},
        {
            "$match": {
                "source.currentStage": {"$in": ["REJECTED", "TALENT_POOL"]},
                "source.talentPool.recontactFlag": {
                    "$nin": ["ineligible", "do_not_contact"]
                },
            }
        },
        {
            "$lookup": {
                "from": "applicants",
                "localField": "applicantId",
                "foreignField": "applicantId",
                "as": "person",
            }
        },
        {"$unwind": "$person"},
        {
            "$match": {
                "person.orgId": user.org_id,
                "person.consent.given": True,
                "$or": [
                    {"person.retentionUntil": None},
                    {"person.retentionUntil": {"$gt": now()}},
                ],
            }
        },
    ]
    counts = (
        await db["talent_matches"]
        .aggregate(pipeline + [{"$count": "total"}])
        .to_list(1)
    )
    rows = (
        await db["talent_matches"]
        .aggregate(
            pipeline
            + [
                {"$sort": {"score": -1, "matchId": 1}},
                {"$skip": skip},
                {"$limit": limit},
                {"$project": {"source": 0, "person": 0}},
            ]
        )
        .to_list(limit)
    )
    output = []
    fields = await fields_for(db, user)
    for row in rows:
        try:
            _, _, source, person, reviews, stale = await talent.match_for(
                db, user, row["matchId"]
            )
        except HTTPException:
            continue
        output.append(
            {
                **clean(
                    {
                        k: v
                        for k, v in row.items()
                        if k
                        not in {"_id", "orgId", "jobHash", "profileHash", "reviewHash"}
                    }
                ),
                "candidate": project_candidate(person, fields),
                "stale": stale,
                "previousStage": source.get("talentPool", {}).get(
                    "rejectedAtStage", source["currentStage"]
                ),
                "previousAssessment": project_application(source, fields).get(
                    "assessment", {}
                ),
                "reviewCount": len(reviews),
            }
        )
    return {"items": output, "total": counts[0]["total"] if counts else 0}


@router.get("/matches/{key}")
async def match(
    key: str,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    row, job, source, person, reviews, stale = await talent.match_for(db, user, key)
    timeline = await tracker(
        jobId=source["jobId"], applicationId=source["applicationId"], user=user, db=db
    )
    result = {
        "matchId": key,
        "stale": stale,
        "candidate": project_candidate(person, await fields_for(db, user)),
        "previousApplicationId": source["applicationId"],
        "previousAssessment": project_application(
            source, await fields_for(db, user)
        ).get("assessment", {}),
        "reviews": clean(
            [
                {
                    k: r.get(k)
                    for k in [
                        "reviewId",
                        "round",
                        "decision",
                        "strengths",
                        "concerns",
                        "comments",
                        "scorecard",
                        "createdAt",
                    ]
                }
                for r in reviews
            ]
        ),
        "rejection": clean(source.get("talentPool", {})),
        "timeline": timeline["timeline"],
    }

    def masked(value):
        if isinstance(value, str):
            return redact_contacts(value)
        if isinstance(value, list):
            return [masked(v) for v in value]
        if isinstance(value, dict):
            return {k: masked(v) for k, v in value.items()}
        return value

    # Keep IDs unchanged; redact only free-text evidence, not ISO times or keys.
    for review in result["reviews"]:
        for field in ["strengths", "concerns", "comments"]:
            review[field] = masked(review.get(field))
    if "reason" in result["rejection"]:
        result["rejection"]["reason"] = masked(result["rejection"]["reason"])
    for event in result["timeline"]:
        event["reason"] = masked(event.get("reason"))
    return result


@router.post("/matches/{key}/reuse")
async def reuse(
    key: str,
    payload: ReuseRequest,
    user=Depends(require_permission("recruitment.manage")),
    db=Depends(database),
):
    return await talent.reuse(db, user, key, payload)
