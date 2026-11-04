"""Module 4 metadata-only safety snapshot and additive migration verification."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import settings
from app.db.mongodb import get_database
from migrations.candidate_management_v2 import upgrade


async def main():
    if settings.mongodb_database!='primehire_admin_v2' or not settings.mongodb_uri:
        raise SystemExit('Refusing an unverified V2 configuration')
    db=get_database(settings.mongodb_uri,settings.mongodb_database)
    try:
        v1=db.client['primehire_admin']
        counts={name:await v1[name].count_documents({}) for name in ['users','jobs','applicants','applications','resume_files','assessments','candidates']}
        path=Path(__file__).resolve().parents[1]/'backend/runtime/module4-v1-snapshot.json'
        if '--snapshot' in sys.argv:
            if path.exists(): raise SystemExit('Baseline exists; use --verify')
            path.write_text(json.dumps(counts),encoding='utf-8')
            print(json.dumps({'v1SnapshotSaved':True,'migrationPlan':await upgrade(db,dry_run=True),
                'v2People':await db['applicants'].count_documents({}),
                'v2LegacyAssessmentRecords':await db['candidates'].count_documents({}),
                'v2LegacyWithOrg':await db['candidates'].count_documents({'orgId':{'$exists':True}}),
                'linkEncryptionConfigured':bool(settings.outbox_encryption_key or settings.recruitment_outbox_encryption_key)}))
        else:
            if not path.exists() or json.loads(path.read_text())!=counts:
                raise SystemExit('V1 safety counts differ; investigate concurrent activity')
            applied=await db['migrations'].find_one({'version':'010_candidate_management_v2'})
            print(json.dumps({'v1CountsUnchanged':True,'migration010Applied':bool(applied),
                'linkEncryptionConfigured':bool(settings.outbox_encryption_key or settings.recruitment_outbox_encryption_key)}))
    finally: db.client.close()


if __name__=='__main__':
    try: asyncio.run(main())
    except Exception as error:
        category='TLS handshake failed' if 'SSL handshake' in str(error) else type(error).__name__
        raise SystemExit('Read-only preflight unavailable: '+category) from None
