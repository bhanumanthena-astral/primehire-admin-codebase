"""Central assignment checks and field projection for all recruitment views."""

from fastapi import HTTPException
from ..config import settings
from ..models.recruitment import clean
from ..services.pii import mask_email, mask_phone

ADMIN = {"super_admin", "admin"}
MANAGERS = ADMIN | {"recruiter"}
DEFAULT_FIELDS = {
    "skills",
    "experience",
    "education",
    "summary",
    "assessment",
    "resume",
}


def questions_allowed(record, fields):
    if not record:
        return True
    # Older sets were generated from all four context groups. Preserve their
    # answers, but never expose that derived context after access is revoked.
    used = set(record.get("contextFields", ["skills", "experience", "summary", "previousReviews"]))
    return used.issubset(fields)


def enabled(db):
    if not settings.recruitment_portals_enabled:
        raise HTTPException(404, "Recruitment portals are not enabled")
    if db is None:
        raise HTTPException(503, "Database unavailable")


def writable(user):
    if user.impersonating:
        raise HTTPException(403, "View-as sessions are read-only")
    from .rate_limit import limiter

    result = limiter.check(f"recruitment:{user.org_id}:{user.user_id}", 120, 60)
    if not result.allowed:
        raise HTTPException(
            429,
            "Too many recruitment changes. Retry shortly.",
            headers={"Retry-After": str(result.retry_after)},
        )


async def job_allowed(db, user, job_id):
    query = {"orgId": user.org_id, "jobId": job_id}
    if user.role not in ADMIN:
        query["assigneeUserId"] = user.user_id
    job = await db["jobs"].find_one(query)
    if not job:
        raise HTTPException(404, "Job not found or not assigned to you")
    from .job_permissions import require_job_access
    await require_job_access(db,user,'view',job)
    return job


async def app_allowed(db, user, key):
    app = await db["applications"].find_one(
        {"orgId": user.org_id, "applicationId": key}
    )
    if not app:
        raise HTTPException(404, "Application not found")
    if user.role in MANAGERS:
        await job_allowed(db, user, app["jobId"])
    else:
        assigned = await db["recruit_interviews"].find_one(
            {
                "orgId": user.org_id,
                "applicationId": key,
                "interviewerId": user.user_id,
                "status": {"$ne": "cancelled"},
            }
        )
        if not assigned:
            raise HTTPException(404, "Application not found")
    return app


async def interview_allowed(db, user, row, *, review=False):
    if user.role in MANAGERS:
        await job_allowed(db, user, row["jobId"])
    elif row["interviewerId"] != user.user_id:
        raise HTTPException(404, "Interview not found")
    if review and row["interviewerId"] != user.user_id:
        raise HTTPException(403, "Only the assigned interviewer can submit this review")
    return row


async def visible_query(db, user):
    if user.role in ADMIN:
        return {"orgId": user.org_id}
    if user.role == "recruiter":
        from .job_permissions import job_access
        actor=await db['users'].find_one({'orgId':user.org_id,'userId':user.user_id},{'jobAccess':1})
        if 'view' not in job_access(user.role,(actor or {}).get('jobAccess')):
            return {'orgId':user.org_id,'jobId':{'$in':[]}}
        rows = (
            await db["jobs"]
            .find({"orgId": user.org_id, "assigneeUserId": user.user_id,
                '$or':[{'assigneeAccess':None},{'assigneeAccess':'view'}]}, {"jobId": 1})
            .limit(5001)
            .to_list(5001)
        )
        if len(rows) > 5000:
            raise HTTPException(422, "Use a job filter for this large workspace")
        return {"orgId": user.org_id, "jobId": {"$in": [r["jobId"] for r in rows]}}
    rows = (
        await db["recruit_interviews"]
        .find(
            {
                "orgId": user.org_id,
                "interviewerId": user.user_id,
                "status": {"$ne": "cancelled"},
            },
            {"applicationId": 1},
        )
        .limit(5001)
        .to_list(5001)
    )
    if len(rows) > 5000:
        raise HTTPException(422, "Use a narrower workspace filter")
    return {
        "orgId": user.org_id,
        "applicationId": {"$in": list({r["applicationId"] for r in rows})},
    }


async def fields_for(db, user):
    if user.role in MANAGERS:
        return DEFAULT_FIELDS | {"previousReviews", "compensation", "contact"}
    profile = await db["recruit_profiles"].find_one(
        {"orgId": user.org_id, "userId": user.user_id}
    )
    fields = (
        set(profile["visibleFields"])
        if profile
        else DEFAULT_FIELDS
        | (
            {"previousReviews"}
            if user.role in {"managerial_interviewer", "hr"}
            else set()
        )
        | ({"compensation"} if user.role == "hr" else set())
    )
    return fields


def project_candidate(candidate, fields):
    from ..services.resume_intake_projection import redact_contacts
    profile = (
        candidate.get("profile")
        or candidate.get("resume", {}).get("parsedJson")
        or candidate
    )
    result = {
        "applicantId": candidate.get("applicantId"),
        "name": candidate.get("name", "Candidate"),
        "email": mask_email(candidate.get("email", "")),
        "phone": mask_phone(candidate.get("phone", "")),
    }
    mapping = {
        "skills": ["skills", "languages", "technologies"],
        "experience": [
            "experienceYears",
            "currentCompany",
            "currentDesignation",
            "role",
            "department",
            "industry",
        ],
        "education": ["education", "ugDegree", "pgDegree", "doctorateDegree"],
        "summary": ["summary", "headline", "currentLocation", "preferredLocations"],
    }
    for group, keys in mapping.items():
        if group in fields:
            for key in keys:
                if key in profile:
                    value=profile[key]
                    result[key] = redact_contacts(value) if isinstance(value,str) else [redact_contacts(v) for v in value] if isinstance(value,list) else value
    if "resume" in fields:
        result["hasResume"] = bool(candidate.get("resume", {}).get("fileId"))
    return clean(result)


def project_application(app, fields):
    keys = [
        "applicationId",
        "applicantId",
        "jobId",
        "currentStage",
        "stageEnteredAt",
        "createdAt",
        "updatedAt",
    ]
    result = {k: app.get(k) for k in keys}
    if "assessment" in fields:
        assessment = app.get("assessment") or {}
        result["assessment"] = {
            k: assessment[k]
            for k in ["score", "status", "completedAt", "sentAt"]
            if k in assessment
        }
        result["assessment"]["status"] = assessment.get("status") or assessment.get("state") or "Not invited"
        result["assessment"]["reportAvailable"] = bool(assessment.get("interviewId")) and (
            assessment.get("score") is not None or bool(assessment.get("submittedAt") or assessment.get("completedAt"))
        )
        if "contact" in fields:
            result["assessment"].update({k: assessment[k] for k in ["link", "error"] if k in assessment})
            if assessment.get('accessCodeEncrypted'):
                from ..services.candidate_link_crypto import decrypt_link, OutboxCryptoError
                try:
                    result['assessment']['password'] = decrypt_link(assessment['accessCodeEncrypted'])
                except OutboxCryptoError:
                    result['assessment']['passwordUnavailable'] = True

        result["atsScore"] = app.get("matchScore")
    return clean(result)
