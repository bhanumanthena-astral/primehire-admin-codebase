# DECISIONS.md — Phase 1 Plan

> Step 0 deliverable. Auth, orgs, RBAC, hiring data model.
> Read alongside `CLAUDE.md`, `docs/ENGINEERING_STANDARDS.md`, `docs/DIAGNOSIS.md`.

---

## 1. New collections and indexes

### 1.1 `organizations`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string (uuid4) | business PK, unique |
| `name` | string | |
| `settings` | object | typed: `{ matchThreshold, retentionDays, llm: {provider, model}, emailFrom, reminderLeadMinutes }` |
| `createdAt` / `updatedAt` | datetime | server-set |

Indexes: `uniq_orgId` UNIQUE on `orgId`.

One default org (`orgId = "default"`, `name = "PrimeHire"`) seeded on first boot via lifespan if absent. All existing data is backfill-migrated to `orgId = "default"`.

### 1.2 `users`

| Field | Type | Notes |
|---|---|---|
| `userId` | string (uuid4) | business PK, unique |
| `orgId` | string | FK to organizations |
| `email` | string | unique per org, stored lowercase + stripped |
| `name` | string | |
| `passwordHash` | string | argon2id; **never returned by any API** |
| `role` | enum | `super_admin`, `admin`, `hr`, `technical_interviewer`, `managerial_interviewer` |
| `isActive` | bool | default `true` |
| `mfa` | object | `{ enabled: bool, secretEncrypted: string?, recoveryCodesHashed: string[]? }` |
| `lastLoginAt` | datetime? | |
| `createdAt` / `updatedAt` | datetime | |

Indexes: `uniq_userId` UNIQUE on `userId`; `uniq_org_email` UNIQUE on `(orgId, email)`; `by_orgId` on `orgId`.

### 1.3 `sessions`

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string (uuid4) | PK |
| `userId` | string | |
| `orgId` | string | |
| `refreshTokenHash` | string | sha256 of the rotating refresh token |
| `deviceInfo` | string | User-Agent summary |
| `createdAt` | datetime | |
| `expiresAt` | datetime | TTL index for auto-cleanup |
| `revokedAt` | datetime? | soft-revoke |

Indexes: `uniq_sessionId` UNIQUE; `by_userId`; `ttl_expiresAt` TTL on `expiresAt` (expire 0).

### 1.4 `login_attempts` (rate-limit / lockout)

| Field | Type | Notes |
|---|---|---|
| `key` | string | `"login:{orgId}:{email}"` or `"login:ip:{ip}"` |
| `attempts` | int | |
| `lockedUntil` | datetime? | |
| `lastAttemptAt` | datetime | |
| `expiresAt` | datetime | TTL auto-cleanup |

Indexes: `uniq_key` UNIQUE; `ttl_expiresAt` TTL.

### 1.5 `invitations` (invite + password-reset tokens)

| Field | Type | Notes |
|---|---|---|
| `tokenHash` | string | sha256 of the single-use token |
| `userId` | string | target user |
| `orgId` | string | |
| `kind` | enum | `invite`, `password_reset` |
| `expiresAt` | datetime | TTL |
| `usedAt` | datetime? | marks consumed |
| `createdBy` | string | admin userId |
| `createdAt` | datetime | |

Indexes: `uniq_tokenHash` UNIQUE; `by_userId`; `ttl_expiresAt` TTL.

### 1.6 `jobs`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `jobKey` | string | unique per org |
| `title` | string | |
| `description` | string | |
| `mustHaveSkills` | string[] | |
| `niceToHaveSkills` | `{ skill, weight }[]` | |
| `minExperienceYears` / `maxExperienceYears` | int? | |
| `matchThreshold` | int | default 60 |
| `status` | enum | `open`, `on_hold`, `closed`, `filled` |
| `assessmentJobId` | string? | FK to `assessments.jobId` |
| `reuseAssessmentMonths` | int | default 6 |
| `createdBy` | string | userId |
| `createdAt` / `updatedAt` | datetime | |

Indexes: `uniq_org_jobKey` UNIQUE on `(orgId, jobKey)`; `by_orgId_status`.

### 1.7 `applicants`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `applicantKey` | string | uuid4, unique per org |
| `email` | string | unique per org, normalized lowercase |
| `phone` | string? | indexed, normalized (digits-only) |
| `name` | string | |
| `resume` | object? | `{ storageKey, fileName, mimeType, sizeBytes, contentHash, rawText, digest, parsedJson }` — all optional now |
| `ctcCurrent` / `ctcExpected` | number? | |
| `noticePeriodDays` | int? | |
| `consent` | object? | `{ givenAt, source, textVersion }` |
| `retentionUntil` | datetime? | |
| `tags` | string[] | |
| `createdAt` / `updatedAt` | datetime | |

Indexes: `uniq_org_applicantKey` UNIQUE on `(orgId, applicantKey)`; `uniq_org_email` UNIQUE on `(orgId, email)`; `by_org_phone` on `(orgId, phone)`.

### 1.8 `applications`

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `applicationKey` | string | uuid4 |
| `applicantKey` | string | FK |
| `jobKey` | string | FK |
| `matchScore` | number? | |
| `scoreBreakdown` | object? | |
| `currentStage` | string (stage enum) | |
| `candidateKey` | string? | link to existing `candidates` doc |
| `assignedInterviewers` | string[] | empty for now |
| `talentPool` | object? | `{ inPool, rejectedAtStage, reasonCategory, recontactFlag, eligibleAfter }` |
| `createdAt` / `updatedAt` | datetime | |

Indexes: `uniq_org_applicationKey` UNIQUE on `(orgId, applicationKey)`; `uniq_active_application` UNIQUE on `(orgId, applicantKey, jobKey)` with partial filter `{ currentStage: { $nin: ["REJECTED", "WITHDRAWN", "HIRED"] } }` — allows re-application after terminal states; `by_org_jobKey`; `by_org_stage`.

### 1.9 `stage_history` (append-only)

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `applicationKey` | string | |
| `fromStage` | string? | null for initial |
| `toStage` | string | |
| `actorUserId` | string | userId or `"system"` |
| `at` | datetime | |
| `note` | string? | |
| `meta` | object? | extra context (e.g. `{ source: "backfill" }`) |

Indexes: `by_org_applicationKey` on `(orgId, applicationKey)`; `by_org_at` on `(orgId, at)`.

### 1.10 `audit_log` (append-only — no update/delete code path)

| Field | Type | Notes |
|---|---|---|
| `orgId` | string | |
| `actor` | object | `{ userId, email (redacted), role, impersonating?: userId }` |
| `action` | string | e.g. `user.create`, `application.transition`, `stage.override` |
| `entityType` | string | e.g. `user`, `application`, `job` |
| `entityKey` | string | business key |
| `before` | object? | PII-redacted snapshot |
| `after` | object? | PII-redacted snapshot |
| `reason` | string? | required for overrides |
| `at` | datetime | |

Indexes: `by_org_at` on `(orgId, at)`; `by_org_entityType_entityKey` on `(orgId, entityType, entityKey)`; `by_org_actor` on `(orgId, actor.userId)`.

### 1.11 `migrations` (migration runner state)

| Field | Type | Notes |
|---|---|---|
| `version` | string | e.g. `"001_add_orgId"` |
| `appliedAt` | datetime | |
| `checksum` | string | sha256 of migration module |
| `durationMs` | int | |

Indexes: `uniq_version` UNIQUE.

### 1.12 Changes to existing collections

All existing collections (`assessments`, `candidates`, `reports`, `templates`) gain an `orgId` field (default `"default"`) via migration `001_add_orgId`. Existing unique indexes become org-scoped where it makes sense:

| Collection | Current index | New index |
|---|---|---|
| `assessments` | `uniq_jobId` on `jobId` | `uniq_org_jobId` on `(orgId, jobId)` |
| `candidates` | `by_email` on `email` | `by_org_email` on `(orgId, email)` |
| `candidates` | `by_assessmentId` on `assessmentId` | `by_org_assessmentId` on `(orgId, assessmentId)` |
| `candidates` | `by_candidateKey` on `candidateKey` | `by_org_candidateKey` on `(orgId, candidateKey)` |
| `candidates` | `uniq_interviewId_v2` | stays global (upstream IDs are globally unique) |
| `candidates` | `uniq_responseId_v2` | stays global (upstream IDs are globally unique) |
| `reports` | all indexes | stay global (keyed by upstream `interviewId`) |
| `templates` | `uniq_templateId` on `id` | `uniq_org_templateId` on `(orgId, id)` |

---

## 2. Auth design

### 2.1 Token architecture

```
Access token (JWT, short-lived 15 min):
  Header: alg HS256
  Payload: sub=userId, orgId, role, sessionId, aud="primehire", iss="primehire", iat, exp
  Signed with JWT_SECRET (existing config.py field, >=32 chars in prod)

Refresh token (opaque, 7 days, rotating):
  Random 48-byte token, sha256-hashed stored in `sessions` collection
  Rotation: each /api/auth/refresh invalidates old, issues new pair
  Revocation: DELETE session row (logout), or bulk-revoke (logout-all)
```

### 2.2 Auth flow

1. `POST /api/auth/login` — email + password -> validate -> if MFA enabled, return `{ mfaRequired: true, mfaToken }`  (short-lived, 5 min); else return access + refresh tokens.
2. `POST /api/auth/mfa/verify` — mfaToken + TOTP code -> access + refresh tokens.
3. `POST /api/auth/refresh` — refresh token -> new access + refresh tokens (rotation).
4. `POST /api/auth/logout` — revoke current session.
5. `POST /api/auth/logout-all` — revoke all sessions for user.
6. `GET /api/auth/me` — return current user profile (no passwordHash).
7. `POST /api/auth/change-password` — old + new password (re-validates old).
8. MFA: `POST /api/auth/mfa/enroll` -> secret + QR URI; `POST /api/auth/mfa/confirm` -> verify TOTP + activate + return recovery codes.
9. `GET /api/auth/sessions` — list active sessions; `DELETE /api/auth/sessions/{id}` — revoke one.

### 2.3 Password policy

- Minimum 12 characters.
- Common-password check: embedded top-10k list (shipped as a set in `security/passwords.py`).
- Lockout: 5 failed attempts -> 15 min lockout, exponential backoff (5, 15, 60, 240 min).
- Generic error on bad email OR bad password: `"Invalid credentials"` (no enumeration).

### 2.4 Rate limiting

In-memory limiter (per-process, documented limitation) using a sliding-window counter:

| Route | Window | Max |
|---|---|---|
| `POST /api/auth/login` | 15 min | 10 per IP+email |
| `POST /api/auth/refresh` | 1 min | 20 per IP |
| `POST /api/auth/mfa/verify` | 15 min | 10 per mfaToken |
| `POST /api/auth/change-password` | 15 min | 5 per user |
| `POST /api/users` (invite) | 1 min | 10 per org |
| All other authed routes | 1 min | 120 per user |

Returns `429 + Retry-After` header. Optional Mongo-backed limiter (TTL collection) documented as upgrade path.

### 2.5 Invite + password reset

- `POST /api/users` (admin creates user) -> generates invite token -> returns `inviteUrl` once in response (no email service yet).
- `POST /api/auth/reset-password-request` -> generates token -> returns `resetUrl` once (no email service yet).
- `POST /api/auth/reset-password` -> token + newPassword -> consumes token, sets password.
- Tokens: random 48-byte, sha256-hashed stored in `invitations`, 24h expiry, single-use.

### 2.6 "View as" (impersonation)

- `POST /api/auth/view-as` — super_admin only, requires `{ targetUserId, reason }`.
- Returns a time-limited (30 min) access token with `impersonating: targetUserId` claim.
- Read-only by default. Any write in this mode:
  - Attributed to the super_admin (`actor.userId = super_admin, actor.impersonating = target`).
  - Requires `reason` field on the write request.
  - Audited in `audit_log`.
- Frontend shows a persistent banner: "Viewing as {name} — read-only mode".

---

## 3. How open routes get locked without breaking the SPA

### 3.1 Backend (FastAPI)

**Strategy: dependency injection, not per-route decoration.**

1. Add `backend/app/security/` package:
   - `deps.py` — `get_current_user(token)` FastAPI dependency that decodes+validates the JWT, returns a `CurrentUser` dataclass with `userId, orgId, role, permissions, sessionId, impersonating?`.
   - `permissions.py` — permissions catalogue, role->permissions map, `require_permission(perm)` dependency factory.
   - `rate_limit.py` — in-memory sliding-window limiter.

2. Every router gets `require_permission(...)` as a dependency:
   - `candidates.py` routes -> `require_permission("applications.view_all")` for reads, same for writes (admin/hr/super_admin for now).
   - `directory.py` -> `require_permission("applications.view_all")`.
   - `reports.py` -> `require_permission("applications.view_all")`.
   - `migration.py` -> keeps `X-Migration-Secret` (unchanged).

3. Public routes (no guard): `/api/health`, `/api/ready` only.

4. All repository functions accept `orgId` parameter from the authenticated user's token — never from request bodies. Existing repo functions are updated to filter by `orgId`.

### 3.2 Express (`server.ts`)

1. `POST /api/send-email` — verify a valid access token before forwarding. Parse `Authorization: Bearer <token>`, validate JWT (same `JWT_SECRET`), check permission. No token -> 401.
2. `/api/backend/*` + `/api/primehire/*` — verify a valid access token before forwarding. Same approach. Keeps its existing PrimeHire credential injection unchanged.
3. `/api/health` — stays public.
4. Reduce verbose proxy logging to metadata only (method, path, status, latency — no request/response bodies).

### 3.3 Cloudflare Pages Functions (`functions/api/`)

1. `functions/api/backend/[[path]].ts` — add JWT verification before proxying. Read `JWT_SECRET` from env. Validate `Authorization: Bearer` header using Web Crypto API (no npm packages in CF Workers). No token or invalid -> 401.
2. `functions/api/send-email.ts` — same JWT verification.
3. `functions/api/health.ts` — stays public.

