"""Read-only V1 safety counts and the isolated V2 migration plan/check."""
import asyncio
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from app.config import settings
from app.db.mongodb import get_database
from migrations.assessment_management_v2 import upgrade


async def main():
    if settings.mongodb_database!='primehire_admin_v2' or not settings.mongodb_uri:
        raise SystemExit('Refusing to inspect an unverified V2 configuration')
    db=get_database(settings.mongodb_uri,settings.mongodb_database)
    v1=db.client['primehire_admin']
    counts={name:await v1[name].count_documents({}) for name in ['users','jobs','applicants','applications','resume_files','assessments','candidates']}
    path=Path(__file__).resolve().parents[1]/'backend/runtime/module3-v1-snapshot.json'
    if '--snapshot' in sys.argv:
        if path.exists():
            raise SystemExit('A Module 3 baseline already exists; verify it instead of overwriting')
        path.write_text(json.dumps(counts),encoding='utf-8')
        print(json.dumps({'v1ReadOnlySnapshotSaved':True,'migrationPlan':await upgrade(db,dry_run=True)}))
    else:
        if not path.exists() or json.loads(path.read_text())!=counts:
            raise SystemExit('V1 counts differ from the Module 3 baseline; investigate concurrent activity')
        record=await db['migrations'].find_one({'version':'009_assessment_management_v2'})
        print(json.dumps({'v1CountsUnchanged':True,'migration009Applied':bool(record)}))
    db.client.close()


if __name__=='__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        category='TLS handshake failed' if 'SSL handshake' in str(error) else type(error).__name__
        raise SystemExit('Database preflight unavailable: '+category+'. No database changes were made.') from None
