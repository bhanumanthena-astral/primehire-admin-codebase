# PrimeHire Admin — Read-only Diagnosis

> Method: static code read only. No servers started, no migrations run, no DB queried, no state changed — except creating this report. Secret **values** are never printed (names + locations only). `Unknown` means it could not be determined from code. Every finding cites `path:line-range`.

Date (UTC): 2026-10-03. Repo root: `C:\Users\onlyf\Desktop\Primehire-admin\primehire-admin-codebase`.

---

## 1. Stack and structure

### 1.1 Languages, frameworks, versions

**Frontend / edge (root `package.json:1-47`)**

| Layer | Technology | Version / evidence |
|---|---|---|
| Language | TypeScript | `~5.8.2` — `package.json:45` |
| UI | React + react-dom | `^19.0.1` — `package.json:28-29` |
| Build/dev | Vite + @vitejs/plugin-react | `^6.2.3` + `^5.0.4` — `package.json:35,15` |
| Styling | Tailwind CSS v4 via @tailwindcss/vite + tailwindcss + tw-animate-css | `^4.1.14`, `^4.1.14`, `^1.4.0` — `package.json:17,34,43`; entry `src/index.css:1-3` |
| Component kit | shadcn + @base-ui/react + class-variance-authority + clsx + tailwind-merge | `^4.12.0`, `^1.6.0`, `^0.7.1`, `^2.1.1`, `^3.6.0` — `package.json:14,19-20,31,33`; config `components.json:1-21` |
| Icons | lucide-react | `^0.546.0` — `package.json:26` |
| Charts | recharts | `^3.10.1` — `package.json:30` |
| Animation | motion | `^12.23.24` — `package.json:27` |
| Toasts | sonner | `^2.0.7` — `package.json:32` |
| Theming | next-themes | `^0.4.6` — `package.json:28` (see `src/components/ui/primitives.tsx:304-338` ModeToggle) |
| Fonts | @fontsource-variable/geist | `^5.2.9` — `package.json:14` |
| PDF/export | jspdf + html2canvas | `^4.2.1` + `^1.4.1` — `package.json:24-25`; used in `src/utils/exportReportPdf.ts:31-40,466-627` |
| AI SDK | @google/genai | `^2.4.0` — `package.json:16`; no call-site found in surveyed flows (see §3.6, §9) |
| Node server | Express + dotenv | `^4.21.2` + `^17.2.3` — `package.json:22-23`; `server.ts:1-10` |
| Dev runner/bundler | tsx + esbuild | `^4.21.0` + `^0.25.0` — `package.json:44,42` |
| Types | @types/express, @types/node | `^4.17.21`, `^22.14.0` — `package.json:38-39` |
| Linter | `tsc --noEmit` (no ESLint config found) | `package.json:11`, `tsconfig.json:1-26` |

**Backend (`backend/requirements.txt:1-9`)**

| Layer | Technology | Version / evidence |
|---|---|---|
| Language | Python | `3.11.9` observed in `backend/.venv/pyvenv.cfg` (local venv only); deploy pin Unknown — no Dockerfile/runtime file (see §1.4) |
| API | FastAPI | `>=0.115,<0.122` — `backend/requirements.txt:1` |
| Server | uvicorn[standard] | `>=0.30,<0.36` — `backend/requirements.txt:2` |
| DB driver | motor (async MongoDB) | `>=3.5,<4` — `backend/requirements.txt:3` |
| Validation/config | pydantic + pydantic-settings | `>=2.7,<3`, `>=2.3,<3` — `backend/requirements.txt:4-5` |
| HTTP client | httpx | `>=0.27,<0.29` — `backend/requirements.txt:6` |
| Tests | pytest + pytest-asyncio + mongomock-motor | `>=8,<9`, `>=0.23,<1`, `>=0.0.20,<1` — `backend/requirements.txt:7-9`; `backend/pytest.ini:1-3` (`asyncio_mode=auto`, `testpaths=tests`) |

**Package manager / runtime**

- JS: npm (evidence: `package-lock.json` at root; scripts in `package.json:6-11`). Node version: Unknown — no `engines`, no `.nvmrc`/`.node-version` (glob for those returned empty).
- Python: venv + pip (evidence: `backend/README.md:5-9` `python -m venv backend\.venv` + `pip install -r backend\requirements.txt`). Python version pin for deploy: Unknown.

### 1.2 Repo layout — single repo, three runtimes

Single Git repo containing (a) Vite+Express admin frontend at root, (b) FastAPI+MongoDB backend in `backend/`, (c) Cloudflare Pages Functions in `functions/`. Not a monorepo with workspaces — no `workspaces` field in `package.json:1-47`.

Folder tree to 2 levels (from directory reads):

```text
./  (root)
  .env  (.env.example, .env.local — see §8)
  .gitignore, package.json, package-lock.json, tsconfig.json, vite.config.ts
  index.html, server.ts, components.json, metadata.json
  README.md (empty, 0 lines), INTEGRATION_NOTES.md
  backend/          # FastAPI + MongoDB
    .env, .env.example, requirements.txt, pytest.ini, README.md
    app/  (config.py, main.py, api/, db/, models/, schemas/, services/)
    tests/  (9 test files + conftest.py)
    .venv/, .pytest_cache/, __pycache__/
  functions/        # Cloudflare Pages Functions
    api/  (health.ts, send-email.ts, backend/[[path]].ts)
  src/              # React app
    App.tsx, main.tsx, types.ts, mockData.ts
    components/  (Dashboard, CandidateManagement, AssessmentsAndAssignments,
                  MailTemplates, ReportDialog, CandidateWorkspaceSimulator,
                  ui/primitives, report/* ~30 files)
    lib/  (mongoApi.ts, primehireClient.ts, primehireIds.ts)
    utils/  (normalizeReport.ts, reportConfig.ts, reportMetrics.ts, exportReportPdf.ts)
  lib/  (utils.ts — cn() helper)
  components/  (ui/ — shadcn: accordion, badge, button, checkbox, dialog, input, select, sonner, table, tabs, textarea)
  dist/  (build output: assets/, index.html, server.cjs, server.cjs.map)
  scratch/  (probe scripts, openapi*.json, report-*.json — dev scratch, not app code)
```

Key alias: `@/* → ./*` — `vite.config.ts:9-12`, `tsconfig.json:18-24`, `components.json:15-21` (so `@/lib/utils` = `lib/utils.ts:1-6`).

### 1.3 How to run locally, build scripts

**Root frontend (`package.json:6-11`, `server.ts:199-201`):**

| Script | Command | Effect |
|---|---|---|
| `dev` | `tsx server.ts` | Express + Vite middleware on `http://localhost:3000` — `server.ts:185-201` |
| `build` | `vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs` | Static SPA to `dist/` + bundled Node server `dist/server.cjs` |
| `start` | `node dist/server.cjs` | Serves `dist/` + SPA fallback `* → dist/index.html` — `server.ts:191-197` |
| `clean` | `rm -rf dist server.js` | Removes build output |
| `lint` | `tsc --noEmit` | Typecheck only (`tsconfig.json:1-26`: ES2022, bundler, react-jsx, noEmit) |

**Backend (`backend/README.md:5-34`):**

```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env   # then fill in values (never commit)
.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
# GET http://localhost:8000/api/health
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -v   # in-memory mongomock-motor, no Atlas needed
```

Degraded boot: without `MONGODB_URI` the API still boots; health reports `"mongo": "not_configured"` — `backend/README.md:27-28`, `backend/app/main.py:22-35`, `backend/app/api/health.py:13-22`.

Frontend→FastAPI override: `VITE_API_URL` (example `http://localhost:8000` commented in `.env.example:17-19`; read at build time in `src/lib/mongoApi.ts:14-16`).

### 1.4 Docker / deploy config — none in repo

Glob for `{Dockerfile*,docker-compose*,vercel.json,wrangler.toml*,netlify.toml,render.yaml,fly.toml,.github/**/*,.nvmrc,.node-version,.python-version,Procfile}` returned **no files found**.

### 1.5 Hosting / deployment clues

- **Cloudflare Pages Functions** — `functions/api/backend/[[path]].ts:1-13` header states "Cloudflare Pages Function — secure reverse proxy", route `/api/backend/*`; `functions/api/send-email.ts:1-8` and `functions/api/health.ts:1-6` mirror the Express routes for deployed Pages (no Node server there).
- **Local/dev** — Express + Vite middleware on `0.0.0.0:3000` — `server.ts:185-201`; prod `express.static(dist)` + SPA fallback — `server.ts:191-197`.
- **Backend** — FastAPI served by Uvicorn with `/api` routers — `backend/app/main.py:50-54`. Production host (VPS/AWS/Render/etc.): Unknown — no config found.
- **Upstream dependency (not hosted here)** — PrimeHire v1 API default base `https://api.placement.vils.ai/primehire/api/v1` in `server.ts:75`, `functions/api/backend/[[path]].ts:30`, `backend/app/config.py:21`. The app is a BFF/admin layer in front of it — `INTEGRATION_NOTES.md:7-21`.

---

## 2. Database

### 2.1 Engine, ORM/query layer, migration tooling