### 3.4 Frontend SPA

- `react-router` added for routing.
- Auth context (`src/lib/authContext.tsx`) manages token storage (memory for access token, httpOnly cookie for refresh token), auto-refresh, logout.
- API wrapper: `mongoApi.ts` and `primehireClient.ts` get an `authFetch` wrapper that attaches `Authorization: Bearer <accessToken>` to every request and handles 401 -> refresh -> retry.
- Route guard (`PrivateRoute`) checks auth context; redirects to `/login` if unauthenticated.
- Login page with MFA step.
- Existing four-tab admin screen mounts at `/admin/*` behind the guard.

---

## 4. Migration and backfill approach

### 4.1 Migration runner

New `backend/migrations/` directory with:
- `runner.py` — reads `migrations` collection, discovers migration modules in `migrations/versions/`, executes pending ones in order. Supports `--dry-run` flag (print what would run, don't execute). Records `{ version, appliedAt, checksum, durationMs }`.
- `versions/001_add_orgId.py` — adds `orgId = "default"` to all docs in `assessments`, `candidates`, `reports`, `templates` that lack it. Rebuilds org-scoped indexes.

### 4.2 Data backfill (Step 7)

`backend/migrations/versions/002_backfill_hiring_model.py` + admin endpoint `POST /api/admin/backfill`:

1. For each non-mock `candidates` doc:
   - Normalize email -> find-or-create `applicants` doc (merge duplicates -> one applicant, multiple applications, report merges).
   - Find `assessments` doc by `assessmentId` -> find-or-create `jobs` doc (set `assessmentJobId`).
   - Create `applications` doc linked via `candidateKey`.
   - Set stage: `link` + `inviteSent` -> `ASSESSMENT_SENT`; `assessmentStatus == COMPLETED` -> `ASSESSMENT_COMPLETED`; otherwise `SHORTLISTED`.
   - Write `stage_history` with `{ source: "backfill", actorUserId: "system" }`.
2. Never modifies/deletes existing docs.
3. Skips `isMock` candidates.
4. Idempotent: re-running finds existing applicants/jobs/applications and skips.
5. Reports duplicate emails merged.
6. Supports `dryRun` mode.

### 4.3 Seed default org

On first boot (lifespan in `main.py`), if `organizations` collection is empty -> insert default org. This is not a migration; it's a startup seed (like `ensure_indexes`).

---

## 5. Conflicts with engineering standards

| Standard | Status | Resolution |
|---|---|---|
| S2.2 "Every route requires an auth guard" | **Currently violated** — all FastAPI CRUD routes are open | Fixed in Step 3: `require_permission()` on every route |
| S2.3 "CORS `*` in production fails startup" | Partially wired in `validate_settings()` | Already handled — no change needed |
| S2.4 "Rate limiting on login/reset/upload/email" | **Not implemented** | Added in Step 3 |
| S2.6 "Reject `$` / `.` keys in filters" | **Not implemented** | Add `sanitize_filter()` in `security/mongo.py` |
| S2.6 "Reduce verbose proxy logging" | `server.ts` logs full request/response bodies | Fixed in Step 3: metadata-only logging |
| S6.2 "Versioned migrations runner" | **Not implemented** | Added in Step 1 |
| S8.1 "Append-only audit_log" | **Not implemented** | Added in Step 5 |
| CLAUDE.md S1 "MFA required for super_admin/admin" | **Not implemented** | Added in Step 2 |
| CLAUDE.md "test_authz_matrix.py fails if any route lacks a guard" | **Not implemented** | Added in Step 8 |

No unresolvable conflicts found. All gaps are greenfield additions, not contradictions.

---

## 6. Canonical stage enum

```python
class Stage(str, Enum):
    RESUME_UPLOADED = "RESUME_UPLOADED"
    PARSED = "PARSED"
    SHORTLISTED = "SHORTLISTED"
    TALENT_POOL = "TALENT_POOL"
    ASSESSMENT_SENT = "ASSESSMENT_SENT"
    ASSESSMENT_COMPLETED = "ASSESSMENT_COMPLETED"
    ROUND1_PENDING_ASSIGNMENT = "ROUND1_PENDING_ASSIGNMENT"
    ROUND1_SCHEDULED = "ROUND1_SCHEDULED"
    ROUND1_REVIEW_PENDING = "ROUND1_REVIEW_PENDING"
    ROUND2_PENDING_ASSIGNMENT = "ROUND2_PENDING_ASSIGNMENT"
    ROUND2_SCHEDULED = "ROUND2_SCHEDULED"
    ROUND2_REVIEW_PENDING = "ROUND2_REVIEW_PENDING"
    HR_ROUND = "HR_ROUND"
    OFFER = "OFFER"
    HIRED = "HIRED"
    REJECTION_PENDING_HR_REVIEW = "REJECTION_PENDING_HR_REVIEW"
    REJECTED = "REJECTED"
    ON_HOLD = "ON_HOLD"
    WITHDRAWN = "WITHDRAWN"
```

Transition table driven by a data structure (not code branches). `transition_stage()` validates against it.

---

## 7. Permissions catalogue

```python
PERMISSIONS = [
    "users.manage",
    "roles.assign_admin",
    "org.settings",
    "jobs.manage",
    "resumes.upload",
    "applications.view_all",
    "applications.assign",
    "applications.transition",
    "applications.override_stage",
    "reviews.read_all",
    "reviews.unlock",
    "talent_pool.manage",
    "audit.view",
    "data.export",
    "data.erase",
    "portal.view_as",
]

ROLE_PERMISSIONS = {
    "super_admin": ALL,  # every permission
    "admin": [
        "users.manage", "jobs.manage", "resumes.upload",
        "applications.view_all", "applications.assign",
        "applications.transition", "reviews.read_all",
        "talent_pool.manage",
    ],
    "hr": [
        "jobs.manage", "resumes.upload",
        "applications.view_all", "applications.assign",
        "applications.transition", "reviews.read_all",
        "talent_pool.manage",
    ],
    "technical_interviewer": [
        "applications.view_all",  # filtered to assigned only at repo level
        "reviews.read_all",       # filtered to assigned only
    ],
    "managerial_interviewer": [
        "applications.view_all",  # filtered to assigned only
        "reviews.read_all",       # filtered to assigned only
    ],
}
```

Endpoints use `require_permission(...)` — never role-name checks.

---

## 8. New backend dependencies

| Package | Purpose | Version range |
|---|---|---|
| `argon2-cffi` | password hashing (argon2id) | `>=23,<25` |
| `PyJWT` | JWT encode/decode | `>=2.8,<3` |
| `pyotp` | TOTP for MFA | `>=2.9,<3` |
| `qrcode[pil]` | QR code generation for MFA enrollment | `>=7,<9` |
| `cryptography` | encrypt MFA secrets at rest | `>=42,<45` |

No boto3 (S3Storage is a stub). No Docker files.

---

## 9. New frontend dependencies

| Package | Purpose |
|---|---|
| `react-router` (v7) | client routing + guards |
| `vitest` + `@testing-library/react` + `jsdom` | frontend unit tests |
| `jsonwebtoken` | JWT verification in Express `server.ts` |

---

## 10. Summary of what changes in existing tests

Existing backend tests call FastAPI routes that are currently unauthenticated. After Step 3, they'll all return 401. Each existing test file needs:

1. **`conftest.py`** — add a fixture that creates a test user (super_admin) + generates a valid JWT, and a helper `auth_headers()` returning `{"Authorization": "Bearer <token>"}`.
2. **`test_candidates_api.py`** — add `auth_headers` to every `client.get/post/put/delete` call.
3. **`test_directory_api.py`** — add `auth_headers`.
4. **`test_reports_api.py`** — add `auth_headers`.
5. **`test_migration.py`** — unchanged (uses `X-Migration-Secret`, not JWT).
6. **`test_health.py`** — unchanged (public route).
7. **`test_ready.py`** — unchanged (public route).
8. **`test_repositories.py`** — unchanged (direct DB, no HTTP).
9. **`test_schemas.py`** — unchanged (Pydantic validation, no HTTP).
10. **`test_services.py`** — unchanged (service functions, no HTTP).
11. **`test_report_backfill.py`** — unchanged (service function, no HTTP).
12. **`test_config_validation.py`** — unchanged (config, no HTTP).

Files changed: `conftest.py`, `test_candidates_api.py`, `test_directory_api.py`, `test_reports_api.py` (4 files).

---

## 11. Execution order

| Step | Scope | Key files touched |
|---|---|---|
| 1 | Organizations + migrations runner | `migrations/`, `db/mongodb.py`, `models/organization.py`, `schemas/organization.py`, `main.py` |
| 2 | Users + RBAC + permissions | `security/`, `models/user.py`, `schemas/user.py`, `config.py` |
| 3 | Auth endpoints + lock all routes + CLI | `api/auth.py`, `api/users.py`, `cli.py`, `server.ts`, `functions/`, existing `api/*.py`, `conftest.py` + 3 test files |
| 4 | Frontend (router, login, guards, admin pages) | `src/lib/auth*.ts`, `src/App.tsx`, new pages, `package.json` |
| 5 | Hiring data model (jobs/applicants/applications/stages/audit) | `schemas/`, `models/`, `services/`, `api/`, `db/mongodb.py` |
| 6 | Local resume storage adapter | `services/storage.py`, `api/resumes.py` |
| 7 | Backfill existing data | `migrations/versions/002_*`, `api/admin.py` |
| 8 | Tests + docs | `tests/test_authz_matrix.py`, `tests/test_auth.py`, frontend tests, README |

---

## 12. Open questions

1. **MFA secret encryption key**: use `JWT_SECRET` as the key for encrypting TOTP secrets at rest, or add a separate `MFA_ENCRYPTION_KEY` env var? Decision: **separate `MFA_ENCRYPTION_KEY`** (defense in depth; JWT compromise shouldn't reveal MFA secrets).

2. **Refresh token storage**: `localStorage` (survives page reload, XSS risk) or `httpOnly cookie` (CSRF risk but XSS-resistant)? Decision: **`httpOnly` secure cookie for refresh token, memory-only for access token.** This is the most secure pattern for SPAs. The backend sets `Set-Cookie` on login/refresh; the frontend reads access token from the JSON response body.

3. **First boot without super_admin**: the CLI `create-super-admin` must work without a running server (direct MongoDB connection). The app boots without users and returns 401 on everything until the first super_admin is created. `/api/health` and `/api/ready` remain accessible.

4. **Express JWT validation**: the Express server (`server.ts`) needs to validate JWTs. Decision: add `jsonwebtoken` npm package — standard, well-audited choice.

5. **Cloudflare Pages Functions JWT validation**: Decision: implement minimal HS256 verification using Web Crypto API (no npm packages in CF Workers). Small utility function.

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| In-memory rate limiter resets on process restart | Documented; Mongo-backed limiter as upgrade path |
| mongomock-motor may not support all index features (partial filters, TTL) | Test indexes against real index creation; mock tests focus on logic, not index behavior |
| Existing `localStorage`/`INITIAL_*` fallback paths bypass auth | Frontend auth wrapper intercepts all API calls; fallback paths will 401 until token attached |
| MFA TOTP secret encryption adds complexity | Use `cryptography.fernet` (simple symmetric); key rotation documented as future work |
| Backfill duplicate-email merging may surprise users | Dry-run mode mandatory before real run; merge report shown to admin |

---

**Waiting for your "go" to begin Step 1.**

---

# Phase 2 — Step 0 plan: resume pipeline, scoring, jobs worker, outbox, assessment hand-off

> Protocol: plan recorded here first. No code until "go".
> Scope: HR single/bulk resume upload → parse → candidate profile → job match
> (60% split SHORTLISTED vs TALENT_POOL) → assessment send + completion sync.
> Existing assessment/PrimeHire/Zepto flows are reused, not rebuilt.
> OpenRouter Free LLM behind a provider adapter (swappable later). AI advisory only.

## 1. Collections / indexes (all in `backend/app/db/mongodb.py::INDEXES`)

| Collection | Key fields | Indexes |
|---|---|---|
| `resume_batches` (new) | `orgId`, `batchId` (uuid), `jobKey`, `fileIds[]`, `status` (`pending\|processing\|done\|partial`), `counts{total,parsed,failed}`, `createdBy`, timestamps | `uniq_batchId` UNIQUE on `batchId`; `by_org_created` on `(orgId, createdAt desc)` |
| `background_jobs` (new) | `orgId`, `jobId` (uuid), `kind` (`resume_parse\|resume_score\|assessment_send\|assessment_sync\|email_send\|interview_reminder`), `entityType/entityKey`, `payloadRef`, `runAfter`, `attempts`, `maxAttempts`, `status` (`pending\|running\|done\|failed\|skipped`), `dedupeKey`, `lastError`, timestamps | `uniq_dedupeKey` UNIQUE on `dedupeKey`; `by_status_runAfter` on `(status, runAfter)`; `ttl` optional on completed (keep 30d for diagnostics) |
| `email_outbox` (new) | `orgId`, `messageId` (uuid), `kind` (`assessment_invite\|interview_assignment\|reminder\|...`), `toHash` (sha256, never raw PII in index), `payloadEncrypted` (Fernet), `dedupeKey` (`kind+entity+due`), `status` (`pending\|sent\|failed\|skipped`), `attempts`, `nextRetryAt`, `sentAt`, timestamps | `uniq_dedupeKey` UNIQUE; `by_status_nextRetry` on `(status, nextRetryAt)` |
| `llm_runs` (new) | `orgId`, `runId`, `promptVersion`, `model`, `tokensIn/Out`, `inputHash` (sha256, never content), `outputRef` (applicationKey/batchId), `decider` (userId or `system+approvedBy`), `latencyMs`, timestamps | `by_org_created` on `(orgId, createdAt desc)` |
| `applicants` (extend, no new collection) | add `resume.{storageKey,fileName,mimeType,sizeBytes,contentHash,rawText,digest,parsedJson}`, `consent{purpose,channel,textVersion,givenAt}`, `retentionUntil`, `tags[]` | keep `uniq_org_email`; add `by_org_phone` on `(orgId, phone)`; skills array index `by_org_skill` on `(orgId, resume.parsedJson.skills)` for pool search later |
| `applications` (extend) | `matchScore`, `scoreBreakdown{keyword,llm,disagreementFlag,matched[],missing[]}`, `source` (`upload\|talent_pool_match`), `talentPool{inPool,rejectedAtStage,reasonCategory,recontactFlag,eligibleAfter}` already in §1.8 | FIX index: replace `uniq_job_applicant` with partial UNIQUE on `(orgId, applicantKey, jobKey)` + filter `{currentStage: {$nin: [REJECTED, WITHDRAWN, HIRED]}}` so re-application after terminal states works |

No `notifications` collection yet (Phase 3). No interview/review collections yet (Phases 3–4).

## 2. Services / routes (reuse first)

- `services/storage.py` — UUID filenames under `resolved_storage_dir`, traversal-safe, magic-bytes check (new dep `python-magic-bin` or header sniff + `python-multipart`), 5 MB/file, 10 files / 25 MB batch, DOCX unzip cap, ClamAV hook (`CLAMAV_ENABLED`, quarantine status), authed download `GET /api/resumes/{fileId}/download` (`attachment` + `nosniff`).
- `services/llm/` — `base.py` adapter interface + `openrouter.py` (timeout 30s, retry ≤2, strict JSON schema, `extra=forbid`); `strip_pii()` before send; deterministic fallback when LLM fails. Prompt version `resume-parse-v1`, `match-score-v1` versioned in code.
- `services/resume_parse.py` — deterministic extract (email/phone regex, skill lexicon from job + global list: Java, Python, React, Spring Boot, SQL, AWS…) then optional LLM structuring; output Pydantic `ParsedResume` (name, email, phone, skills, languages, technologies, experienceYears, education[], ctcCurrent/Expected, noticePeriodDays, summary).
- `services/scoring.py` — keyword score (must-have coverage weighted + nice-to-have weights + experience band) alongside LLM score; `disagreementFlag` if |Δ|≥25; threshold from `jobs.matchThreshold` (default 60): `>=threshold → SHORTLISTED`, else `TALENT_POOL` (saved, reason `below_threshold`, flag `eligible`).
- `services/outbox.py` + `services/zepto_mail.py` — Fernet-encrypt body with `OUTBOX_ENCRYPTION_KEY`, dedupe on `(kind, entityId, dueAt)`, backoff retries, diagnostics query.
- `worker.py` (new `backend/app/worker.py` + `cli.py worker` command) — asyncio poller claiming `background_jobs` (atomic `findOneAndUpdate` pending→running), runs parse→score→transition via existing `transition_stage` path (`can_transition` + history + audit), enqueues assessment-send; survives restart (jobs stay `pending`, dedupe prevents doubles).
- Assessment hand-off — reuse `primehire_service` + existing `POST /interview` flow via httpx (timeout + 3 retries + jitter, metadata-only logs); completion sync reuses `report_backfill.backfill_report` behind a `assessment_sync` job + manual `POST /api/applications/{id}/sync-assessment` trigger. No new candidate portal.
- Routes (all `require_permission`, orgId from token, paginated + allowlisted): `POST /api/resumes/upload` (`resumes.upload`), `GET /api/resumes/batches/{id}`, `GET /api/applicants` (new list), `GET /api/applicants/{id}`, `POST /api/applications/{id}/send-assessment` (`applications.transition`), `POST /api/applications/{id}/sync-assessment`, `GET /api/diagnostics/outbox` + `/jobs` (`admin` only). Transition permission: `applications.transition`; override stays `applications.override_stage`.

## 3. Conflicts with standards

| Standard | Status | Resolution in this phase |
|---|---|---|
| §3 upload safety (specified-only) | violated (no endpoint) | implemented here with §3.7 fixtures (spoofed/oversized/corrupt/zip-bomb/traversal/double-ext) |
| §4 LLM safety (specified-only) | violated | delimited blocks + ignore-instructions prompt, schema-validated JSON, retry ≤2 → fallback, advisory-only (human `userId+reason` in audit), keyword+LLM pair + disagreement flag, `llm_runs` (hash not content), PII stripped, injection fixtures |
| §6.1 outbox + idempotency (specified-only) | violated (fire-and-forget Zepto in Express only) | durable `email_outbox` + dedupe + retries; backend Zepto sender; Express path untouched |
| §5 consent/retention | partial (`consent` field exists, no flow) | capture consent on upload (`source: hr_upload`, `textVersion: v1`), set `retentionUntil = now + RETENTION_DAYS`, surface in profile |
| `applications.uniq_job_applicant` global-unique in `mongodb.py:125` vs §1.8 partial-filter design | drift | fixed via migration `002_fix_application_uniqueness` (drop + recreate partial) with dry-run |
| `Settings.extra="ignore"` + missing new vars | gap | add all vars below to both `.env.example` + `validate_settings()` |

## 4. New env vars (both `.env.example` + backend + `validate_settings()`)

`OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default e.g. free-tier model, documented swappable),
`LLM_PROVIDER` (default `openrouter`), `OUTBOX_ENCRYPTION_KEY` (Fernet, prod-required),
`ZEPTOMAIL_API_KEY` (backend sender; name only, never value),
`EMAIL_FROM_ADDRESS` (default existing `noreply@nxtagent.ai`),
`UPLOAD_MAX_MB` (default 5), `UPLOAD_BATCH_MAX` (default 10),
`CLAMAV_ENABLED` (default false), `RETENTION_DAYS` (default 365).
No Docker/Redis/S3/boto3.

## 5. Tests + docs (gate: mixed batch split by threshold + assessments send)

Backend: upload-safety fixtures, parse unit (incl. Java/Python/React/Spring/SQL/AWS extraction + CTC), scoring (above/below 60, disagreement flag), injection fixtures (no action + flagged), outbox dedupe/retry/encryption, worker crash-restart (job runs once), assessment send/sync mocked-PrimeHire, transition-table additions, authz-matrix + org-isolation updates, PII-canary log tests, coverage ≥80%. Frontend: HR upload flow (Vitest) + Playwright e2e `login(HR) → create job → bulk upload 3 resumes (2 above / 1 below 60) → SHORTLISTED vs TALENT_POOL → send assessment → sync completed`. Docs: README, DEPLOYMENT (worker command), HR upload guide, `.env.example` (root+backend), migration dry-run output.

## 6. Risks

| Risk | Mitigation |
|---|---|
| OpenRouter free-tier latency/failure | timeout 30s, retry ≤2, deterministic fallback always produces a score; `llm_runs` records failures; disagreement flag forces human review |
| Parse isolation cost (30s subprocess per file) | Phase 2 runs parse in worker with per-file try/catch + batch isolation (one bad file ≠ failed batch); subprocess sandbox deferred to hardening in Phase 7, documented |
| `python-magic` native dep weight | prefer pure-Python header sniff for PDF/DOCX/DOC + `python-multipart`; confirm before adding `python-magic-bin` |
| mongomock-motor gaps (partial/TTL) | logic tests on mock, index-shape test guarded for real Mongo; migration dry-run in CI |
| Zepto sandbox bounces | outbox `failed` + diagnostics retry button; no auto-retry storm (backoff, max 5) |
| PII in LLM prompts/logs | `strip_pii` unit-tested; `inputHash` only in `llm_runs`; PII-canary tests on all new routes |

## 7. Execution order (after "go")

1. Config + indexes + migration 002 (dry-run). 2. Storage + upload routes + fixtures.
3. LLM adapter + parse + scoring + `llm_runs`. 4. Jobs worker + outbox/Zepto + diagnostics.
5. Assessment send/sync wiring. 6. HR UI (upload, profile, roadmap v1, tracker, talent-pool read-only).
7. Tests + docs + green CI, then STOP + report and propose pipeline amendment.

**WAITING for your "go" for Phase 2 Step 1.**

---

## Phase 2 — Approved adjustments (user "go" with changes)

1. Parsing sandbox stays in Phase 2: isolated child process, 30 s timeout,
   kill-on-timeout. Only the Windows memory cap is best-effort (documented).
2. ClamAV: keep `CLAMAV_ENABLED`, the scan interface, and `quarantined` status
   (blocks download + parsing). Real `clamd` integration deferred to Phase 7.
3. Partial-unique `applications` index allows a new application for the same
   `(orgId, applicantKey, jobKey)` only after `REJECTED` or `WITHDRAWN`.
   `HIRED` and `TALENT_POOL` still block. A below-threshold re-upload for the
   same job re-scores the existing application — never a second row.
4. Must implement + test: consent checkbox (blocks upload until ticked);
   knockout rule (missing must-have caps score + lists missing);
   `needsReview` flag (knockout or LLM/keyword |Δ|≥25 near threshold → human,
   never silent pool); `possibleDuplicate` flag (phone matches, email differs);
   outbox body wiped after successful send; no candidate password persisted anywhere.
5. LLM behind concurrency limit (default 2) with 429-aware backoff + jitter;
   batch finishes on deterministic fallback with a visible flag if LLM fails.
6. Fixtures: synthetic resumes only. Never commit real resumes or real PII.
7. Migration 002 requires a dry-run report and prints a backup reminder before
   touching a real database.

Slices (STOP after each for review, app running + tests green + how-to-try note):
- Slice A: Steps 1–3 + Jobs page + Resume Upload page (live batch table, per-file statuses).
- Slice B: Steps 4–5 + Applicants list + Applicant Profile (score breakdown, roadmap, timeline).
- Slice C: Steps 6–7 + bulk "Send assessments" + completion sync.
- Slice D: Tracker, Talent Pool list, Diagnostics, Org Settings additions + full tests/docs.

Ordering note: pipeline amendment runs after Phase 2 (Phase 2 uses only early
stages, which the amendment keeps).

## Slice A self-check (user asked, 2026-10-03)

Reran suite: 268 passed. Adversarial TestClient script: spoofed rename →
rejected row (batch partial, API healthy); 11 files → 400 batch cap; 6 MB
file → rejected; no consent → 400; same resume twice → both stored, same
contentHash (dedup/possible-duplicate + re-score arrives in Slice B);
interviewer upload → 403. Atlas snapshot: not applicable here — only
mongomock in this environment; reminder stands for dev/Atlas data before
running migration 002 for real.

## Slice B plan adjustments (user "go Slice B" with changes)

Worker moves into Slice B: upload validates/stores/enqueues one
`resume_process` job per file and returns immediately; worker
(claim/lease/backoff/dead-letter, per-file isolation, dedupe keys) runs
parse → LLM structure/score → scoring → applicant/application
create-or-rescore → stage transitions. Batch table polls.
LLM: concurrency 2, 429-aware backoff+jitter, model from env only (default
empty = deterministic-only + "LLM unavailable" flag), PII stripped,
`llm_runs` hash-only, retry ≤2 → fallback. `.doc` → lowConfidence +
needsReview. Skills: word-boundary + aliases + edge tests. PII masked by
default + audited reveal; nothing PII in localStorage/URLs. Roadmap stepper
is data-driven; no hardcoded Round 1/2. Vitest now (consent gate, score
badge, mask/reveal) + `npm test` in CI. Also: knockout rule, needsReview
(|Δ|≥25/knockout/injection/lowConfidence), possible-duplicate
(phone-match/email-differ), re-score on re-upload, injection fixtures,
70/30 weights from org settings, profile with breakdown/timeline/gated
stage actions (reason mandatory on ALL transitions).

## Slice C build log (email safety + assessment hand-off + sync)

Built 2026-10-03. STOPPED for review — pipeline amendment next (then Phase 3).

A. Follow-ups first:
1. Deny by default: interviewer roles now 403 on ALL applicant/application/
   job/legacy-candidate reads until Phase 3 projection (matrix updated;
   `resumes.upload` is the staff gate meanwhile).
2. Injection: normalized matching (split lines), paraphrase + es/fr/hi
   patterns; 5 variant fixtures assert identical deterministic score/stage
   vs clean twin + review flag. Backstops documented in `docs/SCORING.md`.
3. `docs/SCORING.md` holds the exact keyword-v1 formula; calibration test
   (10 synthetic cases + combine bounds). Calibration caught a real bug:
   neutral must-base 48 let blank resumes shortlist (63); lowered to 40.
4. Phone duplicates via indexed `phoneDigits` ([full, last10]) lookup;
   legacy `by_org_phone` retired.

B. Safety: `EMAIL_DRY_RUN` default true (prod refuses true; dev real-send
   without allowlist refuses boot). No fabricated links — upstream failure
   leaves a visible failed state + retry. Write-ahead
   send_requested→upstream_pending→link_created→email_queued→email_sent;
   crash resumes or adopts the upstream duplicate (tested). Password only in
   encrypted outbox body, wiped after real send; canary tests sweep logs,
   audit, llm_runs, responses, and stored docs. Outbox: Fernet, dedupe
   kind+entity, backoff, dead-letter; lists never include bodies (dry-run
   single view only, admin). Timeouts/retries/jitter on all upstream/Zepto
   calls; IDs/status/latency logs only. Bulk send is an explicit human
   action with per-item results; autoSend defaults false (audited change).
   Sync sweeps ASSESSMENT_SENT only (batch/interval config), skips expired
   windows, transitions via transition_stage(actor=system).
C. UI: bulk send with confirm dialog + results on Applicants (shortlisted
   rows, per-row assessment chip, dry-run banner), Diagnostics tab
   (admin: counts, failed emails/dead jobs with retry, allowlist flag),
   assessment linking on Jobs, email-mode banner hook.
   NOTE: `src/App.tsx` was found reverted to its pre-Slice-B structure
   (sidebar revision without Applicants/Diagnostics wiring); wiring was
   re-applied and verified (tsc+build+tests green). Recommend a commit
   before Slice D so regressions are visible.
D. Tests: 387 backend passed (13 flow tests: dry-run/real/allowlist/
   double-click/crash-adopt/bulk/sync×2/crypto/org-settings/authz/autosend/
   validate-guards), coverage 82.7% (gate 80); 10 Vitest passed (incl. new
   bulk-send dialog test); new CI runs both.
- How to try (your own addresses only): keep `EMAIL_DRY_RUN=true` →
  bulk-send to a shortlisted synthetic candidate → Diagnostics shows
  "recorded, not sent", stage stays SHORTLISTED. Then dry-run off +
  allowlist=self → real invite → ASSESSMENT_SENT. Off-list address →
  refused. Double-click → one interview + one email (counts asserted).
  Submit via inbox link → sweep → ASSESSMENT_COMPLETED with score.
- Open risks: at-least-once email across a crash in the Zepto→mark window
  (small, documented); upstream candidate_id uses our applicantId (assumed
  accepted — first real send will confirm); report envelope shape assumed
  `{report: {...}}` per backfill convention; Atlas snapshot still pending
  before migration 002 on real data.

## Slice B build log (worker + LLM + scoring + portals)

Built 2026-10-03. STOPPED for review — Slice C not started.

- Worker (`models/jobs.py`, `services/worker.py`, `cli.py worker`):
  `background_jobs` with idempotent enqueue (pre-check + unique dedupeKey),
  atomic claim/lease (300 s), backoff retries (30 s×2^n+jitter, cap 1 h),
  dead-letter after maxAttempts. Upload returns 202-style immediately with
  batch `processing`; batch table polls every 3 s. Crash-safe (expired
  leases reclaimed, tested).
- LLM (`services/llm/`): OpenRouter scorer, model/key from env only (default
  empty = disabled → deterministic + "LLM unavailable"). Concurrency 2,
  429 honors Retry-After + jitter, retry ≤2, strict JSON schema, delimited
  blocks + ignore-instructions prompt, PII stripped (name→CANDIDATE,
  emails/phones redacted), `llm_runs` hash-only (tested: no raw text stored).
  Injection short-circuits BEFORE any LLM call (pipeline-level, not just
  adapter-level — caught by test).
- Scoring (`services/scoring.py`, `keyword-v1`): 80 coverage + 15 nice
  weights + experience band; knockout (missing must-have → cap 40 + listed);
  70/30 combine from org `settings.scoring`; |Δ|≥25 → needsReview.
  Skills use word-boundary + aliases (js/ts/postgres/k8s/nodejs/dotnet…);
  Java≠JavaScript, SQL≠NoSQL tested. `.doc` → lowConfidence + needsReview.
- Pipeline (`services/pipeline.py`): find-or-create applicant (consent v1,
  retentionUntil), possible-duplicate (phone), create-or-RESCORE (never a
  second active application), TALENT_POOL↔SHORTLISTED moves via
  `transition_stage` with reasons, pool records carry reason/flag/
  eligibleAfter. All transitions (API + worker) go through
  `services/transitions.py`; reason mandatory everywhere now.
- PII: masked by default in list/detail/profile; POST reveal (email/phone
  allowlist, strict 400 otherwise) writes `pii.reveal` audit. Nothing PII in
  localStorage (new pages keep memory state only) or URLs.
- UI: data-driven `RoadmapStepper` (coarse steps, no Round 1/2 labels);
  `ScoreBadge` (score/threshold/review chips); Applicants list (search,
  masked + Reveal, latest-application score); Applicant Profile (chips,
  experience/education/CTC/notice, full breakdown, download, timeline,
  gated stage actions); batch live-polling; Jobs untouched.
- Tests: 308 backend passed (incl. 20 new scoring/pipeline tests: mixed
  3-resume split SHORTLISTED/TALENT_POOL, injection, disagreement,
  duplicates, rescore+promotion, quarantine, reveal audit, lease reclaim,
  mocked-LLM hash-only runs), coverage 83.2% (gate 80); 9 Vitest passed
  (consent gate, badge, mask/reveal); `npm test` wired; new
  `.github/workflows/ci.yml` (lint+test+build, pytest+coverage).
- Bugs caught by tests during build: applicant missing orgId; ParsedResume
  validated before lowConfidence attach; injection mock calling LLM;
  reveal allowlist strictness; dedupe pre-check without index; backoff vs
  immediate reclaim in crash test.
- How to try: set `OPENROUTER_*` in `backend/.env` (or leave empty for
  deterministic mode); run API + `cli.py worker`; login → Upload (consent)
  → watch batch go processing→done → Applicants → Profile (breakdown,
  timeline) → Reveal (audit) → stage action with reason. Bad-key test:
  wrong `OPENROUTER_API_KEY` → batch still finishes, "LLM unavailable" shown.
- Open risks (at Slice B close; both closed in Slice C follow-ups):
  phone lookup was O(n) scan → now indexed `phoneDigits`; interviewer reads
  were masked-but-allowed → now 403 until Phase 3 projection.
  Remaining: free-tier model name left to operator (no hardcode); `.doc`
  still lossy; Atlas snapshot still not taken here (mocks only).

## Slice A build log (Steps 1–3)

Built 2026-10-03. STOPPED for review — Slice B not started.

- Step 1: `app/config.py` + both `.env.example` gained 11 Phase 2 vars
  (`LLM_PROVIDER/OPENROUTER_*/LLM_CONCURRENCY/OUTBOX_ENCRYPTION_KEY/
  ZEPTOMAIL_API_KEY/EMAIL_FROM_ADDRESS/UPLOAD_* /CLAMAV_ENABLED/RETENTION_DAYS`)
  with production guards in `validate_settings()`. `INDEXES` gained
  `resume_batches/resume_files/background_jobs/email_outbox/llm_runs`,
  applicant phone/skills indexes, and the partial `uniq_active_application`
  (new app allowed only after REJECTED/WITHDRAWN). Migration
  `002_fix_application_uniqueness` reports active duplicates + prints the
  backup reminder; dry-run verified in `test_migrations.py`.
- Step 2: `services/storage.py` (UUID keys, traversal-safe),
  `services/upload_validate.py` (magic bytes, 5 MB/file, batch cap, DOCX
  unzip cap, double-extension/traversal rejects), `services/clamav.py`
  (interface + quarantined block; real clamd in Phase 7), `api/resumes.py`
  (multipart upload with mandatory consent, batch list/detail, authed
  `attachment`+`nosniff` download; quarantined → 403). StorageKey never
  leaves the server (projection helpers + test).
- Step 3: `services/resume_extract.py` (deterministic email/phone/skills/
  langs/CTC/notice/experience/education) + `_parse_worker.py` child with
  30 s kill-on-timeout in `services/resume_parse.py` (bytes over stdin;
  POSIX-only 512 MB RLIMIT_AS, Windows best-effort). Parse ran inline at
  upload in Slice A; moved to the `background_jobs` worker in Slice B.
- UI: `JobsPage` (list + create) and `ResumeUploadPage` (job select,
  consent checkbox gating upload, multi-file picker, result batch table
  with per-file status + extracted fields, batch history) wired as new
  `Jobs`/`Upload` tabs in `App.tsx` behind the existing login guard.
- Verify: `tsc` clean, `vite build` ok, backend 268 passed, coverage 83%
  (gate 80). New deps: `python-multipart/pypdf/python-docx` (light,
  required for upload/parse). `npm test` script still absent (pre-existing
  gap — Slice D adds Vitest + Playwright e2e).
- How to try: backend `uvicorn app.main:app --app-dir backend --reload`;
  frontend `npm run dev` (set `VITE_API_URL=http://localhost:8000`);
  login → Jobs → create job → Upload → tick consent → upload PDF/DOCX →
  see per-file parsed rows; without consent upload is blocked (400 + UI).


## Pipeline amendment - Step 0 plan (awaiting "go"; no code yet)

Context: Phase 2 Slices A-C committed (`phase2-slice-c`), tree clean,
suites green (387 backend, 82.7%, 10 Vitest). This amendment replaces
hardcoded `ROUND1_*`/`ROUND2_*`/`HR_ROUND` with data-driven pipelines.
Two slices (P1 model+refactor, P2 admin UI + outstanding Phase 2 items),
then Phase 3. STOP after each slice.

### Collections / indexes

- `pipeline_templates` (new, per org): `templateKey` (slug, immutable once
  used), `name`, `description`, `version` (int, bump on edit),
  `rounds[]`, `isDefault`, `isArchived`, timestamps.
  Index: `uniq_org_templateKey` UNIQUE on `(orgId, templateKey)`.
- Round (embedded, validated): `roundKey` (stable slug), `name` (free
  text), `type` (`technical|managerial|hr|custom`), `order` (contiguous),
  `parallelGroup?`, `required` (default true),
  `interviewerEligibility {roles[], skills[]}`,
  `scorecard {key, competencies[{key,label,anchors}]}` (inline, versioned
  with the template; a full `review_templates` collection lands in Phase
  4), `defaultDurationMinutes` (45), `defaultMode`, `bufferMinutes` (10),
  `fieldPolicyOverride?`, `passRule` (`all|any|majority|lead_decides`,
  default `all`), `visibilityOfPriorRounds` (`none|all|selected[]`),
  `hideDecisionUntilOwnScorecard` (default true),
  `questionSourceRounds[]` + `generateQuestions` (hr rounds),
  `allowSlotNomination` (default false).
  Constraints: 1-8 rounds; contiguous order/groups; keys immutable once
  the template has been used.
- `jobs`: add `pipelineTemplateKey` + `pipelineVersion` (copied at job
  creation; changing a job's template re-instantiates only not-started
  rounds, audited, with dry-run preview).
- `applications`: add `rounds[]` (`{roundKey, instanceId, name, type,
  status, interviewId?, reviewIds[], decision?, startedAt?, completedAt?,
  skippedReason?, addedAdHoc?}`) + `currentRoundKeys[]`.
  Index: `by_org_round` on `(orgId, currentRoundKeys)` for tracker columns.
- Stage enum: drop `ROUND1_*`, `ROUND2_*`, `HR_ROUND`; add `INTERVIEWING`
  (early/terminal stages unchanged). `transition_stage()` keeps coarse
  moves; new `advance_round(application, roundKey, outcome, actor,
  reason?)` owns round moves (`advance|hold|reject|repeat|no_show`),
  parallel `passRule` evaluation, activation of next rounds, and
  `stage_history` entries carrying `roundKey` + `instanceId`.
- Migration `003_pipeline_templates`: seed "Technical + Managerial + HR"
  (default) and "Full-stack: Frontend + Backend (parallel) + Managerial +
  HR" (example); map live apps (`ROUND1_*` to `INTERVIEWING` round 0,
  `ROUND2_*` to round 1, `HR_ROUND` to the hr round), keeping old history
  entries and appending new metadata; dry-run + backup reminder (Atlas
  snapshot still pending - operator action before any real-DB migration).

### Conflicts with standards / existing code

- `VALID_TRANSITIONS` (`models/hiring.py`) loses all `ROUND*` edges;
  `schemas/hiring.py::Stage` shrinks; transition-table tests updated.
- Frontend hardcodes stages in two places: `stepsForStage()` (interview
  aggregate) and the profile stage-action `<select>` - both become
  data-driven from `application.rounds` (the stepper component already
  is; P1 feeds it rounds).
- `advance_round` and `transition_stage` must never disagree: coarse
  `INTERVIEWING` enter/exit only via `advance_round`; no direct writes to
  `currentStage` outside `transitions.py` (test asserts this).
- Phase 2 surfaces untouched: upload, score, SHORTLISTED/TALENT_POOL,
  ASSESSMENT_* flow keeps working throughout.

### How Phases 3-6 read through this (recorded for those prompts)

- P3: interviewer profiles match `interviewerEligibility`; interviews
  carry `roundKey`+`instanceId`; assign dialog per current round(s);
  visibility = strictest(role default, profile, round override).
- P4: review forms/scores from round `scorecard`; decisions map to generic
  outcomes via `advance_round`; anti-anchoring per round settings.
- P5: hr-type rounds own question generation (`questionSourceRounds`);
  comparison groups scorecards by round name/type; offers trigger from the
  pipeline end state.
- P6: rejection records `rejectedAtRound`; pool shows "rejected at: round".
- P7: funnel/time-in-stage per `roundKey` and round `type`.

### Slice P1 (model + refactor + migration + tests)

Amendment Steps 0-2 + Step 4: `pipeline_templates` model/API (minimal
CRUD behind `pipelines.manage`), `advance_round`, stage-enum swap,
migration 003, stepper fed from rounds, tests (instantiation on entering
`INTERVIEWING`, sequential flows, parallel groups under each passRule,
hold/reject/repeat/no-show, ad-hoc insert/skip with reasons, derived
`currentRoundKeys`, old-stage migration dry-run, `pipelines.manage` +
`applications.manage_rounds` permission checks, org isolation,
authz-matrix updates). STOP.

### Slice P2 (admin UI + outstanding Phase 2 items)

Amendment Step 3 (pipeline builder with per-round drawer,
parallel-group controls, validation, live roadmap preview,
duplicate/archive; job-form template dropdown with preview; tracker
columns from rounds) plus:
- Admin Tracker: per-job Kanban from pipeline rounds + universal coarse
  view, drop-off % from `stage_history`, alert chips (assessment pending
  >3d, needs review, failed parses/emails). Read-only; changes only via
  guarded actions.
- Talent Pool basic list (below-threshold + rejected: job, score, tags,
  date, eligibility; no re-matching yet - Phase 6).
- Org Settings page (super_admin only): LLM provider/model, score
  weights, autoSendAssessment, sync interval, consent notice text,
  retention days. Typed schema, every change audited.
- Report contract fixtures from `scratch/report-*.json` structure with
  synthetic values only. Verified PII-free (no name/email/phone keys,
  empty `candidate_id`); SAFE to derive. `scratch/login.json` DOES look
  like real credentials (email + 20-char password) and is committed -
  rotate that password and delete the file (owner action; history rewrite
  not done unilaterally).
- Playwright smoke (login, create job, upload 2 synthetic resumes with
  mocked backend/LLM, one shortlisted + one pooled, dry-run send, status
  chip) wired into CI.
- README + docs/DEPLOYMENT.md updates for all of Phase 2 (worker, env
  vars, dry-run, allowlist, backup before migrations).

### Risks

- Stage-enum swap ripples through transition tests, the profile stage
  `<select>`, and any stage-string comparisons. Mitigation: P1 keeps the
  app bootable after each commit; full suite per step.
- Parallel `passRule` semantics are the subtlest logic; per-variant tests.
- Template-version migration of ACTIVE applications is the only
  data-risky op: dry-run preview + explicit reason + audit; the likely
  case (no live interview-stage apps) only seeds.
- Unexplained mid-slice revert of `src/App.tsx` (found at Slice C start,
  rewired, committed). Watch for recurrence: if any file changes without
  an edit record, stop and investigate before continuing. No second
  session is running from this side.

**WAITING for your "go" for Slice P1.**

---

## Jobs module rebuild — Step 0 (awaiting "go")

Source: the Jobs-module spec text in the user message ("Elite HR PRD - #Phase2.md"
was named as source of truth, but that file is NOT present anywhere in the
workspace — searched `**/*.md`, `*PRD*`, `*Phase2*`, `scratch/`). Step 0 and
all slices below are built from the message spec; if the real file surfaces
and conflicts with it, the file wins and the plan is re-cut.

### Existing implementation (inspected, will be reused — §32)
- Backend `api/hiring.py`: POST/GET/PUT `/jobs` (+`/{job_id}`), audit-logged
  (`job.create`/`job.update`); create/update gated `jobs.manage`, reads gated
  `resumes.upload`. NO delete/archive/close/reopen endpoints.
- Model `models/hiring.py`: `jobId` = server uuid4 (already immutable/permanent),
  user-supplied unique-per-org `jobKey`; NO company/department/positions/
  keywords-txn/dates/assignee/workMode/location/status-lifecycle fields.
- Schemas `schemas/hiring.py` (`extra="forbid"`): `JobStatus` =
  open/on_hold/closed/filled; experience = int years; description = plain text.
- Frontend `JobsPage.tsx`: minimal create (jobKey/title/skills/assessment link)
  + table. RBAC roles: super_admin/admin/hr hold `jobs.manage`.
- Email infra exists (outbox + ZeptoMail) for assignee notifications.

### Proposed collections/indexes (new fields live on `jobs`; no new collection)
Extend `jobs` docs: companyName, jobRole, department, min/maxExpYears (decimal),
positionsTotal/Filled, keywords[] (+keywordCount), workMode, location,
openedAt/closesAt, assigneeUserId (+assigneeEmail snapshot), jdHtml + jdText,
jdTemplateVersion, lifecycleStatus, duplicateOf?, closedAt, archivedAt.
Indexes (in `db/mongodb.py`, verified at startup): keep uniq jobId+orgId and
uniq jobKey+orgId; ADD `{orgId, lifecycleStatus}`, `{orgId, assigneeUserId}`,
`{closesAt}` (auto-close sweep), text-ish `{orgId, companyName, jobRole}` via
regular compound (no Atlas Search dependency). Migration entry in
`backend/migrations/` backfills defaults for pre-existing job docs; dry-run in CI.

### Conflicts with ENGINEERING_STANDARDS to resolve at Slice 1
1. Status model: spec DRAFT/OPEN/ON_HOLD/CLOSED/ARCHIVED vs existing
   open/on_hold/closed/filled (+ matrix test rows pin the old values).
   Proposal: adopt spec lifecycle, migrate old values
   (filled→CLOSED w/ filled=positions), update matrix rows.
2. Spec "Job ID system-generated, Job Key?" — existing `jobId` (uuid, immutable)
   already satisfies permanence; keep `jobKey` as the human unique key and map
   spec "Job ID" display to a readable derived form OR adopt spec naming in UI
   only. Needs your call — see Q1 below.
3. Decimal experience + rich-text JD + JD upload (magic bytes, 5 MB default,
   batch/single caps) reuse the resume-upload safety rules (§5); JD template
   parse runs in the isolated-parse worker pattern, never inline unbounded.
4. Assignee = active user + auto email snapshot: needs a users-directory read
   (`users.manage`-scoped list already exists) + outbox notification on
   assign/reassign (dedupe kind+entity).
5. Auto-close sweep + audit-trail reads reuse worker/audit infra; timezone =
   org setting (default Asia/Kolkata per phase protocol §7).

### Risks
- Biggest: building from message-spec without the PRD file (drift risk if the
  file differs — especially duplicate-detection strictness, JD template schema,
  and closing-timezone rule).
- Scope is ~4 slices (backend schema/endpoints/migration; JD upload+template;
  frontend list/detail/create/edit/lifecycle; tests+docs). Authz-matrix,
  org-isolation, projection, injection, and e2e tests per phase protocol §8.
- No new paid service, Docker, Redis, or S3 (protocol §10).

**WAITING for your "go" (and Q1–Q3 below) before Slice 1.**

### Jobs Slice 1 — DONE (schema/model/migration/indexes + tests)
- Schemas (`schemas/hiring.py`): `JobLifecycle` DRAFT/OPEN/ON_HOLD/CLOSED/ARCHIVED;
  `JobCreate` carries all 14 PRD §1 fields (company/jobRole/department mandatory,
  decimal experience, StrictInt positionsTotal>=1, keyword normalize+dedupe+cap 20,
  closesAt>openedAt, JD html mandatory with 50..20000 plain-text bounds);
  `JobUpdate` excludes jobId/jobKey/companyName/jobRole (extra=forbid 422s them);
  `JobPublic` adds positionsRemaining (derived), jdText, assignee snapshot,
  closedAt/archivedAt. Old `JobStatus` retained read-only for migration mapping.
- Model: `list/count_by_org` filter on lifecycleStatus with legacy-value shim.
- Indexes: by_org_lifecycle/assignee/company/department, by_closesAt; retired
  by_orgId_status (LEGACY_INDEXES + startup drop).
- Migration `003_jobs_lifecycle` (idempotent, honest backfill, dry-run safe).
- Tests: `job_payload()` factory in conftest; 6 files migrated to full payloads;
  10 new requisition-validation tests; 2 migration tests; injection twin aligned
  to the new experience band (purpose unchanged). Full suite: 483 passed.
- Assumptions logged: MAX_KEYWORDS=20, JD 50..20000 chars, WorkMode
  ONSITE/REMOTE/HYBRID optional, company/department non-blank (no master-data
  service yet) — all trivially adjustable if the PRD file says otherwise.
- Next: Slice 2 endpoints (detail+applications, close/reopen/archive/delete,
  assignee+notifications, duplicate-warning, openedAt/assignee-email server
  defaults, auto-close sweep) + matrix rows.

### Jobs Slice 2 — DONE (endpoints: detail/lifecycle/assignee/duplicate/auto-close)
- Hiring API: GET detail (+applications+counts); POST close/reopen (future-date
  guard)/archive; DELETE refused with applications (409, archive instead);
  POST check-duplicate (advisory only, exact-match on identity fields, archived
  excluded); POST /api/admin/jobs/auto-close (OPEN + closesAt<=now UTC).
- Create/update enrichment: openedAt/positionsFilled/jdText server defaults;
  assignee must be an existing ACTIVE org user (422 otherwise) with email
  snapshot (auto-refreshed on later updates); ARCHIVED immutable, CLOSED
  limited subset; job.assign audit entries preserve history; assignee
  notification via the EXISTING outbox channel (kind=job_assigned, deduped per
  job+assignee, best-effort so writes never fail without a key).
- Matrix: 8 new rows (same role split as job reads). No migration changes.
- Tests: 13 new endpoint tests (incl. outbox dedupe + keyless graceful skip);
  4 email-flow tests rescoped to invite kind (job notifications legitimately
  present). Full suite: 537 passed. Frontend untouched (lint clean).
- Assumptions: closesAt compared in UTC (no org-timezone setting exists in the
  system; applied at input/display); duplicate = same company+role+dept+location
  among non-archived (description-similarity scoring deferred to the file).

### RESOLVED in Slice 13: org timezone for auto-close
The PRD mandates the ORGANIZATION timezone for closing-date/time
interpretation. Slice 2 compared closesAt in UTC because no org-timezone
setting existed (verified: no timezone field in org settings, config, or
schemas); UTC was INTERIM. Slice 13 introduced `settings.timezone`
(validated IANA name, default "UTC" preserves the interim behavior for
unconfigured orgs), and the auto-close sweep now interprets the stored
wall-clock boundary in the org's timezone (real tz rules via `zoneinfo`,
DST-sensitive, per-org isolation, invalid/missing tz → UTC fallback).


