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
