# E2E PostgreSQL deployment

Requested November 4, 2026: dedicated Ubuntu 24.04 x86_64 VM, 4 allocated
vCPUs, approximately 8 GB RAM and 100 GB disk. Preserve existing V2 data.
Oracle quotas, the 70% CPU slice and the Oracle egress limiter do not apply.

The public VM IP does not make a database public. PostgreSQL binds only to
127.0.0.1:5432; neither MongoDB nor PostgreSQL is exposed to the internet.
The existing V1/local MongoDB installation remains unchanged.

## Storage design

The PostgreSQL path uses native JSONB tables, one per existing domain, with
database-enforced primary/unique/partial indexes. This preserves application
IDs, optional resume fields, assessment reports and encrypted credentials.
It is not a normalized relational schema rewrite. Existing repository methods
compile their supported query dialect into parameterized PostgreSQL SQL;
joins, filters, grouping, sorting and pagination run in PostgreSQL. Unsupported
operators raise an error, never return a best-effort result. No Mongo server
or external compatibility service is used in the PostgreSQL deployment.

Conditional writes and upserts take short PostgreSQL transaction advisory locks
per table, so competing worker claims, revisions and identity uniqueness remain
atomic across processes. This deliberately serializes writes to a single domain
table; load-test before increasing parsing concurrency. Expiry-index cleanup is
performed on table access at most once per minute; authentication and leases
must continue enforcing their existing explicit expiry checks.

## Cutover requirements

1. Provision the new host with `backend/deploy/e2e/bootstrap.sh`. It installs
   PostgreSQL and creates isolated application and validation databases.
   Credentials are generated on-host in `/etc/elitehr/postgres.env`; never print
   or commit that file. The script does not start the application or web server.
2. Test storage semantics and complete V2 workflows on the validation database.
3. Inventory only `primehire_admin_v2`, snapshot it and copy V2-referenced files.
   Preserve IDs, UTC timestamps and every existing encryption/identity key.
   Never copy V1 records or change the source database.
4. Stop V2 source writers for the final export, import into an empty PostgreSQL
   target, verify per-domain counts and content digests, then run migrations.
5. Start API and workers only after readiness, scanner checks, authentication,
   resume parsing, assessment synchronization and scheduling checks succeed.
   Review old queued email recipients before enabling delivery workers.
6. Serve the frontend and API from the same E2E hostname. Cloudflare hosting is
   optional. Without a domain, keep the web endpoint bound to loopback and use
   an SSH tunnel. Configure real HTTPS/DNS and the Google OAuth callback before
   public access; the existing localhost OAuth callback is not a public callback.
7. PostgreSQL needs `pg_dump` backups plus matching storage and encryption keys.
   Keep the source snapshot for rollback and perform a restore verification.

## Verified state: November 4, 2026

The E2E production database received 1,305 records in 45 collections/tables and
59 referenced resume/archive files. Every document and file was checksum
verified in a trial import and again in the production import; no missing file
references. All 35 existing encrypted values were readable with the preserved
keys. The source MongoDB and original uploaded files were retained.

The checked backend release is `20261104-e2e-postgres-03`; its API, resume worker
and assessment worker run as systemd services under `elitehr`. PostgreSQL,
ClamAV, API and nginx listen only on loopback. The Python environment needed
read permissions for the unprivileged account after installing with umask 077;
that was corrected on-host and in the installer source. The frontend is served
from `/srv/elitehr/frontend`, proxied privately through nginx port 9000.

Actual authenticated API checks returned three jobs, 32 applications, six resume
batches, two assessments, 15 reports and one HR scheduling-pending application.
A restored resume download matched its original checksum. Desktop/mobile
browser checks confirmed job workspaces, resumes and Ankit's HR scheduling
action, without submitting a booking or invitation.

An encrypted native PostgreSQL/files/configuration backup was restored into the
separate validation database and its table contents verified. The backup and
recovery key were also saved in local ignored `artifacts/backend/` files.
Daily encrypted backups run at 02:15 Asia/Kolkata through
`elitehr-postgres-backup.timer`; subsequent off-host backup transfer is not yet
automated. Preserve the backup key separately from encrypted archives. Backups
pause/restart active app writers and refuse low-disk headroom before stopping
services. The backup operations script is installed separately at
`/usr/local/lib/elitehr/backup.py`.

Validation: 1,971 local backend tests passed (19 skipped), 229 PostgreSQL-backed
workflow checks passed, and 28 final storage/migration tests passed against real
PostgreSQL. Combined Linux/SQL application coverage reached 83.57%. All 288
frontend tests, TypeScript/lint and production build passed. A further 122
targeted checks passed after local PostgreSQL and Google configuration, with 19
explicit skips. The final date-type predicate regression covers periodic
assessment synchronization for both stored datetimes and legacy strings.
Production pins
were audited without known vulnerabilities; pypdf was updated to 6.21.4.

## Localhost first; public cutover explicitly deferred

The user selected `elitehr.vils.ai` for the future main address, then explicitly
deferred changing its existing CNAME to Render. Do not replace its DNS or expose
the E2E app publicly until the user resumes cutover. No public DNS, Render
deployment or production Google callback was switched in this session.

`http://localhost:3000` runs the existing local frontend and local V2 API with
the separate PostgreSQL test copy. That copy was restored from the verified
backup into `elitehr_v2_validation`, schema `elitehr`; its `elitehr_local` login
cannot connect to `elitehr_v2` production. It has its own 59 files under
`backend/runtime/e2e-local-storage`. Original local storage is unchanged.

The local SSH tunnel forwards 25432 to the private PostgreSQL listener and
13310 to the private scanner. Docker's existing port 15432 was left untouched.
Local credentials are ignored under `backend/secrets/`; the previous backend
environment is backed up there. `scripts/configure_e2e_local.py` configures only
the isolated test copy. The V2 launchers accept either configured persistent
backend. Do not copy PostgreSQL credentials into frontend settings.

Local Google sign-in keeps the already registered
`http://localhost:3000/api/auth/google/callback`. Real localhost tests verified
Google configuration, S256 PKCE, cancellation and retry; no user Google consent
was submitted by the agent. Local email is dry-run. Local test changes do not
sync back to the production database.

The separate `http://localhost:18080` SSH preview reaches the actual production
copy on E2E, not the isolated local test copy. Its Google login and physical
email delivery remain disabled pending public cutover. Use port 3000 for testing.

For public cutover, re-check current source/test changes before deciding what
to promote. Replace the `elitehr` Render CNAME with the reviewed E2E A record,
issue a valid HTTPS certificate, switch the production origin/callback to
`https://elitehr.vils.ai`, verify Google sign-in, review outstanding delivery
intents, then enable actual delivery. The user reports the main Google callback
has been registered; keep the localhost callback too.