- **Engine:** MongoDB Atlas via Motor async client — `backend/app/db/mongodb.py:15-21` (`AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=5000)`), `backend/app/db/mongodb.py:30-31` (`get_database`), `backend/app/db/mongodb.py:34-42` (`ping()` never raises). DB name default `"primehire"` — `backend/app/config.py:19`.
- **ORM/query layer:** No ODM (no Beanie/MongoEngine). Hand-rolled repository functions per collection in `backend/app/models/*.py` using Motor directly (e.g. `insert_one`/`find_one` in `backend/app/models/candidate.py:63-67`, `upsert` in `backend/app/models/report.py:75-92`). Validation via Pydantic schemas in `backend/app/schemas/*.py`. No query builder beyond dict filters.
- **Migration tooling:** No Alembic/migration framework. Closest equivalents:
  - Index management: `ensure_indexes()` called on startup — `backend/app/main.py:28-32`, defined `backend/app/db/mongodb.py:95-110`; drops legacy indexes best-effort — `backend/app/db/mongodb.py:99-105`.
  - One-time data import: `POST /api/migration/import` — `backend/app/api/migration.py:28-37` → `backend/app/services/migration_service.py` (dry-run + import, per-record error collection). No forward/back migration files.

### 2.2 Full collection list with columns, types, keys, relationships

All index specs live in `backend/app/db/mongodb.py:47-86`. Field shapes come from `backend/app/schemas/*.py` + `backend/app/models/*.py` (`to_document`/`to_public`).

#### `assessments`

- Indexes (`backend/app/db/mongodb.py:48-51`): `uniq_jobId` UNIQUE on `jobId`; `by_isActive` on `isActive`.
- Fields (`backend/app/schemas/assessment.py:25-40`, `backend/app/models/assessment.py:13-19`):

| Field | Type | Notes |
|---|---|---|
| `jobId` (alias `job_id`) | string | business PK, unique; UI `AssessmentProfile.id` mirrors it — `src/lib/mongoApi.ts:67-83` |
| `jobTitle` | string | |
| `jobDescription` | string (`""` default) | |
| `language` | string (`"en"` default) | |
| `roundType` | `TECHNICAL\|BASIC\|HR` | |
| `questions` | array of Question | each: `id: string`, `text` (alias `question`): string, `type: SPEAK_TO_ANSWER\|MCQ`, `maxDuration: int = 120`, `referenceAnswer\|answer?: string`, `criteria?: string`, `options?: string[]`, `correctOption?: string`, `maxScore?: int`, `weightage?: int` — `backend/app/schemas/assessment.py:10-22` |
| `startDate` / `endDate` | string ISO8601 \| null | schedule window |
| `isActive` | bool (`true`) | |
| `createdAt` / `deactivatedAt` | string ISO8601 \| null (passthrough) + server `createdAt/updatedAt: datetime` — `backend/app/models/assessment.py:17-18` | |
| `_id` | ObjectId | exposed as `id: string` in `to_public`, plus `mongoId` on frontend — `src/lib/mongoApi.ts:81` |
- Repo: `create()`, `get_by_job_id()`, `list(limit=50, skip=0)` — `backend/app/models/assessment.py:34-50`.

#### `candidates`

- Indexes (`backend/app/db/mongodb.py:52-74`): `by_assessmentId` on `assessmentId`; `by_candidateKey` on `candidateKey`; `by_email` on `email` (all non-unique); `uniq_interviewId_v2` UNIQUE PARTIAL on `primehire.interviewId` where `$type:string AND $ne:""`; `uniq_responseId_v2` UNIQUE PARTIAL on `primehire.responseId` where same. Legacy `uniq_interviewId`/`uniq_responseId` (sparse) dropped best-effort on startup — `backend/app/db/mongodb.py:89-105` (they indexed explicit nulls → E11000 on 2nd pre-link insert).
- Null-pruning: `to_document()` drops `primehire.{interviewId,responseId,candidateUUID}` when `None`/`""`, drops whole `primehire` if empty — `backend/app/models/candidate.py:30-40`.
- Fields (`backend/app/schemas/candidate.py:14-55`, `backend/app/models/candidate.py:41-44`):

| Field | Type | Notes |
|---|---|---|
| `candidateKey` | string \| null | server generates `CAND-` + 8 hex upper if absent — `backend/app/services/candidate_service.py:103-105`; UI `Candidate.id` mirrors it — `src/lib/mongoApi.ts:86-116` |
| `assessmentId` | string | FK-like reference to `assessments.jobId` (no DB-level FK) |
| `name` / `email` / `phone` | string (`phone` default `""`) | `email` indexed but **not unique** |
| `startTime` / `endTime` | string (`""` default) | interview window |
| `link` | string \| null | opaque upstream interview URL passthrough |
| `assignedDate` | string \| null | |
| `status` | `ACTIVE\|INACTIVE` | |
| `primehire.interviewId` / `primehire.responseId` / `primehire.candidateUUID` | string \| null | upstream linkage; partially-unique as above |
| `syncState.submittedDate` / `syncState.assessmentStatus` / `syncState.reportStatus (GENERATING\|GENERATED\|FAILED)` / `syncState.inviteSent` / `syncState.inviteSentAt` / `syncState.lastInviteSentAt` / `syncState.lastReminderSentAt` / `syncState.reminderCount (=0)` / `syncState.mailStatus` | mixed | mail/progress mirror — `backend/app/schemas/candidate.py:20-29` |
| `migrationMeta.unresolvedResponseId` / `unresolvedCandidateUUID` | audit strings | set on import fallback — `backend/app/services/migration_service.py:34-39` (frontend-only `linkGenerated/linkValue` dropped there) |
| `origin` | string (`"primehire"`) | `backend/app/models/candidate.py:42` |
| `isMock` | bool (`false`) | auto-quarantine for `int-`/`res-`/synthetic-UUID/demo payloads — `backend/app/services/candidate_service.py:29-73,128-134` |
| `answers` / `simulatedReport` | any | mock-only passthrough — `backend/app/services/migration_service.py:42,135-138` |
| `createdAt` / `updatedAt` | datetime (server) | `backend/app/models/candidate.py:43-44` |
| `_id` | ObjectId | exposed as `id`, plus frontend `mongoId` — `backend/app/models/candidate.py:48-56`, `src/lib/mongoApi.ts:114` |
- Forbidden (never accepted/stored/returned): `password`, `rowLoading` — `backend/app/models/candidate.py:15,22-24,97-101`, `backend/app/schemas/candidate.py:59-64,109-114`.
- Repo (`backend/app/models/candidate.py:59-128`): `create`, `get_by_interview_id`, `get_raw_by_interview_id`, `set_uuid_if_absent` (only when `$in:[None,""]`), `get_by_key`, `update_by_key` (dotted `$set` + `updatedAt`), `delete_by_key` (Mongo only), `list_by_assessment`, `list_all`.

#### `reports`

- Indexes (`backend/app/db/mongodb.py:75-81`): `uniq_interviewId` UNIQUE on `interviewId`; `by_candidateId`; `by_responseId` (sparse); `by_status`; `by_updatedAt` desc.
- Fields (`backend/app/models/report.py:27-61`):

| Field | Type | Notes |
|---|---|---|
| `interviewId` | string | unique key |
| `candidateId` / `assessmentId` / `responseId` | string \| null | linkage (no FKs) |
| `status` | string (`"GENERATED"`) | |
| `source` | string (`"primehire"`) | |
| `schemaVersion` | int (`1`) | |
| `rawResponse` | any | complete upstream envelope verbatim |
| `raw` | any | unwrapped `data` verbatim |
| `normalized` / `normalizedScores` | dict \| null | camelCased + extracted scores — `backend/app/services/report_normalize.py:43-109` |
| `videoRefs` | array (`[]`) | only `questionWiseResult[].videoUrl` → `{questionId, videoUrl, fetchedAt}` — `backend/app/services/report_normalize.py:112-128` |
| `fetchedAt` / `createdAt` / `updatedAt` | datetime | |
| `upstreamHash` | string | `sha256(json.dumps(sort_keys=True, default=str))` — `backend/app/models/report.py:21-24` |
| `error` | null | |
- Repo (`backend/app/models/report.py:75-92`): `upsert_by_interview_id` (upsert on `interviewId`, refreshes `updatedAt`), `get_by_interview_id`.

#### `templates`

- Indexes (`backend/app/db/mongodb.py:82-85`): `uniq_templateId` UNIQUE on `id`; `by_type` on `type`.
- Fields (`backend/app/schemas/template.py:10-15`, `backend/app/models/template.py:13-29`): `id: string` (unique), `name: string`, `type: STANDARD_INVITATION\|REMINDER\|CUSTOM (=CUSTOM default)`, `subject: string ("" default)`, `body: string ("" default)`, server `createdAt/updatedAt: datetime`. `to_public()` exposes Mongo `_id` as `mongoId` without overwriting `id`.
- Repo (`backend/app/models/template.py:32-44`): `create`, `get_by_template_id`. No update/delete route (see §4).

#### ER-style text diagram

```text
assessments 1 ─── * candidates        (logical FK candidates.assessmentId → assessments.jobId; NO DB FK)
   [jobId UNIQUE]     [candidateKey app-key; primehire.interviewId/responseId UNIQUE PARTIAL]

candidates 1 ─── 0/1 reports         (logical: reports.candidateId = candidates._id string
   [primehire.*]      [interviewId UNIQUE]   AND reports.interviewId = candidates.primehire.interviewId; NO DB FK)

reports * ──── 1 assessments (optional)  (reports.assessmentId → assessments.jobId; NO DB FK)

templates (standalone; no relations — mail-template library, UNIQUE id)
```

All relationships are application-level; MongoDB enforces no foreign keys (no `$lookup`/refs in models).

