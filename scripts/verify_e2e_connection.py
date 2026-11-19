"""Check the isolated localhost PostgreSQL connection without printing credentials."""
import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))


def mail_mode_allowed(settings, recipient):
    if settings.email_dry_run and settings.recruitment_email_dry_run is True:
        return True
    recipient = recipient.strip().lower()
    valid = bool(re.fullmatch(r"[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+", recipient))
    staff = [value.strip().lower() for value in settings.recruitment_email_test_recipient_allowlist.split(',') if value.strip()]
    return (valid and not settings.email_dry_run and settings.recruitment_email_dry_run is False
            and settings.test_recipient_allowlist == [recipient] and staff == [recipient])


def main():
    from app.config import settings
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-only',action='store_true')
    args=parser.parse_args()
    uri=urlsplit(settings.postgres_url)
    if (settings.database_backend!='postgresql' or settings.is_production
        or uri.hostname!='127.0.0.1' or uri.port!=25432
        or uri.username!='elitehr_local' or uri.path!='/elitehr_v2_validation'):
        raise SystemExit('Local development must use the isolated E2E PostgreSQL test configuration. Run scripts/configure_e2e_local.py first.')
    if not mail_mode_allowed(settings, os.environ.get('ELITEHR_LOCAL_TEST_EMAIL', '')):
        raise SystemExit('Use email dry-run or the explicit single-recipient local test mode.')
    if args.config_only:
        return
    import psycopg
    try:
        with psycopg.connect(settings.postgres_url,connect_timeout=5) as connection:
            row=connection.execute("SELECT current_database(),current_user,has_database_privilege(current_user,'elitehr_v2','CONNECT')").fetchone()
            print(json.dumps({'database':row[0],'role':row[1],'productionAccess':row[2],'connected':True}))
    except psycopg.Error:
        raise SystemExit('E2E test database is unreachable. Run npm run dev:local to reconnect the private tunnel.') from None


if __name__=='__main__':main()