### Jobs tracker
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
● Slice 3 — JD Upload & Template (in progress)
○ Slice 4 — Jobs List | ○ Slice 5 — Create/Edit UI | ○ Slice 6 — Job Details
○ Slice 7 — Lifecycle UI | ○ Slice 8 — Assignee Management
○ Slice 9 — Notifications | ○ Slice 10 — Search/Filter/Sort/Pagination
○ Slice 11 — Audit Trail | ○ Slice 12 — Edge Cases | ○ Slice 13 — RBAC
○ Slice 14 — Full Verification

### Jobs Slice 3 — DONE (JD upload → extract → map → review → save + template)
- Service `services/jd_template.py` (stateless): prescribed v1 template format
  (14 `Label: value` lines, JD runs to EOF); `build_template_docx()`,
  `parse_template_text()` (seen-label tracking, wrapped-line continuations),
  `map_template_values()` resolving assignee by userId-or-email + active check,
  with JobCreate construction as the SINGLE validation truth (placeholder
  jobKey stripped; assigneeEmail snapshot excluded from the create shape).
- Endpoints (`jobs.manage`): GET jd-template (labeled .docx download, placed
  before /jobs/{id} for route matching); POST parse-jd reusing
  validate_client_filename/validate_upload (magic bytes, caps, traversal),
  clamav hook (quarantined → 422), parse_bytes_isolated (timeout-isolated).
