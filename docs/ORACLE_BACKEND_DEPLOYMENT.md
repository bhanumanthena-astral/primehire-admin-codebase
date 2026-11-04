# Elite HR V2: Oracle backend deployment

For the current fixed-capacity, Kafka, 1,000-resume deployment, follow
[ORACLE_FREE_TIER_KAFKA.md](ORACLE_FREE_TIER_KAFKA.md). It supersedes the VM sizing
below and preserves a 30% reserve under the user's 70% ceiling.

Status: deployment preparation only. No Oracle account, VM or public domain was
available when this package was prepared. No cloud resources were created, no
database was migrated, and no live invitations were sent. Linux/ARM installation,
restore and capacity checks must pass on the actual VM before public cutover.

## Architecture

One repository is appropriate; frontend and backend are independently deployed.
The backend release contains FastAPI, migration code and worker services only.
It excludes the frontend, Node development server, environments, uploaded files,
test dependencies and local databases. Its checksum manifest rejects missing,
modified, unexpected and symlinked files before installation.

Oracle VM: Caddy HTTPS → loopback FastAPI :8002 → authenticated loopback MongoDB
:27017, private storage and loopback ClamAV :3310. Separate systemd units run the
API, resume queue, general scheduler and recruitment delivery worker. Existing
password hashing, invitations, sessions, roles and job authorization run in the
backend. Oracle infrastructure does not replace application authentication.

Cloudflare frontend cutover is a later step. Some legacy provider proxies still
live in `server.ts` / Pages functions, and authentication uses same-origin URLs.
Audit and replace those routes with authenticated backend equivalents before
cutover; do not publish the Express development server or put provider secrets in
the frontend bundle. Prefer `app.<your-domain>` and `api.<your-domain>` for the
existing secure SameSite=Lax refresh cookie. An unrelated pages.dev hostname and
Oracle hostname need a deliberate cookie/BFF design and browser verification.

Update: the independent frontend/ project now includes a same-origin Pages
gateway, which keeps refresh cookies on the frontend domain and forwards native
V2 API traffic to BACKEND_ORIGIN. Follow frontend/README.md for frontend-first
deployment. Legacy provider-only proxy routes remain development compatibility
and are not recreated by the gateway; verify native V2 capabilities at cutover.

This is a single-host deployment with a durable Mongo-backed work queue, bounded
parsing concurrency and restartable services. It is not highly available and has
not been load-tested for 1,000 simultaneous uploads. Start with the conservative
worker limits, measure memory/queue latency/disk and expand capacity if required.

## Oracle account and new VM

Create the account yourself at https://signup.cloud.oracle.com/ . Identity,
payment verification and account passwords stay with you. Choose the home region
carefully; A1 free capacity can be unavailable. Check the console's current
Always Free eligibility and cost estimate before creating anything; do not
upgrade the tenancy or select billable resources merely to obtain capacity.

Use a **new, dedicated Ubuntu 24.04 LTS** VM, A1 with 1 OCPU / 8 GB
when available under the account's free allowance. Confirm actual eligibility in
the account. MongoDB 8 supports Ubuntu 24.04 arm64, but the actual CPU/package
installation and OCR/scanner memory usage must be checked on the chosen host.
Use sufficient boot storage within the account's free combined volume allowance;
leave headroom for MongoDB, resumes, scanner signatures and backup staging.

Keep the generated SSH private key on your computer. Never paste keys, cloud
passwords, environment contents or connection strings in chat. Configure SSH
ingress from your administrator IP only. Permit public TCP 80/443 when activating
HTTPS. Never expose 8002, 27017 or 3310 in an Oracle security list or NSG. The VM
firewall and Oracle network rules both apply; do not flush Oracle image rules.

No domain is needed to install the host or inspect readiness through SSH. A real
public HTTPS address is required before browser access and Cloudflare cutover.

## Build and transfer a clean release

From the repository on Windows:

