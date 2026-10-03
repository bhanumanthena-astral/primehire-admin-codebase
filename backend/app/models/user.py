"""User, session, login attempt, and invitation collections repository."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import uuid


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_public_user(doc: dict[str, Any]) -> dict[str, Any]:
    """Strip sensitive fields before returning user document to client."""
    out = dict(doc)
    out.pop("_id", None)
    out.pop("passwordHash", None)
    mfa = out.get("mfa") or {}
    out["mfaEnabled"] = bool(mfa.get("enabled", False))
    out.pop("mfa", None)
    return out


class UserRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["users"]

    async def get_by_id(self, user_id: str, org_id: str | None = None) -> dict[str, Any] | None:
        query: dict[str, Any] = {"userId": user_id}
        if org_id is not None:
            query["orgId"] = org_id
        doc = await self.coll.find_one(query)
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def get_by_email(self, email: str, org_id: str | None = None) -> dict[str, Any] | None:
        query: dict[str, Any] = {"email": email.strip().lower()}
        if org_id is not None:
            query["orgId"] = org_id
        doc = await self.coll.find_one(query)
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def create(self, doc: dict[str, Any]) -> dict[str, Any]:
        record = dict(doc)
        if "userId" not in record:
            record["userId"] = str(uuid.uuid4())
        record["email"] = record["email"].strip().lower()
        now = utcnow()
        record.setdefault("isActive", True)
        record.setdefault("mfa", {"enabled": False})
        record.setdefault("createdAt", now)
        record.setdefault("updatedAt", now)
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def update(
        self, user_id: str, updates: dict[str, Any], org_id: str | None = None
    ) -> dict[str, Any] | None:
        query: dict[str, Any] = {"userId": user_id}
        if org_id is not None:
            query["orgId"] = org_id
        upd = dict(updates)
        upd["updatedAt"] = utcnow()
        await self.coll.update_one(query, {"$set": upd})
        return await self.get_by_id(user_id, org_id=org_id)

    async def list_by_org(
        self, org_id: str, skip: int = 0, limit: int = 50
    ) -> list[dict[str, Any]]:
        cursor = self.coll.find({"orgId": org_id}).sort("createdAt", -1).skip(skip).limit(limit)
        docs = []
        async for doc in cursor:
            doc.pop("_id", None)
            docs.append(to_public_user(doc))
        return docs

    async def count_by_org(self, org_id: str) -> int:
        return await self.coll.count_documents({"orgId": org_id})

    async def delete(self, user_id: str, org_id: str | None = None) -> bool:
        query: dict[str, Any] = {"userId": user_id}
        if org_id is not None:
            query["orgId"] = org_id
        result = await self.coll.delete_one(query)
        return result.deleted_count > 0


class SessionRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["sessions"]

    async def create_session(
        self,
        *,
        user_id: str,
        org_id: str,
        refresh_token_hash: str,
        device_info: str = "",
        expires_at: datetime,
    ) -> dict[str, Any]:
        record = {
            "sessionId": str(uuid.uuid4()),
            "userId": user_id,
            "orgId": org_id,
            "refreshTokenHash": refresh_token_hash,
            "deviceInfo": device_info,
            "createdAt": utcnow(),
            "expiresAt": expires_at,
            "revokedAt": None,
        }
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({"sessionId": session_id})
        if doc and "_id" in doc:
            doc.pop("_id", None)
        return doc

    async def revoke_session(self, session_id: str) -> bool:
        res = await self.coll.update_one(
            {"sessionId": session_id},
            {"$set": {"revokedAt": utcnow()}},
        )
        return res.modified_count > 0

    async def revoke_all_for_user(self, user_id: str) -> int:
        res = await self.coll.update_many(
            {"userId": user_id, "revokedAt": None},
            {"$set": {"revokedAt": utcnow()}},
        )
        return res.modified_count

    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        cursor = self.coll.find({"userId": user_id, "revokedAt": None}).sort("createdAt", -1)
        docs = []
        async for doc in cursor:
            doc.pop("_id", None)
            docs.append(doc)
        return docs


class LoginAttemptRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["login_attempts"]

    async def is_locked(self, key: str) -> tuple[bool, int]:
        """Returns (is_locked, retry_after_seconds)."""
        doc = await self.coll.find_one({"key": key})
        if not doc:
            return False, 0
        locked_until = doc.get("lockedUntil")
        if locked_until:
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            now = utcnow()
            if now < locked_until:
                remaining = int((locked_until - now).total_seconds())
                return True, max(1, remaining)
        return False, 0

    async def record_failure(self, key: str) -> tuple[int, int]:
        """Record failure. Returns (attempt_count, locked_for_seconds)."""
        now = utcnow()
        doc = await self.coll.find_one({"key": key})
        attempts = (doc.get("attempts", 0) if doc else 0) + 1

        lock_seconds = 0
        if attempts >= 5:
            # Exponential backoff: 5 attempts = 15m, 6 = 30m, 7 = 60m, 8+ = 240m
            if attempts == 5:
                lock_seconds = 15 * 60
            elif attempts == 6:
                lock_seconds = 30 * 60
            elif attempts == 7:
                lock_seconds = 60 * 60
            else:
                lock_seconds = 240 * 60
            locked_until = now + timedelta(seconds=lock_seconds)
        else:
            locked_until = None

        expires_at = now + timedelta(days=1)
        await self.coll.update_one(
            {"key": key},
            {
                "$set": {
                    "attempts": attempts,
                    "lastAttemptAt": now,
                    "lockedUntil": locked_until,
                    "expiresAt": expires_at,
                }
            },
            upsert=True,
        )
        return attempts, lock_seconds

    async def reset(self, key: str) -> None:
        await self.coll.delete_one({"key": key})


class InvitationRepository:
    def __init__(self, db: Any) -> None:
        self.coll = db["invitations"]

    async def create_invitation(
        self,
        *,
        user_id: str,
        org_id: str,
        token_hash: str,
        kind: str,
        created_by: str,
        expires_at: datetime,
    ) -> dict[str, Any]:
        record = {
            "tokenHash": token_hash,
            "userId": user_id,
            "orgId": org_id,
            "kind": kind,
            "createdBy": created_by,
            "createdAt": utcnow(),
            "expiresAt": expires_at,
            "usedAt": None,
        }
        await self.coll.insert_one(record)
        record.pop("_id", None)
        return record

    async def get_valid(self, token_hash: str, kind: str) -> dict[str, Any] | None:
        doc = await self.coll.find_one({
            "tokenHash": token_hash,
            "kind": kind,
            "usedAt": None,
        })
        if not doc:
            return None
        expires_at = doc.get("expiresAt")
        if expires_at:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if utcnow() > expires_at:
                return None
        doc.pop("_id", None)
        return doc

    async def mark_used(self, token_hash: str) -> bool:
        res = await self.coll.update_one(
            {"tokenHash": token_hash},
            {"$set": {"usedAt": utcnow()}},
        )
        return res.modified_count > 0


async def seed_default_super_admin(
    db: Any,
    email: str = "admin@primehire.ai",
    password: str = "Admin@PrimeHire2026!",
    name: str = "Super Admin",
    org_id: str = "default",
) -> bool:
    """Seed default super admin in local dev/bootstrap if users collection is empty."""
    user_repo = UserRepository(db)
    count = await db["users"].count_documents({})
    if count > 0:
        return False
    from ..security.passwords import hash_password
    from ..security.roles import Role
    await user_repo.create({
        "email": email.strip().lower(),
        "name": name,
        "role": Role.SUPER_ADMIN.value,
        "orgId": org_id,
        "passwordHash": hash_password(password),
        "isActive": True,
    })
    return True

