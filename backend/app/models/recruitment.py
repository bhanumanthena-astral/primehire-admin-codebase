"""Tenant-scoped recruitment repositories and short workflow leases."""

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

INDEXES = {
    "recruit_email_outbox": [
        ([("orgId", 1), ("dedupeKey", 1)], {"unique": True}),
        ([("status", 1), ("nextRetryAt", 1)], {}),
    ],
    "recruit_interviews": [
        ([("orgId", 1), ("interviewId", 1)], {"unique": True}),
        (
            [("orgId", 1), ("applicationId", 1), ("round", 1), ("active", 1)],
            {"unique": True, "partialFilterExpression": {"active": True}},
        ),
        ([("orgId", 1), ("interviewerId", 1), ("startsAt", 1)], {}),
        ([("status", 1), ("reminderAt", 1)], {}),
    ],
    "recruit_reviews": [([("orgId", 1), ("interviewId", 1)], {"unique": True})],
    "recruit_notifications": [
        ([("orgId", 1), ("userId", 1), ("eventKey", 1)], {"unique": True}),
        ([("orgId", 1), ("userId", 1), ("createdAt", -1)], {}),
    ],
    "recruit_profiles": [([("orgId", 1), ("userId", 1)], {"unique": True})],
    "recruit_questions": [([("orgId", 1), ("interviewId", 1)], {"unique": True})],
    "recruit_leases": [([("expiresAt", 1)], {"expireAfterSeconds": 0})],
}


def now():
    return datetime.now(timezone.utc)


def aware(value):
    return (
        value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value
    )


def clean(value):
    """Mongo stores naive UTC datetimes; responses always carry UTC offsets."""
    if isinstance(value, datetime):
        return aware(value)
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


class RecruitmentRepository:
    def __init__(self, db, org):
        self.db, self.org = db, org

    async def interview(self, key):
        row = await self.db["recruit_interviews"].find_one(
            {"orgId": self.org, "interviewId": key}
        )
        if not row:
            raise HTTPException(404, "Interview not found")
        return row

    async def update(self, key, revision, changes):
        row = await self.db["recruit_interviews"].find_one_and_update(
            {"orgId": self.org, "interviewId": key, "revision": revision},
            {"$set": {**changes, "updatedAt": now()}, "$inc": {"revision": 1}},
            return_document=ReturnDocument.AFTER,
        )
        if not row:
            raise HTTPException(
                409, "This interview changed. Refresh before trying again."
            )
        return row

    async def notify(self, user, key, kind, interview_id, application_id):
        if not user:
            return
        query = {"orgId": self.org, "userId": user, "eventKey": key}
        await self.db["recruit_notifications"].update_one(
            query,
            {
                "$setOnInsert": {
                    **query,
                    "notificationId": uuid.uuid4().hex,
                    "kind": kind,
                    "interviewId": interview_id,
                    "applicationId": application_id,
                    "createdAt": now(),
                    "readAt": None,
                }
            },
            upsert=True,
        )


@asynccontextmanager
async def lease(db, org, keys):
    owner = uuid.uuid4().hex
    held = []
    try:
        for key in sorted(set(keys)):
            identity = f"{org}:recruit:{key}"
            try:
                row = await db["recruit_leases"].find_one_and_update(
                    {
                        "_id": identity,
                        "$or": [{"expiresAt": {"$lte": now()}}, {"owner": owner}],
                    },
                    {
                        "$set": {
                            "owner": owner,
                            "expiresAt": now() + timedelta(seconds=300),
                        }
                    },
                    upsert=True,
                    return_document=ReturnDocument.AFTER,
                )
            except DuplicateKeyError:
                raise HTTPException(
                    409,
                    "Another scheduling or review request is running. Retry shortly.",
                ) from None
            if not row or row["owner"] != owner:
                raise HTTPException(409, "Workflow is busy. Retry shortly.")
            held.append(identity)
        yield
    finally:
        for identity in held:
            await db["recruit_leases"].delete_one({"_id": identity, "owner": owner})