```powershell
.\backend\.venv-v2\Scripts\python.exe backend/deploy/build_release.py --version 20261026-01
Get-FileHash artifacts/backend/elitehr-backend-20261026-01.tar.gz -Algorithm SHA256
scp -i <private-key-path> artifacts/backend/elitehr-backend-20261026-01.tar.gz ubuntu@<vm-ip>:/tmp/
scp -i <private-key-path> artifacts/backend/elitehr-backend-20261026-01.tar.gz.sha256 ubuntu@<vm-ip>:/tmp/
```

On the **new Oracle VM**, compare the checksum with your local value, then:

```bash
cd /tmp
sha256sum -c elitehr-backend-20261026-01.tar.gz.sha256
mkdir elitehr-release-20261026-01
tar -xzf elitehr-backend-20261026-01.tar.gz -C elitehr-release-20261026-01
sudo bash elitehr-release-20261026-01/deploy/oracle/bootstrap.sh /tmp/elitehr-release-20261026-01
```

The script refuses an existing MongoDB installation/data or a provisioned host.
It installs official MongoDB packages, local authentication, scanner/OCR tools,
immutable release code, its own Python environment and hardened service units.
Mongo credentials and the backup passphrase are generated locally in private
root-owned files. The application account can read/write V2 only.

**Application and email units remain stopped.** Bootstrap is intentionally a
one-time fresh-host operation. If installation is interrupted, inspect/recover
that host rather than deleting data or rerunning against an existing database.

## Private configuration and V2 migration

Configure `/etc/elitehr/backend.env` through a private SSH session or encrypted
file transfer; retain `root:elitehr`, mode 0640. Do not print it in logs.
The template marks required secrets as placeholders and startup rejects them.
Use production provider credentials only where needed. Preserve the existing
resume identity secret and encryption keys exactly when moving encrypted V2
records. Inventory `OUTBOX_ENCRYPTION_KEY` and
`RECRUITMENT_OUTBOX_ENCRYPTION_KEY` separately; do not replace an existing key
with a newly generated key and assume old ciphertext will decrypt.

Keep `MONGODB_DATABASE=primehire_admin_v2` and the provisioned authenticated
loopback URI. Keep `MIGRATION_SECRET` blank. No V1 database or user is copied.
Set explicit HTTPS `ALLOWED_ORIGINS` at frontend cutover. The initial
`https://localhost` entry grants no public frontend access. Published invite and
assessment-link base URLs also need their final HTTPS address before sharing.

Migration is a separate, supervised cutover:

1. Inventory V2 collection counts, keys and storage references without exporting
   PII to logs. Record the V1 read-only safety baseline.
2. Pause V2 source writers during the final dump. Dump **only**
   `primehire_admin_v2`; securely restore it into the dedicated Oracle V2 DB.
   Use a root-only mongorestore configuration file, never a password in argv.
3. Copy only files referenced by V2 records, preserving their expected relative
   paths. The current local storage may contain V1 files; do not copy the whole
   shared directory. Exclude symlinks and verify path containment/checksums.
4. Preserve V2 users/password hashes and required cryptographic keys. Review
   pending email/outbox records before enabling any delivery worker. Do not
   recreate weak default admin credentials.
5. Verify counts, scoped login, document downloads and decryption on Oracle.
   Starting the API applies existing V2 migrations/indexes. No new schema was
   introduced by this deployment package.
6. Keep source V2 paused once Oracle accepts writes; avoid two writable copies.
   Verify V1 counts remain unchanged. Retain an encrypted pre-cutover snapshot.

If migrating no data, arrange a private, one-time V2 administrator invitation
using the existing onboarding workflow; production does not seed a default
superadmin. That step must be completed before user cutover.

## Readiness and initial start

```bash
cd /opt/elitehr/current
sudo -u elitehr .venv/bin/python -m deploy.runtime check --env-file /etc/elitehr/backend.env
sudo systemctl enable --now elitehr@api elitehr@resume
curl --fail http://127.0.0.1:8002/api/ready
```

The check verifies configuration, V2 Mongo connectivity, persistent storage and
a harmless synthetic malware scan. Do not disable the scanner to make it pass.
Wait for signatures to load and inspect service status without dumping secrets.
For private remote inspection, run on Windows:

```powershell
ssh -i <private-key-path> -L 18002:127.0.0.1:8002 ubuntu@<vm-ip>
```