- Exact PRD strings: invalid-template and missing-fields messages; per-field
  errors with model-level attribution; create-ready `mapped` incl.
  jdTemplateVersion (review → POST /api/jobs proven by test).
- Matrix: 2 rows. Tests: 12 (incl. template round-trip, all PRD validations,
  spoofed/extension rejects, interviewer 403s). Full suite: 561 passed; tsc clean.
- Assumptions: template layout + date/number parsing leniency + v1 version are
  documented in-module (adjustable if the PRD file surfaces); PDF/DOC parse via
  the shared isolated worker (covered by resume parse tests).

### Jobs tracker
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
✓ Slice 3 — JD Upload & Template
○ Slice 4 — Jobs List | ○ Slice 5 — Create/Edit UI | ○ Slice 6 — Job Details
○ Slice 7 — Lifecycle UI | ○ Slice 8 — Assignee Management
○ Slice 9 — Notifications | ○ Slice 10 — Search/Filter/Sort/Pagination
○ Slice 11 — Audit Trail | ○ Slice 12 — Edge Cases | ○ Slice 13 — RBAC
○ Slice 14 — Full Verification

### Jobs Slice 4 — DONE (list/search/filter/sort/paginate + row actions)
- Backend: GET /api/jobs upgraded (q/company/department/assignee/experience/
  workMode/date-bands, allowlisted sort+order, default limit 20, X-Total-Count
  header; response stays a bare list); GET application-counts; POST assign
  (email → userId, reuses Slice 2 audit/notify). Matrix +2 rows.