### 2.3 Existing data volume clues (code only, production not queried)

- Seed/fallback data: `src/mockData.ts:76-217` — `ARJUN_REPORT_PAYLOAD` (HR 8-question unevaluated + `faceapi_violations`), `ARJUN_ASSESSMENT`, `ARJUN_CANDIDATE` (`reportStatus GENERATED`, `assessmentStatus COMPLETED`), `INITIAL_ASSESSMENTS` / `INITIAL_CANDIDATES` merged with server data in `src/App.tsx:83-129,164-202`. `INITIAL_TEMPLATES` (`tpl-invite`, `tpl-reminder`) — `src/mockData.ts:13-48`.
- Counts from production: Unknown — no seed-count files and production was not queried (per rules).
- Pagination defaults hint at expected scale: assessments `limit=50` server / `200` frontend read (`backend/app/models/assessment.py:34-50`, `src/lib/mongoApi.ts:118-121`); candidates `limit=500` (`src/lib/mongoApi.ts:123-127`); bulk create cap `1..500` (`backend/app/schemas/candidate.py:135-136`); list clamp `1..200` (`backend/app/api/directory.py:26-27`).

### 2.4 Indexes, constraints, risky gaps

- **Good:** unique `assessments.jobId` (`backend/app/db/mongodb.py:49`); unique partial `primehire.interviewId/responseId` avoiding null-collision (`backend/app/db/mongodb.py:60-73`); UUID never overwritten (`backend/app/models/candidate.py:77-87`); migration never overwrites differing docs (`backend/app/services/migration_service.py:175-183,338-350,368-383`); legacy sparse indexes retired (`backend/app/db/mongodb.py:89-105`).
- **Risky / missing:**
  - No foreign keys anywhere (orphan candidates/reports possible; `DELETE /candidates` is Mongo-only by design — `backend/app/api/candidates.py:110-118` docstring).
  - `candidates.email` indexed but **not unique** (`backend/app/db/mongodb.py:55`) — duplicates allowed; dedup is UI/CSV-validation only.
  - No unique on `(assessmentId, email)` — one candidate can be re-added to the same job with a new `CAND-` key (relevant to planned multi-application model — see §9).
  - No TTL/expiry index on anything (assessment links/windows never auto-expire in DB).
  - `link` URL unsanitized passthrough; `raw/normalized` stores arbitrary upstream JSON unbounded (by design but unbounded doc size).
  - Reports `by_responseId` is `sparse` (legacy style) while candidates use `partial` — inconsistent, low risk.

---

## 3. Existing features, mapped to code

### 3.1 Candidate creation

**Exists — two parallel paths (upstream PrimeHire + local Mongo mirror).**

(a) **Upstream-driven (primary, frontend):** `primehireClient.addCandidates(assessmentId, [{name,email,phone,startTime,endTime}])` is **local-only**, returns `CAND-` + `generate32BitId()` (8-char hex) and defers sync to `POST /interview` — `src/lib/primehireClient.ts:281-288`, `src/lib/primehireIds.ts:67-70`. Actual creation happens inside `mockGenerateLink()` which sends only `{candidate_id, start_time, end_time}` — `src/mockData.ts:488-494`.

(b) **CSV/manual intake (frontend, `src/components/AssessmentsAndAssignments.tsx`):**
- CSV: `handleCSVUpload` 10 MB guard + `FileReader.readAsText` — `:1424-1440`; `parseCSVContent` requires headers `Name,Email,Phone,Start Time,End Time`, naive `split(",")` — `:1442-1494`; `.csv`-only picker + sample loader — `:3495-3518`, `:1412-1421`.
- Manual: `handleAddManualCandidate` validates name regex, email `@+.`, phone 10 digits, times + consent → review rows — `:1585-1663`.
- Import: `handleConfirmCandidateImport` blocks on red validations, server-first `createCandidatesBulk()` with partial-success (failed rows kept) — `:1506-1583`, `src/lib/mongoApi.ts:208-219`.

(c) **FastAPI mirror (`POST /api/candidates`, `POST /api/candidates/bulk`):**
- Route `70-84` in `backend/app/api/candidates.py` validates `CandidateIn` (rejects `password`/`rowLoading` — `backend/app/schemas/candidate.py:59-64`) → `candidate_service.create()` (`backend/app/services/candidate_service.py:118-138`): generates `CAND-` key if absent, checks `get_by_key` → `CandidateConflict`, auto-quarantines mocks (`looks_mock`), inserts via `models/candidate.py:63-67`, maps `DuplicateKeyError` → 409. Bulk (`backend/app/api/candidates.py:41-52`, service `:140-159`) loops per-item with `{index, code: DUPLICATE_KEY|VALIDATION_ERROR|CREATE_FAILED, message}` isolation. Update via dotted `$set` (`schemas/candidate.py:116-132`, `models/candidate.py:93-113`).
- Request shape: `CandidateWritePayload` allowlist — `src/lib/mongoApi.ts:131-158` (`candidateKey?, assessmentId, name, email, phone?, startTime?, endTime?, link?, assignedDate?, status?, primehire?, syncState?`). Response: created public doc mapped back to UI `Candidate` — `src/lib/mongoApi.ts:86-116,201-206`.
- Duplicate handling: app-key conflict → 409 pre-check; real `interviewId/responseId` duplicates → 409 via partial-unique indexes; **email duplicates allowed** (no unique email).

### 3.2 Assessment creation

**Exists upstream; no direct FastAPI endpoint.**

- Frontend form + validation in `src/components/AssessmentsAndAssignments.tsx:550-691`: requires jobId/title/desc + start/end + question text + MCQ options/correct + TECHNICAL `referenceAnswer` / BASIC `criteria`; non-HR `totalWeightageSum == 100` (`:603-606`); `simulateCreateFailure` flag (`:609-612`); edit path is local-only (`:615-650`).
- Mapping to backend contract: `mapFrontendProfileToBackend()` strict Pydantic allowlist `job_id/job_title/job_description/language/round_type/questions/start_date/end_date`; sanitizes `q.id` to `^[A-Za-z0-9_]` + `q_` prefix on leading digit; `text→question`, `maxDuration→max_duration` default 120; MCQ `options: string[] → [{id: opt_N, data}]`, `correctOption → answer: opt_N`; non-MCQ `referenceAnswer|answer|criteria → answer`; strips `max_score/weightage` when `roundType == HR` — `src/lib/primehireClient.ts:109-178`. Reverse mapper `:181-235`.
- Transport: `primehireClient.createAssessment → POST /assessment` (`:243-249`); list/detail/toggle via `GET /assessment`, `GET /assessment/:id`, `PUT /assessment/:id/toggle-active` (`:256-275`). All go through `/api/backend/*` proxy (see §4).
- Storage: upstream is source of truth; localStorage + Mongo mirror (`mapMongoAssessment` — `src/lib/mongoApi.ts:67-83`). FastAPI has **only** `GET /api/assessments` list (`backend/app/api/directory.py:30-40`); `assessment_service.create()` exists (`backend/app/services/assessment_service.py:15-17`) but is reachable only via migration import (`migration_service.py:332-353`) and tests — **no `POST/PUT/DELETE /assessments` route**.
- Questions stored as embedded array in assessment doc (see §2.2). Scoring fields `maxScore/weightage` on TECHNICAL/BASIC only (HR stripped). Timed per-question via `maxDuration` (default 120 s); schedule window `startDate/endDate`; no server-side expiry enforcement found.

### 3.3 Assessment link generation + candidate-facing flow

**Link generation exists (frontend-orchestrated `POST /interview`); candidate test UI is a local simulator, not the real portal.**

- `mockGenerateLink(candidateIds, store, roundType, jobId?)` — `src/mockData.ts:461-615`: resolves legacy `asm-react/support/hr → JOB-…` (`:473-481`); self-heals `not found → POST /assessment → retry POST /interview` (`:506-552`); duplicate-IDs → rotate `CAND-` + recursive retry (`:555-585`); final fallback fabricates local links (`:592-613`).
- Response parsing: `extractInterviewsFromResponse` handles `data.interviews|candidates|interviews|[]` — `:395-406`; `mapInterviewResultsToCandidates` matches `candidateId|candidate_id|email`, reads `url|link|interviewUrl + password|accessCode + id|interviewId`, validates UUID else synthesizes `c3a7db8e-…` random, fabricates `primehire-test.com/interview/{round}-{firstname}-{code}` + `PRIME-…` if missing — `:411-452`. Persisted as `link/password/interviewId/responseId/verifiedCandidateUUID/linkGenerated/linkValue` — `:434-448` (branded IDs — `src/lib/primehireIds.ts:6-40`).
- Single/bulk/regenerate/reschedule wrappers in `AssessmentsAndAssignments.tsx:758-782,884-923,1087-1121` (+ `mockRegenerateLink` rotating ID and resetting submission/mail — `mockData.ts:621-655`; `mockRescheduleInterview` requiring `interviewId` — `:664-708`).
- Tokens/expiry/one-time/anti-cheating: **Tokens** = upstream `interviewId` (UUID) + `password`/`accessCode` (interview-portal credential, not app auth) + `responseId`. **Expiry** = `start_time/end_time` window + schedule `startDate/endDate`; UI-only expiry toggle shifts `endTime ±` (`AssessmentsAndAssignments.tsx:1331-1351`); no DB TTL, no one-time-use flag, no anti-cheating in the admin app (proctoring signals like `faceapi_violations`/`tabSwitching/multipleFaces` only appear in *report display* — `ReportDialog.tsx:188-229`, `mockData.ts:76-171`).
- Candidate-facing flow in this repo = `CandidateWorkspaceSimulator.tsx:28-907` (explicitly decoupled per `INTEGRATION_NOTES.md:48-50`): steps `LOGIN|CALIBRATION|INSTRUCTIONS|TEST|SUBMITTING|COMPLETE`; login checks `passwordInput === candidate.password` (`:178-185`); mic/canvas calibration (`:73-136`); per-question countdown + auto-advance (`:139-161`); canned-transcript recording stub (`:187-222`); deterministic mock grading (MCQ exact + speak keyword hits → 95/85/65/0%) (`:254-377`). The real candidate portal lives upstream (link domain), not here.

