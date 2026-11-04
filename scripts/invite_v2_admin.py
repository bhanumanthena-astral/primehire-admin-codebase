"""Bootstrap a pending administrator only in the separate V2 database."""
import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import settings
from app.models.user import UserRepository, InvitationRepository, utcnow
from app.models.hiring import AuditLogRepository
from app.security.tokens import generate_opaque_token, hash_token, INVITE_TOKEN_LIFETIME
from motor.motor_asyncio import AsyncIOMotorClient


async def invite(email, name):
    if settings.mongodb_database != 'primehire_admin_v2':
        raise SystemExit('Refusing to modify any database except primehire_admin_v2.')
    client = AsyncIOMotorClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
    try:
        db = client['primehire_admin_v2']
        users = UserRepository(db)
        if await users.get_by_email(email, 'default'):
            raise SystemExit('Account already exists; no changes made.')
        user = await users.create({'orgId':'default','email':email,'name':name,
            'role':'super_admin','isActive':True,'passwordHash':''})
        token = generate_opaque_token()
        await InvitationRepository(db).create_invitation(user_id=user['userId'],org_id='default',
            token_hash=hash_token(token),kind='invite',created_by='v2-bootstrap',
            expires_at=utcnow()+INVITE_TOKEN_LIFETIME)
        # This is the disposable account seeded into the NEW database.
        # No V1 user or database is queried or updated.
        await db['users'].update_one({'email':'admin@primehire.ai','orgId':'default',
            'role':'super_admin','lastLoginAt':None}, {'$set':{'isActive':False,'updatedAt':utcnow()}})
        await AuditLogRepository(db).log(org_id='default',actor_user_id='v2-bootstrap',
            action='user.invited',resource_type='user',resource_id=user['userId'],
            details={'role':'super_admin','source':'v2-bootstrap'})
        destination = ROOT / 'v2-admin-invite.txt'
        destination.write_text(f'Prime Hire V2 administrator: {email}\n\nOpen this private, one-use link to create your password:\nhttp://localhost:3000/accept-invite#token={token}\n\nKeep this file private and remove it after setup.\n',encoding='utf-8')
        print(f'V2 administrator invited: {email}. Private link saved to v2-admin-invite.txt.')
    finally:
        client.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--email',required=True)
    parser.add_argument('--name',required=True)
    arguments = parser.parse_args()
    asyncio.run(invite(arguments.email,arguments.name))
