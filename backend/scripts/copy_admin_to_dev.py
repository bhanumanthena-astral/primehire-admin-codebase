"""Copy primehire_admin collections into primehire_dev for safe rehearsal.

READ-ONLY on the source database: only find()/count_documents(). All writes
go to the target (default primehire_dev). Refuses to run when source and
target are the same database, and requires --allow-prod when the target is
primehire_admin.

Usage (from backend/, backend\\.venv):
    .\\.venv\\Scripts\\python -m scripts.copy_admin_to_dev
    .\\.venv\\Scripts\\python -m scripts.copy_admin_to_dev --target primehire_dev2
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.db.mongodb import get_database  # noqa: E402

DATA_COLLECTIONS = ("assessments", "candidates", "reports", "templates", "organizations")


async def copy_collection(db_from: object, db_to: object, name: str) -> tuple[int, int]:
    docs = await db_from[name].find({}).to_list(length=100000)
    await db_to[name].delete_many({})
    if docs:
        await db_to[name].insert_many(docs)
    return len(docs), await db_to[name].count_documents({})


async def main() -> int:
    parser = argparse.ArgumentParser(description="Clone admin collections into a dev database (read-only source).")
    parser.add_argument("--source", default=None, help="Source database (default: settings MONGODB_DATABASE).")
    parser.add_argument("--target", default="primehire_dev", help="Target database (default: primehire_dev).")
    parser.add_argument("--allow-prod", action="store_true",
                        help="Required when the target is primehire_admin.")
    args = parser.parse_args()

    if not settings.has_mongo:
        print("MONGODB_URI not configured. Aborting.")
        return 2
    source_name = args.source or settings.mongodb_database
    target_name = args.target
    if source_name == target_name:
        print(f"Refusing: source and target are both '{source_name}'. Aborting.")
        return 2
    if target_name == "primehire_admin" and not args.allow_prod:
        print("Refusing to write primehire_admin without --allow-prod. Aborting.")
        return 2

    db_from = get_database(settings.mongodb_uri, source_name)
    db_to = get_database(settings.mongodb_uri, target_name)
    print(f"Copying {source_name} -> {target_name} (source is read-only)")
    total = 0
    for col in DATA_COLLECTIONS:
        try:
            copied, verified = await copy_collection(db_from, db_to, col)
        except Exception as exc:  # noqa: BLE001
            print(f"  {col}: SKIPPED ({type(exc).__name__})")
            continue
        total += copied
        print(f"  {col}: copied {copied}, verified {verified}")
    print(f"Done. {total} documents cloned. Rehearse imports against '{target_name}'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