### 3.4 Assessment result storage + scoring/report logic

- **Fetch:** `mockGetInterviewStatus` parses `data.interviewStatus{isInterviewSubmitted,isReportAvailable,submittedAt}`, IST-formats dates, lazily resolves `response_id` — `mockData.ts:825-904`. `mockGetReport` priority: local `simulatedReport` → live `GET /interview/:id/report` if `interviewId` not `int-` (`_isRealReport`), else mock `{overallScore: 82, …}` — `:910-978`. `mockRegenerateReport` → `POST /response/:id/generate-report`, sets `GENERATING` — `:984-1054`. `lookupResponseId` via `GET /response/report-not-generated` — `:806-823`.
- **Backend cache:** `report_service.store()` upserts raw (`backend/app/services/report_service.py:15-48`) but has **no route**; `report_backfill.backfill_report()` (single-report, read-only toward PrimeHire: lookup → skip if not `GENERATED` → `GET {base}/interview/{id}/report` 60 s → unwrap envelope → `validate_report_data` → hash-compare `upstreamHash` → upsert verbatim `raw/rawResponse` + `deep_camel` normalized + `normalizedScores` + `videoRefs` → UUID recovery via `set_uuid_if_absent`) — `backend/app/services/report_backfill.py:30-121`. Callable only via import/tests; **no trigger route/schedule**.
- **Normalize/extract:** `deep_camel` snake→camel (`report_normalize.py:38-48`); `validate_report_data` requires `question_wise_result` list + numeric scores (`:73-88`); `extract_scores` variant-tolerant (`technical = technicalAnalysis.overallScore OR report.overallScore`, `communication`, `confidence`, `fluency/grammar/pronunciation/vocabulary` — `:91-109`, missing → `None` never `0`); `extract_video_refs` only (`:112-128`); `extract_candidate_uuid` with synthetic-prefix rejection (`:131-142`).
- **Read contract:** `GET /api/reports/{interview_id}` is Mongo-first, explicitly no PrimeHire fallback (`backend/app/api/reports.py:1-6,29-64`); hides `raw/rawResponse/_id/createdAt/error`; 400 on `int-` mock / empty ID; 404 `REPORT_NOT_FOUND`.
- **Frontend render/score display:** `ReportDialog.tsx:150-678` (RealTechnicalReport with camel|snake tolerance `:162-166`, executive Technical/Communication/Presence cards, Q&A expandables, proctoring banner, `VideoPlayer`), plus `src/components/report/*` (~30 files: `ReportShell`, Technical/Basic/HR renderers, gauges/radars/distribution, `RecruiterDecisionContext`, PDF/HTML/print/share). Grade helpers: `getGrade A-E` (`ReportDialog.tsx:23-29`), `getGrade A+-F` (`normalizeReport.ts:7-18`); coverage/aggregates/radar heuristics in `reportMetrics.ts:19-126`; deterministic insights in `normalizeReport.ts:239-332`. Candidate list score for filtering is a heuristic (`simulatedReport.overallScore` or `15+hash%85`) — `CandidateManagement.tsx:125-152`, not a backend score.

### 3.5 Zepto Email integration

| Aspect | Finding |
|---|---|
| Client (sole call-site) | `sendEmailViaApi` — `src/components/AssessmentsAndAssignments.tsx:925-958`: wraps plaintext → `htmlBody` div (`:926-930`), `POST /api/send-email {toEmail,toName,subject,htmlBody}` (`:932-943`), throws on `!ok` (`:945-955`). No other sender. |
| Server (local) | `POST /api/send-email` proxy — `server.ts:21-63`: reads `process.env.ZEPTOMAIL_API_KEY` (500 if missing `:24-28`), fixed `from {address: "noreply@nxtagent.ai", name: "PrimeHire Careers"}` (`:34`), `POST https://api.zeptomail.in/v1.1/email` with `Accept/Content-Type/Authorization: apiKey` (`:40-48`), payload `htmlbody: htmlBody` (`:37`). Success `{success:true, details:bodyText}` (`:55`), else relays upstream status+body (`:57`). |
| Server (deployed) | `functions/api/send-email.ts:57-120`: same contract + CORS (`POST,OPTIONS` `:61-67`), 405 non-POST (`:69-71`), 400 on bad JSON / missing `toEmail/subject/htmlBody` (`:79-93`), same from-address (`:104`). |
| Templates | `renderTemplate(template, candidate, assessment, company=PrimeHire)` replaces 8 vars, `link→NO_LINK_GENERATED`, `password→NO_PASSWORD` — `src/mockData.ts:52-73`; library `tpl-invite STANDARD_INVITATION` + `tpl-reminder REMINDER` — `:13-48`; selection in invite/reminder handlers — `AssessmentsAndAssignments.tsx:981,1048,1140,1234`; editor/preview (no sending) in `MailTemplates.tsx:13-284` (preview From display `recruitment@primehire.com` is hardcoded display only — `:256-284`). |
| Guards | Single invite requires `link && !submitted && ACTIVE` (`:960-1020`); reminder requires `invited && !completed && ACTIVE && !expired` (`:1022-1085`); bulk via `Promise.all` with per-row `Sending→Invite Sent|Reminder Sent|Failed` (`:1123-1302`). |
| Error handling | Client `console.error` on bulk fail (`:1183,1275`) + row `mailStatus Failed`; server `console.log/error` dispatch+status+body (`server.ts:31,50-52,60`); Pages `console.error` (`send-email.ts:75,117`). State persisted: `inviteSentAt/lastInviteSentAt/lastReminderSentAt/reminderCount` + `syncCandidateToServer` (e.g. `:977-1019,1045-1084`). |
| Retries / queue / logging infra | **None.** Single `fetch`, no retry loop (`primehireClient.ts:39-103` notes no retry; same for email), no queue/persistence, console-only logging. Backend (`backend/`) has **zero** email code — grep for `zepto|smtp|send.*mail` returns nothing; only `syncState` invite/reminder fields + `Template` CRUD schemas/models with no send logic. |
| Backend env | `ZEPTOMAIL_API_KEY` lives only in root server/Functions env (see §8); backend has no Zepto variable. |

### 3.6 Resume handling / file upload / storage

**No resume handling, no file upload, no object storage.** Confirmed absent: no `FormData`/`multipart`/`resume`/`pdf`/`docx`/`S3`/`disk-storage` handling in app code. Only file paths found:

- **CSV candidate import** (`.csv` 10 MB, `FileReader.readAsText`, headers `Name,Email,Phone,Start Time,End Time`) — `AssessmentsAndAssignments.tsx:1424-1494,3495-3518` + stub `mockUploadAndParseCandidates → []` — `src/mockData.ts:325-331`; manual rows — `:1585-1663`.
- **Export/download only:** vector jsPDF A4 + standalone HTML download + `window.print` — `src/utils/exportReportPdf.ts:31-40,462-627`.
- `@google/genai ^2.4.0` is installed (`package.json:16`, `metadata.json:6` capability flag) but no resume-parse or AI call-site was found in surveyed flows — treat as unused dependency until proven otherwise.

---

## 4. API inventory

### 4.1 Root Express (`server.ts:1-204`) — local dev + prod static

| Method | Path | Auth | Handler | Purpose | Request / Response |
|---|---|---|---|---|---|
| GET | `/api/health` | none | `server.ts:16-18` | liveness | → `{status:"ok"}` |
| POST | `/api/send-email` | server Zepto key (500 if missing) | `server.ts:21-63` | ZeptoMail relay | `{toEmail,toName?,subject,htmlBody}` → `{success:true,details}` or upstream status + `{success:false,error}`; no retry |
| ALL | `/api/primehire/*` (legacy) + `/api/backend/*` | `PRIMEHIRE_ACCESS_KEY/SECRET_KEY` server-side (500 `CONFIGURATION_ERROR` if missing); forwards caller `Authorization` + optional `PROXY_ORIGIN` | `server.ts:68-182` | PrimeHire reverse proxy | strips prefix → `{BACKEND_URL or default}{subpath}{query}` (`:72-76`), injects `x-access-key/x-secret-key` (`:101-105`), relays status+JSON verbatim (`:142-171`) |

### 4.2 Cloudflare Pages Functions (`functions/api/*`)

