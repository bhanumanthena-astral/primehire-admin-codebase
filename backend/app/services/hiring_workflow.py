"""Persisted hiring templates and versioned round criteria."""

from html import escape
from uuid import uuid4
from fastapi import HTTPException
from ..models.recruitment import now, lease
from ..models.hiring import AuditLogRepository

CATEGORIES = {"rejection", "candidate_reminder", "company_reminder", "report_share"}
DEFAULT_TRAITS = {
    "technical": [
        ("technicalDepth", "Technical knowledge"),
        ("problemSolving", "Problem solving"),
        ("communication", "Communication"),
    ],
    "managerial": [
        ("ownership", "Ownership"),
        ("leadership", "Leadership"),
        ("communication", "Communication"),
        ("cultureFit", "Cultural alignment"),
    ],
    "hr": [("communication", "Communication"), ("cultureFit", "Cultural alignment")],
}


async def preferences(db, org):
    return await db.hiring_preferences.find_one({"_id": org}) or {
        "templates": [],
        "defaultRejectionId": None,
        "revision": 0,
    }


async def save_preferences(db, user, payload):
    async with lease(db, user.org_id, ["hiring-preferences"]):
        current = await preferences(db, user.org_id)
        if current["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Settings changed. Refresh and try again.")
        templates = [item.model_dump() for item in payload.templates]
        default = next(
            (t for t in templates if t["id"] == payload.defaultRejectionId), None
        )
        if payload.defaultRejectionId and (
            not default or default["category"] != "rejection"
        ):
            raise HTTPException(
                422, "Choose a rejection email template as the default."
            )
        record = {
            "templates": templates,
            "defaultRejectionId": payload.defaultRejectionId,
            "revision": current["revision"] + 1,
        }
        await db.hiring_preferences.update_one(
            {"_id": user.org_id}, {"$set": record}, upsert=True
        )
        await AuditLogRepository(db).log(
            org_id=user.org_id,
            actor_user_id=user.user_id,
            action="hiring.templates_updated",
            resource_type="organization",
            resource_id=user.org_id,
            details={
                "defaultRejectionId": payload.defaultRejectionId,
                "revision": record["revision"],
            },
        )
        return record


def render(template, variables):
    def replace(value):
        for key, item in variables.items():
            value = value.replace("{{" + key + "}}", str(item or ""))
        return value

    subject = replace(template["subject"]).replace("\r", " ").replace("\n", " ")
    return subject, "<div>" + escape(replace(template["body"])).replace(
        "\n", "<br>"
    ) + "</div>"


async def rejection_preview(db, org, application):
    settings = await preferences(db, org)
    template = next(
        (
            t
            for t in settings["templates"]
            if t["id"] == settings.get("defaultRejectionId")
            and t["category"] == "rejection"
        ),
        None,
    )
    if not template:
        raise HTTPException(
            409,
            "Ask an administrator to set a default rejection email before rejecting candidates.",
        )
    candidate = (
        await db.applicants.find_one(
            {"orgId": org, "applicantId": application["applicantId"]}
        )
        or {}
    )
    job = await db.jobs.find_one({"orgId": org, "jobId": application["jobId"]}) or {}
    company = await db.organizations.find_one({"orgId": org}) or {}
    email = candidate.get("email", "").strip()
    if "@" not in email or email.endswith("@placeholder.local"):
        raise HTTPException(
            422, "A valid candidate email is required for rejection notification."
        )
    variables = {
        "candidate_name": candidate.get("name", "Candidate"),
        "job_title": job.get("title", "Job"),
        "company": company.get("name", "Company"),
        "company_name": company.get("name", "Company"),
        "application_reference": application["applicationId"],
        "hr_contact": company.get("settings", {}).get("emailFrom", ""),
    }
    subject, html = render(template, variables)
    return {
        "templateId": template["id"],
        "templateName": template["name"],
        "to": email,
        "name": candidate.get("name", "Candidate"),
        "subject": subject,
        "html": html,
    }


