"""Candidate write API (persistence cutover): FastAPI + MongoDB is the source of truth.

Routes are keyed by the stable application ``candidateKey`` (the UI ``id``) —
never by the Mongo ``_id`` and never by the rotatable legacy ``CAND-`` ids
except as the key value itself. DELETE removes the Mongo document only;
PrimeHire interviews/reports are never touched here.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from ..config import settings
from ..db.mongodb import get_database
from ..schemas.candidate import CandidateIn, CandidatesBulkIn, CandidateUpdate
from ..services.candidate_service import (
    CandidateConflict,
    CandidateNotFound,
    CandidateService,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _db() -> Any:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    return get_database(settings.mongodb_uri, settings.mongodb_database)


def _service(db: Any = Depends(_db)) -> CandidateService:
    return CandidateService(db)


@router.post("/candidates/bulk", status_code=status.HTTP_201_CREATED)
async def create_candidates_bulk(
    body: CandidatesBulkIn, service: CandidateService = Depends(_service)
) -> dict[str, Any]:
    try:
        items = [item.to_doc() for item in body.items]
        created, errors = await service.create_many(items)
    except Exception:  # noqa: BLE001
        logger.exception("Bulk candidate import failed")
        raise HTTPException(status_code=500, detail="Bulk import failed.") from None
    return {"items": created, "errors": errors,
            "created": len(created), "failed": len(errors)}


@router.get("/candidates/{candidate_key}")
async def get_candidate(
    candidate_key: str, service: CandidateService = Depends(_service)
) -> dict[str, Any]:
    try:
        return await service.get_by_key(candidate_key.strip())
    except CandidateNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "CANDIDATE_NOT_FOUND",
            "message": "No candidate was found for this key."}) from None
    except Exception:  # noqa: BLE001
        logger.exception("Candidate lookup failed for key %s", candidate_key)
        raise HTTPException(status_code=500, detail="Candidate lookup failed.") from None


@router.post("/candidates", status_code=status.HTTP_201_CREATED)
async def create_candidate(
    body: CandidateIn, service: CandidateService = Depends(_service)
) -> dict[str, Any]:
    try:
        return await service.create(body.to_doc())
    except CandidateConflict as exc:
        raise HTTPException(status_code=409, detail={
            "code": "DUPLICATE_KEY",
            "message": str(exc)}) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Candidate creation failed")
        raise HTTPException(status_code=500, detail="Candidate creation failed.") from None


@router.put("/candidates/{candidate_key}")
async def update_candidate(
    candidate_key: str, body: CandidateUpdate,
    service: CandidateService = Depends(_service),
) -> dict[str, Any]:
    try:
        payload = body.model_dump(exclude_unset=True)
        return await service.update(candidate_key.strip(), payload)
    except CandidateNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "CANDIDATE_NOT_FOUND",
            "message": "No candidate was found for this key."}) from None
    except CandidateConflict as exc:
        raise HTTPException(status_code=409, detail={
            "code": "DUPLICATE_KEY",
            "message": str(exc)}) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Candidate update failed for key %s", candidate_key)
        raise HTTPException(status_code=500, detail="Candidate update failed.") from None


@router.delete("/candidates/{candidate_key}")
async def delete_candidate(
    candidate_key: str, service: CandidateService = Depends(_service)
) -> dict[str, Any]:
    key = candidate_key.strip()
    try:
        await service.delete(key)
    except CandidateNotFound:
        raise HTTPException(status_code=404, detail={
            "code": "CANDIDATE_NOT_FOUND",
            "message": "No candidate was found for this key."}) from None
    except Exception:  # noqa: BLE001
        logger.exception("Candidate deletion failed for key %s", candidate_key)
        raise HTTPException(status_code=500, detail="Candidate deletion failed.") from None
    return {"deleted": key}
