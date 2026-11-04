#!/usr/bin/env bash
# Install a verified immutable release; never start public web or email delivery.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 && -f /etc/elitehr/e2e-provisioned ]] || exit 1
release_source=$(realpath "${1:?Pass the extracted verified backend directory}")
[[ -f "$release_source/release.json" ]] || exit 1
version=$(python3 "$release_source/deploy/build_release.py" --root "$release_source" --verify)
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ ]] || exit 1
target="/opt/elitehr/releases/$version"
[[ ! -e "$target" && ! -e /opt/elitehr/current ]] || { echo 'Existing application release; use a reviewed update.' >&2; exit 1; }
install -d -m 0755 "$target"
rsync -a --chmod=D755,F644 "$release_source/" "$target/"
python3 -m venv "$target/.venv"
"$target/.venv/bin/python" -m pip install --disable-pip-version-check -r "$target/requirements-production.txt"
# Provisioning uses umask 077 for secrets; runtime dependencies contain only
# public package code and must be readable by the unprivileged app user.
chmod -R a+rX "$target/.venv"
ln -s "$target" /opt/elitehr/current
install -m 0644 "$target/deploy/e2e/elitehr@.service" /etc/systemd/system/elitehr@.service
systemctl daemon-reload
echo 'Verified release installed. Application and email services remain stopped.'