| Method | Path | Auth | Handler | Purpose | Request / Response |
|---|---|---|---|---|---|
| GET (+OPTIONS) | `/api/health` | none | `functions/api/health.ts:13-22` | liveness (mirrors Express) | → `{status:"ok"}` `Cache-Control:no-store` |
| POST (+OPTIONS) | `/api/send-email` | `ZEPTOMAIL_API_KEY` env (500 if missing) | `functions/api/send-email.ts:57-120` | ZeptoMail relay (deployed) | same shape as Express + 400/405 validation (`:69-93`) |
| * (GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD) | `/api/backend/*` | `PRIMEHIRE_ACCESS_KEY/SECRET_KEY` env (500 if missing); allowlisted headers only | `functions/api/backend/[[path]].ts:71-180` | Secure PrimeHire proxy | path-traversal guard (`:85-97`), `base+suffix+query` (`:98-101`), relays `Content-Type/Disposition/Set-Cookie` (`:151-175`), 502 on fetch fail |

### 4.3 FastAPI (`backend/app/*`, all under `/api` prefix — `main.py:50-54`; DB-gated routes 503 if no Mongo)

| Method | Path | Auth | Handler | Purpose | Request / Response |
|---|---|---|---|---|---|
| GET | `/api/health` | none | `api/health.py:13-22` | liveness + DB state | → `{status:"ok", app, mongo: not_configured\|connected\|unreachable}`; never raises |
| POST | `/api/migration/import[?dryRun]` | `X-Migration-Secret == MIGRATION_SECRET` (403 if empty/mismatch) | `api/migration.py:20-37` | one-time localStorage→Mongo import | arbitrary `{assessments[],candidates[],templates[]}` → dry-run summary or counts; per-record errors collected |
| GET | `/api/reports/{interview_id}` | none | `api/reports.py:48-64` | cached report read | path id → contract `{status,source,schemaVersion,interviewId,candidateId,assessmentId,responseId,report=normalized,normalizedScores,videoRefs,fetchedAt,updatedAt}` (`:29-45`); 400 `MOCK_ID`/`INVALID_ID`, 404 `REPORT_NOT_FOUND`, 500 controlled |
| GET | `/api/assessments?limit&skip` | none | `api/directory.py:30-40` | list assessments | `limit 1..200, skip>=0` → `{items,total,limit,skip}` |
| GET | `/api/candidates[?assessment_id]&limit&skip` | none | `api/directory.py:43-61` | list candidates (+filter) | optional `assessment_id` → `{items,total,limit,skip}` |
| POST → 201 | `/api/candidates` | none | `api/candidates.py:70-84` | create candidate mirror | `CandidateIn` JSON (see §3.1) → public doc; 409 `DUPLICATE_KEY`, 422 validation, 500 generic |
| POST → 201 | `/api/candidates/bulk` | none | `api/candidates.py:41-52` | bulk create (1..500) | `{items:[CandidateIn]}` (`schemas/candidate.py:135-136`) → `{items[],errors[],created,failed}` per-item isolation |
| GET | `/api/candidates/{candidate_key}` | none | `api/candidates.py:55-67` | read one | `key.strip()` → public doc; 404 `CANDIDATE_NOT_FOUND` |
| PUT | `/api/candidates/{candidate_key}` | none | `api/candidates.py:87-107` | patch candidate | partial `CandidateUpdate` (`exclude_unset`) → updated doc; 404/409/422/500 |
| DELETE | `/api/candidates/{candidate_key}` | none | `api/candidates.py:110-124` | delete Mongo doc only | → `{deleted:key}`; 404 if absent; never touches PrimeHire (docstring `:5-6`) |

No FastAPI routes exist for `POST /assessments`, `POST /reports`, `POST /interview`, link generation, email send, or backfill trigger.

### 4.4 Upstream PrimeHire v1 (called by `src/lib/primehireClient.ts:237-355` via `/api/backend/*`; camelCase↔snake auto-mapped `:12-37`)

| Client method | Method+Upstream path | Handler | Purpose |
|---|---|---|---|
| `createAssessment` | `POST /assessment` | `primehireClient.ts:243-249` | create assessment profile |
| `getAssessments` | `GET /assessment` | `:256-258` | list (note: `mockData.ts:277-279` observes `GET /assessment 405`, so UI list is local-only) |
| `getAssessmentDetail` | `GET /assessment/:id` | `:264-267` | detail (live-then-local fallback) |
| `toggleAssessmentActive` | `PUT /assessment/:id/toggle-active` | `:273-275` | activate/deactivate |
| `addCandidates` | local-only (deferred) | `:281-288` | stage `CAND-` IDs; sync deferred to `POST /interview` |
| `createInterview` | `POST /interview` | `:294-300` | **link generation** `{job_id, round_type, candidates:[{candidate_id,start_time,end_time}]}` |
| `rescheduleInterview` | `PUT /interview/:id/reschedule {start_time,end_time}` | `:306-311` | reschedule window |
| `getInterviewStatus` | `GET /interview/:id/status` | `:317-319` | submission/report readiness |
| `getInterviewReport` | `GET /interview/:id/report` | `:325-327` | fetch evaluated report |
| `generateReport` | `POST /response/:id/generate-report` | `:333-335` | trigger evaluation |
| `getReportsNotGenerated` | `GET /response/report-not-generated` | `:341-343` | pending list (used for `response_id` lookup) |
| `resetCandidatePassword` | `PUT /candidate/:uuid/password?new_password=` (gated by `PASSWORD_RESET_ENABLED=true` — `primehireIds.ts:62`) | `:349-354` | rotate interview-portal credential |

---

## 5. Auth and roles

### 5.1 How login works

- **Admin app: no login.** No sessions, JWT, OAuth, password check, or `ProtectedRoute`/router guard found. Sole role-like string is display-only hardcoded `PNS Varma / Administrator` avatar in `src/App.tsx:359-366`.
- **Service-to-service:** browser never holds upstream keys. Express injects `x-access-key/x-secret-key` server-side (`server.ts:101-105`); Pages Function same (`[[path]].ts:137-138`, allowlisted headers only `:124-136`); FastAPI helper `auth_headers()/has_credentials()` (`primehire_service.py:16-26`, "never log"). Missing creds → actionable 500 `CONFIGURATION_ERROR` (`server.ts:87-99`, `[[path]].ts:104-118`) with special 401 hint (`server.ts:161-167`); frontend maps 401/`Invalid Credentials`/`CONFIGURATION_ERROR` to `.env` guidance (`primehireClient.ts:84-96`).
- **Candidate portal credential:** `password`/`accessCode` on the interview link is the *candidate's* test-login secret (`PUT /candidate/:uuid/password` — `primehireClient.ts:349-354`; simulator login `passwordInput === candidate.password` — `CandidateWorkspaceSimulator.tsx:178-185`). The admin backend **refuses to accept/store/return** it: rejected at schema (`schemas/candidate.py:59-64,109-114`), stripped at model (`models/candidate.py:15,22-24,97-101`), counted as `passwordsSkipped` on migration (`migration_service.py:73-76,232-234,361-363`), nulled on frontend mapping (`mongoApi.ts:98`). Regeneration is via upstream `POST /interview` when needed (`models/candidate.py:3-6` comment, `README.md:38-40`).
- **Migration endpoint:** sole guarded route — `require_migration_secret` compares `X-Migration-Secret` to `MIGRATION_SECRET`; empty secret = disabled (403) — `backend/app/api/migration.py:20-25`; secret never in responses (tested `test_migration.py:249-261`).

### 5.2 Roles / permissions + enforcement

- **No roles/permissions model.** No RBAC table, middleware, or UI gating. All FastAPI CRUD/list/report reads are **unauthenticated** (only 503 mongo gate + migration secret elsewhere) — `api/candidates.py`, `api/directory.py`, `api/reports.py` have no secret check. Anyone with network access to `:8000` or the proxy can read/write if Mongo is configured.
- Enforcement is limited to: Pydantic `extra=forbid` + forbidden-field rejection, pagination clamps (`directory.py:26-27`), path-traversal guard (`[[path]].ts:87-97`), email-field validation (`send-email.ts:86-93`), and CORS allowlisting (see §9).

### 5.3 Candidate-facing link security

Separately secured by obscurity + upstream credentials, not by app session: unguessable `interviewId` (UUID, validated — `primehireIds.ts:45-56`, backend `candidate_service.py:23,37-41`) + `password`/`responseId`. Frontend guards link ops to `ACTIVE` candidates and resets submission/mail on reschedule/regen (`AssessmentsAndAssignments.tsx:758-782,812-847,884-901`). No one-time-use token, no signed URL, no rate limit on status/report polling in this repo.

---

## 6. Frontend

### 6.1 Framework, routing, state, UI, styling

- **Framework:** React 19 + Vite 6 + TypeScript 5.8, SPA with `StrictMode + createRoot(#root)` — `src/main.tsx:1-10`, wired by `index.html:23-24` (title `PrimeHire — Placement Analytics` `:6`, font Plus Jakarta Sans `:10`, theme bootstrap `placement-theme dark` `:13-20`).
- **Routing:** **No router library** (no react-router). Tab state `activeTab: dashboard|candidates|assessments|templates` in `src/App.tsx:36-41,73-74`; single `FrostedDetailPanel(panelKey)` workspace (`:600-639`); domain cards `tablist` (`:540-597`).
- **State:** `useState` + `localStorage` (`primehire_assessments/candidates/templates` — `App.tsx:85-129`, writers `:131-153`) with Phase 3C read cutover: `Promise.all(fetchAssessments(), fetchCandidates())` → merge + `apiDown=false`, else `apiDown=true` + toast + banner (`:164-202,532-537`). Server-confirmed status toggle (server write first; local-only if never persisted `!mongoId`) — `:208-227`.
- **UI library:** shadcn (`components/ui/*`: accordion, badge, button, checkbox, dialog, input, select, sonner, table, tabs, textarea) + `@base-ui/react` + `primitives.tsx` kit (432 lines: `SectionHeader`, `Panel`, `IconSquare`, `Stat`, `Pill neutral|success|warning|danger|info|accent`, `Bar`, `PAButton`, `FilterSelect`, `ModeToggle`, `EmptyNote`, `SelectableDomainCard`, `FrostedDetailPanel` — `:6-432`).
- **Styling:** Tailwind v4 (`@tailwindcss/vite`, `tailwindcss`, `tw-animate-css` — `package.json:17,34,43`; `src/index.css:1-49+`: Plus Jakarta Sans, sky/VILS gradient, `dark(.dark *)`), `cn()` = `twMerge(clsx())` — `lib/utils.ts:1-6`; collapsing cyan header with scroll hysteresis (`App.tsx:43-71,311-528`).

