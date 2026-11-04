# Repository structure and credential audit

Scope: active folder layout, source dependencies/references, generated output, Git tracking, local credential handling, and regression/build checks. This is a repository hygiene audit, not a claim that every historical commit or every business rule has received an independent security review.

## Active structure

| Location | Purpose |
| --- | --- |
| `frontend/src/` | React pages, features, API clients and frontend tests |
| `frontend/components/`, `frontend/lib/` | Shared shadcn controls and utilities |
| `frontend/cloudflare/`, `frontend/scripts/` | Pages gateway and standalone build packaging |
| `backend/app/` | FastAPI routes, schemas, repositories, security and services |
| `backend/migrations/`, `backend/tests/` | Versioned schema changes and backend regression tests |
| `backend/deploy/` | Backend release builder and Oracle runtime/deployment configuration |
| `scripts/` | Local launchers, preflight checks, credential setup and repository maintenance |
| `e2e/` | Browser fixtures and Playwright tests |
| `docs/` | Requirements, implementation notes and operational runbooks |
| `server.ts`, root package/config files | Local Express gateway, development server and browser-test tooling |
| `functions/api/` | Existing legacy provider/email gateway compatibility; retained because those routes remain supported |

The root and frontend package files serve different purposes. Their dependency installations are intentionally retained for the local gateway/browser tooling and independently deployable frontend. Python virtual environments, live upload storage, runtime data, active logs and release archives are also retained. No database, candidate profile, resume, assessment or report data is deleted by this cleanup.

The 100 preexisting deletions of old root frontend files each have a corresponding file under `frontend/`. That source migration and the other in-progress functional changes are preserved; they are not reset, bulk-staged, committed or published by this task.

## Removed or consolidated

- Removed the legacy `scratch/` directory from the working tree and Git index: 35 old probe, login, OpenAPI snapshot and report-check files. Active source, CI and application tests had no runtime dependency on those files.
- Preserved the useful manual report checks as `frontend/src/utils/__tests__/legacyReports.test.ts`, with synthetic contracts in `fixtures/legacyReports.ts`. No real recording URLs, credentials or candidate identities are carried into the replacement fixtures.
- Removed stale QA exports/screenshots, test and bytecode caches, coverage output, and root `dist/assets`/`dist/index.html` left over from the old frontend build. The current server serves `frontend/dist`; its Node server bundle remains under root `dist`.
- Added a cross-platform `npm run clean` command backed by `scripts/clean_generated.mjs`. Use `node scripts/clean_generated.mjs --cache-only` to clear generated QA/cache outputs while preserving current application builds. Targets are checked to remain inside the workspace; linked targets are refused. Dependencies, credentials, uploads and database/runtime data are not cleanup targets.

Generated files may reappear when the app or tests run. Git ignores them, and the repository guard rejects tracked private/runtime output rather than relying on ignore rules alone.

## Google credentials

The supplied Web application JSON is stored privately at `backend/secrets/google-oauth-client.json`. Runtime Google settings are in `backend/.env`; both are Git-ignored and excluded from release packages. The user confirmed the localhost callback is registered, and the configuration helper was invoked with `--confirm-registered-redirect` because the downloaded JSON omitted redirect metadata. The existing encryption key is preserved by subsequent configuration runs.

Configured callback: `http://localhost:3000/api/auth/google/callback`. The local V2 API and recruitment worker are reloaded after configuration. First sign-in and Calendar connection still require the team member’s own Google authorization; no account consent is automated. A Cloudflare deployment needs its own registered HTTPS callback and matching backend settings. No Cloud billing or paid product is enabled.

## Credential finding that requires follow-up

Twenty-three removed probe scripts contained the currently configured PrimeHire access and secret keys. A comparison against the committed `HEAD` copy confirmed those credentials are already present in Git history. An old login payload was also tracked. The Google client JSON supplied for this task was untracked and has not been added to Git.

Removing the files from the index prevents them from appearing in the next source snapshot; it does not erase existing commits. **Rotate the PrimeHire access/secret keys and review any password reused from the old login payload.** History has not been rewritten or force-pushed. Credential rotation and any coordinated history purge are separate operator actions; existing app configuration is retained so the application continues to work.

## Safeguards and checks

- `scripts/audit_repository.py` scans working source or exact staged Git blobs (`--index`). It reports filenames/rule names only, checks known secret formats and embedded provider credentials, rejects private/generated paths, and optionally compares against local configured secret values without printing them.
- CI runs the same staged-source hygiene check. Ignore rules cover Google client JSON, private backend credentials, generated browser/test output, runtime logs, scratch probes and tunnel URL output.
- Secret-bearing `Settings` fields are excluded from object representations so error traces do not display credential values. Tests override ambient Google environment settings and use explicit synthetic clients.
- The preserved report check caught recording-based inference of an absent `is_attempted` flag. Normalization now leaves it unknown unless the provider explicitly supplies the flag, matching its existing contract comment and preserving honest report coverage.
- Validation covers private credential setup, secret-free configuration representations, the repository guard, Google authorization/scheduling, the complete frontend/backend regression suites, type checking and production builds. A browser check verifies the real local app exposes the enabled Google button, the expected localhost callback, PKCE and a HttpOnly state cookie; external Google navigation is intercepted before consent.

Final verification: **1,943 backend tests passed, one skipped; 83.14% backend coverage; 246 frontend tests passed; typecheck, lint and production build passed.** Working-source and staged-index credential/hygiene scans reported no findings. Existing bundler size/dynamic-import warnings remain; they do not fail the build. The real Google consent/token exchange is completed by the user during first sign-in, not by the automated check.

The cleanup-related Git removals/guard changes are staged. No commit, push, deployment or history rewrite is performed. Existing unrelated source modifications remain available for review.
