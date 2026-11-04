"""Root-only encrypted PostgreSQL + V2 files backup; no credentials in argv/logs."""
import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, '/opt/elitehr/current')
from deploy.e2e.migrate_v2 import decrypt, encrypt

ROOT = Path('/var/lib/elitehr/backups')
STORAGE = Path('/var/lib/elitehr/storage')
KEY = Path('/etc/elitehr/backup.key')
UNITS = ['elitehr@'+role+'.service' for role in ['api','resume','assessment','recruitment','scheduler']]


def run(arguments, **kwargs):
    result=subprocess.run(arguments,stderr=subprocess.PIPE,**kwargs)
    if result.returncode:
        raise RuntimeError('Backup operation failed: '+Path(arguments[0]).name)
    return result


def check_restore(dump):
    from dotenv import dotenv_values
    from urllib.parse import urlsplit, urlunsplit
    import psycopg
    dsn=dotenv_values('/etc/elitehr/postgres.env')['POSTGRES_URL']
    parsed=urlsplit(dsn)
    validation=urlunsplit(parsed._replace(path='/elitehr_v2_validation'))
    with psycopg.connect(validation) as connection:
        if connection.execute("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='elitehr')").fetchone()[0]:
            raise RuntimeError('Restore verification schema already exists; refusing overwrite')
    with dump.open('rb') as stream:
        run(['runuser','-u','postgres','--','pg_restore','--exit-on-error','--no-owner','--no-privileges',
             '--role=elitehr_app','--dbname=elitehr_v2_validation'],stdin=stream,stdout=subprocess.DEVNULL)
    from psycopg import sql
    with psycopg.connect(dsn) as live, psycopg.connect(validation) as restored:
        tables=live.execute("SELECT tablename FROM pg_tables WHERE schemaname='elitehr' ORDER BY tablename").fetchall()
        for (name,) in tables:
            query=sql.SQL('SELECT count(*),md5(COALESCE(string_agg(md5(doc::text),\'\' ORDER BY id),\'\')) FROM {}.{}').format(sql.Identifier('elitehr'),sql.Identifier(name)) if name!='_store_indexes' else sql.SQL('SELECT count(*) FROM {}.{}').format(sql.Identifier('elitehr'),sql.Identifier(name))
            if live.execute(query).fetchone()!=restored.execute(query).fetchone():
                raise RuntimeError('PostgreSQL restore content verification failed')
    return True


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-restore',action='store_true')
    args=parser.parse_args()
    if os.geteuid()!=0 or not Path('/etc/elitehr/migration-verified.json').is_file():
        raise SystemExit('Verified E2E migration and root access are required')
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    if shutil.disk_usage(ROOT).free/shutil.disk_usage(ROOT).total<0.30:
        raise SystemExit('Insufficient backup headroom; application remains running')
    if not KEY.exists():
        with KEY.open('xb') as stream: stream.write(os.urandom(32))
        KEY.chmod(0o600)
    active=[unit for unit in UNITS if subprocess.run(['systemctl','is-active','--quiet',unit],stdout=subprocess.DEVNULL).returncode==0]
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target=ROOT/('elitehr-postgres-'+stamp+'.enc')
    verified=False
    try:
        if active: run(['systemctl','stop',*active],stdout=subprocess.DEVNULL)
        with tempfile.TemporaryDirectory(prefix='backup-',dir=ROOT) as temporary:
            base=Path(temporary);dump=base/'postgres.dump';payload=base/'backup.tar.gz'
            with dump.open('xb') as stream:
                run(['runuser','-u','postgres','--','pg_dump','--format=custom','--no-owner','--no-privileges','elitehr_v2'],stdout=stream)
            with tarfile.open(payload,'w:gz') as archive:
                archive.add(dump,'postgres.dump')
                for name in ['backend.env','postgres.env']:
                    archive.add(Path('/etc/elitehr')/name,'private/'+name)
                for file in sorted(STORAGE.rglob('*')):
                    if file.is_symlink() or not file.resolve().is_relative_to(STORAGE.resolve()):
                        raise RuntimeError('Unsafe storage path in backup')
                    if file.is_file(): archive.add(file,'storage/'+file.relative_to(STORAGE).as_posix())
            encrypt(payload,target,KEY.read_bytes())
            # Verify authenticated decryption even for normal daily backups.
            checked=base/'checked.tar.gz'
            decrypt(target,checked,KEY.read_bytes())
            if hashlib.sha256(payload.read_bytes()).digest()!=hashlib.sha256(checked.read_bytes()).digest():
                raise RuntimeError('Backup verification failed')
            if args.verify_restore: verified=check_restore(dump)
    finally:
        if active: run(['systemctl','start',*active],stdout=subprocess.DEVNULL)
    report={'backup':target.name,'encrypted':True,'authenticatedDecryptionVerified':True,
            'postgresRestoreVerified':verified,'bytes':target.stat().st_size}
    (ROOT/'latest.json').write_text(json.dumps(report),encoding='utf-8')
    (ROOT/'latest.json').chmod(0o600)
    print(json.dumps(report))


if __name__=='__main__':main()