### 6.2 Pages / components for candidates + assessments

Single-page, 4 tabs (`App.tsx:36-41`):

| Tab | Component | Purpose / file |
|---|---|---|
| Dashboard Overview | `Dashboard.tsx:29-250` | read-only KPIs (active assessments/candidates, invites, reports generated/generating, round split, recent 4); no mutations |
| Candidate Directory | `CandidateManagement.tsx:222-758` | read-only workspace: global + metric-tree filters (round/scale/grade), `handleCheckStatus` (`:265-283`), password update (`:285-303`), regenerate report (`:305-317`), view report; **no creation/link/email here** |
| Assessments & Profiles | `AssessmentsAndAssignments.tsx:199-3883` | list/create/edit/toggle + per-assessment pipeline (CSV/manual import, link gen/regen, reschedule, password, status, bulk/single invites+reminders, simulate completion, expiry toggle, delete, simulator entry, report view) |
| Mail Templates | `MailTemplates.tsx:13-294` | template CRUD + live preview; no sending |
| Modal | `ReportDialog.tsx:510-678` | report viewer + regenerate (`mockGetReport` on open `:525-546`, `mockRegenerateReport` `:548-561`) |
| Simulator | `CandidateWorkspaceSimulator.tsx:28-907` | local candidate-test double (see §3.3) |

Report visuals: `src/components/report/*` (~30 files) — shells (`ReportShell`, `ReportView`, `ReportHeader`, `Header`, `ReportTabs`, `Tabs`), round renderers (`TechnicalReport`, `BasicReport`, `HRReport` + `HR_COMPETENCY_BLOCKS` from `reportConfig.ts:101-107`), visuals (`ScoreGauge`, `GaugeCard`, `ScoreBar`, `MetricCard`, `SkillRadar`, `InteractiveRadarChart`, `ScoreDistribution`, `CommunicationBreakdown`, `CompetencyGrid`, `EvaluationCoverage`, `InsightPanels`, `ProctoringAudit`, `QuestionList`, `QuestionReview`, `TranscriptPanel`, `VideoReview`, `RecruiterDecisionContext`, `Section`, `ShareModal`, `EmptyReportState`, `print/ReportPrintView`).

### 6.3 How frontend calls backend

- **PrimeHire:** same-origin `/api/backend/*` (Pages prod, Express local) — `primehireClient.ts:3-9`; `apiRequest` logs `[API Client]`, parses `detail[]|message|error`, maps auth failures to `.env` guidance, **no retry** — `:39-103`; base fixed server-side (`BACKEND_URL || default` — `server.ts:75`).
- **Mongo/FastAPI:** build-time `VITE_API_URL` (`mongoApi.ts:14-20`); `getJson/sendJson` with `apiErrorMessage` (`:22-59`); reads `fetchAssessments/fetchCandidates` (`:118-127`); writes `createCandidate/createCandidatesBulk/updateCandidate/deleteCandidate/syncCandidateToServer` (best-effort mirror, never throws — `:201-264`); allowlist payload `candidateToPayload` clamping `reportStatus` (`:160-194`); UI surfaces via `toast` + row `mailStatus` + `apiDown` banner.
- **Email:** `POST /api/send-email` via `sendEmailViaApi` (see §3.5).

### 6.4 Reusable components to build on

`primitives.tsx:6-432` (`SectionHeader`, `Panel/Title/Subtitle`, `IconSquare`, `Stat`, `ViewMoreButton`, `Pill`, `Bar`, `PAButton primary|secondary`, `FilterSelect default|on-brand`, `ModeToggle`, `EmptyNote`, `SelectableDomainCard`, `FrostedDetailPanel`) + shadcn `components/ui/*` (`Table`, `Input`, `Textarea`, `Button`, `Dialog`, `Toaster`) + report visuals above + utils (`normalizeReport`, `reportConfig` round tabs/kinds, `reportMetrics` coverage/aggregates/radar, `exportReportPdf` PDF/HTML/print). No stepper, kanban, or generic form-builder found — those would be new.

---

## 7. Background work

### 7.1 Queues / cron / schedulers / workers

**None exists.** No BullMQ/Celery/ARQ/`BackgroundTasks`/node-cron/scheduler/cron/polling (`setInterval(fetch)`) in `backend/` (`requirements.txt:1-9` has no queue lib), `server.ts`, `functions/`, or `src/`. The only `setInterval`/`setTimeout` uses are UI-only: mic meter, question countdown, recording counter, mock eval sequence (`CandidateWorkspaceSimulator.tsx:73-83,139-176,259-267`); scroll `requestAnimationFrame` (`App.tsx:43-71`). Backfill is a synchronous on-call function with no route/schedule (`report_backfill.py:49-121`).

### 7.2 What 15-min interview reminders would need

- Today reminders are **manual bulk/single sends** from the Assessments UI (`AssessmentsAndAssignments.tsx:1022-1302`) — no automation, no persistence of scheduled jobs, no worker.
- To run "15 min before interview" reliably you need new infrastructure (see §10.4). Decisive constraint: **hosting model**.
  - Root Express (`server.ts:199-201`) *can* run as a long-lived process (suitable for in-process scheduler), but the **deployed path is Cloudflare Pages Functions** (`functions/api/*`) which is **serverless/short-lived** — no in-memory cron survives there.
  - FastAPI (`backend/app/main.py:22-35`) can run long-lived under Uvicorn (suitable for APScheduler/Celery beat), but current prod host is Unknown (§1.5) and the backend has no scheduler code.
- Minimum needed: (1) a durable job/schedule store (new Mongo collection, e.g. `reminders`/`jobs` — see §10), (2) a runner that survives the hosting model (either long-lived process + APScheduler/node-cron, or serverless cron trigger + idempotent send + dedupe key), (3) Zepto send moved behind the queue with retries/backoff (today: single `fetch`, no retry), (4) `reminderCount/lastReminderSentAt` already exist for dedupe display but need server-side claim semantics.

---

## 8. Config and environment

### 8.1 All environment variables (names only — values never printed)

**Root (`.env.example:4-26`, tracked template):**

| Name | Purpose | Consumed at |
|---|---|---|
| `BACKEND_URL` | PrimeHire base proxied by Pages Function + Express | `server.ts:75`, `functions/api/backend/[[path]].ts:15-22,98-101` (default `https://api.placement.vils.ai/primehire/api/v1` when unset — `:30`) |
| `PRIMEHIRE_ACCESS_KEY` / `PRIMEHIRE_SECRET_KEY` | server-side upstream creds (never browser) | `server.ts:80-81,101-105`, `functions/api/backend/[[path]].ts:15-22,104-105,137-138` |
| `ALLOWED_ORIGINS` | extra frontend domains for `/api/backend/*` + `/api/send-email` CORS (same-origin always works) | `functions/api/backend/[[path]].ts:42-62`, `functions/api/send-email.ts:28-55`; backend twin in `config.py:25,41-42`, `main.py:40-48` |
| `VITE_API_URL` (commented example) | frontend→FastAPI base for Mongo cutover (Vite build-time) | `src/lib/mongoApi.ts:14-16` |
| `PROXY_ORIGIN` (commented) | optional Origin header on server→PrimeHire | `server.ts:113-115`, `functions/api/backend/[[path]].ts:120-139` |
| `ZEPTOMAIL_API_KEY` | server-side ZeptoMail key for `/api/send-email` (never browser) | `server.ts:24`, `functions/api/send-email.ts:10-13,73` |

**Backend (`backend/.env.example:3-17`, tracked template; read via `backend/app/config.py:12-45`):**

| Name | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string (empty = degraded boot, health `not_configured`) |
| `MONGODB_DATABASE` | DB name (default `primehire`) |
| `PRIMEHIRE_BASE_URL` | PrimeHire base (has working default) |
| `PRIMEHIRE_ACCESS_KEY` / `PRIMEHIRE_SECRET_KEY` | server-side creds; `has_primehire_credentials` gate |
| `ALLOWED_ORIGINS` | CSV → `extra_origins`; gates FastAPI CORS middleware |
| `PROXY_ORIGIN` | defined (`config.py:26`) but **no usage found in backend** — Unknown |
| `MIGRATION_SECRET` | guards `POST /api/migration/import`; empty = disabled |

**Present-but-untracked env files (names only, values not read):** root `.env` (`PRIMEHIRE_ACCESS_KEY`, `PRIMEHIRE_SECRET_KEY`, `ZEPTOMAIL_API_KEY`), root `.env.local` (`VITE_API_URL`), `backend/.env` (`MONGODB_URI`, `MONGODB_DATABASE`, `MIGRATION_SECRET`, `ALLOWED_ORIGINS`). Tracked vs ignored per `.gitignore:7-8` (`.env*` ignored, `!.env.example` exception) — see §9.3.

