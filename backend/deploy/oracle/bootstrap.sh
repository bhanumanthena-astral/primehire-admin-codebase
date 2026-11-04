#!/usr/bin/env bash
# NEW dedicated Ubuntu 24.04 VM only. Never run on a V1/shared database host.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Run as root on the new Oracle VM.' >&2; exit 1; }
source /etc/os-release
[[ ${ID} == ubuntu && ${VERSION_ID} == 24.04 ]] || { echo 'Requires Ubuntu 24.04 LTS.' >&2; exit 1; }
case "$(uname -m)" in aarch64|x86_64) ;; *) echo 'Unsupported CPU architecture.' >&2; exit 1;; esac
release_source=$(realpath "${1:?Pass the extracted backend release directory}")
[[ -f "$release_source/release.json" && -f "$release_source/deploy/runtime.py" ]] || { echo 'Missing verified release.' >&2; exit 1; }
[[ ! -e /etc/elitehr/host-provisioned ]] || { echo 'Host is already provisioned; use the release update procedure.' >&2; exit 1; }
# Refuse existing installations/data rather than adopting or resetting them.
if command -v mongod >/dev/null || [[ -d /var/lib/mongodb && -n "$(find /var/lib/mongodb -mindepth 1 -print -quit)" ]]; then
    echo 'Existing MongoDB found. Refusing to touch it.' >&2; exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg python3 python3-venv rsync clamav clamav-daemon clamav-freshclam tesseract-ocr-eng antiword ufw
version=$(python3 "$release_source/deploy/build_release.py" --root "$release_source" --verify)
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || exit 1
getent passwd elitehr >/dev/null || useradd --system --home-dir /var/lib/elitehr --shell /usr/sbin/nologin elitehr
install -d -m 0755 /opt/elitehr /opt/elitehr/releases
install -d -o root -g elitehr -m 0750 /etc/elitehr
install -d -o elitehr -g elitehr -m 0700 /var/lib/elitehr /var/lib/elitehr/storage
install -d -o root -g root -m 0700 /var/lib/elitehr/backups
release_target="/opt/elitehr/releases/$version"
[[ ! -e "$release_target" && ! -e /opt/elitehr/current ]] || { echo 'Release target exists; refusing overwrite.' >&2; exit 1; }
install -d -m 0755 "$release_target"
rsync -a --chmod=D755,F644 "$release_source/" "$release_target/"
python3 -m venv "$release_target/.venv"
"$release_target/.venv/bin/python" -m pip install --disable-pip-version-check -r "$release_target/requirements-production.txt"
# Official MongoDB 8.0 signed repository; compatible OS/CPU still checked on host.
curl --fail --silent --show-error https://pgp.mongodb.com/server-8.0.asc | gpg --batch --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg
printf '%s\n' 'deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse' > /etc/apt/sources.list.d/mongodb-org-8.0.list
chmod 0644 /usr/share/keyrings/mongodb-server-8.0.gpg /etc/apt/sources.list.d/mongodb-org-8.0.list
apt-get update
apt-get install -y mongodb-org
systemctl stop mongod
cat > /etc/mongod.conf <<'CONFIG'
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1
systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log
net:
  bindIp: 127.0.0.1
  port: 27017
security:
  authorization: enabled
CONFIG
chmod 0644 /etc/mongod.conf
systemctl enable --now mongod
for _ in $(seq 1 30); do
    mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' >/dev/null 2>&1 && break
    sleep 2
done
"$release_target/.venv/bin/python" "$release_target/deploy/oracle/host_config.py" --template "$release_target/deploy/oracle/backend.env.example"
chown root:elitehr /etc/elitehr/backend.env
chmod 0640 /etc/elitehr/backend.env
# Fail closed while signatures are downloaded. Do not bypass malware checks.
systemctl stop clamav-daemon clamav-freshclam || true
cat > /etc/clamav/clamd.conf <<'CONFIG'
User clamav
DatabaseDirectory /var/lib/clamav
TCPSocket 3310
TCPAddr 127.0.0.1
LocalSocket /run/clamav/clamd.ctl
FixStaleSocket true
Foreground true
MaxThreads 2
MaxQueue 8
StreamMaxLength 125M
MaxScanSize 500M
MaxFileSize 125M
MaxRecursion 16
MaxFiles 10000
ReadTimeout 60
SendBufTimeout 2000
AlertExceedsMax yes
AlertEncrypted yes
CONFIG
chmod 0644 /etc/clamav/clamd.conf
freshclam --quiet
systemctl enable --now clamav-freshclam clamav-daemon
ln -s "$release_target" /opt/elitehr/current
install -m 0644 "$release_target/deploy/oracle/elitehr@.service" /etc/systemd/system/elitehr@.service
install -m 0644 "$release_target/deploy/oracle/elitehr-backup.service" /etc/systemd/system/elitehr-backup.service
install -m 0644 "$release_target/deploy/oracle/elitehr-backup.timer" /etc/systemd/system/elitehr-backup.timer
systemctl daemon-reload
# Preserve remote administrator access. Oracle's VCN must also restrict SSH to the administrator IP.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
touch /etc/elitehr/host-provisioned
echo 'Oracle host provisioned. Configure/migrate V2 securely, then run the readiness check before enabling application services.'
echo 'No public API, email delivery worker, or application service has been started.'
