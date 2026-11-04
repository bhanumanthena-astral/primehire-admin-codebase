"""Isolated browser-test API. In-memory DB only; no upstream, email or LLM."""
import os
import sys
import secrets
from pathlib import Path
from contextlib import asynccontextmanager

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update(MONGODB_URI='', ENV='test', EMAIL_DRY_RUN='true',
    OPENROUTER_API_KEY='', OPENROUTER_MODEL='',
    ALLOWED_ORIGINS='http://127.0.0.1:4173',
    JWT_SECRET=secrets.token_urlsafe(48))
import mongomock_motor
from app.main import app
from app.security.deps import get_db
from app.security.passwords import hash_password
from app.models.user import UserRepository, InvitationRepository, utcnow
from app.security.tokens import hash_token, INVITE_TOKEN_LIFETIME
from app.db.mongodb import ensure_indexes

db = mongomock_motor.AsyncMongoMockClient()['browser_acceptance']
app.dependency_overrides[get_db] = lambda: db

@asynccontextmanager
async def lifespan(_app):
    await ensure_indexes(db)
    await db['organizations'].insert_one({'orgId':'default','settings':{'timezone':'Asia/Kolkata'}})
    await UserRepository(db).create({'userId':'browser-invited','orgId':'default','name':'Invited HR',
        'email':'invited@example.com','role':'hr','isActive':True,'passwordHash':''})
    await InvitationRepository(db).create_invitation(user_id='browser-invited',org_id='default',
        token_hash=hash_token('browser-fixture-invitation-not-a-real-token'),kind='invite',
        created_by='browser-admin',expires_at=utcnow()+INVITE_TOKEN_LIFETIME)
    await UserRepository(db).create({'userId':'browser-admin','orgId':'default','name':'Demo Admin',
        'email':'admin@example.com','role':'super_admin','isActive':True,
        'passwordHash':hash_password('Browser-test-only-2026!')})
    await UserRepository(db).create({'userId':'browser-hr','orgId':'default','name':'Demo HR',
        'email':'hr@example.com','role':'hr','isActive':True,
        'passwordHash':hash_password('Browser-test-only-2026!')})
    for role in ['recruiter', 'viewer']:
        await UserRepository(db).create({'userId':f'browser-{role}','orgId':'default',
            'name':f'Demo {role}', 'email':f'{role}@example.com','role':role,'isActive':True,
            'passwordHash':hash_password('Browser-test-only-2026!')})
    from app.schemas.hiring import JobCreate
    from app.models.hiring import JobRepository
    doc = JobCreate(companyName='Demo Labs', jobRole='Platform Engineer', title='Seeded Demo Engineer',
        department='Engineering', minExperienceYears=2, maxExperienceYears=5,lifecycleStatus='OPEN',
        positionsTotal=2, closesAt='2027-12-31T00:00:00Z', assigneeUserId='browser-hr',
        jdHtml='<p>Build reliable platform services with comprehensive automated tests and collaborate with our product team.</p>')
    await JobRepository(db).create({**doc.model_dump(),'orgId':'default','createdBy':'browser-hr',
        'datesVersion':'utc-v1','assigneeEmail':'hr@example.com','assigneeName':'Demo HR'})
    await JobRepository(db).create({**doc.model_dump(), 'title':'Viewer Assigned Engineer',
        'jobKey':'VIEWER-ONLY', 'orgId':'default', 'createdBy':'browser-hr',
        'assigneeUserId':'browser-viewer','lifecycleStatus':'OPEN','datesVersion':'utc-v1'})
    yield

app.router.lifespan_context = lifespan

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8001)