### 8.2 Where config is read; `.env.example` presence

- Root: `dotenv.config()` in `server.ts:6` + `process.env.*` (`:24,75,80-81,113`); Vite `import.meta.env.VITE_API_URL` in `mongoApi.ts:14-16`; Pages Functions env interface (`[[path]].ts:15-22`, `send-email.ts:10-13`).
- Backend: `pydantic-settings BaseSettings` with `env_file=<backend>/.env`, `extra="ignore"` — `config.py:15`; absolute path regardless of CWD — `:7-9`.
- `.env.example` files: **yes, both** — root `.env.example:1-26` and `backend/.env.example:1-17`. No `.env` values are committed (see §9.3).

---

## 9. Quality and risk review

### 9.1 Test coverage + tooling

- **Backend:** `pytest` + `pytest-asyncio` (`asyncio_mode=auto`) + `mongomock-motor` (no Atlas needed) — `requirements.txt:7-9`, `pytest.ini:1-3`, `tests/conftest.py:1-9` (`AsyncMongoMockClient()["testdb"]`), `README.md:30-34`. **68 test functions across 9 files**: `test_candidates_api` (12: `CAND-` gen, mock quarantine, 409, password rejection, roundtrips, bulk partial, 503, null-pruning, legacy-index drop, DuplicateKey mapping), `test_directory_api` (3), `test_health` (2), `test_migration` (15: dry-run, restartable, conflicts, audit meta, password skip, nested questions), `test_report_backfill` (14: normalization, video refs, UUID, idempotency, malformed×7, not-ready, envelope preservation), `test_reports_api` (7: contract hiding, no-upstream-call assert, 404/400/500), `test_repositories` (5: indexes, roundtrips, password strip), `test_schemas` (5), `test_services` (5: mock markers, UUID genuineness).
- **Frontend/edge:** typecheck only (`lint: tsc --noEmit` — `package.json:11`). No unit/e2e runner, no `*.test.*`/`*.spec.*` found (glob). `scratch/` contains probe scripts + `openapi*.json`/`report-*.json` (dev scratch, not a suite).

### 9.2 Error handling + logging

- **Backend:** `logging.getLogger` in `main.py:19`, `db/mongodb.py:10`, `api/candidates.py:26`, `services/candidate_service.py:16`; startup/ping/health never raise (`main.py:27,34`, `mongodb.py:34-42`, `health.py:17-21`); HTTP mapping `CandidateNotFound→404`, `CandidateConflict→409`, `ValidationError→422`, generic→500 `from None` (`api/candidates.py:48-123`); directory/reports 500s without traceback (`directory.py:38-60`, `reports.py:59-60`); migration/backfill collect per-record outcomes instead of raising (`migration_service.py:222-408`, `report_backfill.py:62-121`); pagination clamp (`directory.py:26-27`).
- **Edge:** Express verbose `console.log` of proxied request/response bodies + timing (`server.ts:118-169`), 401 hint (`:161-167`); Pages relays verbatim + `502 Backend request failed` (`[[path]].ts:151-179`); Zepto paths log dispatch/status/body (`server.ts:31,50-52,60`; `send-email.ts:75,117`).
- **Frontend:** `apiErrorMessage` parsing (`mongoApi.ts:30-47`), auth-guidance throws (`primehireClient.ts:84-96`), `toast.success/warning/error` + row `mailStatus` + `apiDown` banner; `syncCandidateToServer` best-effort never throws (`mongoApi.ts:240-264`).

### 9.3 Security issues noticed (static only)

1. **Zero-auth mutating API surface (highest):** all FastAPI candidate/directory/report endpoints unauthenticated — `backend/app/api/candidates.py`, `directory.py`, `reports.py` (only migration is guarded). Exposed Uvicorn = open read/write. No JWT/session/RBAC anywhere.
2. **No rate limiting / hardening headers:** grep for `express-rate-limit|rateLimit|helmet|csp|csrf` returned nothing across `server.ts`, `functions/`, `backend/`. Report/status polling and email relay are unthrottled (spam/abuse vector via `/api/send-email` if origin allowlist is loose).
3. **CORS posture is allowlist-dependent:** FastAPI `allow_credentials=True` with env allowlist (`main.py:40-48`); Pages `ALLOWED_ORIGINS` or `*` (`[[path]].ts:42-62`); Express has **no** cors package (same-origin only via `:3000` — `server.ts:185-197`). A `*` in `ALLOWED_ORIGINS` + credentialed CORS would be risky.
4. **Unvalidated/unsanitized passthroughs:** `link` URL stored unvalidated; `raw/normalized` accepts arbitrary upstream JSON unbounded; `422 detail=str(exc)` may echo input (`candidates.py:81,104`); CSV parser is naive `split(",")` (quoted-comma breakage) — `AssessmentsAndAssignments.tsx:1442-1494`; `htmlBody` is string-interpolated HTML (XSS depends on caller hygiene — `:926-930`).
5. **Insecure file handling:** N/A — no file upload/storage exists (§3.6), which bounds this risk to CSV parsing.
6. **Injection risk:** low for DB (Motor parameterized dict filters; no string-built queries found). Pydantic `extra=forbid` + allowlisted mappers (`primehireClient.ts:109-178`) reduce over-posting.
7. **Secrets in git:** **none found.** No hardcoded key/token/password literals in `server.ts`, `functions/`, `src/`, `backend/` (scan for `API_KEY|SECRET_KEY = "..."` returned nothing). `.env`, `.env.local`, `backend/.env` are git-ignored via `.gitignore:7` (`.env*`) and absent from tracked files; only `*.example` templates are tracked (`.gitignore:8`). Fixed values in code are non-secret identifiers (default API base, `noreply@nxtagent.ai`, ZeptoMail host). **Do not commit the existing ignored `.env` files.**
8. **Upstream credential forwarding:** caller `Authorization` is forwarded through the proxy (`server.ts:110-112`) — fine for Bearer flows but means any caller token reaches upstream; ensure intended.

### 9.4 Tech debt / fragile areas before extending

- **Split-brain truth:** upstream PrimeHire vs Mongo mirror vs `localStorage` fallback vs in-memory `INITIAL_*` fixtures (`App.tsx:83-202`). Writes are dual-path with best-effort `syncCandidateToServer` (silent `skipped/failed` — `mongoApi.ts:240-264`); conflicts have no resolution UI. Migration never overwrites differing docs (good) but leaves divergence invisible.
- **ID sprawl:** `jobId`/`candidateKey(CAND-)`/`CAND-+32bit`/`int-`/`res-`/UUID/`candidate_id`/`interviewId`/`responseId`/`mongoId`/`_id` with branded casts (`primehireIds.ts:6-70`), self-heal branches, and synthetic `c3a7db8e-…` UUIDs (`mockData.ts:411-615`). Fragile matching (`candidateId|candidate_id|email`) and fabricated fallback links (`primehire-test.com`) must not leak into prod data.
- **No assessment write API in FastAPI** (list-only) — every new hiring entity will need new routes/schemas from scratch.
- **Candidate tied 1:1 to assessment** (`assessmentId` single string, unique-email absent) — multi-application needs schema change (see §10.2).
- **Email is fire-and-forget** (no outbox, no idempotency key, no bounce handling); `mailStatus` is UI-local until synced.
- **Report pipeline is pull-only** (manual status check → generate → fetch); backfill exists but is unreachable (no route/schedule).
- **Simulator is decoupled** from real evaluation — mock grades must never be mistaken for upstream scores.
- **Unused/heavy deps:** `@google/genai`, `jspdf`+`html2canvas`, `motion`/`recharts` widen bundle; `scratch/` + `dist/server.cjs` are committed-adjacent clutter (`dist/` is git-ignored but present on disk).
- **Empty `README.md`**, package name `react-example` (`package.json:2`), display-only "Administrator" label — onboarding/confusion risks.

### 9.5 Conflicts with planned changes

| Planned change | Current-design conflict |
|---|---|
| One candidate → multiple applications to different jobs | **Direct conflict.** `candidates.assessmentId` is a single string (one job per doc); no `(email, assessment)` uniqueness, no `applications`/`jobs` collection. Re-applying today = duplicate candidate doc with new `CAND-` key + divergent `primehire` linkage. Needs new `applications` (or `jobs`) model, not a column tweak. |
| Single `stage_history` table driving a roadmap | **No conflict, greenfield.** No stages/history collection exists (only `syncState.assessmentStatus` string + `submittedDate`). New `stage_history` (or `application_events`) collection + canonical stage enum needed; current free-text `assessmentStatus` must be migrated/constrained. |
| Role-based interviewer portals, admin-configurable visible fields | **Conflict by absence.** No users/roles/permissions, no login, no field-visibility config. Requires new `users`/`roles`/`field_policies` + auth middleware on **every** existing open route + frontend route guards (none exist today). |
| LLM provider adapter | **Partial fit.** `@google/genai` installed but unwired; `report_normalize`/`normalizeReport` are deterministic (no LLM seam). New `backend/app/services/llm/*` adapter + prompt/version store + cost/logging needed; do not bolt onto report normalize. |
| Job queue (reminders, parsing, matching, AI) | **Greenfield + hosting constraint.** No queue/worker/scheduler; deployed path is serverless Pages (no long-lived cron) while Express/Uvicorn could host one. Requires durable job collection + runner choice matched to host (see §10.4); current Zepto/status/report flows assume synchronous manual triggers. |

