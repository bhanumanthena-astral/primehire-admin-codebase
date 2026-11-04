"""Read-only V1 snapshot and V2 recruitment migration/worker verification."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import settings
from app.db.mongodb import get_database
from app.models.recruitment import now
from migrations.recruitment_v2 import upgrade
from migrations.talent_v2 import upgrade as upgrade_talent


async def main():
    if settings.mongodb_database != "primehire_admin_v2" or not settings.mongodb_uri:
        raise SystemExit("V2 database configuration is required")
    db = get_database(settings.mongodb_uri, settings.mongodb_database)
    v1 = db.client["primehire_admin"]
    counts = {
        name: await v1[name].count_documents({})
        for name in ["users", "jobs", "applicants", "applications", "resume_files"]
    }
    path = (
        Path(__file__).resolve().parents[1]
        / "backend/runtime/recruitment-v1-snapshot.json"
    )
    if "--verify" in sys.argv:
        assert counts == json.loads(
            path.read_text()
        ), "V1 counts changed; investigate activity before claiming isolation."
        migration = await db["migrations"].find_one({"version": "007_recruitment_v2"})
        heartbeat = await db["recruit_leases"].find_one(
            {"_id": "recruit-worker-heartbeat", "expiresAt": {"$gt": now()}}
        )
        print(
            json.dumps(
                {
                    "v1CountsUnchanged": True,
                    "migration007Applied": bool(migration),
                    "migration008Applied": bool(await db['migrations'].find_one({'version':'008_talent_v2'})),
                    "recruitmentWorkerHealthy": bool(heartbeat),
                }
            )
        )
    else:
        path.write_text(json.dumps(counts), encoding="utf-8")
        print(
            json.dumps(
                {
                    "target": "primehire_admin_v2",
                    "v1ReadOnlySnapshotSaved": True,
                    "plan": await upgrade(db, dry_run=True),
                    "talentPlan": await upgrade_talent(db, dry_run=True),
                }
            )
        )
    db.client.close()


if __name__ == "__main__":
    asyncio.run(main())
