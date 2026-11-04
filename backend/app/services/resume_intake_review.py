"""A persisted human-confirmation saga with deterministic candidate/app IDs."""
from __future__ import annotations
import uuid
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError
from ..models.resume_intake import IntakeRepository, fenced_claim, now, digest
from ..models.jobs import BackgroundJobRepository
from ..schemas.resume_intake import CandidateProfile, REVIEWABLE
from ..security.deps import CurrentUser
from ..security.roles import get_permissions_for_role
from .resume_intake import item_for, job_for, get_limits, matches, audit
from .resume_intake_ats import score
from .resume_intake_llm import evaluate
from .pii import phone_digits_variants


def stable_id(org, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"primehire-v2:{org}:{key}"))


async def save_review(db, user, item_id, request):
    item, _ = await item_for(db, user, item_id, write=True)
    async with fenced_claim(db, user.org_id, [f"item:{item_id}"]):
        item = await IntakeRepository(db).get_item(item_id, user.org_id)
        if item["status"] not in REVIEWABLE - {"completed", "duplicate"}:
            raise HTTPException(409, "This file is not awaiting profile review.")
        reviewed_profile = request.profile.model_dump(mode="json")
        from .resume_intake_ats import profile_fingerprint
        scoring_changed = profile_fingerprint(reviewed_profile) != profile_fingerprint(item.get('profile',{}))
        invalidation = {'atsStale':True,'atsState':'pending','atsPreviewHash':None} if scoring_changed else {}
        updated = await IntakeRepository(db).patch_item(item_id, user.org_id,
            {"profile": reviewed_profile, "confidence": {key: 'reviewed' for key,value in reviewed_profile.items() if value not in (None,'',[])}, "reviewedBy": user.user_id,
             **invalidation}, request.expectedRevision)
        batch=await IntakeRepository(db).get_batch(item['batchId'],user.org_id)
        if batch.get('atsRange'):
            from .resume_intake_selection import enqueue_score
            target=await job_for(db,user,item['jobId'])
            await enqueue_score(db,updated,target)
            updated=await IntakeRepository(db).get_item(item_id,user.org_id)
        await audit(db, user, "review_saved", item_id, {"revision": updated["revision"]})
        return updated