- Frontend JobsPage rewritten: all 13 PRD columns; debounced cross-field
  search; combined filters with clear-all; sortable Title/Company/Opened/
  Closes (+createdAt default); 20/page with total; exact empty states;
  expandable View (detail endpoint + applications); Edit modal (5 spec fields,
  status-aware); Close/Reopen/Archive/Delete/Assign with two-step confirms and
  the exact PRD close warning; role-gated actions (backend authoritative).
- Decisions: Job ID column shows jobKey (human unique; uuid in tooltip);
  assignee shows the email snapshot (no user-directory read needed);
  experience filter = band-covers-years (bandless docs excluded when set);
  JD preview renders jdText (no sanitizer dep; rich render in Slice 5/6).
- Tests: 8 backend (search variants, combined, sort/page/header, counts,
  assign incl. 403s) + 5 vitest (13 columns, exact empty states, query +
  pagination, role gating). Full: backend 578 passed, vitest 15 passed,
  tsc clean, vite build ok.

### Jobs tracker
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
✓ Slice 3 — JD Upload & Template | ✓ Slice 4 — Jobs List
(search/filter/sort/pagination complete with it)
○ Slice 5 — Create/Edit UI | ○ Slice 6 — Job Details
○ Slice 7 — Lifecycle UI | ○ Slice 8 — Assignee Management
○ Slice 9 — Notifications | ○ Slice 11 — Audit Trail | ○ Slice 12 — Edge Cases
○ Slice 13 — RBAC | ○ Slice 14 — Full Verification

### Jobs Slice 5 — DONE (Create Job UI)
- Backend (dependency-justified only): GET /api/users/directory (active users,
  jobs.manage-gated, declared before /{user_id}) + matrix row + test. No other
  backend changes.
- Deps: @tiptap/react + @tiptap/pm + @tiptap/starter-kit (Link comes bundled in
  StarterKit v3; dropped the duplicate extension). No new high/critical audit
  findings (highs present trace to pre-existing @google/genai/autoprefixer/
  express chains, untouched by this install).
- `JdEditor.tsx`: H1/H2/bold/italic/bullets/ordered/quote/link/clear, live
  50–20000 char count, upload fills while unfocused, editor styles in index.css.
- `CreateJobForm.tsx`: all 14 PRD fields (Job ID read-only auto notice +
  editable unique jobKey retained per Q1); directory dropdown with readonly
  auto email; JD upload → parse → review-fill (nothing persisted on upload);
  template download; duplicate pre-check with the exact advisory modal;
  unsaved guard (beforeunload + Stay/Discard); double-submit lock; data
  preserved on API failure; exact "Job created successfully." success state.
