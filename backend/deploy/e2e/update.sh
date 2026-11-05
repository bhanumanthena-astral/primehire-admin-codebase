#!/usr/bin/env bash
# Verified source update on the existing dedicated PostgreSQL E2E host.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 && -f /etc/elitehr/migration-verified.json ]] || exit 1
source_dir=$(realpath "${1:?Pass the extracted verified backend directory}")
version=$(python3 "$source_dir/deploy/build_release.py" --root "$source_dir" --verify)
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || exit 1
previous=$(readlink -f /opt/elitehr/current)
[[ "$previous" == /opt/elitehr/releases/* ]] || exit 1
target="/opt/elitehr/releases/$version"
[[ ! -e "$target" ]] || { echo 'Release already exists; inspect rather than overwrite.' >&2; exit 1; }
install -d -m 0755 "$target"
rsync -a --chmod=D755,F644 "$source_dir/" "$target/"
python3 -m venv "$target/.venv"
"$target/.venv/bin/python" -m pip install --disable-pip-version-check -r "$target/requirements-production.txt"
chmod -R a+rX "$target/.venv"
cd "$target"
.venv/bin/python -m deploy.e2e.preflight
/opt/elitehr/current/.venv/bin/python /usr/local/lib/elitehr/backup.py
active=()
for role in api resume assessment recruitment scheduler; do
    unit="elitehr@$role.service"
    if systemctl is-active --quiet "$unit"; then active+=("$unit"); fi
done
recover() {
    ln -sfn "$previous" /opt/elitehr/current
    if ((${#active[@]})); then systemctl start "${active[@]}"; fi
}
trap recover ERR
if ((${#active[@]})); then systemctl stop "${active[@]}"; fi
ln -sfn "$target" /opt/elitehr/current
if ((${#active[@]})); then systemctl start "${active[@]}"; fi
for _ in $(seq 1 30); do
    if curl --fail --silent --output /dev/null http://127.0.0.1:8002/api/ready; then
        trap - ERR
        echo 'Verified E2E update ready; previous release retained for rollback.'
        exit 0
    fi
    sleep 1
done
echo 'Readiness failed; reverting the code release.' >&2
recover
exit 1
