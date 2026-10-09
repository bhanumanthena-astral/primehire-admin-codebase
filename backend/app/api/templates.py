"""Mail template API: shared MongoDB storage so templates created by one
user are visible to every user (replaces per-browser localStorage).

Routes are keyed by the stable app template ``id`` (e.g. ``tpl-invite``) —
never by the Mongo ``_id``.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from ..auth import require_admin_auth
from ..config import settings
from ..db.mongodb import get_database
from ..models.template import TemplateRepository
from ..schemas.template import TemplateIn, TemplateUpdate

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_admin_auth)])


def _db() -> Any:
    if not settings.has_mongo:
        raise HTTPException(status_code=503, detail="MongoDB is not configured")
    return get_database(settings.mongodb_uri, settings.mongodb_database)


@router.get("/templates")
async def list_templates(response: Response, db: Any = Depends(_db)) -> dict[str, Any]:
    response.headers["Cache-Control"] = "no-store"
    try:
        items = await TemplateRepository(db).list_all()
    except Exception:  # noqa: BLE001
        logger.exception("Template list failed")
        raise HTTPException(status_code=500, detail="Template lookup failed.") from None
    return {"items": items, "total": len(items)}


@router.get("/templates/{template_id}")
async def get_template(template_id: str, db: Any = Depends(_db)) -> dict[str, Any]:
    """Fetch one template by public ``id`` (or Mongo ``_id`` fallback)."""
    key = template_id.strip()
    if not key:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_ID",
            "message": "Template id must not be empty."})
    try:
        doc = await TemplateRepository(db).get_by_key(key)
    except Exception:  # noqa: BLE001
        logger.exception("Template lookup failed for id %s", key)
        raise HTTPException(status_code=500, detail="Template lookup failed.") from None
    if doc is None:
        raise HTTPException(status_code=404, detail={
            "code": "TEMPLATE_NOT_FOUND",
            "message": "No template was found for this id."})
    return doc


@router.post("/templates", status_code=201)
async def create_template(body: TemplateIn, db: Any = Depends(_db)) -> dict[str, Any]:
    repo = TemplateRepository(db)
    try:
        existing = await repo.get_by_template_id(body.id, include_deleted=True)
    except Exception:  # noqa: BLE001
        logger.exception("Template lookup failed for id %s", body.id)
        raise HTTPException(status_code=500, detail="Template lookup failed.") from None
    if existing is not None:
        if existing.get("deletedAt") is not None:
            raise HTTPException(status_code=409, detail={
                "code": "TEMPLATE_DELETED",
                "message": "This template was deleted. Create a new template with a new id."})
        raise HTTPException(status_code=409, detail={
            "code": "DUPLICATE_KEY",
            "message": "A template with this id already exists."})
    try:
        return await repo.create(body.to_doc())
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail={
            "code": "DUPLICATE_KEY",
            "message": "A template with this id already exists or was deleted."}) from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Template creation failed")
        raise HTTPException(status_code=500, detail="Template creation failed.") from None


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str, body: TemplateUpdate, db: Any = Depends(_db)
) -> dict[str, Any]:
    key = template_id.strip()
    if not key:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_ID",
            "message": "Template id must not be empty."})
    try:
        payload = body.model_dump(exclude_unset=True)
        updated = await TemplateRepository(db).update_by_key(key, payload)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except Exception:  # noqa: BLE001
        logger.exception("Template update failed for id %s", key)
        raise HTTPException(status_code=500, detail="Template update failed.") from None
    if updated is None:
        raise HTTPException(status_code=404, detail={
            "code": "TEMPLATE_NOT_FOUND",
            "message": "No template was found for this id."})
    return updated


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str, db: Any = Depends(_db)
) -> dict[str, Any]:
    key = template_id.strip()
    if not key:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_ID",
            "message": "Template id must not be empty."})
    try:
        removed = await TemplateRepository(db).delete_by_template_id(key)
    except Exception:  # noqa: BLE001
        logger.exception("Template delete failed for id %s", key)
        raise HTTPException(status_code=500, detail="Template delete failed.") from None
    if not removed:
        raise HTTPException(status_code=404, detail={
            "code": "TEMPLATE_NOT_FOUND",
            "message": "No template was found for this id."})
    return {"deleted": key}