async def confirm(db, user, item_id, request=None, *, enqueue_only=False):
    repo = IntakeRepository(db)
    item, job = await item_for(db, user, item_id, existing_write=True)
    prior_app_id = item.get("applicationId") or item.get("confirmation", {}).get("applicationId")
    prior_app = await db["applications"].find_one({"orgId": user.org_id, "applicationId": prior_app_id}) if prior_app_id else None
    if not prior_app:
        job = await job_for(db, user, item["jobId"], write=True)
    profile = request.profile.model_dump(mode="json") if request else item.get("confirmation", {}).get("profile", {})
    if item["status"] == "confirming":
        if request and profile != item["confirmation"]["profile"]:
            raise HTTPException(409, "Confirmation is already in progress. Its reviewed profile cannot change.")
        profile = item["confirmation"]["profile"]
    validated = CandidateProfile.model_validate(profile)
    if len(validated.name) < 2 or not (validated.email or validated.phone):
        raise HTTPException(422, "Confirmation requires a name and a valid email or phone.")
    keys = [f"item:{item_id}",'ats-range:'+item['batchId']] + ([f"email:{validated.email}"] if validated.email else []) + [f"phone:{digits}" for digits in phone_digits_variants(validated.phone)]
    async with fenced_claim(db, user.org_id, keys):
        item = await repo.get_item(item_id, user.org_id)
        if item["status"] in {"completed", "duplicate"} and item.get("applicationId"):
            return item
        if item["status"] == "confirming":
            context = item["confirmation"]
            profile = context["profile"]
        else:
            if not request or item["status"] not in REVIEWABLE:
                raise HTTPException(409, "Parse and review this resume before confirmation.")
            if item.get("scanStatus") != "clean":
                raise HTTPException(409, "Security scanning must complete before confirmation.")
            from .resume_intake_selection import require_selection
            batch=await repo.get_batch(item['batchId'],user.org_id)
            decision=require_selection(item,batch,job,profile,request.atsRangeRevision)
            choices = await matches(db, user.org_id, profile)
            if item.get("knownCandidateId"):
                known = await db["applicants"].find_one({"orgId": user.org_id, "applicantId": item["knownCandidateId"]})
                if not known:
                    raise HTTPException(409, "The associated candidate was removed.")
                if not any(c["applicantId"] == known["applicantId"] for c in choices):
                    choices.append(known)
            requested = request.candidateId
            if item.get("knownCandidateId"):
                requested = item["knownCandidateId"]
            exact = [c for c in choices if validated.email and c.get("email", "").lower() == validated.email]
            if requested == "new" and exact:
                raise HTTPException(409, "This email already identifies an existing candidate.")
            if requested and requested != "new" and requested not in {c["applicantId"] for c in choices}:
                raise HTTPException(409, "The selected candidate does not match this contact information.")
            if len(choices) > 1 and not requested:
                raise HTTPException(409, "Email and phone match different candidates. Choose the correct candidate explicitly.")
            if choices and not requested and not exact and any(c.get("name", "").casefold() != validated.name.casefold() for c in choices):
                raise HTTPException(409, "Phone match requires review. Choose an existing candidate or confirm a new person.")
            candidate = next((c for c in choices if c["applicantId"] == requested), None) if requested and requested != "new" else choices[0] if choices and requested != "new" else None
            applicant_id = candidate["applicantId"] if candidate else stable_id(user.org_id, f"candidate:{digest(user.org_id, validated.email)}:{item_id}")
            previous = await db["applications"].find_one({"orgId": user.org_id, "jobId": job["jobId"], "applicantId": applicant_id})
            context = {"profile": profile, "applicantId": applicant_id,
                "applicationId": previous["applicationId"] if previous else stable_id(user.org_id, f"application:{job['jobId']}:{applicant_id}"),
                "existingApplication": bool(previous), "existingCandidate": bool(candidate), "actorUserId": user.user_id,
                'ats':item['ats'],'atsRangeRevision':decision['rangeRevision']}
            item = await repo.patch_item(item_id, user.org_id, {"status": "confirming", "confirmation": context}, request.expectedRevision)
            # Journal before side effects. A crash resumes this same confirmed intent.
            await BackgroundJobRepository(db).enqueue(org_id=user.org_id, kind="resume_intake_confirm",
                entity_type="resume_intake_item", entity_key=item_id, payload={"itemId": item_id},
                dedupe_key=f"{user.org_id}:resume_intake_confirm:{item_id}:{item['revision']}")
        if enqueue_only:
            return item
        candidate_id, application_id = context["applicantId"], context["applicationId"]
        job = await job_for(db, user, item["jobId"], write=not bool(prior_app))
        # Recheck the human-selected range under the shared batch lease before
        # any person/application write, including delayed or replayed jobs.
        if context.get('atsRangeRevision') is not None or not prior_app:
            from .resume_intake_selection import require_selection
            batch=await repo.get_batch(item['batchId'],user.org_id)
            require_selection(item,batch,job,context['profile'],context.get('atsRangeRevision'))
        stamp = now()
        profile = CandidateProfile.model_validate(context["profile"]).model_dump(mode="json")
        person = {"_id": candidate_id, "applicantId": candidate_id, "orgId": user.org_id,
            "name": profile["name"], "email": profile["email"] or f"phone-only-{candidate_id}@placeholder.local",
            "phone": profile["phone"], "phoneDigits": phone_digits_variants(profile["phone"]), "profile": profile,
            "resume": {"fileId": item.get("fileId", ""), "fileName": item["fileName"], "parsedJson": profile},
            "consent": {"given": True, "source": item["source"], "givenAt": stamp}, "tags": [],
            "createdAt": stamp, "updatedAt": stamp, "retentionUntil": item["retentionUntil"], "intakeManaged": True}
        try:
            await db["applicants"].update_one({"orgId": user.org_id, "applicantId": candidate_id}, {"$setOnInsert": person}, upsert=True)
        except DuplicateKeyError:
            raise HTTPException(409, "Candidate identity changed concurrently. Refresh and resolve the duplicate.") from None
        existing = await db["applications"].find_one({"orgId": user.org_id, "jobId": job["jobId"], "applicantId": candidate_id})
        duplicate = context["existingApplication"] or (existing is not None and existing.get("intakeItemId") != item_id)
        ats = existing.get("scoreBreakdown", {}).get("ats") if duplicate and existing else None
        if not duplicate:
            application = {"_id": application_id, "applicationId": application_id, "orgId": user.org_id,
                "jobId": job["jobId"], "applicantId": candidate_id, "intakeItemId": item_id,
                "applicationSource": item["source"], "currentStage": "PARSED", "stageEnteredAt": stamp,
                "candidateKey": None, "assignedReviewers": [], "status": "active", "createdAt": stamp,
                "updatedAt": stamp, "matchScore": None, "needsReview": True,
                "reviewReasons": ["Human hiring decision required."],
                "scoreBreakdown": {"atsStatus": "pending", "final": None, "scoreVersion": "module2-v1"}}
            try:
                outcome = await db["applications"].update_one({"orgId": user.org_id, "applicationId": application_id}, {"$setOnInsert": application}, upsert=True)
                if outcome.upserted_id is None:
                    concurrent = await db["applications"].find_one({"orgId": user.org_id, "applicationId": application_id})
                    if concurrent.get("intakeItemId") != item_id:
                        duplicate = True
                        ats = concurrent.get("scoreBreakdown", {}).get("ats")
            except DuplicateKeyError:
                existing = await db["applications"].find_one({"orgId": user.org_id, "jobId": job["jobId"], "applicantId": candidate_id})
                if not existing:
                    raise
                application_id, duplicate = existing["applicationId"], True
                ats = existing.get("scoreBreakdown", {}).get("ats")
            if not duplicate:
                history_id = stable_id(user.org_id, f"history:{application_id}:created")
                await db["stage_history"].update_one({"_id": history_id}, {"$setOnInsert": {
                    "historyId": history_id, "orgId": user.org_id, "applicationId": application_id,
                    "fromStage": "", "toStage": "PARSED", "transitionAt": stamp, "actorUserId": user.user_id,
                    "reason": "Candidate/application confirmed by resume reviewer.", "metadata": {"intakeItemId": item_id}, "isOverride": False}}, upsert=True)
                await repo.items.update_one({"_id": item_id, "orgId": user.org_id, "revision": item["revision"]},
                    {"$set": {"applicantId": candidate_id, "applicationId": application_id}})
                limits = await get_limits(db, user.org_id)
                import asyncio
                ats = dict(context['ats']) if context.get('ats') else await evaluate(db, user.org_id, profile, item.get("rawText", ""), job, limits, application_id, local_score=score)
                ats["evaluatedAt"] = stamp.isoformat()
                await db["applications"].update_one({"orgId": user.org_id, "applicationId": application_id}, {"$set": {
                    "matchScore": ats["overall"], "scoreBreakdown": {"ats": ats, "atsStatus": "done", "final": ats["overall"],
                        "keyword": ats["breakdown"]["keyword"], "matched": ats["matchedSkills"], "missing": ats["missingSkills"], "scoreVersion": "module2-v1"}, "updatedAt": stamp}})
        elif existing:
            application_id = existing["applicationId"]
        if item.get("fileId"):
            await db["applicants"].update_one({"orgId": user.org_id, "applicantId": candidate_id},
                {"$set": {"resume": person["resume"], "updatedAt": stamp}})
        # Record the application side effect before marking the ledger complete;
        # replay cannot lose this audit if the process dies between writes.
        audit_id = stable_id(user.org_id, f"audit:{item_id}:confirmed")
        await db["audit_log"].update_one({"_id": audit_id}, {"$setOnInsert": {"auditId": audit_id,
            "orgId": user.org_id, "actorUserId": user.user_id, "action": "resume_intake.confirm",
            "resourceType": "resume_intake", "resourceId": item_id, "details": {"applicationId": application_id,
                "applicantId": candidate_id, "duplicate": duplicate}, "createdAt": stamp, "ipAddress": ""}}, upsert=True)
        updated = await repo.patch_item(item_id, user.org_id, {"status": "duplicate" if duplicate else "completed",
            "profile": profile, "applicantId": candidate_id, "applicationId": application_id, "ats": ats,
            "confirmedBy": user.user_id, "confirmedAt": stamp, "error": "Candidate already exists for this job." if duplicate else None}, item["revision"])
        await repo.refresh_summary(item["batchId"], user.org_id)
        return updated


