#!/usr/bin/env bash
# Run after a public hostname resolves to this host and OCI ingress permits 80/443.
set -Eeuo pipefail
[[ ${EUID} -eq 0 && -f /etc/elitehr/host-provisioned ]] || exit 1
api_host=${1:?Pass your public API hostname without https or a path}
python3 - "$api_host" <<'PY'
import re, sys, ipaddress
host = sys.argv[1]
if len(host) > 253 or '.' not in host or not all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', p) for p in host.split('.')):
    raise SystemExit('A valid public DNS hostname is required.')
try:
    ipaddress.ip_address(host)
except ValueError:
    pass
else:
    raise SystemExit('Use a DNS hostname for public HTTPS.')
if host.endswith(('.localhost','.local','.invalid','.example','.test')):
    raise SystemExit('Use your actual public DNS hostname.')
PY
curl --fail --silent --output /dev/null http://127.0.0.1:8002/api/ready
[[ ! -e /etc/caddy/Caddyfile && ! -e /etc/elitehr/https-configured ]] || { echo 'Existing Caddy configuration found; review manually.' >&2; exit 1; }
# Official Caddy signed apt repository. Download scripts are not executed.
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl --fail --silent --show-error https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl --fail --silent --show-error https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
systemctl stop caddy
install -m 0644 /opt/elitehr/current/deploy/oracle/Caddyfile.example /etc/caddy/Caddyfile
install -d -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=API_HOST=%s\n' "$api_host" > /etc/systemd/system/caddy.service.d/elitehr.conf
API_HOST="$api_host" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now caddy
touch /etc/elitehr/https-configured
echo 'HTTPS proxy enabled. Verify its certificate and /api/ready externally before frontend cutover.'
