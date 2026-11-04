# Elite HR V2 frontend

This folder is a standalone frontend project. It contains the React UI, its own
package/lockfile and a Cloudflare Pages API gateway. It needs no Python backend
source, MongoDB data, JWT signing key or provider credentials to build.

The prepared two-repository handoff includes docs/SEPARATE_REPOSITORIES.md.
Use the frontend folder contents as the new repository root. Public illustrations,
Node 22 selection and an independent CI workflow are included.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Publish **dist/**. It contains index.html, assets, _worker.js, _routes.json and
_headers. Only /api requests invoke the gateway; static assets and SPA routes use
Pages' static service.
Do not upload this source directory, the repository root or the backend archive.

## Deploy now: Cloudflare Pages

For a Git deployment of this monorepo, use:

| Setting | Value |
| --- | --- |
| Project type | Pages |
| Root directory | frontend |
| Build command | npm run build |
| Output directory | dist |
| Node version | 22 |
| Runtime BACKEND_ORIGIN | Leave unset until the backend is hosted |

If putting only this folder in its own repository, leave Root directory blank.
Use the same command and output directory. Commit the source and lockfile, not
node_modules, dist or private environment files. Never copy .env from the root.

For dashboard Direct Upload, upload the prepared **elitehr-cloudflare.zip** or
the contents of dist. _worker.js is included deliberately: dashboard upload does
not compile a functions/ directory, while Pages supports prebuilt _worker.js.
The file must be at the upload root beside index.html, not inside another folder.
See [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/#functions).
Direct Upload and Git integration have different project setup paths; choose the
one you intend to keep using. No domain purchase is required for a pages.dev URL.

## Connect Oracle later

In the project's Pages **runtime Variables and Secrets**, set:

```
BACKEND_ORIGIN=https://your-real-backend-hostname
```

Use the origin only: no /api suffix, path, credentials or localhost. Set
Production and Preview separately, then redeploy the Pages project so the
binding takes effect. This is runtime configuration; the browser bundle needs
no backend URL and no VITE_API_URL. A backend cutover does not require editing UI
source. Keep JWT, MongoDB, email, assessment and LLM keys on Oracle.

Add the exact public Pages/custom frontend origin to the Oracle backend's
ALLOWED_ORIGINS. Set its public invitation/access-link base URLs to the frontend
URL. Configure trusted proxy/client-IP handling and test login rate limits on the
actual Oracle reverse proxy; do not trust arbitrary forwarded IP headers.

The flow is browser → same-domain /api/* → Pages gateway → Oracle backend.
The gateway preserves API paths/queries, bearer tokens, idempotency headers,
multipart streams, downloads, statuses and independent Set-Cookie headers. It
keeps refresh cookies host-only on the frontend HTTPS domain, so a pages.dev
frontend does not require third-party cookies to communicate with Oracle.
The backend still validates every user, session, permission and job scope.
The gateway blocks cross-origin browser calls and public migration routes and
does not fall back to the old V1 provider URL or old root functions/ handlers.
Pages advanced mode intentionally ignores those old function files.

With no backend configured, the login page/assets can load and API calls return
503 BACKEND_NOT_CONFIGURED. Authentication, jobs, resumes and other data actions
become usable only after the real backend is reachable and configured. An
unreachable backend returns a sanitized 502 rather than a misleading success.

## Backend compatibility and launch checks

Connect the V2 FastAPI release, with resume/recruitment enabled and Candidate /
Assessment Management capabilities present. The current V2 screens use native
backend APIs. Old development-only flows still reference /api/backend/* and
/api/send-email; those provider-specific endpoints are not in the FastAPI
release. The gateway does not recreate them, provide credentials or redirect
them to V1. Verify native V2 capabilities before launch; do not fall back to
legacy screens against a partial backend. Any deliberate legacy compatibility
requires a separately authorized, authenticated backend implementation.

The assessment library's Candidate assignments action now opens native V2
assignment statuses and links to Candidates for date/link management. Production
builds fail visibly when V2 capabilities are unavailable rather than opening the
older provider screens. Assessment questions, preview and publication are unchanged.

Before user access, test login/refresh/logout, first-password invite, role/job
visibility, job creation, resume upload/download, ATS confirmation, candidate
assignments, assessment preview/publication and all interview portals through
the real Pages URL. Local gateway tests use synthetic upstream responses and do
not prove the remote backend is live.

Preparation verification (26 October 2026): standalone typecheck/lint, all 190
UI/gateway tests, all four assessment browser checks and the production build
passed. Both frontend and root development dependency audits reported zero
vulnerabilities. Export-boundary tests confirmed no backend, private environment
or node_modules files are included. Real Cloudflare-to-Oracle smoke tests remain
pending because no public backend is available yet.

Cloudflare Free has a **100 MB request-body limit**, including multipart overhead.
Large ZIP uploads must fit that limit even if the Oracle upload setting is larger;
split larger batches. The gateway streams bytes and cannot bypass a platform
limit. The app's stricter per-file/type/batch validation still applies.
See [Cloudflare request limits](https://developers.cloudflare.com/workers/platform/limits/#request-and-response-limits).

For local development without the root Express server, npm run dev proxies /api
to http://127.0.0.1:8002. Override FASTAPI_URL in your shell if needed. The root
npm run dev remains the legacy development/BFF command; it is not a Cloudflare
deployment entry point.