- Jobs tab: Create Job entry point (manage roles), form replaces list, Back
  reloads. Slice 4 Edit modal untouched.
- Tests: 11 vitest (fields, all validations, keywords, assignee email,
  upload→review, exact template message, duplicate flow, double-submit,
  success, error preservation, unsaved flow). Full: backend 585 passed,
  vitest 26 passed, tsc clean, vite build ok.

### Jobs tracker
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
✓ Slice 3 — JD Upload & Template | ✓ Slice 4 — Jobs List + Search/Filter/Sort/Pagination
✓ Slice 5 — Create Job UI
○ Slice 6 — Job Details | ○ Slice 7 — Lifecycle UI | ○ Slice 8 — Assignee Management UI
○ Slice 9 — Notifications | ○ Slice 10 — Audit Trail | ○ Slice 11 — Edge Cases
○ Slice 12 — RBAC Verification | ○ Slice 13 — Organization Timezone | ○ Slice 14 — Full Verification

### Jobs Slice 6 — DONE (Job Details page)
- Backend (additive only): GET /jobs/{id}/activity (job-scoped trail,
  resumes.upload-gated so HR/interviewers can read it; global audit-log keeps
  audit.view); audit-log list gains resource_id filter; job.update audit now
  stores per-field {from,to} (was new-values-only). Matrix +1 row.
- Frontend: JobDetailsPage (header, overview groups, keywords, sanitized JD via
  DOMPurify tight allowlist, applications with counts, ehr-timeline activity
  with friendly who/what/old→new sentences, full action set reusing Slice 2
  endpoints + shared modals); Jobs tab gains details mode; applicant rows
  dispatch elite:open-applicant consumed by App (existing applicant tab, no new
  route); 404 vs error states distinct (no blanket offline banner).
- Tests: 3 backend (trail content/scoping/404+403) + 9 vitest (fields, status,
  apps+counts, safe JD incl. script-strip, 404+retry, empties, audit content,
  applicant event, close flow, role gating). Full: backend 594 passed,
  vitest 35 passed, tsc clean, vite build ok.

### Jobs tracker (43% — 6/14 complete)
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
✓ Slice 3 — JD Upload & Template | ✓ Slice 4 — Jobs List + Search/Filter/Sort/Pagination
✓ Slice 5 — Create Job UI | ✓ Slice 6 — Job Details
○ Slice 7 — Lifecycle UI | ○ Slice 8 — Assignee Management UI
○ Slice 9 — Notifications | ○ Slice 10 — Audit Trail refinement
○ Slice 11 — Edge Cases | ○ Slice 12 — RBAC Verification
○ Slice 13 — Organization Timezone | ○ Slice 14 — Full Verification

### Jobs Slice 7 — DONE (Lifecycle UI; rules untouched)
- New `JobLifecycle.tsx`: LIFECYCLE_ORDER, normalizeLifecycle (unknown→DRAFT),
  LifecycleBadge (single presentation), jobActionsFor(status×permission[×apps])
  as the single visibility source, visitedFromActivity (audit-derived only),
  LifecycleStepper (current/visited/pending, responsive vertical on mobile).
- List + Details unified on the shared badge/matrix (identical rendering).
  Details gained a "Lifecycle progress" section; audit trail untouched.
- Consistency hardening found in-slice: the assign endpoint lacked the
  ARCHIVED guard that PUT enforces → added 409 + matrix-neutral test. No other
  backend rule changed.
- ON_HOLD stays display-only: no API transition reaches it (PUT cannot touch
  lifecycle; no hold endpoint was ever specified/built). Logged as a product
  gap, not silently worked around.
- Tests: 6 lifecycle unit + 3 list-sync/guard + 2 details-extras + 1 backend
  guard. Full: backend 594 passed, vitest 46 passed, tsc clean, vite build ok.

### Jobs tracker (50% — 7/14 complete)
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
✓ Slice 3 — JD Upload & Template | ✓ Slice 4 — Jobs List + Search/Filter/Sort/Pagination
✓ Slice 5 — Create Job UI | ✓ Slice 6 — Job Details | ✓ Slice 7 — Lifecycle UI
○ Slice 8 — Assignee Management UI | ○ Slice 9 — Notifications
○ Slice 10 — Audit Trail refinement | ○ Slice 11 — Edge Cases
○ Slice 12 — RBAC Verification | ○ Slice 13 — Organization Timezone
○ Slice 14 — Full Verification

### Jobs Slice 8 — DONE (Assignee Management UI; single-owner model kept)
- Shared `assignees.ts`: resolveOwner (snapshot preserved + inactive flag),
  ownerDisplayName, nameForUserId (directory → former-user/system fallback),
  openCountsByAssignee (open-only load).
- AssignModal upgraded (shared by List + Details): current-owner card with
  inactive warning, active-user dropdown (name·email·role·open-job count),
  email fallback when directory is unavailable, stale-failure resync via
  onRefresh, double-submit lock. Same assign endpoint underneath.
- Owners mode in Jobs tab: active owners table (user/email/role/open/total)
  + preserved-inactive section with per-job Reassign/Open; empty states.
- List assignee cell + Details header/overview show resolved names and an
  inactive dot/badge; audit from→to ids resolve to names (unknown → former).
- No backend changes this slice (no new rules, no new endpoints).
- Tests: 12 vitest (helpers, directory, modal flows incl. stale resync +
  double-submit, details inactive flag). Full: backend 595 passed (unchanged),
  vitest 58 passed, tsc clean, vite build ok.

### Jobs Slice 9 — DONE (Notifications; existing outbox → worker → ZeptoMail only)
- Gap found + fixed: `queue_job_assignment` wrote `email_outbox` rows but never
  chained the EXISTING `email_send` background job, so the worker never
  delivered `job_assigned` (assessment invites chain both; assignments did not).
  Fix reuses the identical pattern: outbox enqueue (dedupe per job+assignee,
  kind=job_assigned) + `email_send` enqueue (dedupe per messageId). No new
  channel, no new retry machine, no ZeptoMail replacement. Worker
  `process_email_job` is generic by messageId (no applicationId → pure
  delivery, no stage transition). Notification failures never block the job
  write (best-effort, logged; missing key skips gracefully).
- Read-only visibility: GET /api/jobs/{id}/notifications (resumes.upload-gated,
  same split as activity; org-scoped; kind=job_assigned + entityKey=jobId;
  metadata only — payloadEncrypted excluded, recipient masked like
  diagnostics). States shown are exactly the outbox states
  (pending/sending/sent/failed + attempts/lastError/sentAt/sentVia). Retries
  stay admin-only via POST /api/diagnostics/outbox/{id}/retry. Audit
  (job.assign old→new) remains authoritative.
- Frontend: JobDetailsPage gains a Notifications section (loading skeleton,
  empty, error+retry; Elite HR card language; Queued/Sending/Sent/Failed/
  Dry-run badges; failed rows show the real lastError, never fake delivery).
  Reloads alongside activity after assign. hiringApi adds fetchJobNotifications
  + JobNotification type. No admin retry controls in Jobs UI.
- Tests: 6 backend (initial queues outbox+worker, reassign notifies new +
  audit intact, dedupe, keyless non-blocking, worker Zepto delivery mocked,
  RBAC+org isolation) + 3 vitest (queued/sent, failed truthfulness, error
  state) + matrix +1 row. Full: backend 607 passed, coverage 84%,
  vitest 61 passed, tsc clean, vite build ok.

### Jobs Slice 10 — DONE (Audit Trail Refinement; existing system only)
- Reused the existing append-only `audit_log` (Slice 2) + job activity
  endpoint (Slice 6). No new system, actions, endpoints, or model changes.
  Coverage verified end-to-end: create (jobKey/title/assignee new values),
  update (per-field old→new), assign/reassign (from→to on both PUT and
  POST paths), close (from/to+reason), reopen (from/to+closesAt — new date
  added to the audited values), archive, delete, auto-close
  (actor `system:auto-close`, reason "closing date reached").
- Idempotency noise removed: PUT with no actual change logs no `job.update`;
  POST /assign to the SAME owner logs no `job.assign` and sends no
  notification (mirrors the PUT path, which already skipped). History stays
  append-only: Rahul→Priya→Srinivas keeps every hop, never collapsed.
- Actor readability: new `actorForUserId()` (name + email where the
  directory knows the user; `Automatic closure` for system actions, never a
  human; `Former user <id8>` snapshot preserved, never fabricated or
  rewritten). Activity titles and old→new assignee rows show name · email.
  Historical ids survive user deactivation (proven by test).
- Isolation/RBAC unchanged: activity scoped per jobId + orgId (Job A never
  shows Job B; cross-org → 404); interviewers stay 403 on activity (same as
  before); global audit-log keeps `audit.view`. Lifecycle stepper untouched
  and still separate from the audit trail. Slice 9 notification states stay
  visible in Details but are NOT part of audit semantics.
- Tests: 7 backend (`test_job_audit.py`: full mutation coverage, old/new,
  actor, timestamps, idempotency, chain append-only, job+org isolation,
  RBAC, deactivation) + 3 vitest (actor name+email, former-user fallback,
  system attribution). Full: backend 614 passed, coverage 84%,
  vitest 64 passed, tsc clean, vite build ok.

### Jobs Slice 11 — DONE (Edge Cases verified + regression tests; no new rules)
- Verified every PRD edge-case category against Slices 1–10 implementation.
- Fixes made (gaps found, no new business rules):
  - Server-side experience range check now holds on partial PUT (only one of
    min/max patched above stored max rejected, 422) — `hiring.py:update_job`.
  - `closesAt <= openedAt` on partial PUT rejected (422) — same endpoint.
  - New applications are refused against CLOSED/ARCHIVED jobs —
    `POST /api/applications` (409) and the resume pipeline
    (`pipeline.py` file marked FAILED with an explicit reason).
  - `hiringApi.ts`: network failures (fetch TypeError) map to a clear
    "Network unavailable..." message; HTTP statuses keep server `detail`
    (401/403/404/422/500 no longer surface as "network" errors).
- Verified as-is (tests added, behavior unchanged): duplicate-job advisory
  never blocks, job ID immutable, reopen requires future date, delete blocked
  with applications (409), application counts consistent across list/detail/
  delete guard, CLOSED/ARCHIVED read-only edits, assignee snapshot preserved
  on deactivation (no silent reassignment), inactive assignee cannot be
  newly assigned, duplicate jobKey → 409 (submit-lock server twin),
  unsaved-changes guard on Create Job, duplicate JD/keyword/date/positions
  validation, closed-job reopen guard, UTC interim auto-close documented.
- Out of scope by spec: no optimistic-locking versioning (last-writer-wins
  stays, server authoritative), no org-timezone system (Slice 13), no new
  lifecycle states or permission models.
- Caveat noted: Edit/Assign/Reopen modals have no dirty-guard for unsaved
  changes (Create Job does); assignee email snapshot refreshes lazily on
  next job edit; list application-counts failure degrades to 0s.
- Tests: 25 new backend (`test_job_edge_cases.py`), 7 new vitest
  (`src\lib\hiringApi.test.ts`). Full: backend 639 passed, coverage 84%,
  vitest 71 passed, tsc clean, eslint build ok.

### Jobs Slice 12 — DONE (RBAC verified for the Jobs module; verification-first)
- Exercised the existing role matrix against every Jobs endpoint:
  super_admin/admin/hr allowed, technical_interviewer/managerial_interviewer
  403 on all Jobs mutations and reads (deny-by-default for interviewers
  holds), any-authed rows verified open to every role, unauthenticated →
  401/403, invalid token → 401/403.
- Added matrix row: PUT /api/jobs/{id} (all three managing roles allowed,
  both interviewer roles 403).
- Added explicit tests: missing token rejected, invalid token rejected,
  transition endpoint 403 for interviewer on a REAL application (404 for
  nonexistent id precedes the permission check — documented ordering,
  no information leak), hr passes the transition guard, every ANY_AUTHED
  row open to all roles (regression guard).
- UI authorization behavior preserved: JobsPage gates create/assign/owners
  on MANAGING_ROLES (src/components/JobsPage.tsx:166), JobDetailsPage
  similar; frontend hiding is display-only, backend guards authoritative.
- Cross-organization isolation: verified for list/detail/edit/close/reopen/
  archive/delete/assign/activity/applications (existing tests + matrix).
- No new permissions, no role redesign; no bugs found in the Jobs RBAC
  boundary itself. Slice 11 gaps stay fixed (closed/archived job
  application guard verified under authz too).
- Tests: 648 backend passed (+9 vs Slice 11), coverage 84%, vitest 71
  passed, tsc clean, vite build OK.

### Jobs Slice 13 — DONE (Organization timezone for automatic close)
- No timezone setting existed anywhere (verified: org settings, config,
  schemas — the interim UTC note is what Slice 2 recorded). Resolution:
  - `settings.timezone` added to `default_settings()` (`models/organization.py`),
    validated IANA name in `OrgSettings` (`schemas/organization.py`), and
    accepted via `PUT /api/org/settings` (`assessments.py`, 422 on invalid).
  - Auto-close sweep (`hiring.py:auto_close_jobs`) now loads the org's
    `settings.timezone` and interprets the stored closesAt wall-clock
    boundary in that timezone via `zoneinfo.ZoneInfo` (real tz rules,
    DST-sensitive — no fixed offsets). Missing/invalid tz → `UTC`
    (documented fallback preserving the pre-Slice-13 interim behavior;
    a default of Asia/Kolkata was NOT invented).
  - Storage convention unchanged: timestamps stay UTC instants; only the
    closing decision uses the org tz. Multi-org isolation: each sweep reads
    the caller org's own settings only.
  - Audit unchanged: actor `system:auto-close`, reason "closing date reached".
- `tzdata>=2024.1` added to `backend/requirements.txt` (Windows zoneinfo
  needs it).
