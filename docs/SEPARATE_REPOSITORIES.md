# Separate repositories — 4 November 2026

Two repos are a maintenance preference, not a production requirement. The app
already has independent deployment boundaries. The requested split produces
clean source snapshots without moving the running application.

Run `python scripts/prepare_standalone_repos.py --version YOUR-UNIQUE-VERSION`.
The default output is `artifacts/repositories/YOUR-UNIQUE-VERSION/`:

- `elitehr-frontend/`: React source, public illustrations, components, lockfile,
  Node 22 selection, Cloudflare gateway/configuration, frontend tests and CI.
- `elitehr-backend/`: Python backend, migrations, Oracle deployment scripts,
  backend tests/CI, operational scripts and docs. Existing `backend/` paths are
  retained to preserve worker, environment loading, test and release tooling.
- Source ZIPs contain each folder's files directly at the ZIP root, with SHA-256
  sidecars and a shared manifest. Source ZIPs are not built Pages uploads.

The folders exclude private environments, Git history, credentials, uploaded
resumes, database exports, virtual environments, dependencies, logs and build
outputs. Explicit source selections and the existing secret scanner are used,
including exact local-secret matching in memory. Existing versions are refused.

Copy each folder outside this working repository, then initialize and push each
to its own private remote. Commit the folder contents at the repo root. Never
copy the old .git or private configuration. Make subsequent changes in those two
repos after cutover; these snapshots are not synchronized with this working copy.
Preparation does not create remotes, push code, provision hosts or run migrations.

The monorepo frontend-export tests remain here and are omitted from the backend
snapshot along with the frontend exporter. All backend business/authz/isolation
tests remain. Full-stack Playwright orchestration stays in this integration
workspace; synthetic backend fixtures remain in the backend snapshot.

## Cloudflare Pages: frontend-only repo

| Setting | Value |
| --- | --- |
| Service | Cloudflare Pages |
| Root directory | Leave blank (repo root) |
| Production branch | Your chosen production branch |
| Build command | npm run build |
| Output directory | dist |
| Node version | 22, also selected by .nvmrc |
| BACKEND_ORIGIN | Runtime variable; unset until Oracle HTTPS exists |

Cloudflare's [React guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)
documents the build command and output directory. The app uses Pages
[advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/):
the build places _worker.js, _routes.json and _headers in dist beside the UI.

The frontend shell can be published first. API calls return 503
BACKEND_NOT_CONFIGURED until Oracle is publicly reachable. Later set runtime
BACKEND_ORIGIN to the backend HTTPS origin without /api and redeploy Pages.
JWT/database/email/LLM credentials stay on Oracle, never in browser variables.

Oracle must allow the exact frontend origin, generate links to that origin and
use its registered Google OAuth callback. Test login, refresh, logout, invitations,
resume upload/download and role portals through the real deployed Pages URL.
Local source/build checks do not prove remote infrastructure is live.

The /api paths, cookie gateway, authorization and data behavior are unchanged.
There is no migration or new runtime setting for this split. Coordinate releases
when changing the API contract. Oracle capacity, HTTPS, provider quotas and the
backend production dependency lock retain their documented limitations.

## Verification and backend release gates

The 20261104-01 handoff freezes the source snapshot used for the independent
checks, rather than mixing in concurrent database migration edits. Frontend:
fresh lockfile installation, TypeScript, 288 tests and Pages production build
pass; npm audit reports zero known vulnerabilities. The Pages gateway and public
thank-you image are present in the built deployment archive.

Backend: all 1,955 application/deployment tests pass (one optional test skipped),
but coverage is 79.27%, below the existing 80% gate, because the frozen snapshot
already includes the optional database adapter while that work is in progress.
The gate is retained. The production pypdf 6.21.2 lock reports seven advisories
(CVE-2026-119203 through CVE-2026-119209); the audit gate is retained. This backend
source handoff is not a production-ready backend release. Its CI correctly blocks
a release until those issues and database migration verification are resolved.
The parallel chat's later database changes remain in the original working tree
and are not silently merged into this tested snapshot. Regenerate the backend
snapshot after that work completes before deploying it. No DB/data was changed
for the repository split. See HANDOFF.md in each prepared source folder.
