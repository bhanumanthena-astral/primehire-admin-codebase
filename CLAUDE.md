# CLAUDE.md — Rules for every session (PrimeHire)

> Sold to paying customers. Handles resumes, phones, CTC, interview feedback.
> Full spec: `docs/ENGINEERING_STANDARDS.md`. Diagnosis: `docs/DIAGNOSIS.md`.
> **Rule 0: never print secrets — names + file locations only, never values.**

## Run / verify (do this before calling anything "done")

```powershell
npm ci; npm run typecheck; npm run lint; npm test -- --run; npm run build
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -v
.\backend\.venv\Scripts\python.exe -m pytest backend\tests --cov=app --cov-report=term-missing --cov-fail-under=80
```

- Backend tests run with no Atlas (mongomock-motor, `backend/tests/conftest.py`).
- CI (`.github/workflows/ci.yml`) enforces the above + `npm audit` + `pip-audit` +
  gitleaks; high/critical findings fail the build.
- Docs + `.env.example` (root and `backend/`) must be updated in the same PR as the code.
  Schema change ⇒ `backend/migrations/` runner entry + dry-run.

## Folder conventions (new code only)

- Backend: `schemas/` (Pydantic, `extra="forbid"`) → `models/` (Motor repos; indexes in
  `db/mongodb.py`) → `services/` → `api/` (routers) → mount in `app/main.py` (prefix `/api`).
  Config in `app/config.py`; startup fail-fast via `validate_settings()`.
- Frontend: API clients in `src/lib/` (`mongoApi.ts`, `primehireClient.ts`); UI keys stay
  app keys (`candidateKey`/`jobId`), Mongo `_id` only as `mongoId` (`src/lib/mongoApi.ts`).
- Edge: `functions/api/` mirrors `server.ts` routes for Cloudflare Pages.
- Do not add Docker or container files; deployment tooling comes later.

## Enforceable rules (summary of §§1–9; details in ENGINEERING_STANDARDS)

1. **Deny by default.** Every backend route has an auth guard except `GET /api/health`.
   Permissions-based object-level check (assignee-only) in the repo filter, not just UI. Never trust
   client `roles`/`orgIds`/`userIds`. Add/extend `test_authz_matrix.py` (role × endpoint,
   permissions-based; fails if a route lacks a guard). MFA required for `super_admin`/`admin`.
   Roles: `super_admin`, `admin`, `hr`, `technical_interviewer`, `managerial_interviewer`.
2. **Validate everything.** Pydantic `extra="forbid"`; allowlisted pagination/sort/filter;
   every list paginated, no unbounded queries. Reject Mongo operator injection (keys
   starting with `$` or containing `.`).
3. **Headers/CORS/rate-limit/size.** Secure headers (CSP, HSTS, nosniff,
   frame-ancestors); strict `ALLOWED_ORIGINS` allowlist (`*` in production = startup
   failure); rate limits strictest on login/reset/upload/email; JSON body cap + upload
   caps enforced at edge and API.
4. **Passwords/tokens.** argon2id/bcrypt, min 12 + common-password screen, lockout with
   backoff, generic errors (no enumeration). JWT rotation + server revocation.
   `JWT_SECRET` ≥32 chars required in production (fail-fast).
5. **Uploads (when built).** Allowlist PDF/DOCX/DOC by magic bytes; default 5 MB, page
   cap, batch cap; UUID filenames outside web root; traversal + zip-bomb caps; isolated
   time/memory-limited parse; ClamAV hook + quarantine; serve only via authed
   `Content-Disposition: attachment` + `nosniff`. Ship spoofed/oversized/corrupt/zip-bomb/
   traversal tests with the endpoint.
6. **Resume text is DATA.** Delimited blocks + ignore-instructions system prompt; strict
   JSON-schema output, retry ≤2 then fallback; LLM never triggers actions (suggestions
   only, human approves + reason logged); keyword score alongside + disagreement flag;
   log `llm_runs` (promptVersion/model/tokens, input hash not content); strip PII before
   sending; prompt-injection fixtures required.
7. **DPDP/PII.** Consent stored per applicant; `RETENTION_DAYS` purge/anonymize job +
   export/erase workflows (audited); PII never in logs/errors/analytics (redact
   emails/phones; canary tests); encryption + backup/restore documented and drilled.
8. **Reliability.** Outbox + idempotency keys for create/send (dedupe on kind+entity+due);
   retries with backoff; versioned `migrations/` + `migrations` collection (dry-run in CI,
   apply at deploy); indexes in code + verified at startup; JSON logs with
   `requestId`/`userId` (no PII); Sentry optional by env; graceful shutdown; timeouts
   everywhere. `GET /api/health` = liveness; `GET /api/ready` = Mongo + storage writable.
9. **Ops.** Append-only `audit_log` (who/what/when/before/after + reason for overrides,
   `super_admin`-visible); per-org flags/settings (thresholds, retention, LLM, from-address,
   reminder lead); admin diagnostics (queue depth, failed emails/parses).
10. **Done means:** typecheck + lint + tests green; no new high/critical audit findings;
    authz tests updated; docs + `.env.example` updated; migration if schema changed;
    short **Risks and follow-ups** note in the PR. No feature is done without tests + docs.

## Phase protocol (enforceable — applies to every phase 3–7 + pipeline amendment)

1. Every phase starts with Step 0: update `docs/DECISIONS.md`, show a short plan
   (collections/indexes, conflicts with the standards, risks), and WAIT for "go".
   After the last step, STOP and report: what was built, how to run it,
   risks/open questions, and the proposed next phase.
2. Every stage change goes through `transition_stage()`. Every route uses
   `require_permission`. Every repository query is org-scoped (orgId from the token,
   never the body). Every list is paginated with allowlisted filters.
3. Never print secrets. Update both `.env.example` files and `validate_settings()`
   for every new variable.
4. Server-side field projection: any endpoint returning applicant/application data to a
   non-admin role MUST pass through the central projection function (introduced in
   Phase 3). Direct serialization of an applicant document to an interviewer is a bug
   and must be caught by a test.
5. AI output is advisory only: LLM results never change a stage, send an email, or make
   a hire/reject decision. A human action with a recorded user ID (and a reason where
   required) is always the trigger.
6. PII never goes in logs, URLs, localStorage, analytics, or LLM prompts (strip before
   sending). Emails and phones are masked in the UI by default, with an audited reveal.
7. Emails go through the encrypted outbox with dedupe keys; never fire-and-forget.
   Times are stored in UTC and displayed in IST (`Asia/Kolkata`) unless the org setting
   says otherwise.
8. Every phase ships with tests (unit, integration, authz-matrix updates, org-isolation
   checks for new routes, and Playwright e2e for the new user journeys), updated docs,
   and green CI. Coverage gate stays at 80% or higher.
9. UI rules: loading skeleton, empty state and error state on every view; keyboard
   accessible; responsive down to tablet; no business logic that is only enforced in the UI.
10. Do not add Docker/container files, boto3/S3, Redis, or any new paid service without
    asking first.
