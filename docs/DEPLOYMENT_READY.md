# Latest frontend handoff — 4 November 2026

Frontend source: artifacts/repositories/20261104-01/elitehr-frontend.zip.
Backend source snapshot: artifacts/repositories/20261104-01/elitehr-backend.zip.
Pages upload: artifacts/frontend/elitehr-cloudflare-20261104-repos-01.zip.

The source folders can become independent repos. For the frontend-only repo,
leave the Cloudflare Pages root directory blank, build with npm run build and
publish dist using Node 22. The frontend independently passes 288 tests,
TypeScript, its production build and npm dependency audit.

Publish the UI first if desired. Data features and authentication require the
real public backend HTTPS origin in the Pages runtime BACKEND_ORIGIN binding.
No real Pages-to-backend smoke test is possible until that origin is available.

Backend source is separated, but its production release remains gated by the
79.27% coverage result (80% required), seven existing pypdf advisories and ongoing
parallel database work. Do not deploy the backend snapshot as production-ready.
No cloud resources, database cutover or live emails were performed by this task.
See docs/SEPARATE_REPOSITORIES.md for exact boundaries and remaining gates.

---

The previous prepared deployment remains below for historical context.

# Deployment handoff — November 2, 2026

Prepared locally; nothing has been published to Cloudflare or Oracle. No Oracle account details, hosts, cloud resources or public URLs have been configured. Do not infer that live infrastructure has been tested.

## Cloudflare Pages frontend

Ready-to-upload archive: artifacts/frontend/elitehr-cloudflare-20261102-free-kafka-02.zip. Upload its contents at the Pages project root. The archive includes index.html, static assets, _worker.js, _routes.json and _headers. It contains no backend code, provider credentials or private environments.

For Git-based Pages deployment, root directory is frontend, build command is npm run build, output is dist, and Node version is 22. Source-only archive: artifacts/frontend/elitehr-frontend-source-20261102-free-kafka-02.zip.

Leave BACKEND_ORIGIN unset until Oracle has a working HTTPS origin. The frontend can be published first, but authentication and application actions will deliberately return BACKEND_NOT_CONFIGURED until the backend is connected. Later set the Pages runtime BACKEND_ORIGIN to https://your-backend-hostname and redeploy Pages. Never put backend secrets or a VITE_API_URL in the browser bundle. See frontend/README.md.

## Oracle backend and Kafka

Ready backend archive: artifacts/backend/elitehr-backend-20261102-free-kafka-02.tar.gz. Its SHA-256 sidecar and artifacts/deployment-20261102-free-kafka-02.json identify the prepared files.

Use a NEW dedicated Ubuntu 24.04 A1 host: exactly 1 OCPU, 8 GB RAM and 100 GB boot storage, with no autoscaling. Verify the tenancy-wide 70% ceiling, quotas and Always Free eligibility before provisioning. Keep MongoDB Community, malware scanning, storage and the private Kafka broker on that host. No GPU or managed Kafka is needed.

The archive includes the bootstrap procedure, Kafka client dependency, private single-node broker configuration, sequential consumer/relay, shared CPU/memory limits, outbound limiter, capacity guard and Super Admin alerts. Follow docs/ORACLE_FREE_TIER_KAFKA.md and docs/ORACLE_BACKEND_DEPLOYMENT.md. After bootstrap/configuration/migration, run enable_free_profile.sh, the readiness check and a representative workload before public cutover. Those commands are for the future Oracle host, not this Windows workstation.

Preserve existing V2 data, identity and encryption keys during migration. Provide the correct Zoho product credentials privately; ZeptoMail API and Zoho Mail SMTP are different integrations. Keep OpenRouter on explicit free models. Document extraction is local; AI scoring remains subject to the provider's separate free limits. Do not switch to a paid model automatically.

## Final connection checks

Set Oracle ALLOWED_ORIGINS to the exact frontend HTTPS origin and published invitation URLs to the frontend origin. The Pages gateway keeps browser API traffic same-origin while forwarding it to Oracle. Verify login/refresh/logout, resume upload/retry, parsing, downloads, application scope and Super Admin-only alerts through the real Pages URL.

Still pending: Oracle home region/AD, VM and SSH details, private configuration and V2 migration, actual 8 GB host/load validation, HTTPS/DNS, Cloudflare project/account, and live frontend-to-backend checks. Pay As You Go permits charges; app alerts alone do not guarantee zero billing.
# JD upload scanner verification

JD template/document uploads and resume uploads use the real ClamAV INSTREAM
service configured by `RESUME_CLAMD_HOST`, `RESUME_CLAMD_PORT` and
`RESUME_SCAN_TIMEOUT_S`. Enable `CLAMAV_ENABLED=true` in production.
The scanner stream-size limit must accommodate 15 MiB JD documents.

Verify `/api/ready` returns HTTP 200 with `checks.scanner=ok` before routing
traffic. With scanning enabled this performs a synthetic scan. Scanner errors
return HTTP 503 for JD uploads and prevent extraction. Detected malware returns
HTTP 422. Scanner service outages require retry after service recovery.

The production runtime dependency check also verifies scanner readiness and a
synthetic scan before starting. Include a clean 15 MiB JD upload in deployment
smoke checks with a test account.

