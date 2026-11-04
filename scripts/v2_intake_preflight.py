"""Read-only V2 migration plan and V1 count snapshot; never prints credentials."""
import asyncio
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from app.config import settings
from app.db.mongodb import get_database
from migrations.runner import run_migrations
from migrations.resume_intake_v2 import upgrade


async def main():
    assert settings.mongodb_database=='primehire_admin_v2' and settings.mongodb_uri
    settings.resume_module_v2_enabled=True
    db=get_database(settings.mongodb_uri,settings.mongodb_database)
    pending=await run_migrations(db,dry_run=True)
    v1=db.client['primehire_admin']
    snapshot={name:await v1[name].count_documents({}) for name in ['jobs','users','applicants','applications','resume_files']}
    target=ROOT/'backend/runtime/v1-count-snapshot.json'
    if '--verify' in sys.argv:
        assert snapshot==json.loads(target.read_text()),'V1 counts changed during the activation window; investigate concurrent activity.'
        print('V1 collection counts match the pre-activation snapshot.')
        from datetime import datetime,timezone
        migration=await db['migrations'].find_one({'version':'006_resume_intake_v2'})
        worker=await db['resume_intake_limits'].find_one({'kind':'worker','expiresAt':{'$gt':datetime.now(timezone.utc)}})
        print(json.dumps({'module2MigrationApplied':bool(migration),'workerHealthy':bool(worker),
            'scannerReady':bool(worker and worker.get('scannerReady'))}))
    else:
        target.write_text(json.dumps(snapshot),encoding='utf-8')
        print(json.dumps({'target':'primehire_admin_v2','pendingMigrations':[row['version'] for row in pending],
            'module2':await upgrade(db,dry_run=True),'v1SnapshotSaved':True}))
    db.client.close()


asyncio.run(main())