async def prepare_rejection(db, org, application, actor):
    from .recruitment_worker import encrypt_recruitment_body
    import json

    preview = await rejection_preview(db, org, application)
    event_id = uuid4().hex
    intent = {
        **{
            k: preview[k]
            for k in ["templateId", "templateName", "to", "name", "subject"]
        },
        "eventId": event_id,
        "actorUserId": actor,
        "queued": False,
        "createdAt": now(),
        "payloadEncrypted": encrypt_recruitment_body(
            json.dumps(
                {
                    "to": preview["to"],
                    "html": preview["html"],
                    "workflow": {
                        "rejectionEventId": event_id,
                        "actorUserId": actor,
                        "templateId": preview["templateId"],
                    },
                }
            )
        ),
    }
    previous = application.get("rejectionMail")
    if (
        previous
        and not previous.get("queued")
        and application["currentStage"] != "REJECTED"
    ):
        return previous
    await db.applications.update_one(
        {"orgId": org, "applicationId": application["applicationId"]},
        {"$set": {"rejectionMail": intent}},
    )
    return intent


async def queue_rejection(db, application):
    from .recruitment_worker import RecruitmentOutbox

    intent = application.get("rejectionMail")
    if not intent or intent.get("queued"):
        return
    message = await RecruitmentOutbox(db).enqueue(
        org_id=application["orgId"],
        kind="workflow_rejection",
        entity_type="application",
        entity_key=application["applicationId"],
        to_email=intent["to"],
        to_name=intent["name"],
        subject=intent["subject"],
        payload_encrypted=intent["payloadEncrypted"],
        dedupe_key=application["orgId"] + ":rejection:" + intent["eventId"],
    )
    await db.recruit_email_outbox.update_one(
        {"orgId": application["orgId"], "messageId": message["messageId"]},
        {
            "$set": {
                "rejectionEventId": intent["eventId"],
                "actorUserId": intent["actorUserId"],
                "templateId": intent["templateId"],
            }
        },
    )
    await db.applications.update_one(
        {
            "orgId": application["orgId"],
            "applicationId": application["applicationId"],
            "rejectionMail.eventId": intent["eventId"],
        },
        {
            "$set": {
                "rejectionMail.queued": True,
                "rejectionMail.messageId": message["messageId"],
            }
        },
    )


async def traits(db, org, job, round, reviewer_id=None):
    identity = org + ":" + job + ":" + round
    if reviewer_id:
        personal = await db.hiring_traits.find_one({"_id": identity + ":reviewer:" + reviewer_id})
        if personal:
            return personal
    row = await db.hiring_traits.find_one({"_id": identity})
    return row or {
        "revision": 0,
        "traits": [
            {"id": key, "name": label, "description": "", "active": True}
            for key, label in DEFAULT_TRAITS[round]
        ],
    }


async def save_traits(db, user, job, round, payload, reviewer_id=None):
    suffix = ":reviewer:" + reviewer_id if reviewer_id else ""
    async with lease(db, user.org_id, ["traits:" + job + ":" + round + suffix]):
        current = await traits(db, user.org_id, job, round, reviewer_id)
        if current["revision"] != payload.expectedRevision:
            raise HTTPException(409, "Traits changed. Refresh before saving.")
        record = {
            "orgId": user.org_id,
            "jobId": job,
            "round": round,
            "revision": current["revision"] + 1,
            "traits": [trait.model_dump() for trait in payload.traits],
            "updatedBy": user.user_id,
            "reviewerId": reviewer_id,
            "updatedAt": now(),
        }
        await db.hiring_traits.update_one(
            {"_id": user.org_id + ":" + job + ":" + round + suffix},
            {"$set": record},
            upsert=True,
        )
        await AuditLogRepository(db).log(
            org_id=user.org_id,
            actor_user_id=user.user_id,
            action="hiring.traits_updated",
            resource_type="job",
            resource_id=job,
            details={"round": round, "reviewerId": reviewer_id, "revision": record["revision"]},
        )
        return record


