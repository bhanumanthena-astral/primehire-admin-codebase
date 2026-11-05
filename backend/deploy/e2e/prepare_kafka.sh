#!/usr/bin/env bash
# Private, persistent Kafka for the dedicated E2E PostgreSQL host.
set -Eeuo pipefail
[[ ${EUID} -eq 0 && -f /etc/elitehr/e2e-provisioned ]] || exit 1
root=$(readlink -f /opt/elitehr/current)
command -v docker >/dev/null
[[ ! -e /etc/elitehr/kafka.env && ! -e /etc/systemd/system/elitehr-kafka.service ]] || {
    echo 'Existing Kafka configuration requires review.' >&2
    exit 1
}
systemctl enable --now docker
docker pull apache/kafka:4.3.2
image=$(docker image inspect apache/kafka:4.3.2 --format '{{index .RepoDigests 0}}')
[[ "$image" == apache/kafka@sha256:* ]] || exit 1
install -d -o 1000 -g 1000 -m 0750 /var/lib/elitehr/kafka
"$root/.venv/bin/python" - <<'PY'
import base64
import os
from pathlib import Path
source = Path('/opt/elitehr/current/deploy/oracle/kafka.env.example').read_text()
# Kafka's default JMX options start an unauthenticated auxiliary RMI listener.
# A nonempty, unrelated JVM option suppresses those defaults entirely.
source += '\n# No remote Java management listener on the application host.\nKAFKA_JMX_OPTS=-Djava.awt.headless=true\n'
cluster = base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip('=')
target = Path('/etc/elitehr/kafka.env')
with target.open('x') as stream:
    stream.write(source.replace('__GENERATED_LOCALLY__', cluster))
target.chmod(0o600)
PY
cat > /etc/systemd/system/elitehr-kafka.service <<UNIT
[Unit]
Description=Elite HR private persistent Kafka
Requires=docker.service
After=docker.service network-online.target
[Service]
ExecStart=/usr/bin/docker run --rm --name elitehr-kafka --network host --memory=1g --memory-swap=1g --cpus=1 --pids-limit=160 --log-opt max-size=5m --log-opt max-file=3 --env-file /etc/elitehr/kafka.env --mount type=bind,source=/var/lib/elitehr/kafka,target=/var/lib/kafka/data $image
ExecStop=/usr/bin/docker stop --time 45 elitehr-kafka
Restart=on-failure
RestartSec=10
TimeoutStopSec=60
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now elitehr-kafka
echo 'Private broker started. Verify isolated workloads before enabling application dispatch.'
