"""Read-only, tenant-scoped leadership analytics; no candidate records leave this API."""
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..security.deps import get_db, require_permission
from ..services.leadership import dashboard
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from ..security.rate_limit import limiter
from ..services.leadership_assistant import answer_question

router = APIRouter(prefix="/api/leadership", tags=["leadership"])

class Preferences(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assistantEnabled: bool

class Turn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=2000)

class Question(BaseModel):
    model_config = ConfigDict(extra='forbid')
    question: str = Field(min_length=1, max_length=1200)
    days: Literal[7, 30, 90, 180] = 30
    jobId: str | None = Field(None, max_length=100, pattern=r'^[\w-]+$')
    history: list[Turn] = Field(default_factory=list, max_length=6)

async def preferences(db, user):
    if db is None:
        raise HTTPException(503, 'Account settings are temporarily unavailable')
    row = await db.leadership_preferences.find_one({'_id': f'{user.org_id}:{user.user_id}'}) or {}
    return {'assistantEnabled': row.get('assistantEnabled', True)}

@router.get('/preferences')
async def get_preferences(response: Response, user=Depends(require_permission('leadership.view')), db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return await preferences(db, user)

@router.put('/preferences')
async def save_preferences(payload: Preferences, response: Response, user=Depends(require_permission('leadership.view')), db=Depends(get_db)):
    if user.impersonating:
        raise HTTPException(403, 'Personal settings cannot be changed while viewing another account.')
    await preferences(db, user)
    await db.leadership_preferences.update_one({'_id': f'{user.org_id}:{user.user_id}'},
        {'$set': {'orgId': user.org_id, 'userId': user.user_id, 'assistantEnabled': payload.assistantEnabled}}, upsert=True)
    response.headers['Cache-Control'] = 'no-store'
    return payload.model_dump()

@router.post('/assistant')
async def assistant(payload: Question, response: Response, user=Depends(require_permission('leadership.view')), db=Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    if not (await preferences(db, user))['assistantEnabled']:
        raise HTTPException(409, 'Enable your assistant in Leadership settings first.')
    if not payload.question.strip():
        raise HTTPException(422, 'Enter a recruitment question.')
    limit = limiter.check(f'leadership-ai:{user.org_id}:{user.user_id}', max_requests=8, window_seconds=60)
    if not limit.allowed:
        raise HTTPException(429, 'Please wait before asking another question.', headers={'Retry-After': str(limit.retry_after)})
    return await answer_question(db, user.org_id, payload.question, payload.days, payload.jobId,
        [turn.model_dump() for turn in payload.history])


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