- Tests: `backend/tests/test_org_timezone.py` — 11 tests: Kolkata vs UTC
  boundary divergence, UTC fallback for missing/invalid tz, boundary exact
  and just-after, America/New_York DST boundary (Jan EST 17:00Z vs Jul EDT
  16:00Z), idempotency + CLOSED/ARCHIVED/future filters, multi-org isolation
  (same wall closesAt, different orgs, different outcomes), audit + 409 on
  application after auto-close, manual close/reopen unchanged, settings
  timezone validation 422.

### Jobs Slice 14 — DONE (Full Jobs verification; acceptance sweep)
- End-to-end journey test added (`backend/tests/test_jobs_e2e.py`, 4 tests):
  create → assignee snapshot → list/details → edit permitted field →
  application + consistent counts → delete blocked (409) → close →
  applications blocked → reopen (future date) + invalid-date rejection →
  reassign + audit → archive preserves applications. Negative paths:
  invalid experience range → 422; delete-with-applications → 409;
  interviewer → 403 on PUT/close/delete/activity.
- PRD traceability (all verified by tests above + Slices 1–13 suites):
  ✓ Create (14 fields, validation, ID generation, assignee snapshot,
    duplicate advisory, JD entry/upload) — test_hiring_api, test_jd_template
  ✓ JD upload/parse/template incl. security + extraction failure —
    test_jd_template
  ✓ Job list (columns, pagination 20/page, search, filters, sort,
    empty/no-results) — test_hiring_api, jobsList.test.tsx
  ✓ Job details (all fields, JD render, counts consistent) —
    jobDetails.test.tsx, test_hiring_api
  ✓ Lifecycle DRAFT/OPEN/ON_HOLD/CLOSED/ARCHIVED — test_hiring_api,
    lifecycle.test.tsx
  ✓ Close (exact confirmation in UI, 409 guards, audit) — test_hiring_api,
    test_job_audit
  ✓ Automatic close with org tz, DST, multi-org, idempotency, audit —
    test_org_timezone
  ✓ Reopen (future-date validation, authz) — test_hiring_api
  ✓ Archive/delete (delete blocked with applications, history preserved) —
    test_hiring_api, test_job_edge_cases
  ✓ Assignee (active selectable, inactive rejected, snapshot, reassignment,
    deactivated owner preserved, audit, outbox flow) — assignees.test.tsx,
    test_job_notifications
  ✓ Notifications (assignment → outbox → worker → ZeptoMail, dedupe,
    idempotency, failure truthfulness) — test_job_notifications
  ✓ Audit (create/update/assign/reassign/close/reopen/archive/delete/
    auto-close; system actor; cross-job/org isolation) — test_job_audit
  ✓ Applications (counts, closed/archived block, org isolation) —
    test_hiring_api, test_job_edge_cases
  ✓ RBAC (5 roles × all Jobs endpoints, any-authed, token edge cases) —
    test_authz_matrix
  ✓ Edge cases — test_job_edge_cases, createJob.test.tsx
  ✓ Error classification (network/401/403/404/409/422/500) — hiringApi.ts +
    hiringApi.test.ts
  ✓ Data integrity (idempotent ops, stable IDs, preserved history) —
    Slice 11/12 tests
  ✓ Concurrent editing — documented last-writer-wins, server authoritative —
    test_job_edge_cases
  ✓ UI consistency (Elite HR visual system in Jobs pages) — reviewed
  ⚠ Performance: practical verification only; pagination/capping verified by
    tests; no measurable UI blocking found. No optimization performed.
- Regression: all Slices 1–13 suites green.
- Final status:
  **Jobs / Job Requisition Management Module — 100% verified against the
  approved specification.**

### Jobs tracker (100% — 14/14 complete)
✓ Slice 1 — Backend Foundation | ✓ Slice 2 — Backend Endpoints
✓ Slice 3 — JD Upload & Template | ✓ Slice 4 — Jobs List + Search/Filter/Sort/Pagination
✓ Slice 5 — Create Job UI | ✓ Slice 6 — Job Details | ✓ Slice 7 — Lifecycle UI
✓ Slice 8 — Assignee Management UI | ✓ Slice 9 — Notifications
✓ Slice 10 — Audit Trail refinement | ✓ Slice 11 — Edge Cases
✓ Slice 12 — Jobs RBAC Verification | ✓ Slice 13 — Organization Timezone
✓ Slice 14 — Full Jobs Verification — COMPLETE

### Jobs Enhancement — AI JD Document Ingestion — Phase 0: Architecture / Decision (PROPOSED, awaiting go)
- Status: Jobs module remains 100% complete (14/14) against the approved PRD.
  This is a SEPARATE enhancement tracker; the archived completion % is untouched.
- Problem: Slice 3 `POST /api/jobs/parse-jd` (`backend/app/api/hiring.py:301`,
  `services/jd_template.py`) is prescribed-template-only by design; a normal JD
  PDF correctly 422s (`INVALID_TEMPLATE_MESSAGE` / `MISSING_FIELDS_MESSAGE`).
  Product goal: HR uploads a normal PDF/DOCX → secure validate → text-first
  extract → OpenRouter structures fields → HR reviews → existing
  `POST /api/jobs` persists. LLM never persists, assigns, or changes lifecycle.
- Reuse inventory (no new security plumbing, no new env, no new collections):
  `validate_client_filename`/`validate_upload` + `clamav.scan_bytes` +
  `parse_bytes_isolated` (30 s isolated worker); `services/llm/base.py`
  (`scrub_text`, `detect_injection`, `input_hash`, strict-schema pattern) +
  `services/llm/openrouter.py` (semaphore, retry ≤2, `llm_runs` hash-only,
  never-raises, unconfigured → graceful fallback); `JobCreate` as single
  validation truth + `JDParseOut` review contract; `parseJd()`/`CreateJobForm`
  review flow; `OPENROUTER_*`/`LLM_CONCURRENCY` config; `llm_runs` collection.
- Design (proposed): extend `POST /api/jobs/parse-jd` with a `mode` form field
  (`template` default = byte-identical current behavior; `document` = new
  AI path). New `services/jd_extract.py` (text-first, PII-strip, delimited
  `<<<JD-START/END>>>`, `jd-extract-v1` prompt, new `JdExtractPayload`
  `extra="forbid"` schema, missing → null + `missingFields`, evidence where
  cheap) + assignee raw-string resolved server-side via `UserRepository`
  (same as template; never auto-creates). Frontend gets two paths
  (Template / Document) with AI-extracted badge; save always via existing
  create endpoint + duplicate advisory.
- Standards conflicts: none — follows §4/§6 (delimited blocks,
  ignore-instructions prompt, strict JSON, retry ≤2 → manual fallback,
  advisory-only with human `userId`, `llm_runs` hash-not-content, PII-strip,
  injection fixtures), §1 (`jobs.manage` guard unchanged), §5 (no bypass),
  §7 (no doc content in logs). Stateless parse: no outbox/audit-job event.
- Risks: hallucination (mitigate: strict schema + JobCreate revalidation +
  missing-stays-missing + evidence); unconfigured LLM (fallback to manual,
  template path independent); free-tier 429/latency (reuse backoff+jitter);
  `parseJd()` double-`res.json()` bug drops `fieldErrors` (fix read-once in
  this enhancement); response-contract drift (keep `JDParseOut` shape,
  additive fields only).
- Plan (stops after each, tests + docs each step):
  1. Secure Document Extraction (reuse worker, empty/malformed errors)
  2. LLM Structured Extraction (`jd-extract-v1`, fixtures, no persist)
  3. Schema Validation (JobCreate truth, field errors/warnings)
  4. Review UI (two paths, AI badge, missing/needs-review)
  5. Template + AI Integration (mode default, regression suites green)
  6. Error/Fallback + Injection Tests 7. Full Verification (80%+ cov, CI).
- Tracker:
  ● AI JD Ingestion — Phase 0: Architecture / Decision (this entry)
  ● AI JD Ingestion — Phase 1: Secure Document Extraction — DONE (see entry below)
  ● AI JD Ingestion — Phase 2: LLM Structured Extraction — DONE (see entry below)
  ● AI JD Ingestion — Phase 3: Schema Validation — DONE (see entry below)
  ● AI JD Ingestion — Phase 4: Review UI — DONE (see entry below)
  ● AI JD Ingestion — Phase 5: Template + AI Integration — DONE (see entry below)
  ● AI JD Ingestion — Phase 6: Error/Fallback + Injection Verification — DONE (see entry below)
  ○ Full Verification
- WAITING FOR "go" — no code changed in Phase 0.

### AI JD Ingestion — Phase 1 DONE (Secure Document Extraction, no LLM)
- New `services/jd_document.py` (`doc-v1`): `normalize_jd_text()` (CRLF→LF,
  per-line rstrip, edge blanks dropped, 3+ blanks→2, 20k cap) + `is_extractable()`.
- `POST /api/jobs/parse-jd` gains `mode` form field (`template` default,
  `document` new; anything else → 422 naming `mode`). Template branch is
  byte-identical (default callers send file-only → unchanged). Document branch
  `_parse_jd_document()` reuses the exact Slice 3 chain (filename safety,
  `validate_upload` magic-bytes/size/zip-bomb, ClamAV 422, isolated 30 s
  parser) then returns `JDParseOut(templateVersion="doc-v1", mapped={},
  warnings=[AI-pending])`. No LLM import, no DB write, no schema/migration
  change (`JDParseOut` shape reused; no new collections/indexes/env vars).
- Failure contract: 400 traversal/extension-mismatch/empty/oversize;
  422 invalid-mode / quarantined / timeout-or-parse-failure /
  no-readable-text (dict shape with `file` field error); 403 interviewer;
  missing file → FastAPI 422. Unreadable input never reaches any LLM.
- Tests: `backend/tests/test_jd_document.py` — 18 (PDF+DOCX prose extraction,
  template-file-as-document, 3 template-pinned regressions incl. prose-still-422s
  without mode, missing-file/invalid-mode/403, wrong-ext/spoof/traversal/empty/
  corrupt-PDF/oversize/quarantine/timeout, normalizer units). Full backend
  681 passed (663 prior + 18 new); coverage 84.76% (gate 80; `jd_document.py`
  100%). Frontend untouched: `tsc` clean, vitest 71 passed, `vite build` ok.
- Next: Phase 2 LLM Structured Extraction (`jd-extract-v1`, strict schema,
  missing-stays-missing) — NOT started; awaiting "go".

### AI JD Ingestion — Phase 2 DONE (LLM Structured Extraction, jd-extract-v1)
- New `services/llm/jd_extract.py` (scorer `match-score-v1` untouched):
  `JdExtractPayload` (`extra="forbid"`, all facts nullable, `assigneeText`
  raw-only, `missingFields`/`warnings`/`evidence`, `injection_suspected`),
  `JD_EXTRACT_SYSTEM_PROMPT` (untrusted-data rules, null-if-missing, JSON
  only), `build_jd_extract_block()` (PII-scrub + 12k truncate +
  `<<<JD-START/END>>>`), `extract_jd_fields()` mirroring the scorer
  (config gate, injection short-circuit WITH hash-only run log, semaphore,
  initial + 2 retries, 429/5xx/auth/bad-schema handling, never-raises incl.
  a hardened catch-all the scorer lacks). Output capped review-size
  (30 keywords, 500-char evidence). No DB writes except `llm_runs`
  (promptVersion `jd-extract-v1`, hash never content); no user resolution;
  no Job write.
- Wiring: `_parse_jd_document()` now calls `extract_jd_fields()` after the
  Phase 1 text check. Success → `JDParseOut` gains additive-only
  `aiExtract`/`missingFields`/`evidence` (`mapped` stays `{}` until Phase 3;
  `templateVersion` still `doc-v1`). Any LLM skip/failure → Phase 1 text-only
  200 with reasons + AI-pending warning (manual entry always possible).
  Injection also appends a verify-every-field warning. Template path
  byte-identical and LLM-free (proven by test).
- PII tradeoff noted: assignee emails in-JD are scrubbed to `[EMAIL]` before
  send (privacy wins); Phase 3 resolves assignees server-side from the
  unscrubbed stored text if needed — names (non-email) survive scrubbing.
- Tests: `backend/tests/test_jd_extract.py` — 21 (PM extraction incl. hash-only
  audit + scrub/truncation asserts, sparse-missing, truncation, caps,
  unconfigured/empty/injection skips, 429→success, 500×3, bad-schema→success
  and ×3 exhaust, bad-envelope ×3, 401, timeout→success, unexpected-error,
  model-reported injection, 5 endpoint tests incl. template-bypass pin).
  Full backend 702 passed (681 + 21); coverage 85.15% (gate 80;
  `jd_extract.py` ~99%, only the defensive `_log` except uncovered).
  Frontend untouched: `tsc` clean, vitest 71 passed, build ok.
- Next: Phase 3 Schema Validation (`aiExtract` → JobCreate truth) — NOT
  started; awaiting "go".

### AI JD Ingestion — Phase 3 DONE (Schema Validation, JobCreate truth)
- New `services/jd_validate.py`: `validate_jd_extraction()` (read-only —
  user lookups + validation, zero writes) returning `JdReviewReady`
  (values/missingFields/needsReview/fieldErrors/warnings/resolvedAssignee/
  evidence). `JobCreate` constructed with an `AI-CHECK` placeholder as the
  SINGLE validation truth (stripped from output; `jobKey` never reported
  missing — HR supplies it at save, as in the template flow). `missing`-type
  pydantic errors → missingFields; other errors → fieldErrors with
  message-based attribution for model-level rules (range/order/length).
  Normalization (number/date/mode leniency, `<p>` JD wrap) mirrors template
  conventions; the shared `normalize_keywords` is reused, never duplicated.
- Assignee: userId → email → name resolution via `UserRepository`,
  org-scoped + active-checked; unique-active resolves with the email snapshot
  taken from the USER RECORD. No match / multi-match / inactive → needsReview
  (named-but-unresolved is review, not missing). No user is ever created.
  PII tradeoff closed: emails from the ORIGINAL unscrubbed server text are
  candidates only when the doc names an assignee and exactly one resolves;
  bare contact emails with no named assignee stay unresolved (tested).
