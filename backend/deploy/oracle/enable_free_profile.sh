#!/usr/bin/env bash
# Dedicated, already bootstrapped Oracle Ubuntu host only. No OCI provisioning.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
[[ -f /etc/elitehr/host-provisioned ]] || { echo 'Bootstrap the dedicated host first.' >&2; exit 1; }
[[ -f /sys/fs/cgroup/cgroup.controllers ]] || { echo 'cgroup v2 is required.' >&2; exit 1; }
[[ ! -f /etc/elitehr/free-profile-enabled ]] || { echo 'Profile already installed; inspect instead of rerunning.' >&2; exit 1; }
grep -q 'VERSION_ID="24.04"' /etc/os-release || exit 1
# Refuse undersized or unexpectedly sized hosts; this profile is sized for 8 GB.
awk '/MemTotal/ { if ($2 < 7000000 || $2 > 9000000) exit 1 }' /proc/meminfo || {
    echo 'Expected a dedicated 8 GB host; do not resize automatically.' >&2; exit 1;
}
[[ $(nproc) -eq 1 ]] || { echo 'Expected exactly one allocated CPU; do not resize automatically.' >&2; exit 1; }
source_root=/opt/elitehr/current
[[ -f "$source_root/deploy/oracle/elitehr.slice" ]] || exit 1
# Do not mix an old Mongo-only parser with Kafka consumers during installation.
systemctl stop elitehr@resume elitehr@api elitehr@scheduler elitehr@recruitment
apt-get update
apt-get install -y docker.io iproute2
systemctl enable --now docker
[[ $(docker info --format '{{.CgroupDriver}}') == systemd ]] || {
    echo 'Docker must use the systemd cgroup driver.' >&2; exit 1;
}
docker pull apache/kafka:4.3.2
install -d -m 0700 -o 1000 -g 1000 /var/lib/elitehr/kafka
install -m 0644 "$source_root/deploy/oracle/elitehr-egress.service" /etc/systemd/system/elitehr-egress.service
install -m 0644 "$source_root/deploy/oracle/elitehr.slice" /etc/systemd/system/elitehr.slice
install -m 0644 "$source_root/deploy/oracle/elitehr-kafka.service" /etc/systemd/system/elitehr-kafka.service
# Every app service, scanner, Mongo and proxy shares the aggregate cap.
for unit in elitehr@ elitehr-backup mongod clamav-daemon clamav-freshclam caddy; do
    install -d -m 0755 "/etc/systemd/system/${unit}.service.d"
    printf '[Service]\nSlice=elitehr.slice\n' > "/etc/systemd/system/${unit}.service.d/free-profile.conf"
done
# Public/API services must not run if the egress limiter could not start.
for unit in elitehr@ caddy; do
    printf '[Unit]\nRequires=elitehr-egress.service\nAfter=elitehr-egress.service\n' > "/etc/systemd/system/${unit}.service.d/egress.conf"
done
install -d -m 0755 /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=128M\nRuntimeMaxUse=32M\n' > /etc/systemd/journald.conf.d/elitehr.conf
"$source_root/.venv/bin/python" - "$source_root" <<'PY'
import base64
import os
import re
import sys
from pathlib import Path
root = Path(sys.argv[1])
template = (root/'deploy/oracle/kafka.env.example').read_text()
cluster = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip('=')
target = Path('/etc/elitehr/kafka.env')
with target.open('x') as stream:
    stream.write(template.replace('__GENERATED_LOCALLY__', cluster))
target.chmod(0o600)
env = Path('/etc/elitehr/backend.env')
text = env.read_text()
values = {'FREE_TIER_GUARD_ENABLED': 'true', 'FREE_TIER_ACTIVE_RESUME_LIMIT': '1000',
    'RESUME_KAFKA_ENABLED': 'true', 'RESUME_KAFKA_BOOTSTRAP_SERVERS': '127.0.0.1:9092',
    'RESUME_WORKER_CONCURRENCY': '1', 'RESUME_UPLOAD_CONCURRENCY': '2'}
for name, value in values.items():
    text = re.sub(r'^'+name+r'=.*\n?', '', text, flags=re.M)
    text += '\n'+name+'='+value+'\n'
env.write_text(text)
PY
systemctl daemon-reload
systemctl restart mongod clamav-daemon clamav-freshclam
systemctl try-restart caddy
systemctl restart systemd-journald
systemctl enable --now elitehr-egress
systemctl enable --now elitehr-kafka
touch /etc/elitehr/free-profile-enabled
echo 'Free host profile installed. API, intake and delivery workers remain stopped.'
echo 'Check private configuration and readiness, then start elitehr@api and elitehr@resume.'
echo 'This caps local resources; OCI account quotas and tenancy-wide usage still require verification.'
