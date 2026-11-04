"""Module 2 admission before multipart parsing: auth, leases and body caps."""
from __future__ import annotations
import uuid
import inspect
import asyncio
import time
from datetime import timedelta
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from starlette.responses import JSONResponse
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from ..config import settings
from ..models.resume_intake import now
from .deps import get_db, get_current_user


class BodyLimit(HTTPException):
    def __init__(self):
        super().__init__(413, "Request exceeds the upload/body limit.")


class IntakeAdmissionMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not settings.resume_module_v2_enabled or not scope.get("path", "").startswith("/api/resume-intake/"):
            return await self.app(scope, receive, send)
        upload = scope["path"].endswith("/upload") and scope["method"] == "POST"
        cap = 126 * 1024 * 1024 if upload else 512 * 1024
        headers = dict(scope.get("headers", []))
        try:
            declared = int(headers.get(b"content-length", b"0") or b"0")
            if declared < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({"detail": "Invalid Content-Length."}, 400)(scope, receive, send)
        if declared > cap:
            return await JSONResponse({"detail": "Request exceeds the upload/body limit."}, 413)(scope, receive, send)
        db, slot, owner = None, None, uuid.uuid4().hex
        if upload:
            provider = getattr(scope.get("app"), "dependency_overrides", {}).get(get_db, get_db)
            db = provider()
            if inspect.isawaitable(db):
                db = await db
            if db is None:
                return await JSONResponse({"detail": "Upload service unavailable."}, 503)(scope, receive, send)
            try:
                auth = headers.get(b"authorization", b"").decode()
                if not auth.startswith("Bearer "):
                    raise HTTPException(401, "Sign in before uploading.")
                user = await get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth[7:]), db)
                record = await db["users"].find_one({"orgId": user.org_id, "userId": user.user_id})
                if not record or record.get("role") != user.role or not record.get("isActive", True):
                    raise HTTPException(401, "Your account changed. Sign in again.")
                if user.impersonating or "resumes.upload" not in user.permissions:
                    raise HTTPException(403, "Resume upload access is required.")
                if settings.free_tier_guard_enabled:
                    from ..services.capacity_guard import require_capacity
                    require_capacity(required_bytes=cap)
                for number in range(settings.resume_upload_concurrency):
                    admission_scope = '__free_host__' if settings.free_tier_guard_enabled else user.org_id
                    key = f"upload:{admission_scope}:{number}"
                    try:
                        doc = await db["resume_intake_limits"].find_one_and_update({"_id": key,
                            "$or": [{"expiresAt": {"$lte": now()}}, {"expiresAt": None}]},
                            {"$set": {"orgId": user.org_id, "owner": owner, "expiresAt": now() + timedelta(minutes=15)}},
                            upsert=True, return_document=ReturnDocument.AFTER)
                        if doc:
                            slot = key
                            break
                    except DuplicateKeyError:
                        continue
                if slot is None:
                    raise HTTPException(429, "Upload capacity is busy. Keep your files selected and retry.", headers={"Retry-After": "10"})
            except HTTPException as exc:
                return await JSONResponse({"detail": exc.detail}, exc.status_code, headers=exc.headers)(scope, receive, send)
        consumed, started = 0, False
        deadline = time.monotonic() + 600
        async def bounded_receive():
            nonlocal consumed
            try:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise asyncio.TimeoutError
                message = await asyncio.wait_for(receive(), timeout=min(60, remaining))
            except asyncio.TimeoutError:
                raise HTTPException(408, "Upload timed out. Keep the files selected and retry.") from None
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > cap:
                    raise BodyLimit
            return message
        async def tracked_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                response_headers = list(message.get("headers", []))
                if not any(key.lower() == b"cache-control" for key, _ in response_headers):
                    response_headers.append((b"cache-control", b"no-store"))
                response_headers.append((b"x-content-type-options", b"nosniff"))
                message = {**message, "headers": response_headers}
            await send(message)
        try:
            await self.app(scope, bounded_receive, tracked_send)
        except BodyLimit:
            if not started:
                await JSONResponse({"detail": "Request exceeds the upload/body limit."}, 413)(scope, receive, send)
        finally:
            if slot and db is not None:
                await db["resume_intake_limits"].delete_one({"_id": slot, "owner": owner})
