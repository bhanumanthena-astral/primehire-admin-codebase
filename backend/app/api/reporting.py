"""Reports workspace API: resource authorization before content, history or media."""
import asyncio
import ipaddress
import re
import socket
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from ..config import settings
from ..security.deps import get_db, require_permission
from ..security.rate_limit import limiter
from ..services import reporting as service

router=APIRouter(prefix='/api/reporting',tags=['reporting'])


def database(db=Depends(get_db)):
    if db is None:raise HTTPException(503,'Report storage is temporarily unavailable')
    return db


def private(response:Response):
    response.headers['Cache-Control']='no-store'
    response.headers['Referrer-Policy']='no-referrer'


class SyncRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    applicationId:str|None=Field(default=None,max_length=100)
    jobId:str|None=Field(default=None,max_length=100)


class VersionAction(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    version:int=Field(ge=1)
    action:Literal['archive','invalidate','restore']
    reason:str=Field(min_length=10,max_length=1000)


@router.get('/capabilities')
async def capabilities(response:Response,user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    await service.scope(db,user)
    org=await db.organizations.find_one({'orgId':user.org_id},{'settings.timezone':1}) or {}
    return {'enabled':True,'canRefresh':'reports.refresh' in user.permissions and not user.impersonating,
        'canExport':'reports.export' in user.permissions,'canManageVersions':'reports.manage_versions' in user.permissions and not user.impersonating,
        'supportedRoundSchemas':['BASIC','TECHNICAL'],'timezone':(org.get('settings') or {}).get('timezone') or 'Asia/Kolkata'}


@router.get('/reports')
async def list_reports(response:Response,q:str=Query('',max_length=200),
    roundType:Literal['BASIC','TECHNICAL','MIXED','HR','UNKNOWN']|None=None,
    status:Literal['Not Started','Processing','Completed','Partial','Failed','Archived','Invalidated']|None=None,
    jobId:str|None=Query(None,max_length=100),applicationId:str|None=Query(None,max_length=100),
    generatedFrom:datetime|None=None,generatedTo:datetime|None=None,
    sort:Literal['candidateName','jobTitle','roundType','status','generatedAt','updatedAt','version']='updatedAt',
    order:Literal['asc','desc']='desc',skip:int=Query(0,ge=0),limit:int=Query(25,ge=1,le=100),
    user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    if any(value and not value.tzinfo for value in [generatedFrom,generatedTo]) or generatedFrom and generatedTo and generatedFrom>=generatedTo:
        raise HTTPException(422,'Choose a valid timezone-aware generated date range')
    return await service.listing(db,user,q=q,round_type=roundType,status=status,job_id=jobId,application_id=applicationId,
        generated_from=generatedFrom,generated_to=generatedTo,sort=sort,order=order,skip=skip,limit=limit)


@router.post('/sync',status_code=202)
async def sync(payload:SyncRequest,response:Response,user=Depends(require_permission('reports.refresh')),db=Depends(database)):
    private(response)
    budget=limiter.check(f'report-sync:{user.org_id}:{user.user_id}',10,60)
    if not budget.allowed:raise HTTPException(429,'Too many report sync requests. Retry shortly.',headers={'Retry-After':str(budget.retry_after)})
    return await service.queue_sync(db,user,application_id=payload.applicationId,job_id=payload.jobId)


@router.get('/applications/{application_id}')
async def application_history(application_id:str,response:Response,user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    return await service.application_history(db,user,application_id)


@router.get('/summaries/{summary_id}')
async def summary(summary_id:str,response:Response,user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    return await service.summary_for(db,user,summary_id)


@router.get('/interviews/{interview_id}/summary')
async def interview_summary(interview_id:str,response:Response,user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    return await service.interview_snapshot(db,user,interview_id)


@router.post('/interviews/{interview_id}/summary-refresh')
async def refresh_interview_summary(interview_id:str,response:Response,user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    return await service.interview_snapshot(db,user,interview_id,refresh=True)


@router.get('/reports/{report_id}')
async def report(report_id:str,response:Response,version:int|None=Query(None,ge=1),user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    return await service.detail(db,user,report_id,version)


@router.get('/reports/{report_id}/versions')
async def versions(report_id:str,response:Response,skip:int=Query(0,ge=0),limit:int=Query(50,ge=1,le=100),user=Depends(require_permission('reports.view')),db=Depends(database)):
    private(response)
    return await service.versions_page(db,user,report_id,skip,limit)


@router.post('/reports/{report_id}/version-action')
async def version_action(report_id:str,payload:VersionAction,response:Response,user=Depends(require_permission('reports.manage_versions')),db=Depends(database)):
    private(response)
    return await service.control_version(db,user,report_id,payload.version,payload.action,payload.reason)


@router.get('/reports/{report_id}/export')
async def export_report(report_id:str,version:int|None=Query(None,ge=1),user=Depends(require_permission('reports.export')),db=Depends(database)):
    result=await service.detail(db,user,report_id,version)
    await service.audit(db,user,'exported',report_id,{'version':result['metadata']['version']})
    return JSONResponse(jsonable_encoder(result),headers={'Cache-Control':'no-store','Content-Disposition':f'attachment; filename="report-{report_id}.json"','Referrer-Policy':'no-referrer'})


async def validate_media_url(value):
    try:
        parsed=urlsplit(value)
        port=parsed.port
    except ValueError:
        raise HTTPException(409,'Video reference is unavailable') from None
    allowed={host.strip().lower() for host in settings.report_media_allowed_hosts.split(',') if host.strip()}
    from ..services.assessment_management import provider_connection
    from ..services.primehire_api import UpstreamError
    try:allowed.add(urlsplit(provider_connection()[0]).hostname)
    except (RuntimeError,UpstreamError):pass
    if parsed.scheme!='https' or parsed.hostname not in allowed or parsed.username or parsed.password or port not in {None,443}:
        raise HTTPException(409,'Video is unavailable through the configured media service')
    try:
        addresses=await asyncio.get_running_loop().getaddrinfo(parsed.hostname,443,type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
            raise ValueError('Non-public media origin')
    except (OSError,ValueError):
        raise HTTPException(409,'Video is unavailable through the configured media service') from None


@router.get('/reports/{report_id}/media/{question_reference}')
async def media(report_id:str,question_reference:str,request:Request,version:int=Query(...,ge=1),user=Depends(require_permission('reports.view')),db=Depends(database)):
    series,app,_=await service.series_for(db,user,report_id)
    row=await db.report_versions.find_one({'orgId':user.org_id,'reportId':report_id,'version':version})
    url=(row or {}).get('content',{}).get('media',{}).get(question_reference)
    if not isinstance(url,str):raise HTTPException(404,'Question video is unavailable')
    await validate_media_url(url)
    headers={}
    requested_range=request.headers.get('range')
    if requested_range:
        if not re.fullmatch(r'bytes=\d*-\d*',requested_range):raise HTTPException(416,'Unsupported media range')
        headers['Range']=requested_range
    client=httpx.AsyncClient(timeout=30,follow_redirects=False)
    try:
        upstream=await client.send(client.build_request('GET',url,headers=headers),stream=True)
        mime=upstream.headers.get('content-type','').split(';')[0]
        if upstream.status_code not in {200,206} or not mime.startswith(('video/','audio/')):
            raise ValueError('Media unavailable')
        if int(upstream.headers.get('content-length','0'))>128*1024*1024:raise ValueError('Media too large')
    except Exception:
        await client.aclose()
        raise HTTPException(503,'Video is temporarily unavailable. The rest of the report remains available.') from None
    await service.audit(db,user,'video_viewed',report_id,{'version':version,'questionReference':question_reference,'applicationId':app['applicationId']})
    async def stream():
        size=0
        try:
            async for chunk in upstream.aiter_bytes():
                size+=len(chunk)
                if size>128*1024*1024:break
                yield chunk
        finally:
            await upstream.aclose();await client.aclose()
    return StreamingResponse(stream(),status_code=upstream.status_code,media_type=mime,headers={
        'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
        **{key:value for key,value in upstream.headers.items() if key in {'content-range','accept-ranges','content-length'}}})
