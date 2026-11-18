"""Additive CCC indexes and repair of cached, distinct hired-position counts."""

from app.models.recruitment import lease, now


async def upgrade(db):
    for collection, keys, name in [
        (
            "hiring_traits",
            [("orgId", 1), ("jobId", 1), ("round", 1)],
            "hiring_trait_scope",
        ),
        (
            "applications",
            [("orgId", 1), ("jobId", 1), ("currentStage", 1), ("applicantId", 1)],
            "hiring_position_counts",
        ),
        (
            "applications",
            [("orgId", 1), ("jobId", 1), ("applicationSource", 1)],
            "hiring_application_sources",
        ),
    ]:
        await db[collection].create_index(keys, name=name)
    if await db.migration_runs.find_one({"_id": "ccc_hiring_workflow_v1"}):
        return
    from app.services.pii import phone_digits_variants

    async for candidate in db.applicants.find({}):
        changes = {"normalizedEmail": str(candidate.get("email") or "").strip().lower()}
        if not candidate.get("phoneDigits"):
            changes["phoneDigits"] = phone_digits_variants(candidate.get("phone", ""))
        await db.applicants.update_one(
            {"orgId": candidate["orgId"], "applicantId": candidate["applicantId"]},
            {"$set": changes},
        )
    async for job in db.jobs.find({"positionsTotal": {"$exists": True}}):
        async with lease(db, job["orgId"], ["position-count:" + job["jobId"]]):
            hired = {
                row.get("applicantId") or row["applicationId"]
                async for row in db.applications.find(
                    {
                        "orgId": job["orgId"],
                        "jobId": job["jobId"],
                        "currentStage": "HIRED",
                    },
                    {"applicantId": 1, "applicationId": 1},
                )
            }
            await db.jobs.update_one(
                {"orgId": job["orgId"], "jobId": job["jobId"]},
                {"$set": {"positionsFilled": len(hired)}},
            )
    await db.migration_runs.update_one(
        {"_id": "ccc_hiring_workflow_v1"}, {"$set": {"completedAt": now()}}, upsert=True
    )
