# Module 3: Assessment Management

Scope authorized 19 October 2026: add the supplied CSV, listing, details and edit
requirements around the current question form and preview/confirmation sequence.
The user explicitly approved editable drafts with published questions locked,
because the available PrimeHire contract only verifies POST /assessment.

Implementation rules:

- V2 only (`primehire_admin_v2`); no V1 record adoption/backfill or CRUD rewrite.
- One CSV row per question, grouped by Assessment Group ID. A bad question or
  inconsistent assessment header rejects that entire group. Other valid groups
  may import after explicit confirmation. Imports create drafts, never publish.
- Optional Job Title (fallback: first JD line), Option A–D and Correct Answer
  extend the documented columns to match the existing form's MCQ requirements.
- English/Dutch; BASIC/TECHNICAL/HR; SPEAK_TO_ANSWER/MCQ. Positive duration,
  positive scored-round max score, 0–100 weights totaling 100 for BASIC/TECHNICAL.
  HR scores/weights are never sent upstream, preserving the existing contract.
- CSV dates are YYYY-MM-DD at midnight IST; manual date/time windows are explicit
  IST. Stored UTC instants are displayed in IST.
- Draft edits use revision checks and server validation. Published/uncertain
  records are immutable. Unknown publish outcomes are not blindly retried.
- Human preview and confirmation precede publication through the same upstream
  create contract. No automatic invitations, candidate creation or scoring.
- Assessment ID is immutable. CSV group identity is deterministic per organization;
  repeated import reports duplicates and never silently overwrites a draft.
- Admins see organization records; recruiters/HR see owned or explicitly shared
  records, subject to existing access restrictions. Read-only users cannot write.
- Additive metadata/index migration only; no new environment variable or service.
- The V2 launcher reuses the existing form server's BACKEND_URL and PrimeHire
  credential variables in memory for publication only. Backend/V1 credentials
  and secret files are not changed. Direct API deployments may use the existing
  backend PrimeHire configuration instead; no new credential names are needed.

## Acceptance and activation — 19 October 2026

| Document area | Implemented behavior | Verification |
| --- | --- | --- |
| Grouped CSV creation | Template, row/field errors, complete-group validation, ordered preview, explicit confirmation, partial-success summary and duplicate protection | Backend integration and browser import/reimport journey |
| All assessments | Scoped table, search, language/round/status/date filters, pagination, clear filters, loading/error/empty states | API permissions/filter tests and browser pagination/read-only journey |
| Assessment details | Full ordered questions, options, references, scoring, windows and available actor metadata | Browser published/draft details and API isolation tests |
| Editing | Existing form, editable drafts, revision conflicts, preserved failed saves, preview/confirmation, locked published questions | UI tests, browser create/edit/publish journey and Dutch BASIC rubric regression |

These four areas are implemented for the approved draft/published distinction.
This is functional completion, not a production capacity or availability claim.
Open **Assessments & Profiles** to use the module. CSV imports create drafts;
publication requires a separate human preview and confirmation.

Verification:

- TypeScript typecheck and production build passed. The build retains the existing
  large-chunk warning; bundle optimization is separate work.
- UI regression suite: 25 files / 143 tests passed. A first fork-worker run had a
  worker startup timeout; the complete single-thread-worker rerun passed.
- Browser acceptance: all four journeys passed, including mobile details and
  read-only access. Synthetic data and a fake provider were used.
- New module boundary/integration tests: 35 passed. Updated authorization matrix
  and organization/owner checks passed.
- Full backend run: 1,515 passed, one existing 100-resume flaky-provider stress
  test failed (98 applications rather than 100). That exact test passed when
  rerun alone. Total measured backend coverage: 82.31%, above the 80% gate.
  Resume/ATS implementation was not changed to make the rerun pass.
- npm dependency audit: zero reported vulnerabilities.
- Python audit of the exact installed V2 package versions: no known
  vulnerabilities found. The existing auditor in `backend/.venv` was used;
  application dependencies were not changed or installed for this check.
- Live frontend and V2 API readiness returned HTTP 200. Migration
  `009_assessment_management_v2` is applied; the pre/post read-only V1 counts
  for users, jobs, applicants, applications, resume_files, assessments and
  candidates matched. Counts are a safety check, not a full content comparison.

The initial Atlas TLS failure cleared during verification. A subsequent transient
DNS timeout interrupted one startup; retrying the same V2 launcher succeeded
without changing TLS validation, Atlas settings, credentials or the database URI.
No live assessment was published and no invitation was sent during verification.

## Risks and follow-ups

- A real provider publication remains unverified in this session. Provider timeout,
  malformed success, 409 or server-error outcomes lock the draft as uncertain;
  reconcile with the provider before enabling any retry. Published question edits
  require a separately verified upstream update contract.
- Historical records without the new configuration expose only verified metadata;
  missing fields are shown as unavailable. No V1/historical backfill was applied.
- CSV is UTF-8, at most 2 MB, 1,000 question rows and 100 assessment groups. The
  optional MCQ columns extend the supplied document to represent the form's
  existing MCQ data without dropping options or correct answers.
- A dedicated 1,000-user concurrent load test and independent security review are
  outside this document acceptance run. Gitleaks was not installed locally, so
  its dedicated scan was unavailable.

To recheck the live safety baseline without modifying records:

```powershell
.\backend\.venv-v2\Scripts\python.exe scripts/assessment_management_preflight.py --verify
```

The ignored baseline and verification logs are in `backend/runtime/`. Do not
overwrite the baseline to silence a mismatch; investigate concurrent activity.

## Verified provider contract correction — 26 October 2026

The outgoing MCQ payload uses options shaped as `{id: "A", data: "..."}` and `correct_option_id` referencing the selected option ID. Sending MCQ `answer` caused PrimeHire HTTP 400 ("Some attributes are missing in request body"). BASIC spoken questions send `criteria`; TECHNICAL/HR spoken references retain the existing `answer` mapping. Whole-valued scores/weights are emitted as JSON integers. Local draft metadata is never included in the provider request.

The previously rejected draft JOB-DDEE9A0E was successfully published using this correction, retaining its existing ID. Publication errors persist a sanitized provider reason, excluding echoed request inputs and credentials. Tests cover the supplied BASIC/MCQ example, technical answer-option mapping, preserved drafts and publication state handling.