- Wiring: document mode attaches `review` (additive `JDParseOut.review`);
  LLM-unavailable → `review: null` text-only fallback. Injection flag flows
  into a document-level needsReview entry. Range bounds removed from the
  Phase 2 shape (`ge=` dropped) so out-of-range LLM values reach JobCreate
  as field errors instead of malformed-LLM fallbacks.
- Frontend (minimal, no UI): `parseJd()` fixed to read the body ONCE
  (message + fieldErrors from one parse; FastAPI array details now mapped
  loc→field) + additive `ParsedJd.aiExtract/missingFields/evidence/review`
  types. All other error handling untouched.
- Tests: `backend/tests/test_jd_validation.py` — 31 (valid PM, missing
  required/optional, decimals, range, negative, 3+-without-max, positions,
  keyword dedupe+cap, JD bounds, ISO/ambiguous/impossible/order dates,
  7 assignee cases incl. record-email snapshot + scrubbed-email recovery +
  contacts-not-assignees + org isolation + no-auto-create, injection,
  malformed-dict, 5 endpoint incl. PM end-to-end + no-persistence +
  401/403) + 4 `hiringApi.test.ts` parseJd regressions. Full backend
  733 passed (702 + 31); coverage 85.27% (gate 80; `jd_validate` 88%,
  `jd_extract` 99%). Frontend: `tsc` clean, vitest 75 passed, build ok.
  Template suites green; no migration/collections/env changes.
- Next: Phase 4 Review UI — NOT started; awaiting "go".

### AI JD Ingestion — Phase 4 DONE (Review UI, human-in-the-loop)
- `parseJd(file, mode='template'|'document')` (`hiringApi.ts`): mode sent as a
  FormData field; default `template` keeps every existing caller byte-identical.
  Additive `ParsedJd.aiExtract/missingFields/evidence/review` types (Phase 3).
- `CreateJobForm.tsx`: JD Template / JD Document (AI-assisted) radio paths
  (template default). Template path logic + messages unchanged and shows zero
  AI chrome. Document path prefills from `review.values` (never `mapped`,
  never raw LLM output; `jobKey` never prefilled), stores the review payload
  client-side only, and renders: extraction summary counts (from the actual
  payload), missing list (Needs input), needs-review list with reasons + raw
  assignee text, per-field amber notes, AI-extracted badges in Elite HR
  warm-amber (`--warning-soft`), resolved-assignee identity note, collapsible
  source evidence (review.evidence preferred, parsed.evidence fallback; no
  prompts/traces), honest AI-failure state with manual-continue, static
  processing stage labels (no fake percentages), replace-upload replacing the
  review state. Save still flows only through validate → duplicate advisory →
  existing `POST /api/jobs`; unsaved-change guard and double-submit lock
  untouched (AI prefill flows through the same draft state).
- Tests: `src/components/__tests__/aiReview.test.tsx` — 15 (paths + mode
  args, prefill/badges/summary, missing, needs-review + raw assignee,
  resolved identity, evidence, field notes, template-clean, failure +
  manual-continue, replace, review→edit→duplicate→save, stages, dirty,
  double-submit). `hiringApi.test.ts` +4 (Phase 3). Full vitest 90 passed
  (75 + 15); `tsc` clean; build ok. Backend untouched this phase: 733 passed,
  85.27% (gate 80); template suites green.
- Next: Phase 5 Template + AI Integration — NOT started; awaiting "go".

### AI JD Ingestion — Phase 5 DONE (Template + AI Integration)
- ROOT CAUSE of the reported "LLM not configured" runtime message: the
  implementation was correct end-to-end (CreateJobForm mode=document →
  parseJd → POST /api/jobs/parse-jd → _parse_jd_document → Phase 1 text →
  extract_jd_fields → honest skip → text-only JDParseOut → Review UI
  fallback), but the local runtime `backend/.env` defines NO
  `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (keys verified present/absent by
  name only; defaults are empty). `_is_configured()` therefore returns False
  by design. NOT a wiring bug. To enable AI: set the two existing vars
  (documented in `backend/.env.example`) and restart the API; no code,
  endpoint, collection, or migration change is involved.
- Changes: `JD_DOCUMENT_AI_PENDING_WARNING` rewritten to runtime-accurate
  text with no phase references ("AI field extraction is unavailable —
  text extraction only. You can continue filling the form manually; nothing
  was saved."); `main.py` lifespan now logs a names-only warning when the
  LLM pair is unset so the next boot explains itself. Fallback behavior
  unchanged (still honest text-only, still no persistence).
- Tests: `backend/tests/test_jd_integration.py` — 5 (configured PM doc →
  structured `review.values` + `jd-extract-v1` audit row; missing config →
  fallback with zero HTTP calls/rows; provider 500s → fallback; template
  with config → `v1` + zero LLM calls; message has no phase language).
  Full backend 738 passed (733 + 5); coverage 85.27% (gate 80). Frontend
  untouched: `tsc` clean, vitest 90 passed, build ok. Template suites green.
- Real-file note: `Elite_HR_Product_Manager_JD.pdf` is not in the repo, so
  verification used a PM-shaped fixture; manual check is: configure the two
  vars, restart `:8000`, re-upload the PDF, expect structured review.
- Next: Phase 6 Error/Fallback + Injection Verification — NOT started;
  awaiting "go".

### AI JD Ingestion — Phase 6 DONE (Error/Fallback + Injection Verification)
- Runtime config (operator): `OPENROUTER_API_KEY` present in local
  `backend/.env`; `OPENROUTER_MODEL` was empty → set to the Gemma 4 26B A4B
  free-tier slug (public identifier; paid variant is the same slug without
  the `:free` suffix). Model choice rationale: structured-output support is
  required by the `jd-extract-v1` contract; Mercury Decide is a decision
  endpoint, not a full-schema extractor. No code hardcodes the model; the
  `:8000` server was restarted to pick it up. Secrets never read/printed —
  presence and lengths only.
- Hardening: `llm/base.py` `INJECTION_PATTERNS` extended (additive) with
  JD-hidden attacks — tool/function calls, destructive DB verbs, credential
  revelation, priority/schema override — tuned against false positives on
  legitimate prose ("maintain records", "call APIs", "return to office" all
  verified clean). Scorer behavior unchanged (flags → human review only).
- Tests: `backend/tests/test_jd_security.py` — 8 (key-without-model and
  model-without-key fallbacks; 7 adversarial docs each skipped with zero HTTP
  calls + hash-only `injection_suspected` audit rows; legit-prose negatives;
  endpoint injection upload → honest manual state with zero jobs/users
  created; multi-PII scrub pre-LLM with server-side resolution intact;
  garbage numerics become review errors, never corrected values). Full
  backend 746 passed (738 + 8); coverage 85.36% (gate 80). Frontend
  untouched: `tsc` clean, vitest 90 passed, build ok. Template zero-LLM +
  persistence safety re-verified via Phase 5 suite (green).
- Real-file note: `Elite_HR_Product_Manager_JD.pdf` is still absent from the
  repo, so no live PDF run was possible here (also needs an authed session);
  operator step is: re-upload the PDF through Create Job → expect populated
  `review.values` instead of the text-only fallback.
- Next: Phase 7 Full Verification — NOT started; awaiting "go".

### LLM Resilience — Step 0: Architecture / Decision (PROPOSED, awaiting go)
### LLM Resilience — L1 DONE (Tier 1 dispatch; STOPPED per plan, L2 + Phase 7 pending)
- Built: `services/llm/resilience.py` (taxonomy 429/5xx-retryable vs 4xx/schema
  fail-fast with sanitized codes-only reasons; Retry-After + remaining-limit
  headers; defer-delay = max(Retry-After, exp-backoff)+jitter; atomic token
  bucket with interactive reserve; Mongo-shared breaker with single half-open
  probe; result cache keyed prompt+digest+job with TTL; dev-only fake provider
  refused in production; `llm_guard`/`llm_record`; `llm_health` card data).
  Atomicity note: bucket take tries aggregation-pipeline `findOneAndUpdate`
  first, CAS-loop fallback second (same one-conditional-update guarantee;
  the fallback exists for servers without pipeline updates).
- Pipeline (`pipeline.py` + `worker.py` + `models/jobs.py defer()`): parse →
  deterministic keyword score stored immediately → guarded single-attempt LLM
  (breaker + bucket + cache + blank/injection skips) → success decides
  normally; retryable failure defers-and-releases (bounded by 12 attempts /
  6 h age / 120 s wait, then deterministic decide + `llm_complete`
  follow-up); fail-fast decides deterministically. Borderline (±10, keyword
  52 held PARSED + needsReview; 36 pooled; 68 shortlisted — all proven).
  Late LLM annotates only: TALENT_POOL/PARSED + crossing score →
  needsReview, never a transition. `llmStatus` (pending/done/failed/skipped)
  on files + breakdowns; batches stay PROCESSING with pendingAI counts.
- Surface: sync JD fails fast to text-only on open breaker/empty bucket
  (zero LLM calls, visible flag); diagnostics `llm` card (breaker, bucket,
  queue depth, oldest wait, 429s/hour, last sanitized error) + deferred list
  + audited, capped `POST /diagnostics/llm/retry-failed`; batch-table and
  applicant-profile "AI scoring pending/unavailable" chips.
- Config: 13 new settings with safe defaults, both `.env.example` files,
  production ranges + fake-refusal in `validate_settings()`. No hardcoded
  models. New `llm_governance` collection (bucket/breaker/cache, unique _id,
  TTL on cache expiry) indexed in code. `deferred` is a status value — no
  migration. Naive/aware datetime hardening (`as_aware`) after finding the
  drivers return naive UTC (would have silently disabled all age budgets).
- Tests: `test_llm_l1.py` 18 (taxonomy, headers, backoff bounds, bucket
  burst/refill/floor + 10-way concurrency, breaker open/half-open/close,
  defer/claim/lease, restart survival, borderline 3-way, late-no-restage,
  cache, blank skip, echo canary across logs + 6 collections, diagnostics +
  audited retry + 403, sync fast-path ×2, prod config guards, 100-file 50%-
  429 batch with zero loss/dupe) + 3 JD fake/cache tests + 4 chip tests.
  Full backend 803 passed, coverage 83.54% (gate 80). Frontend: tsc clean,
  93/94 vitest (1 failure = parallel JobRules message drift in
  createJob.test, owned by the concurrent workstream — "positive integer"
  → "integer between 1 and 1000"), build ok. One full-suite run showed a
  single load flake in `test_late_llm_never_restages`; immediate full
  re-run green (803/803).
- Live 429 note (prior turn): with real creds the free Gemma tier rejected
  3× instantly; key/slug valid, egress valid, slug exists on OpenRouter.
  Retry manually or switch to the paid slug (drop `:free`) with credits.
- L2 note (not built): governance key fingerprint must be truncated HMAC
  with an app secret — never plain hash, never logged.
- Next: Phase 7 Full Verification, then L2 — both awaiting "go".
- Status: separate enhancement tracker ("LLM Resilience", Slices L1/L2). Jobs
  100% frozen; AI JD Ingestion Phases 0–6 done, Phase 7 still pending and
  unaffected. The 429 evidence (free-tier Gemma, 3× immediate rejections in
  live logs) motivates system-level dispatch instead of manual retries.
- Scope split (verified against code): L1 governs the BACKGROUND worker path
  (`background_jobs` + `worker.py run_once` + `pipeline.process_resume_file`
  → scorer): deferral, deterministic-first scoring, stage gating. The SYNC JD
  path (`POST /api/jobs/parse-jd`, inline retry+sleep) only gains the shared
  token-bucket + breaker checks (no deferral — HTTP cannot wait hours); its
  30 s timeout and text-only fallback stay.
- Collections/indexes (new): `llm_governance` (one doc per provider+model[+key
  hash]: token-bucket `{tokens, nextRefill}`, breaker `{state, openedAt,
  consecutiveFailures}`, 429 counters) with unique index on the governance
  key; all index definitions in `db/mongodb.py` + verified at startup. Reuse:
  `background_jobs` (`pending` + `runAfter` already claim-gated; `deferred`
  added as an observable status value, no schema migration), `llm_runs`
  (+tokens/cost fields, additive), `audit_log` (retry action),
  `organizations` (L2 settings + Fernet-encrypted key, same mechanism as
  outbox crypto; never returned, canary-tested).
- Standards conflicts: none — §1 (diagnostics + retry action permission-gated,
  existing `require_permission`), §2 (`extra="forbid"` on new schemas), §4
  (no secrets in logs/errors; key names only), §6 (advisory-only preserved;
  late-LLM-never-restages + needsReview rule), §8 (timeouts, requestId logs,
  graceful worker), §9 (audit for overrides/retries). New env vars go in both
  `.env.example` files + `validate_settings()` ranges (L1: attempts/age/rpm/
  burst/breaker/wait-seconds; L2: chain order, daily caps).
- Risks: worker timing changes (deferred scoring delays SHORTLIST visibility
  — mitigated by deterministic-first + flags); free-tier 429 storms filling
  the queue (breaker + token bucket bound the blast radius); per-org key
  handling (Fernet reuse, never-logged); fair-share complexity creep (L2
  keeps FIFO-per-org + interactive lane only); 100-resume flaky-provider
  test runtime (fake provider, sleeps patched).
- Plan: L1 (adapter error taxonomy + defer/release + bucket + breaker +
  deterministic-first + wait-seconds gate + skips + diagnostics card + env +
  fake-provider tests) → STOP + report; L2 (chain + per-org keys + fairness +
  cost/caps + RUNBOOK) → STOP + report.
- Tracker:
  ● LLM Resilience — L1 Tier 1 dispatch — DONE (see entry below)
  ○ L2 Tier 2 groundwork
- L1 built and verified; STOPPED per plan. Phase 7 and L2 both awaiting "go".
