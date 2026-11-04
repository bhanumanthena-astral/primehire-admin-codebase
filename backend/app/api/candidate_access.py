"""Purpose-scoped candidate bearer link; never grants HR or profile access."""
import hmac
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from ..security.deps import get_db
from ..security.rate_limit import limiter
from ..config import settings
from ..services.candidate_management import share_token, utc
from ..models.recruitment import now
from ..services.candidate_link_crypto import decrypt_link, OutboxCryptoError

router=APIRouter()


class Access(BaseModel):
    model_config=ConfigDict(extra='forbid')
    token:str=Field(min_length=100,max_length=150)


async def assignment_token(payload:Access,request:Request,db=Depends(get_db)):
    if settings.mongodb_database!='primehire_admin_v2' or db is None: raise HTTPException(404,'Assessment access is unavailable')
    result=limiter.check('candidate-access:'+(request.client.host if request.client else 'unknown'),60,60)
    if not result.allowed: raise HTTPException(429,'Too many access attempts; retry shortly')
    assignment_id=payload.token.split('.')[0]
    if not re.fullmatch(r'ASGN-[a-f0-9]{32}',assignment_id) or not hmac.compare_digest(payload.token,share_token(assignment_id)):
        raise HTTPException(404,'Assessment link is invalid')
    row=await db['candidate_assignments'].find_one({'assignmentId':assignment_id,'status':'Generated'})
    if not row: raise HTTPException(410,'Assessment link is no longer valid')
    if utc(row['startDate'])>now(): raise HTTPException(403,'This assessment is not open yet')
    if utc(row['endDate'])<=now(): raise HTTPException(410,'This assessment link has expired')
    assessment=await db['assessments'].find_one({'orgId':row['orgId'],'jobId':row['assessmentId'],'isActive':{'$ne':False},'publicationState':{'$nin':['draft','publishing','uncertain']}})
    if not assessment: raise HTTPException(410,'This assessment is no longer available')
    start=utc(assessment.get('windowStart') or assessment.get('startDate'))
    end=utc(assessment.get('windowEnd') or assessment.get('endDate'))
    if start and start>now(): raise HTTPException(403,'This assessment is not open yet')
    if end and end<=now(): raise HTTPException(410,'This assessment link has expired')
    if not await db['applicants'].find_one({'orgId':row['orgId'],'applicantId':row['candidateId']}):
        raise HTTPException(410,'This assignment is no longer available')
    return row


@router.post('/api/candidate-access')
async def access(row=Depends(assignment_token)):
    from fastapi.responses import JSONResponse
    try: target=decrypt_link(row['providerLinkEncrypted'])
    except OutboxCryptoError: raise HTTPException(503,'Assessment access is temporarily unavailable') from None
    return JSONResponse({'url':target},headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
