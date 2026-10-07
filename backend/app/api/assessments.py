"""Assessment write API (Slice 2A): FastAPI + MongoDB is the source of truth.

- POST validates, stores as syncState "pending", calls PrimeHire
  server-side, then marks "synced" or "failed". The record always exists.
- PUT/PATCH carry a `version`; stale writes get HTTP 409 with the current
  document ("This was changed by someone else, reload").
- POST accepts an Idempotency-Key header (24h TTL); repeats return the
  original response without creating a duplicate.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import ValidationError

from ..auth import require_admin_auth
from ..config import settings
from ..db.mongodb import get_database
from ..models.assessment import AssessmentConflict
from ..services.assessment_service import AssessmentNotFound, AssessmentService
from ..services.primehire_payload import PayloadError

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_admin_auth)])


def _db() -> Any:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    return get_database(settings.mongodb_uri, settings.mongodb_database)


def _service(db: Any = Depends(_db)) -> AssessmentService:
    return AssessmentService(db)


def _actor(auth: Any = Depends(require_admin_auth)) -> str:
    if isinstance(auth, dict) and auth.get("sub"):
        return str(auth["sub"])
    return "admin"


def _conflict_response(job_id: str, exc: AssessmentConflict) -> HTTPException:
    return HTTPException(status_code=409, detail={
        "code": "VERSION_CONFLICT" if exc.current else "DUPLICATE_ASSESSMENT",
        "message": str(exc),
        "current": exc.current,
    })


async def _check_idempotency(db: Any, key: str) -> dict[str, Any] | None:
    if not key:
        return None
    doc = await db["idempotency_keys"].find_one({"key": key})
    if doc is None:
        return None
    return doc.get("response")


async def _store_idempotency(db: Any, key: str, response: dict[str, Any]) -> None:
    if not key:
        return
    try:
        await db["idempotency_keys"].insert_one({
            "key": key,
            "response": response,
            "createdAt": datetime.now(timezone.utc),
        })
    except Exception:  # noqa: BLE001 — duplicate key race: first write wins
        logger.debug("Idempotency key %s already stored", hashlib.sha256(key.encode()).hexdigest()[:12])


@router.get("/assessments/{job_id}")
async def get_assessment(job_id: str, service: AssessmentService = Depends(_service)) -> dict[str, Any]:
    try:
        return await service.get_by_job_id(job_id.strip())
    except AssessmentNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "ASSESSMENT_NOT_FOUND",
            "message": "No assessment was found for this job ID."}) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment lookup failed for %s", job_id)
        raise HTTPException(status_code=500, detail="Assessment lookup failed.") from None


@router.post("/assessments", status_code=status.HTTP_201_CREATED)
async def create_assessment(
    body: dict[str, Any], request: Request,
    db: Any = Depends(_db), service: AssessmentService = Depends(_service),
    actor: str = Depends(_actor),
) -> dict[str, Any]:
    idem_key = request.headers.get("idempotency-key", "").strip()
    if idem_key:
        try:
            cached = await _check_idempotency(db, idem_key)
        except Exception:  # noqa: BLE001 — idempotency must never block creates
            cached = None
        if cached is not None:
            return cached
    try:
        stored = await service.create(body, created_by=actor)
    except AssessmentConflict as exc:
        raise _conflict_response("", exc) from None
    except (ValidationError, PayloadError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment creation failed")
        raise HTTPException(status_code=500, detail="Assessment creation failed.") from None
    if idem_key:
        try:
            await _store_idempotency(db, idem_key, stored)
        except Exception:  # noqa: BLE001
            pass
    return stored


@router.put("/assessments/{job_id}")
async def put_assessment(
    job_id: str, body: dict[str, Any],
    service: AssessmentService = Depends(_service),
    actor: str = Depends(_actor),
) -> dict[str, Any]:
    try:
        return await service.put(job_id.strip(), body, updated_by=actor)
    except AssessmentNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "ASSESSMENT_NOT_FOUND",
            "message": "No assessment was found for this job ID."}) from None
    except AssessmentConflict as exc:
        raise _conflict_response(job_id, exc) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment update failed for %s", job_id)
        raise HTTPException(status_code=500, detail="Assessment update failed.") from None


@router.patch("/assessments/{job_id}")
async def patch_assessment(
    job_id: str, body: dict[str, Any],
    service: AssessmentService = Depends(_service),
    actor: str = Depends(_actor),
) -> dict[str, Any]:
    try:
        return await service.patch(job_id.strip(), body, updated_by=actor)
    except AssessmentNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "ASSESSMENT_NOT_FOUND",
            "message": "No assessment was found for this job ID."}) from None
    except AssessmentConflict as exc:
        raise _conflict_response(job_id, exc) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment patch failed for %s", job_id)
        raise HTTPException(status_code=500, detail="Assessment update failed.") from None


@router.patch("/assessments/{job_id}/activate")
async def activate_assessment(
    job_id: str, body: dict[str, Any],
    service: AssessmentService = Depends(_service),
    actor: str = Depends(_actor),
) -> dict[str, Any]:
    try:
        version = body.get("version")
        if version is None:
            raise ValueError("version is required.")
        return await service.set_active(job_id.strip(), True, int(version), updated_by=actor)
    except AssessmentNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "ASSESSMENT_NOT_FOUND",
            "message": "No assessment was found for this job ID."}) from None
    except AssessmentConflict as exc:
        raise _conflict_response(job_id, exc) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment activation failed for %s", job_id)
        raise HTTPException(status_code=500, detail="Assessment activation failed.") from None


@router.patch("/assessments/{job_id}/deactivate")
async def deactivate_assessment(
    job_id: str, body: dict[str, Any],
    service: AssessmentService = Depends(_service),
    actor: str = Depends(_actor),
) -> dict[str, Any]:
    try:
        version = body.get("version")
        if version is None:
            raise ValueError("version is required.")
        return await service.set_active(job_id.strip(), False, int(version), updated_by=actor)
    except AssessmentNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "ASSESSMENT_NOT_FOUND",
            "message": "No assessment was found for this job ID."}) from None
    except AssessmentConflict as exc:
        raise _conflict_response(job_id, exc) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment deactivation failed for %s", job_id)
        raise HTTPException(status_code=500, detail="Assessment deactivation failed.") from None


@router.post("/assessments/{job_id}/retry")
async def retry_assessment_sync(
    job_id: str, service: AssessmentService = Depends(_service)
) -> dict[str, Any]:
    """Re-attempt the PrimeHire sync for a pending/failed record."""
    try:
        return await service.retry_sync(job_id.strip())
    except AssessmentNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "ASSESSMENT_NOT_FOUND",
            "message": "No assessment was found for this job ID."}) from None
    except Exception:  # noqa: BLE001
        logger.exception("Assessment retry failed for %s", job_id)
        raise HTTPException(status_code=500, detail="Assessment sync retry failed.") from None
