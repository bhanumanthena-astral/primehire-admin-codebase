#!/usr/bin/env bash
# Update code on an already provisioned dedicated V2 host. Schema rollback is separate.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 && -f /etc/elitehr/host-provisioned ]] || exit 1
exec 9>/run/lock/elitehr-operations.lock
flock -n 9 || { echo 'Another deployment or backup is running.' >&2; exit 1; }
release_source=$(realpath "${1:?Pass an extracted backend release directory}")
version=$(python3 "$release_source/deploy/build_release.py" --root "$release_source" --verify)
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || exit 1
previous=$(readlink -f /opt/elitehr/current)
[[ "$previous" == /opt/elitehr/releases/* ]] || exit 1
target="/opt/elitehr/releases/$version"
[[ ! -e "$target" ]] || { echo 'Release already exists; refusing overwrite.' >&2; exit 1; }
install -d -m 0755 "$target"
rsync -a --chmod=D755,F644 "$release_source/" "$target/"
python3 -m venv "$target/.venv"
"$target/.venv/bin/python" -m pip install --disable-pip-version-check -r "$target/requirements-production.txt"
(cd "$target"; runuser -u elitehr -- .venv/bin/python -m deploy.runtime check --env-file /etc/elitehr/backend.env)
active=()
for unit in elitehr@api elitehr@resume elitehr@recruitment elitehr@scheduler; do
    if systemctl is-active --quiet "$unit"; then active+=("$unit"); fi
done
switched=0
recover() {
    trap - ERR
    if [[ "$switched" == 1 ]]; then
        if (( ${#active[@]} )); then systemctl stop "${active[@]}" || true; fi
        ln -s "$previous" /opt/elitehr/current.rollback
        mv -Tf /opt/elitehr/current.rollback /opt/elitehr/current
        if (( ${#active[@]} )); then systemctl start "${active[@]}" || true; fi
    fi
    echo 'Update failed. Previous code restored if switched; inspect schema compatibility before retrying.' >&2
    exit 1
}
trap recover ERR
if (( ${#active[@]} )); then systemctl stop "${active[@]}"; fi
ln -s "$target" /opt/elitehr/current.next
mv -Tf /opt/elitehr/current.next /opt/elitehr/current
switched=1
if (( ${#active[@]} )); then systemctl start "${active[@]}"; fi
if printf '%s\n' "${active[@]}" | grep -qx elitehr@api; then
    ready=0
    for _ in $(seq 1 45); do
        if curl --fail --silent --output /dev/null http://127.0.0.1:8002/api/ready; then ready=1; break; fi
        sleep 2
    done
    [[ "$ready" == 1 ]]
fi
ln -sfn "$previous" /opt/elitehr/previous
trap - ERR
echo 'Backend code updated. Only previously active services were restarted.'
