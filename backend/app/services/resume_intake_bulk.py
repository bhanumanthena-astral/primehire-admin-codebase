"""Explicit human bulk approval snapshots; changed/unready rows are skipped."""
from fastapi import HTTPException
from ..models.resume_intake import IntakeRepository
from ..schemas.resume_intake import ReviewRequest
from ..security.deps import CurrentUser
from ..security.roles import get_permissions_for_role
from .resume_intake_review import confirm


async def prepare_bulk(db, job):
    payload, org = job["payload"], job["orgId"]
    actor = await db["users"].find_one({"orgId": org, "userId": payload["actorUserId"], "isActive": True})
    if not actor or "resumes.upload" not in get_permissions_for_role(actor["role"]):
        await db["resume_intake_batches"].update_one({"_id": payload["batchId"], "orgId": org},
            {"$set": {"bulkApprovalRunning": False, "error": "Bulk reviewer is unavailable. An authorized reviewer can approve again."}})
        return {"blocked": "approval actor unavailable"}
    user = CurrentUser(actor["userId"], org, actor["role"], get_permissions_for_role(actor["role"]), "")
    batch=await IntakeRepository(db).get_batch(payload['batchId'],org)
    if not batch or not batch.get('atsRange') or payload.get('atsRangeRevision')!=batch.get('atsRangeRevision',0):
        await db['resume_intake_batches'].update_one({'_id':payload['batchId'],'orgId':org},{'$set':{
            'bulkApprovalRunning':False,'error':'ATS range changed or is missing. Review and approve the batch again.'}})
        return {'blocked':'ATS range changed'}
    queued, skipped = 0, 0
    query = {"orgId": org, "batchId": payload["batchId"], "status": {"$in": ["review_required", "duplicate_suspected"]}, "updatedAt": {"$lte": payload["approvedAt"]}, "atsUpdatedAt": {"$lte": payload["approvedAt"]}}
    async for item in db["resume_intake_items"].find(query).sort("rowNumber", 1).limit(5500):
        try:
            request = ReviewRequest(expectedRevision=item["revision"], profile=item["profile"],atsRangeRevision=payload['atsRangeRevision'])
            await confirm(db, user, item["_id"], request, enqueue_only=True)
            queued += 1
        except HTTPException:
            skipped += 1
    await db["resume_intake_batches"].update_one({"_id": payload["batchId"], "orgId": org}, {"$set": {
        "bulkApprovalResult": {"queued": queued, "skipped": skipped}, "bulkApprovalRunning": False}})
    await IntakeRepository(db).refresh_summary(payload["batchId"], org)
    return {"queued": queued, "skipped": skipped}
