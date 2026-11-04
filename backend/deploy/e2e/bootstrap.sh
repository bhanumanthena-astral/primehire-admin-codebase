#!/usr/bin/env bash
# Base provisioning on the user's NEW dedicated Ubuntu 24.04 E2E VM.
# Application services remain stopped. PostgreSQL listens on loopback only.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Run as root on the dedicated E2E VM.' >&2; exit 1; }
source /etc/os-release
[[ ${ID} == ubuntu && ${VERSION_ID} == 24.04 && $(uname -m) == x86_64 ]] || exit 1
[[ ! -e /etc/elitehr/e2e-provisioned ]] || { echo 'E2E base already provisioned.'; exit 0; }
if command -v psql >/dev/null || command -v mongod >/dev/null; then
    echo 'Existing database installation found; inspect it before provisioning.' >&2
    exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql postgresql-contrib python3-venv python3-pip rsync \
    clamav clamav-daemon clamav-freshclam tesseract-ocr-eng antiword nginx
getent passwd elitehr >/dev/null || useradd --system --home-dir /var/lib/elitehr --shell /usr/sbin/nologin elitehr
install -d -m 0755 /opt/elitehr /opt/elitehr/releases
install -d -o root -g elitehr -m 0750 /etc/elitehr
install -d -o elitehr -g elitehr -m 0700 /var/lib/elitehr /var/lib/elitehr/storage
install -d -o root -g root -m 0700 /var/lib/elitehr/backups
systemctl enable --now postgresql
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q -c "ALTER SYSTEM SET listen_addresses='127.0.0.1'"
systemctl restart postgresql
python3 - <<'PY'
import os, secrets, subprocess
from pathlib import Path
password = secrets.token_urlsafe(48)
commands = (
    f"CREATE ROLE elitehr_app LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n"
    "CREATE DATABASE elitehr_v2 OWNER elitehr_app;\n"
    "CREATE DATABASE elitehr_v2_validation OWNER elitehr_app;\n"
    "REVOKE ALL ON DATABASE elitehr_v2 FROM PUBLIC;\n"
    "REVOKE ALL ON DATABASE elitehr_v2_validation FROM PUBLIC;\n"
)
result = subprocess.run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1','-q'],input=commands,text=True,capture_output=True)
if result.returncode:
    raise SystemExit('Database provisioning failed; inspect the host privately before retrying.')
target = Path('/etc/elitehr/postgres.env')
with target.open('x') as stream:
    stream.write('DATABASE_BACKEND=postgresql\nMONGODB_DATABASE=primehire_admin_v2\nMONGODB_URI=\n'
                 f'POSTGRES_URL=postgresql://elitehr_app:{password}@127.0.0.1:5432/elitehr_v2\nPOSTGRES_SCHEMA=elitehr\n')
os.chown(target,0,__import__('grp').getgrnam('elitehr').gr_gid)
target.chmod(0o640)
PY
# Keep distribution HTTP service stopped until the app is ready.
systemctl disable --now nginx
touch /etc/elitehr/e2e-provisioned
echo 'E2E base provisioned. PostgreSQL is private; app and web services are not started.'
