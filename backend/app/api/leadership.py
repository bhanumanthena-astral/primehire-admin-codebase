"""Read-only, tenant-scoped leadership analytics; no candidate records leave this API."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..security.deps import get_db, require_permission
from ..services.leadership import dashboard

router = APIRouter(prefix="/api/leadership", tags=["leadership"])


@router.get("/dashboard")
async def overview(response: Response, days: int = Query(30, description="Activity window: 7, 30, 90 or 180 days"),
                   jobId: str | None = Query(None, min_length=1, max_length=100, pattern=r"^[\w-]+$"),
                   user=Depends(require_permission("leadership.view")), db=Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    if db is None:
        raise HTTPException(503, "Hiring analytics are temporarily unavailable")
    if days not in {7, 30, 90, 180}:
        raise HTTPException(422, "Choose a 7, 30, 90 or 180 day activity period")
    return await dashboard(db, user.org_id, days=days, job_id=jobId)