async def delivery_allowed(db, message):
    org = message["orgId"]
    if message["kind"] == "workflow_rejection":
        app = await db.applications.find_one(
            {"orgId": org, "applicationId": message["entityKey"]}
        )
        return bool(
            app
            and app["currentStage"] == "REJECTED"
            and (app.get("rejectionMail") or {}).get("eventId")
            == message.get("rejectionEventId")
        )
    if message["kind"] == "workflow_share":
        from ..security.roles import effective_permissions

        actor = await db.users.find_one(
            {"orgId": org, "userId": message.get("actorUserId"), "isActive": True}
        )
        if not actor or not {"reports.view", "reports.export"}.issubset(
            await effective_permissions(db, actor)
        ):
            return False
        from ..security.deps import CurrentUser
        from .reporting import application_for

        recipient = await db.users.find_one(
            {"orgId": org, "userId": message.get("recipientUserId"), "isActive": True}
        )
        if not recipient:
            return False
        try:
            await application_for(
                db,
                CurrentUser(
                    recipient["userId"],
                    org,
                    recipient["role"],
                    await effective_permissions(db, recipient),
                    "",
                ),
                message["entityKey"],
            )
            await application_for(
                db,
                CurrentUser(
                    actor["userId"],
                    org,
                    actor["role"],
                    await effective_permissions(db, actor),
                    "",
                ),
                message["entityKey"],
            )
        except HTTPException:
            return False
        for reference in message.get("reportReferences", []):
            if reference["kind"] == "review":
                row = await db.recruit_reviews.find_one(
                    {
                        "orgId": org,
                        "reviewId": reference["id"],
                        "locked": True,
                        "applied": True,
                    }
                )
                if not row:
                    return False
            else:
                row = await db.report_versions.find_one(
                    {
                        "orgId": org,
                        "reportId": reference["id"],
                        "version": reference["version"],
                    }
                )
                if (
                    not row
                    or row.get("controlStatus") in {"Archived", "Invalidated"}
                    or row.get("status") != "Completed"
                ):
                    return False
        return True
    return False


async def shareable(db, user, key):
    from .reporting import application_for, public_metadata

    app, job = await application_for(db, user, key)
    candidate = (
        await db.applicants.find_one(
            {"orgId": user.org_id, "applicantId": app["applicantId"]}
        )
        or {}
    )
    items = []
    async for row in db.report_catalog.find(
        {"orgId": user.org_id, "applicationId": key, "status": "Completed"}
    ):
        version = (
            await db.report_versions.find_one(
                {
                    "orgId": user.org_id,
                    "reportId": row["reportId"],
                    "version": row["version"],
                }
            )
            or {}
        )
        if version.get("controlStatus") in {"Archived", "Invalidated"}:
            continue
        overview = (version.get("content") or {}).get("overview") or {}
        score = (
            "Unavailable"
            if overview.get("value") is None
            else str(overview["value"])
            + (
                " / " + str(overview["maximum"])
                if overview.get("maximum") is not None
                else ""
            )
        )
        items.append(
            {
                "id": row["reportId"],
                "kind": "report",
                "version": row["version"],
                "round": row["roundType"],
                "summary": str(candidate.get("name", "Candidate"))
                + " — "
                + str(job.get("title", "Job"))
                + " — "
                + row["roundType"]
                + " assessment report\nOverall score: "
                + score,
                "url": "/reports/"
                + row["reportId"]
                + "?version="
                + str(row["version"]),
            }
        )
    async for review in db.recruit_reviews.find(
        {"orgId": user.org_id, "applicationId": key, "locked": True, "applied": True}
    ):
        names = {
            trait["id"]: trait["name"]
            for trait in (review.get("traitSnapshot") or {}).get("traits", [])
        }
        ratings = "\n".join(
            names.get(key, key) + ": " + str(value) + " / 5"
            for key, value in review.get("scorecard", {}).items()
        )
        items.append(
            {
                "id": review["reviewId"],
                "kind": "review",
                "round": review["round"],
                "version": 1,
                "summary": review["round"].title()
                + " evaluation\nDecision: "
                + review["decision"]
                + "\nStrengths: "
                + review["strengths"]
                + "\nConcerns: "
                + review.get("concerns", "")
                + "\n"
                + review["comments"]
                + ("\nRatings:\n" + ratings if ratings else ""),
                "url": "/reports/applications/" + key,
            }
        )
    return {
        "items": items,
        "candidateName": candidate.get("name", "Candidate"),
        "jobTitle": job.get("title", "Job"),
    }