---

## 10. Integration plan (recommendations only — no code changed)

### 10.1 Where new modules plug in (minimal touch)

- **Backend:** follow existing layering — new Pydantic schemas in `backend/app/schemas/`, repositories in `backend/app/models/`, orchestration in `backend/app/services/`, routers in `backend/app/api/` mounted in `backend/app/main.py:50-54`; indexes in `INDEXES` (`db/mongodb.py:47-86`) so startup + tests share them; config via `config.py:12-45` + `backend/.env.example:1-17`.
  - Suggested: `schemas/{job,application,stage,interviewer,llm,reminder}.py`, `models/{job,application,stage_history,users,field_policy,jobs_outbox}.py`, `services/{matching_service,resume_service,reminder_service,llm_adapter}.py`, `api/{jobs,applications,stages,interviewers,reminders}.py`.
- **Frontend:** new tabs alongside `MODULE_TABS` (`App.tsx:36-41`) reusing `FrostedDetailPanel` + `primitives.tsx` + shadcn `components/ui/*`; new API methods in `mongoApi.ts` (FastAPI) mirroring `fetchAssessments/fetchCandidates` patterns (`:118-127`); keep `id = business key`, `mongoId = ObjectId` discipline (`:3-12`).
- **Edge:** extend `functions/api/backend/[[path]].ts` allowlist + `server.ts:68-182` only for new upstream paths; add `functions/api/cron/*` or backend scheduler (not both) for reminders (see §10.4).
- **Email:** keep `POST /api/send-email` contract; put it behind an outbox + worker instead of calling from UI directly.

### 10.2 Existing tables: new columns vs new tables

- **New columns (safe, additive):** `candidates.phone` normalization, `syncState.*` reminder timestamps (already exist — reuse `inviteSentAt/lastReminderSentAt/reminderCount/mailStatus`), `assessments.startDate/endDate` already present; add `assessments.applicationDeadline`, `candidates.consentAt`, `reports.schemaVersion` bump path.
- **New tables/collections (required):** `jobs` (one row per requisition; today's `assessments.jobId` becomes a posting, not the job), `applications` (`candidateId ↔ jobId`, stage, source, resume ref — this unblocks multi-application without duplicating candidates), `stage_history` (append-only: `applicationId, from, to, actor, at, note` — drives roadmap), `interviews` (schedule, panel, `reminderDueAt`, `reminderSentAt`), `users` + `roles` + `field_policies` (interviewer portals), `resumes`/`attachments` (metadata + object-store key, never binary in Mongo), `jobs_outbox`/`reminders` (durable scheduled sends with idempotency keys), `llm_runs` (provider, model, prompt version, tokens, cost, output ref), `talent_pool` (either tag on `candidates` or separate collection if pool ≠ applicant).
- **Do not** widen `candidates` with `jobId2…` or array-patch `assessmentId` — migrate to `applications` instead. Keep `password` ban (`models/candidate.py:15`).

### 10.3 Reuse vs thin adapters for candidate/assessment APIs

- **Candidates:** reusable **as-is** for single-application mirror (create/bulk/get/update/delete + `syncCandidateToServer`), but wrap in a thin `applications` adapter that (a) resolves/creates the person by email once, (b) creates one `applications` row per job, (c) fans out the existing `POST /interview` + Mongo candidate row per application. Add server-side `(email)` lookup + `(person, job)` dedupe that doesn't exist today.
- **Assessments:** **thin adapter required.** `GET /api/assessments` is reusable for reads; creation must stay on upstream `POST /assessment` via `mapFrontendProfileToBackend` (`primehireClient.ts:109-178`) until/unless a native `POST /api/assessments` is added. Do not expose `assessment_service.create()` directly without adding auth + validation + tests.
- **Reports:** `GET /api/reports/{id}` reusable as cache read; add an adapter that exposes `report_backfill` behind an authenticated `POST /api/reports/backfill/{interview_id}` (today unreachable) with idempotency via `upstreamHash`.

### 10.4 Recommended queue/scheduler fitting current hosting + stack

- If deploy stays **Cloudflare Pages (serverless):** use **serverless cron + Mongo-backed outbox**: new `reminders` collection (`dueAt, sentAt, idempotencyKey, payload`), a Pages Cron Trigger (or external scheduler hitting an authenticated `POST /api/reminders/dispatch-due`) that claims due rows atomically (`findOneAndUpdate sentAt:null, dueAt<=now`) and calls the existing Zepto contract. No in-process scheduler (won't survive). Fits Mongo + zero new infra.
- If FastAPI runs **long-lived (Uvicorn on VPS/container):** use **APScheduler (Mongo job store) or Celery + Redis** for heavier work (resume parse, matching, LLM). APScheduler is the smaller step (no Redis); Celery/Redis only if AI/parse throughput demands it. Backend has neither today — adding APScheduler touches only `main.py` lifespan + one service.
- Either way: move Zepto behind the outbox with **retries + exponential backoff + dedupe on `(interviewId, kind, dueAt)`** reusing existing `reminderCount/lastReminderSentAt` as display, not as lock. Decide host first — it determines the runner.

### 10.5 Recommended order of work

1. **Close auth + data-model foundations first:** add `users/roles` + auth middleware on all open FastAPI routes; create `jobs` + `applications` + `stage_history` collections + indexes; backfill/migrate `assessmentId → applications` (keep old field read-compatible).
2. **Durable communications:** `reminders/outbox` collection + dispatch endpoint + runner (per §10.4) + 15-min interview reminder on `interviews.reminderDueAt`; move invite/reminder sends off the UI thread.
3. **Interviewer portals:** `field_policies` + role-scoped read APIs reusing `directory`/`reports` contracts; frontend route guards (new — none exist).
4. **Talent pool + resume parse/store:** `resumes` metadata + object store (S3/R2 — none exists today) + parse worker; link to `applications`, not to `candidates` directly.
5. **Matching + AI:** `llm_runs` + provider adapter (`backend/app/services/llm/`) behind the queue; matching as batch job over `applications × jobs`, not inline in UI.
6. **Cut over writes fully to FastAPI** (today reads are cut over, writes are dual/best-effort) and retire `localStorage`/`INITIAL_*` fallbacks last, after parity + tests.

### 10.6 Open questions for you (needed before building)

1. **Host of record:** does production run on Cloudflare Pages + where does FastAPI run (VPS/Render/AWS/Atlas App Services)? This decides scheduler/queue (§10.4).
2. **Upstream authority:** is PrimeHire v1 (`api.placement.vils.ai`) still the system of record for assessments/interviews/reports, or will Mongo become it? Who wins on conflict?
3. **Candidate identity:** is `email` the dedupe key for "one candidate, many applications", or do you need phone/UUID merge rules? Any GDPR/retention constraints?
4. **Stages:** what is the canonical stage list for `stage_history` (applied → assessment → interview → offer → hired/rejected + talent-pool?), and who may transition each?
5. **Interviewer roles:** which roles exist (admin/recruiter/interviewer/hiring-manager/candidate?) and which fields must be hideable per role?
6. **Reminders:** besides 15-min interview nudges, which sequences (invite → reminder → expiry → result) and quiet hours/timezone (IST assumed from `mockData.ts:825-904` — confirm)?
7. **Resumes:** allowed types/size caps, storage choice (S3/R2/local — none today), parse provider + PII redaction needs?
8. **LLM:** which provider/model, budget/latency limits, and must AI outputs be human-approved before sending?
9. **Email:** is `noreply@nxtagent.ai` staying the from-address, and do you need open/click/bounce tracking (Zepto webhooks today: none)?
10. **Auth:** SSO/OAuth vs email+password + session/JWT expectations for the new portals, and session lifetime?

---

## Appendix — evidence index (where to look first)

- Stack/scripts: `package.json:6-47`, `backend/requirements.txt:1-9`, `tsconfig.json:1-26`, `vite.config.ts:1-22`, `components.json:1-21`
- Run/build: `server.ts:185-201`, `backend/README.md:5-34`, `.env.example:1-26`, `backend/.env.example:1-17`
- DB: `backend/app/db/mongodb.py:15-110`, `backend/app/config.py:12-45`, `backend/app/models/*.py`, `backend/app/schemas/*.py`
- Features: `src/components/AssessmentsAndAssignments.tsx:550-1663` (create/intake), `src/mockData.ts:461-1054` (links/status/reports), `src/lib/primehireClient.ts:109-355`, `src/lib/mongoApi.ts:1-264`, `ReportDialog.tsx:150-678`, `CandidateWorkspaceSimulator.tsx:28-907`
- Email: `server.ts:21-63`, `functions/api/send-email.ts:1-120`, `AssessmentsAndAssignments.tsx:925-1302`, `mockData.ts:13-73`, `MailTemplates.tsx:13-294`
- Auth: `backend/app/api/migration.py:20-25`, `backend/app/services/primehire_service.py:16-26`, `App.tsx:359-366`, `primehireIds.ts:45-70`
- Frontend shell: `src/App.tsx:36-202`, `src/types.ts:8-86`, `src/components/ui/primitives.tsx:1-432`, `src/utils/*`, `src/components/report/*`
- Quality: `backend/tests/*.py` (68 fns), `backend/pytest.ini:1-3`, `.gitignore:1-13`, `INTEGRATION_NOTES.md:1-61`, `metadata.json:1-6`
