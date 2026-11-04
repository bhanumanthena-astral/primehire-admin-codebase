"""Provision a PostgreSQL login restricted to the existing restored test database.

Run once as root on E2E after the backup restore verification. Production
database ownership and credentials are not changed or granted to this role.
"""
import os
import secrets
import subprocess
from pathlib import Path


def main():
    if os.geteuid()!=0: raise SystemExit('Root is required')
    destination=Path('/etc/elitehr/local-testing.env')
    if destination.exists(): raise SystemExit('Local testing is already provisioned; refusing to rotate credentials')
    password=secrets.token_urlsafe(48)
    command=f"""
CREATE ROLE elitehr_local LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE elitehr_v2_validation OWNER TO elitehr_local;
GRANT CONNECT ON DATABASE elitehr_v2_validation TO elitehr_local;
\\connect elitehr_v2_validation
ALTER SCHEMA elitehr OWNER TO elitehr_local;
ALTER FUNCTION elitehr.field(jsonb,text[]) OWNER TO elitehr_local;
ALTER FUNCTION elitehr.set_field(jsonb,text[],jsonb) OWNER TO elitehr_local;
SELECT format('ALTER TABLE %I.%I OWNER TO elitehr_local',schemaname,tablename)
FROM pg_tables WHERE schemaname='elitehr' ORDER BY tablename
\\gexec
"""
    result=subprocess.run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1','-q'],input=command,text=True,capture_output=True)
    if result.returncode: raise SystemExit('Test database provisioning failed; inspect the private host logs')
    result=subprocess.run(['runuser','-u','postgres','--','psql','-At','-c',
        "SELECT has_database_privilege('elitehr_local','elitehr_v2','CONNECT')"],text=True,capture_output=True)
    if result.returncode or result.stdout.strip()!='f':
        raise SystemExit('Test database isolation verification failed')
    with destination.open('x') as stream:
        stream.write('DATABASE_BACKEND=postgresql\nPOSTGRES_SCHEMA=elitehr\n'
            f'POSTGRES_URL=postgresql://elitehr_local:{password}@127.0.0.1:25432/elitehr_v2_validation\n')
    destination.chmod(0o600)
    print('Local PostgreSQL test login provisioned; production database access denied.')


if __name__=='__main__':main()