async def resume_confirmation(db, job):
    item = await IntakeRepository(db).get_item(job["payload"]["itemId"], job["orgId"])
    if not item or item["status"] != "confirming":
        return {"skipped": "confirmation finished"}
    actor_id = item["confirmation"]["actorUserId"]
    actor = await db["users"].find_one({"orgId": job["orgId"], "userId": actor_id, "isActive": True})
    if not actor:
        await IntakeRepository(db).patch_item(item["_id"], job["orgId"], {"status": "confirmation_paused", "error": "Reviewer account is unavailable. An authorized reviewer can resume confirmation."}, item["revision"])
        return {"blocked": "confirmation actor unavailable"}
    user = CurrentUser(actor_id, job["orgId"], actor["role"], get_permissions_for_role(actor["role"]), "")
    if "resumes.upload" not in user.permissions:
        await IntakeRepository(db).patch_item(item["_id"], job["orgId"], {"status": "confirmation_paused", "error": "Reviewer permission changed. An authorized reviewer can resume confirmation."}, item["revision"])
        return {"blocked": "confirmation permission changed"}
    try:
        result = await confirm(db, user, item["_id"])
        return {"status": result["status"]}
    except HTTPException as exc:
        if exc.status_code == 409 and exc.detail == 'Another request is processing this candidate. Retry shortly.':
            raise  # A short lease collision is retried by the durable worker.
        await db["resume_intake_items"].update_one({"_id": item["_id"], "status": "confirming", "orgId": job["orgId"]},
            {"$set": {"status": "confirmation_paused", "error": str(exc.detail), "updatedAt": now()}, "$inc": {"revision": 1}})
        raise
    except Exception:
        await db["resume_intake_items"].update_one({"_id": item["_id"], "status": "confirming", "orgId": job["orgId"]},
            {"$set": {"status": "confirmation_paused", "error": "ATS or persistence failed. Candidate/application records are retained; retry confirmation.", "updatedAt": now()}, "$inc": {"revision": 1}})
        raise
