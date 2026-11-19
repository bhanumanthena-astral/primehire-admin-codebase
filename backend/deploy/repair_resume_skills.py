"""Explicit single-job suggestion repair; dry-run unless --apply is supplied."""
import argparse
import asyncio
import json
from dotenv import load_dotenv


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',default='/etc/elitehr/backend.env')
    parser.add_argument('--job-key',required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--expected-count',type=int)
    args=parser.parse_args()
    load_dotenv(args.env_file)
    from app.config import settings
    from app.db.postgres import PostgresDatabase
    from app.services.resume_skill_repair import repair_job
    if settings.database_backend!='postgresql':raise SystemExit('This operation requires the verified PostgreSQL backend')
    async def run():
        db=PostgresDatabase(settings.postgres_url,settings.mongodb_database,settings.postgres_schema)
        try:print(json.dumps(await repair_job(db,args.job_key,apply=args.apply,expected_count=args.expected_count)))
        finally:db.close()
    asyncio.run(run())


if __name__=='__main__':main()
