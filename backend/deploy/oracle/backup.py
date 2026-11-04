"""Encrypted, consistent V2 backup during an explicit single-host maintenance window."""
import fcntl
import hashlib
import os
import shutil
from pathlib import Path
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone

UNITS = ['elitehr@api','elitehr@resume','elitehr@recruitment','elitehr@scheduler']


def backup():
    root = Path('/var/lib/elitehr/backups')
    config = Path('/etc/elitehr')
    if not (config/'host-provisioned').is_file() or not (config/'backup.passphrase').is_file():
        raise RuntimeError('Backup prerequisites are not configured.')
    from dotenv import dotenv_values
    from app.config import Settings
    from deploy.runtime import validate_deployment
    values = dotenv_values(config/'backend.env')
    settings = Settings(_env_file=None, **{key.lower():value for key,value in values.items() if value is not None})
    validate_deployment(settings)
    # Temporary dump + tar + encrypted output coexist. Reserve headroom, fail before pausing writers.
    storage_size = sum(p.stat().st_size for p in Path(settings.storage_dir).rglob('*') if p.is_file())
    if shutil.disk_usage(root).free < max(4*1024**3, storage_size*4):
        raise RuntimeError('Insufficient free disk space for an encrypted backup.')
    if settings.free_tier_guard_enabled:
        from app.services.capacity_guard import require_capacity
        require_capacity(required_bytes=max(4*1024**3, storage_size*4), config=settings)
    # The dump is scoped to V2 and app writers are paused for DB/file consistency.
    active = [unit for unit in UNITS if subprocess.run(['systemctl','is-active','--quiet',unit]).returncode == 0]
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination = root/f'elitehr-v2-{stamp}.tar.gpg'
    if destination.exists():raise RuntimeError('Backup already exists')
    try:
        if active:subprocess.run(['systemctl','stop',*active],check=True,timeout=120,capture_output=True)
        with tempfile.TemporaryDirectory(prefix='.elitehr-backup-',dir=root) as folder:
            work = Path(folder)
            subprocess.run(['mongodump','--config',str(config/'mongo-backup.yml'),
                '--db','primehire_admin_v2','--gzip','--archive='+str(work/'database.gz')],
                check=True,timeout=1800,capture_output=True)
            with tarfile.open(work/'snapshot.tar','w') as archive:
                archive.add(work/'database.gz',arcname='database.gz')
                archive.add(settings.storage_dir,arcname='storage')
                archive.add(config/'backend.env',arcname='backend.env')
                archive.add(Path('/opt/elitehr/current/release.json'),arcname='release.json')
            subprocess.run(['gpg','--batch','--pinentry-mode','loopback','--symmetric',
                '--cipher-algo','AES256','--passphrase-file',str(config/'backup.passphrase'),
                '--output',str(work/'snapshot.gpg'),str(work/'snapshot.tar')],
                check=True,timeout=1800,capture_output=True)
            os.chmod(work/'snapshot.gpg',0o600)
            os.rename(work/'snapshot.gpg',destination)
        checksum = hashlib.sha256()
        with destination.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):checksum.update(chunk)
        destination.with_suffix(destination.suffix+'.sha256').write_text(checksum.hexdigest()+'\n',encoding='utf-8')
        print('Encrypted V2 backup completed. Transfer it off this VM and retain the backup key separately.')
    finally:
        if active:subprocess.run(['systemctl','start',*active],check=True,timeout=180,capture_output=True)


if __name__ == '__main__':
    if os.geteuid()!=0:raise SystemExit('Run backup as root.')
    os.umask(0o077)
    try:
        with open('/run/lock/elitehr-operations.lock','w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            backup()
    except Exception as error:
        raise SystemExit('V2 backup failed: '+type(error).__name__) from None
