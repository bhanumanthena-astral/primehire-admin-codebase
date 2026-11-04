"""Process explicitly requested V2 assessment links and invitation emails."""
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.config import settings, validate_settings
from app.db.mongodb import get_database
from app.services.worker import run_forever

if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--results-only',action='store_true',help='Sync existing assessment/report results without generating links or sending invitations.')
    modes.add_argument('--no-email',action='store_true',help='Generate requested links and sync results without delivering invitations.')
    args=parser.parse_args()
    if settings.mongodb_database != 'primehire_admin_v2' or not settings.has_mongo:
        raise SystemExit('A persistent V2 database is required')
    validate_settings()
    from dotenv import dotenv_values
    from app.services.assessment_management import configure_publication
    form = dotenv_values(Path(__file__).resolve().parents[1] / '.env')
    configure_publication(form.get('BACKEND_URL') or settings.primehire_base_url,
        form.get('PRIMEHIRE_ACCESS_KEY') or settings.primehire_access_key,
        form.get('PRIMEHIRE_SECRET_KEY') or settings.primehire_secret_key)
    kinds=['assessment_sync','report_sync'] if args.results_only else ['assessment_send','assessment_sync','report_sync'] if args.no_email else ['assessment_send','email_send','assessment_sync','report_sync']
    asyncio.run(run_forever(get_database(settings.mongodb_uri, settings.mongodb_database),
        poll_seconds=2, kinds=kinds))
