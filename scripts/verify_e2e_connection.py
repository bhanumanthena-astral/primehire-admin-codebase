"""Check the isolated localhost PostgreSQL connection without printing credentials."""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))


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
    if not settings.email_dry_run or settings.recruitment_email_dry_run is not True:
        raise SystemExit('Local development must keep invitation and recruitment email in dry-run mode.')
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
