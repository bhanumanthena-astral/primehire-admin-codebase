"""Hiring model repositories: jobs, applicants, applications, stage history, and audit log."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import re
import uuid

from ..schemas.hiring import Stage, JobStatus, ApplicationStatus

#: Transition shim: pre-lifecycle `status` query values map onto the
#: JobLifecycle. Removed once all clients send lifecycle values.
LEGACY_STATUS_TO_LIFECYCLE = {
    "open": "OPEN",
    "on_hold": "ON_HOLD",
    "closed": "CLOSED",
    "filled": "CLOSED",
    "OPEN": "OPEN",
    "ON_HOLD": "ON_HOLD",
    "CLOSED": "CLOSED",
    "ARCHIVED": "ARCHIVED",
    "DRAFT": "DRAFT",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Canonical state machine transition table (§6 DECISIONS.md)
VALID_TRANSITIONS: dict[Stage, set[Stage]] = {
    Stage.RESUME_UPLOADED: {Stage.PARSED, Stage.REJECTED, Stage.WITHDRAWN},
    Stage.PARSED: {Stage.SHORTLISTED, Stage.TALENT_POOL, Stage.REJECTED, Stage.WITHDRAWN},
    Stage.SHORTLISTED: {Stage.ASSESSMENT_SENT, Stage.TALENT_POOL, Stage.REJECTED, Stage.WITHDRAWN},
    Stage.TALENT_POOL: {Stage.SHORTLISTED, Stage.REJECTED},
    Stage.ASSESSMENT_SENT: {Stage.ASSESSMENT_COMPLETED, Stage.REJECTED, Stage.WITHDRAWN},
    Stage.ASSESSMENT_COMPLETED: {
        Stage.ROUND1_PENDING_ASSIGNMENT,
        Stage.REJECTION_PENDING_HR_REVIEW,
        Stage.TALENT_POOL,
        Stage.WITHDRAWN,
    },
    Stage.ROUND1_PENDING_ASSIGNMENT: {Stage.ROUND1_SCHEDULED, Stage.WITHDRAWN},
    Stage.ROUND1_SCHEDULED: {Stage.ROUND1_REVIEW_PENDING, Stage.WITHDRAWN},
    Stage.ROUND1_REVIEW_PENDING: {
        Stage.ROUND2_PENDING_ASSIGNMENT,
        Stage.HR_ROUND,
        Stage.REJECTION_PENDING_HR_REVIEW,
        Stage.WITHDRAWN,
    },
    Stage.ROUND2_PENDING_ASSIGNMENT: {Stage.ROUND2_SCHEDULED, Stage.WITHDRAWN},
    Stage.ROUND2_SCHEDULED: {Stage.ROUND2_REVIEW_PENDING, Stage.WITHDRAWN},
    Stage.ROUND2_REVIEW_PENDING: {
        Stage.HR_ROUND,
        Stage.REJECTION_PENDING_HR_REVIEW,
        Stage.WITHDRAWN,
    },
    Stage.HR_ROUND: {Stage.OFFER, Stage.REJECTION_PENDING_HR_REVIEW, Stage.WITHDRAWN},
    Stage.REJECTION_PENDING_HR_REVIEW: {
        Stage.REJECTED,
        Stage.TALENT_POOL,
        Stage.ROUND1_PENDING_ASSIGNMENT,
        Stage.ROUND2_PENDING_ASSIGNMENT,
        Stage.HR_ROUND,
    },
    Stage.OFFER: {Stage.HIRED, Stage.REJECTED, Stage.WITHDRAWN},
    Stage.HIRED: set(),
    Stage.REJECTED: set(),
    Stage.WITHDRAWN: set(),
    Stage.ON_HOLD: {
        Stage.SHORTLISTED,
        Stage.ASSESSMENT_SENT,
        Stage.ROUND1_PENDING_ASSIGNMENT,
        Stage.ROUND1_SCHEDULED,
        Stage.ROUND2_PENDING_ASSIGNMENT,
        Stage.ROUND2_SCHEDULED,
        Stage.HR_ROUND,
        Stage.OFFER,
        Stage.REJECTED,
        Stage.WITHDRAWN,
    },
}


def can_transition(from_stage: Stage, to_stage: Stage, is_override: bool = False) -> bool:
    """Check if transition is permitted by the state machine."""
    if is_override:
        return True
    if to_stage == Stage.ON_HOLD and from_stage not in (Stage.HIRED, Stage.REJECTED, Stage.WITHDRAWN):
        return True
    allowed = VALID_TRANSITIONS.get(from_stage, set())
    return to_stage in allowed


class JobRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["jobs"]

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        if "jobId" not in record:
            record["jobId"] = str(uuid.uuid4())
        now = utcnow()
        record.setdefault("createdAt", now)
        record.setdefault("updatedAt", now)
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get_by_id(self, job_id: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"jobId": job_id, "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def get_by_key(self, job_key: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"jobKey": job_key, "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def update(self, job_id: str, updates: dict[str, Any], org_id: str) -> dict[str, Any] | None:
        upd = dict(updates)
        upd["updatedAt"] = utcnow()
        await self.coll.update_one({"jobId": job_id, "orgId": org_id}, {"$set": upd})
        return await self.get_by_id(job_id, org_id)

    async def list_by_org(
        self, org_id: str, status: str | None = None, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"orgId": org_id}
        if status:
            mapped = LEGACY_STATUS_TO_LIFECYCLE.get(status, status)
            query["$or"] = [{"lifecycleStatus": mapped}, {"lifecycleStatus": {"$exists": False}, "status": status}]
        cursor = self.coll.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def count_by_org(self, org_id: str, status: str | None = None) -> int:
        query: dict[str, Any] = {"orgId": org_id}
        if status:
            mapped = LEGACY_STATUS_TO_LIFECYCLE.get(status, status)
            query["$or"] = [{"lifecycleStatus": mapped}, {"lifecycleStatus": {"$exists": False}, "status": status}]
        return await self.coll.count_documents(query)

    #: Allowlisted sort keys for the Jobs list (PRD §15-16).
    SORT_FIELDS = frozenset({"createdAt", "openedAt", "closesAt", "title", "companyName"})

    def _search_query(
        self,
        org_id: str,
        *,
        status: str | None = None,
        q: str | None = None,
        company: str | None = None,
        department: str | None = None,
        assignee: str | None = None,
        experience: float | None = None,
        work_mode: str | None = None,
        opened_from: datetime | None = None,
        opened_to: datetime | None = None,
        closes_from: datetime | None = None,
        closes_to: datetime | None = None,
    ) -> dict[str, Any]:
        """Build the ANDed Jobs-list filter (PRD §15 search + §16 filters).

        Text matches are case-insensitive substrings (covers exact, partial,
        starts-with and contains). `experience` keeps jobs whose band covers
        the given years; docs without a band are excluded when it is set.
        """
        query: dict[str, Any] = {"orgId": org_id}
        if status:
            mapped = LEGACY_STATUS_TO_LIFECYCLE.get(status, status)
            query["$or"] = [{"lifecycleStatus": mapped}, {"lifecycleStatus": {"$exists": False}, "status": status}]
        if q and q.strip():
            rx = {"$regex": re.escape(q.strip()), "$options": "i"}
            query["$and"] = query.get("$and", [])
            query["$and"].append({"$or": [
                {"jobKey": rx}, {"jobId": rx}, {"title": rx}, {"jobRole": rx},
                {"companyName": rx}, {"assigneeEmail": rx}, {"assigneeUserId": rx},
            ]})
        if company and company.strip():
            query["companyName"] = {"$regex": re.escape(company.strip()), "$options": "i"}
        if department and department.strip():
            query["department"] = {"$regex": re.escape(department.strip()), "$options": "i"}
        if assignee and assignee.strip():
            rx = {"$regex": re.escape(assignee.strip()), "$options": "i"}
            query["$and"] = query.get("$and", [])
            query["$and"].append({"$or": [{"assigneeUserId": rx}, {"assigneeEmail": rx}]})
        if experience is not None:
            query["minExperienceYears"] = {"$lte": experience}
            query["maxExperienceYears"] = {"$gte": experience}
        if work_mode:
            query["workMode"] = work_mode
        if opened_from is not None or opened_to is not None:
            band: dict[str, Any] = {}
            if opened_from is not None:
                band["$gte"] = opened_from
            if opened_to is not None:
                band["$lte"] = opened_to
            query["openedAt"] = band
        if closes_from is not None or closes_to is not None:
            band = {}
            if closes_from is not None:
                band["$gte"] = closes_from
            if closes_to is not None:
                band["$lte"] = closes_to
            query["closesAt"] = band
        return query

    async def search(
        self,
        org_id: str,
        *,
        status: str | None = None,
        q: str | None = None,
        company: str | None = None,
        department: str | None = None,
        assignee: str | None = None,
        experience: float | None = None,
        work_mode: str | None = None,
        opened_from: datetime | None = None,
        opened_to: datetime | None = None,
        closes_from: datetime | None = None,
        closes_to: datetime | None = None,
        sort: str = "createdAt",
        order: str = "desc",
        skip: int = 0,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        query = self._search_query(
            org_id, status=status, q=q, company=company, department=department,
            assignee=assignee, experience=experience, work_mode=work_mode,
            opened_from=opened_from, opened_to=opened_to,
            closes_from=closes_from, closes_to=closes_to,
        )
        direction = -1 if order == "desc" else 1
        cursor = self.coll.find(query).sort(sort, direction).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def count_search(self, org_id: str, **filters: Any) -> int:
        return await self.coll.count_documents(self._search_query(org_id, **filters))

    async def list_ids(self, org_id: str, limit: int = 1000) -> list[str]:
        cursor = self.coll.find({"orgId": org_id}, {"jobId": 1}).limit(limit)
        return [str(d.get("jobId")) async for d in cursor if d.get("jobId")]


class ApplicantRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["applicants"]

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        if "applicantId" not in record:
            record["applicantId"] = str(uuid.uuid4())
        record["email"] = record["email"].strip().lower()
        now = utcnow()
        record.setdefault("createdAt", now)
        record.setdefault("updatedAt", now)
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get_by_id(self, applicant_id: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"applicantId": applicant_id, "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def get_by_email(self, email: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"email": email.strip().lower(), "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def find_by_phone(self, phone: str, org_id: str) -> list[dict[str, Any]]:
        """Applicants sharing a phone number — indexed lookup on phoneDigits."""
        from ..services.pii import phone_digits_variants

        variants = phone_digits_variants(phone)
        if not variants:
            return []
        cursor = self.coll.find(
            {"orgId": org_id, "phoneDigits": {"$in": variants}}
        ).sort("createdAt", -1).limit(50)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def update(self, applicant_id: str, updates: dict[str, Any], org_id: str) -> dict[str, Any] | None:
        upd = dict(updates)
        upd["updatedAt"] = utcnow()
        await self.coll.update_one({"applicantId": applicant_id, "orgId": org_id}, {"$set": upd})
        return await self.get_by_id(applicant_id, org_id)

    async def list_by_org(self, org_id: str, skip: int = 0, limit: int = 50) -> list[dict[str, Any]]:
        cursor = self.coll.find({"orgId": org_id}).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def search_by_org(self, org_id: str, query: str, skip: int = 0, limit: int = 50) -> list[dict[str, Any]]:
        """Substring search over name/email/skills (regex-escaped, paginated)."""
        import re as _re

        safe = _re.escape((query or "")[:100])
        where = {
            "orgId": org_id,
            "$or": [
                {"name": {"$regex": safe, "$options": "i"}},
                {"email": {"$regex": safe, "$options": "i"}},
                {"resume.parsedJson.skills": {"$regex": safe, "$options": "i"}},
            ],
        }
        cursor = self.coll.find(where).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs


class ApplicationRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["applications"]

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        if "applicationId" not in record:
            record["applicationId"] = str(uuid.uuid4())
        now = utcnow()
        record.setdefault("currentStage", Stage.RESUME_UPLOADED.value)
        record.setdefault("stageEnteredAt", now)
        record.setdefault("status", ApplicationStatus.ACTIVE.value)
        record.setdefault("assignedReviewers", [])
        record.setdefault("createdAt", now)
        record.setdefault("updatedAt", now)
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get_by_id(self, application_id: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"applicationId": application_id, "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def get_by_job_and_applicant(
        self, job_id: str, applicant_id: str, org_id: str
    ) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"jobId": job_id, "applicantId": applicant_id, "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def find_active_for_pair(
        self, job_id: str, applicant_id: str, org_id: str
    ) -> dict[str, Any] | None:
        """Non-terminal application for the pair (blocks duplicates per index).

        Terminal REJECTED/WITHDRAWN rows do not block — a fresh application
        may be created after them.
        """
        doc = await self.coll.find_one({
            "jobId": job_id, "applicantId": applicant_id, "orgId": org_id,
            "currentStage": {"$nin": ["REJECTED", "WITHDRAWN"]},
        })
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def update_score(
        self, application_id: str, org_id: str, updates: dict[str, Any]
    ) -> dict[str, Any] | None:
        upd = dict(updates)
        upd["updatedAt"] = utcnow()
        await self.coll.update_one(
            {"applicationId": application_id, "orgId": org_id}, {"$set": upd}
        )
        return await self.get_by_id(application_id, org_id)

    async def get_by_candidate_key(self, candidate_key: str, org_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"candidateKey": candidate_key, "orgId": org_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def update_stage(
        self, application_id: str, to_stage: str, status: str, org_id: str
    ) -> dict[str, Any] | None:
        now = utcnow()
        await self.coll.update_one(
            {"applicationId": application_id, "orgId": org_id},
            {
                "$set": {
                    "currentStage": to_stage,
                    "stageEnteredAt": now,
                    "status": status,
                    "updatedAt": now,
                }
            },
        )
        return await self.get_by_id(application_id, org_id)

    async def list_by_applicant(
        self, applicant_id: str, org_id: str
    ) -> list[dict[str, Any]]:
        cursor = self.coll.find({"applicantId": applicant_id, "orgId": org_id}).sort("createdAt", -1)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def list_by_job(
        self, job_id: str, org_id: str, stage: str | None = None, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"jobId": job_id, "orgId": org_id}
        if stage:
            query["currentStage"] = stage
        cursor = self.coll.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs

    async def list_by_org(
        self, org_id: str, stage: str | None = None, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"orgId": org_id}
        if stage:
            query["currentStage"] = stage
        cursor = self.coll.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs


class StageHistoryRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["stage_history"]

    async def record_transition(
        self,
        *,
        application_id: str,
        from_stage: str,
        to_stage: str,
        actor_user_id: str,
        reason: str = "",
        is_override: bool = False,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        record = {
            "historyId": str(uuid.uuid4()),
            "applicationId": application_id,
            "fromStage": from_stage,
            "toStage": to_stage,
            "transitionAt": utcnow(),
            "actorUserId": actor_user_id,
            "reason": reason,
            "isOverride": is_override,
            "metadata": metadata or {},
        }
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def list_for_application(self, application_id: str) -> list[dict[str, Any]]:
        cursor = self.coll.find({"applicationId": application_id}).sort("transitionAt", 1)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs


class AuditLogRepository:
    """Append-only audit trail (§8.1 of ENGINEERING_STANDARDS)."""

    def __init__(self, db: Any) -> None:
        self.coll = db["audit_log"]

    async def log(
        self,
        *,
        org_id: str,
        actor_user_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: dict[str, Any] | None = None,
        ip_address: str = "",
    ) -> dict[str, Any]:
        record = {
            "auditId": str(uuid.uuid4()),
            "orgId": org_id,
            "actorUserId": actor_user_id,
            "action": action,
            "resourceType": resource_type,
            "resourceId": resource_id,
            "details": details or {},
            "ipAddress": ip_address,
            "createdAt": utcnow(),
        }
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def list_by_org(
        self, org_id: str, resource_type: str | None = None, resource_id: str | None = None, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"orgId": org_id}
        if resource_type:
            query["resourceType"] = resource_type
        if resource_id:
            query["resourceId"] = resource_id
        cursor = self.coll.find(query).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for d in cursor:
            d.pop("_id", None)
            docs.append(d)
        return docs