Then inspect `http://127.0.0.1:18002/api/ready`. This is infrastructure readiness;
production Secure cookies intentionally require HTTPS for browser login.

Do not enable `elitehr@scheduler` or `elitehr@recruitment` until pending deliveries,
provider keys, recipients and send policies have been reviewed. The scheduler
can deliver assessment mail; recruitment delivery also handles reminders. A
separate resume worker claims only intake work. Starting the API is not consent
to send old queued invitations. Existing explicitly triggered API actions may
still call providers; keep real users off this host during readiness checks.

## Public HTTPS after obtaining a hostname

Point `api.<your-domain>` DNS directly at the VM and allow OCI TCP 80/443. Then:

```bash
sudo bash /opt/elitehr/current/deploy/oracle/enable_https.sh api.<your-domain>
curl --fail https://api.<your-domain>/api/ready
```

The script installs Caddy from its official signed repository, binds public
HTTPS and proxies API requests to loopback only. Public docs and migration
routes are blocked. It refuses to overwrite a pre-existing Caddy configuration.
Verify certificate issuance, firewall rules, external readiness, upload size
limits, authenticated uploads/downloads, role isolation and real browser cookies
before connecting the frontend. Do not expose an HTTP API to an HTTPS frontend.

## Backup, restore and updates

Manual backup after configuration:

```bash
sudo systemctl start elitehr-backup.service
```

The backup briefly stops only active application writers, dumps V2 and snapshots
private storage/config into an encrypted archive, then restarts those services.
This planned maintenance is required for cross-file consistency on the standalone
MongoDB host. Ensure adequate temporary disk space. The optional timer is
installed but not enabled; its default daily 01:30 UTC window is configurable.

Copy the encrypted backup and checksum **off the VM**, for example into an
explicitly approved private Oracle Object Storage bucket within verified account
quotas. Store `/etc/elitehr/backup.passphrase` separately and securely. A backup
beside its decryption key on the same disk is not disaster recovery. Define
retention and monitor failures/disk space; no automatic deletion is performed.

Before launch, drill a restore into another isolated V2 environment: verify the
checksum, decrypt into a root-only temporary directory, validate archive paths,
restore the dump with a root-only credential config and `--nsInclude
'primehire_admin_v2.*'`, restore only its storage, and transfer original app
encryption keys. Keep writers/delivery units stopped while comparing counts,
decrypting records, logging in and opening a known resume. Use the new host's
local Mongo credentials rather than overwriting them with the old URI from the
backup. Destroy private restore staging after verification. Record achieved
recovery time; restore has not been drilled by this preparation task.

For a new code release, take and verify a backup first, upload/extract/check the
new archive, then run its `deploy/oracle/update.sh` as root. It installs a separate
venv, checks dependencies, switches the current symlink and restarts only units
that were active. If API readiness fails, it restores the previous code. It does
not reverse database migrations: upgrades require backward-compatible schema
changes or a separately planned data restore. `/opt/elitehr/previous` records the
prior release. Do not remove a previous release until the new one is verified.

## Launch evidence still required

Local preparation verification (26 October 2026): 1,733 backend tests passed with
83.01% application coverage; 72 final targeted deployment/security/worker checks
passed. Frontend typecheck, lint, 152 tests and build passed. The pinned production
dependency audit reported no known vulnerabilities. All 39 pins resolved to
compatible CPython 3.12 ARM64 wheels. Bash/Python syntax and the built archive's
manifest, Linux line endings and sensitive-file exclusions were checked. These
checks do not replace running and restoring the application on the actual VM.

* Successful actual Ubuntu/CPU package installation and all services healthy.
* Verified V2-only migration and V1 unchanged; keys and downloads preserved.
* Encrypted off-host backup and successful restore drill.
* HTTPS, invitation/password/login/refresh/logout and role/job isolation checks.
* Controlled email test only to an approved recipient; no stale invitation sends.
* Upload/parse/ATS and assessment-provider smoke tests on synthetic data.
* Load/capacity measurements, queue retry/restart and full-disk failure checks.
* Frontend proxy/auth URL changes and Cloudflare deployment verification.

Provider references: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[MongoDB Ubuntu install](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-ubuntu/),
[Caddy install](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
