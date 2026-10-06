# Jobs Module — PRD Traceability

Authoritative status of every Jobs / Job Requisition Management requirement
against the approved spec. Format: `Requirement → implementation → test`.
Status legend: ✓ implemented/verified, ⚠ partial, ✗ gap, N/A.

| # | Requirement (PRD summary) | Code reference | Test | Status |
|---|---|---|---|---|
| 1 | Create Job — mandatory fields Company, Role, Title, Dept, Experience, Positions, Keywords, Dates, Assignee, JD | `backend/app/api/hiring.py` `create_job`, `schemas/hiring.py JobCreate` | `test_hiring_api.py`, `test_job_rules.py` | ✓ |
| 2 | Field validation matrix (JD 50–10,000, positions 1–1000, experience 0–50 whole months, charsets, keywords ≤20, department list) | `backend/app/jobs/rules.py`, `schemas/hiring.py` | `test_job_rules.py` | ✓ |
| 3 | Job ID system-generated, unique, immutable, never reused | `models/hiring.py`, POST /api/jobs | `test_hiring_api.py::test_update_excludes_immutable_fields` | ✓ |
| 4 | Jobs List — columns, pagination (20/page), search (ID/title/role/company/assignee), filters (status/company/dept/assignee/workMode/experience/dates), sort allowlisted | `hiring.py list_jobs`, `models/hiring.py` repo | jobsList vitest + test_hiring_api | ✓ |
| 5 | Job Details — full field view, formatted JD render, application count parity | `GET /jobs/{id}/detail`, JobDetailsPage | jobDetails vitest | ✓ |
| 6 | Lifecycle DRAFT/OPEN/ON_HOLD/CLOSED/ARCHIVED with defined transitions | `close_job`, `reopen_job`, `archive_job`, close/reopen endpoints | `test_hiring_api.py`, lifecycle vitest | ✓ |
| 7 | Manual Close — applications blocked, audit, confirmation copy in UI | `close_job` hiring.py:637, JobLifecycle.tsx | `test_hiring_api`, `test_job_edge_cases` | ✓ |
| 8 | Automatic Close — org-timezone boundary via worker sweep, actor `system:auto-close`, idempotent, assignee outbox notification | `services/auto_close.py`, `services/worker.py`, org tz from `OrgSettings.timezone` | `test_auto_close_worker.py`, `test_org_timezone.py` | ✓ |
| 9 | Reopen — future closing date required, CLOSED-only, backend authoritative | `POST /jobs/{id}/reopen` | test_hiring_api | ✓ |
| 10 | Archive — hides from active lists, no edits, history preserved | `POST /jobs/{id}/archive` | test_hiring_api, edge cases | ✓ |
| 11 | Delete — blocked when applications exist (409), allowed otherwise | `delete_job` hiring.py:870 | test_hiring_api | ✓ |
| 12 | Assignee — active-only selection, email snapshot, reassignment, deactivated-owner preserved | `_resolve_assignee`, `assign_job` | test_hiring_api, assignees vitest, edge cases | ✓ |
| 13 | Assignment notifications — outbox → worker → Zepto, dedupe, dry-run respected | `services/email_send.queue_job_assignment`, `models/outbox.py` | test_job_notifications | ✓ |
| 14 | Audit trail — create/update/assign/close/reopen/archive/delete/auto-close, old/new values, actor, system actor | `AuditLogRepository`, `test_job_audit.py` | test_job_audit | ✓ |
| 15 | Applications per job — counts consistent with list/detail, closed/archived block new applications | `POST /applications`, `services/pipeline.py` lifecycle guard | test_job_edge_cases | ✓ |
| 16 | RBAC — 5 roles × all Jobs endpoints; interviewers denied; cross-org isolation | `require_permission` on every route, matrix tests | test_authz_matrix.py | ✓ |
| 17 | Edge cases — duplicates advisory, unsaved changes, idempotency keys, stale edit guard (server-authoritative response), JD upload failures | `CreateJobForm`, `hiringApi` error classification | test_job_edge_cases, createJob vitest | ✓ |
| 18 | Error classification — network vs 401/403/404/409/422/500 | `hiringApi.hiringFetch` + `apiErrorMessage` | `hiringApi.test.ts` | ✓ |
| 19 | Concurrent editing — server response authoritative (no silent overwrite of newer local state); no optimistic-locking protocol by design | `JobRepository.update`, JobsPage resync on server error | test_job_edge_cases | ✓ |
| 20 | Org data isolation — all queries orgId-scoped from token | every repo query | test_org_isolation | ✓ |
| 21 | JD upload/parse — template, sanitization, magic-byte validation, 50–10,000 on plain text | `services/jd_template.py`, `services/jd_validate.py`, `jd_document.py` | test_jd_template, test_jd_validation, test_jd_document | ✓ |
| 22 | Rules endpoint for frontend parity | `GET /api/jobs/rules` → `rules.public_rules()` | test_job_rules | ✓ |
| 23 | Legacy grandfathering — edit validates only changed fields; `jobs audit-rules` reports legacy violations | `schemas/hiring.py JobUpdate`, `app/cli.py _audit_rules` | test_job_rules::test_edit_only_validates_changed_fields | ✓ |
| 24 | U1 bulk upload / ZIP; L1 429 handling; Phase 7 AI verification; P1/P2 pipeline config | — | — | ✗ open (next PRD slices) |

Edge-case table (spec §13) coverage maps to rows 17–20 plus:
mandatory-empty (#1/#2), experience range (#2), positions decimal (#2),
duplicate keyword merge/dedupe (#2), closing-before-opening (#2), invalid
assignee (#12), inactive assignee (#12), duplicate job advisory (#17),
invalid job id 404 (row 4), no jobs / no results empty states (#4),
closed-job reopen (#9), archived job (#10), deactivated assignee (#12),
concurrent editing (#19), duplicate submission (client guard + 409 jobKey
unique), network failure (#18), session expiry (authRefresh in authFetch),
long JD (#2), JD template failures (#21), unauthorized access (#16),
automatic closure (#8), application-count consistency (#15), data isolation
(#20), error quality (#18).

Outstanding (not Jobs-PRD scope regressions):
- U1 bulk upload with ZIP archive (see `test_jd_template`/U1 notes; no
  `scripts/make_synthetic_resumes.py`).
- L1 LLM 429 resilience (LLM Tier-1 hardening tests showed flakiness under
  full-suite ordering).
- Org-level validation overrides (currently constants, not per-org settings).
- Org timezone display conversion for `closesAt` on the UI.