async def queue_share(db, user, key, payload, *, preview_only=False):
    import hashlib, json
    from .recruitment_worker import RecruitmentOutbox, encrypt_recruitment_body
    from ..security.deps import CurrentUser
    from ..security.roles import effective_permissions
    from .reporting import application_for

    recipient = await db.users.find_one(
        {
            "orgId": user.org_id,
            "userId": payload.recipientUserId,
            "isActive": True,
            "role": {"$in": ["hr", "admin", "super_admin"]},
        }
    )
    if not recipient:
        raise HTTPException(422, "Choose an active HR recipient in this company.")
    recipient_context = CurrentUser(
        recipient["userId"],
        user.org_id,
        recipient["role"],
        await effective_permissions(db, recipient),
        "",
    )
    await application_for(db, recipient_context, key)
    available = (await shareable(db, user, key))["items"]
    selected = [item for item in available if item["id"] in payload.reportIds]
    if len(selected) != len(set(payload.reportIds)) or not selected:
        raise HTTPException(422, "Select finalized reports you can access.")
    template = next(
        (
            t
            for t in (await preferences(db, user.org_id))["templates"]
            if t["id"] == payload.templateId and t["category"] == "report_share"
        ),
        None,
    )
    if not template:
        raise HTTPException(422, "Choose a company-side report sharing template.")
    # Links always require the recipient's own authenticated session.
    from ..config import settings

    base = settings.hiring_report_base_url.rstrip("/")
    summary = "\n\n".join(
        item["summary"] + "\n" + base + item["url"] for item in selected
    )
    subject, html = render(
        template,
        {
            "candidate_name": (await shareable(db, user, key))["candidateName"],
            "report_summary": summary,
            "hr_contact": recipient.get("name", "HR"),
        },
    )
    email = recipient.get("email", "")
    if "@" not in email or email.endswith("@placeholder.local"):
        raise HTTPException(422, "The HR recipient needs a valid email address.")
    if preview_only:
        return {"to": email, "subject": subject, "html": html, "reports": selected}
    if payload.provider == "gmail":
        from .google_oauth import access_token, GMAIL_SCOPE

        await access_token(db, user.org_id, user.user_id, required_scope=GMAIL_SCOPE)
    digest = hashlib.sha256(
        json.dumps(
            [key, selected, recipient["userId"], payload.provider, payload.requestId],
            sort_keys=True,
        ).encode()
    ).hexdigest()
    msg = await RecruitmentOutbox(db).enqueue(
        org_id=user.org_id,
        kind="workflow_share",
        entity_type="application",
        entity_key=key,
        to_email=email,
        to_name=recipient.get("name", "HR"),
        subject=subject,
        payload_encrypted=encrypt_recruitment_body(
            json.dumps(
                {
                    "to": email,
                    "html": html,
                    "workflow": {
                        "actorUserId": user.user_id,
                        "recipientUserId": recipient["userId"],
                        "provider": payload.provider,
                        "reportReferences": selected,
                        "templateId": payload.templateId,
                    },
                }
            )
        ),
        dedupe_key=user.org_id + ":share:" + digest,
    )
    await db.recruit_email_outbox.update_one(
        {"orgId": user.org_id, "messageId": msg["messageId"]},
        {
            "$set": {
                "actorUserId": user.user_id,
                "recipientUserId": recipient["userId"],
                "provider": payload.provider,
                "reportReferences": selected,
                "templateId": payload.templateId,
            }
        },
    )
    await AuditLogRepository(db).log(
        org_id=user.org_id,
        actor_user_id=user.user_id,
        action="reports.share_queued",
        resource_type="application",
        resource_id=key,
        details={
            "messageId": msg["messageId"],
            "reports": payload.reportIds,
            "recipientUserId": recipient["userId"],
        },
    )
    return {
        "messageId": msg["messageId"],
        "status": msg["status"],
        "preview": {"to": email, "subject": subject, "html": html},
    }


async def notify_hr_handoff(db, org, key):
    from ..models.recruitment import RecruitmentRepository

    app = await db.applications.find_one({"orgId": org, "applicationId": key})
    if not app:
        return
    job = await db.jobs.find_one({"orgId": org, "jobId": app["jobId"]}) or {}
    required = set(job.get("requiredInterviewRounds") or ["technical", "managerial"])
    reviews = [
        r
        async for r in db.recruit_reviews.find(
            {"orgId": org, "applicationId": key, "locked": True, "applied": True}
        )
    ]
    if not required.issubset({r["round"] for r in reviews}):
        return
    event = (
        "hr-handoff:"
        + key
        + ":"
        + ":".join(sorted(r["reviewId"] for r in reviews if r["round"] in required))
    )
    from ..security.deps import CurrentUser
    from ..security.roles import effective_permissions
    from .reporting import application_for

    async for recipient in db.users.find(
        {"orgId": org, "role": "hr", "isActive": True}
    ):
        await RecruitmentRepository(db, org).notify(
            recipient["userId"],
            event,
            "reports_ready_for_hr",
            reviews[-1]["interviewId"],
            key,
        )
