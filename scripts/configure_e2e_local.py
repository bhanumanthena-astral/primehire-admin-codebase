"""Configure local V2 against its isolated E2E PostgreSQL test copy, without printing secrets."""
import json
import shutil
import sys
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import dotenv_values

ROOT=Path(__file__).resolve().parents[1]


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-env',type=Path,required=True)
    args=parser.parse_args()
    values=dotenv_values(args.test_env)
    parsed=urlsplit(values.get('POSTGRES_URL',''))
    if (parsed.hostname!='127.0.0.1' or parsed.port!=25432 or parsed.username!='elitehr_local'
            or parsed.path!='/elitehr_v2_validation' or not parsed.password):
        raise SystemExit('Use the dedicated loopback PostgreSQL testing credentials')
    target=ROOT/'backend/.env'
    previous=dotenv_values(target)
    if previous.get('MONGODB_DATABASE')!='primehire_admin_v2':
        raise SystemExit('Local configuration must already be isolated V2')
    backup=ROOT/'backend/secrets/backend-before-e2e-postgres-20261104.env'
    backup.parent.mkdir(parents=True,exist_ok=True)
    if backup.exists():
        current=urlsplit(previous.get('POSTGRES_URL',''))
        if previous.get('DATABASE_BACKEND')!='postgresql' or current.username!='elitehr_local' or current.path!='/elitehr_v2_validation':
            raise SystemExit('Original configuration is already backed up; refusing to replace another setup')
    else:
        shutil.copy2(target,backup)
    updates={**values,'ENV':'local','RESUME_MODULE_V2_ENABLED':'true','RECRUITMENT_PORTALS_ENABLED':'true',
        'GOOGLE_OAUTH_ENABLED':'true','GOOGLE_REDIRECT_URI':'http://localhost:3000/api/auth/google/callback',
        'EMAIL_DRY_RUN':'true','RECRUITMENT_EMAIL_DRY_RUN':'true',
        'RESUME_CLAMD_HOST':'127.0.0.1','RESUME_CLAMD_PORT':'13310','CLAMAV_ENABLED':'true',
        'RESUME_WORKER_CONCURRENCY':'1','FREE_TIER_GUARD_ENABLED':'false','RESUME_KAFKA_ENABLED':'false',
        'STORAGE_DIR':str(ROOT/'backend/runtime/e2e-local-storage'),
        'ALLOWED_ORIGINS':'http://localhost:3000,http://127.0.0.1:3000'}
    # Preserve the effective source identity/encryption keys and the same
    # provider account the existing local launcher uses. Never print values.
    updates['RESUME_IDENTITY_SECRET']=previous.get('RESUME_IDENTITY_SECRET') or previous.get('JWT_SECRET','')
    updates['OUTBOX_ENCRYPTION_KEY']=previous.get('OUTBOX_ENCRYPTION_KEY') or previous.get('RECRUITMENT_OUTBOX_ENCRYPTION_KEY','')
    form=dotenv_values(ROOT/'.env')
    for source_key,destination_key in [('BACKEND_URL','PRIMEHIRE_BASE_URL'),('PRIMEHIRE_ACCESS_KEY','PRIMEHIRE_ACCESS_KEY'),('PRIMEHIRE_SECRET_KEY','PRIMEHIRE_SECRET_KEY')]:
        if form.get(source_key):updates[destination_key]=form[source_key]
    if not previous.get('ZEPTOMAIL_API_KEY') and form.get('ZEPTOMAIL_API_KEY'):
        updates['ZEPTOMAIL_API_KEY']=form['ZEPTOMAIL_API_KEY']
    retained=[line for line in target.read_text(encoding='utf-8').splitlines()
              if line.partition('=')[0].strip() not in updates]
    content='\n'.join(retained)+'\n\n# Isolated E2E PostgreSQL local test copy; production database is inaccessible.\n'
    content+=''.join(key+'='+json.dumps(str(value))+'\n' for key,value in updates.items())
    target.write_text(content,encoding='utf-8')
    print('Local V2 uses the isolated PostgreSQL test copy, localhost Google callback and dry-run email.')


if __name__=='__main__':main()
