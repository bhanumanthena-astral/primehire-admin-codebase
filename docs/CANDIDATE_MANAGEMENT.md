# Module 4 — Candidate Management

Scope: the Candidate Management document supplied on 22 October 2026. This adds
the eight documented submodules in **Candidates**, around the existing person,
application and published-assessment records. Resume/ATS, assessment creation,
recruitment stages, interviews and automated invitation delivery are not changed.

## Confirmed decisions

- The user selected the Edit section limits: headline **250** characters and
  summary **5,000** characters. Detail views display the complete saved values.
- The user approved existing provider login, one reusable link per assignment,
  access expiring at End Date and manual sharing without automatic email.
- Scheduling uses date/time values, stored in UTC and displayed/entered in
  **Asia/Kolkata (IST)**, matching the existing portal. Past entry times and
  non-positive windows are rejected server-side as well as in the UI.
- Existing normalized-email/phone matching remains the duplicate rule. A phone-only
  person can stay phone-only; an existing required email cannot be removed.
- A candidate with applications must have the correct application selected for
  each assignment. Candidates without an application can have a standalone
  assignment. A configured job-specific assessment mapping must be respected.
- Only accessible published, active assessments with an available window can be
  assigned. Repeat assignments of the same assessment to the same candidate are
  not enabled. Concurrent duplicates are blocked by a unique database index.
- Dates are editable before link generation. They lock afterwards because this
  integration has no verified provider contract for changing that same link's
  window. No new attempt or automatic replacement link is invented.

## Document acceptance mapping

| Submodule | Implemented behavior |
| --- | --- |
| Candidates List | Name/ID, masked contacts, designation, experience, location, associated jobs, date, assessment states; server search/filter/pagination, clear filters and empty/error/loading states |
| View Candidate Details | Stored profile, skills, headline/summary, structured and existing free-text education, separate paginated applications and assignments, authorized original-resume download, unavailable-value and not-found states |
| Edit Candidate Details | Prepopulated form, read-only ID, documented character/range limits, Unicode names, contact normalization, tag deduplication, education validation, field-level errors, cancel and preserved failed form values |
| Assessment Assignment | Existing candidate/assessment checks, application ownership checks, separate assignment relationship and explicit review/confirmation before saving |
| Assignment Enhancements | Candidate and assessment context, language/round/question count/window, distinct configure/generate/copy actions and assignment states in candidate details and the assessment detail view |
| Start Date and End Date | Future start, later end, timezone-aware server validation, parent-assessment window checks, revision-safe edits and visible IST windows |
| Generate Assessment Link | Explicit human action, one provider POST, encrypted stored URL, stable signed invite URL, idempotent reuse, visible failure and safe retry after definite rejection |
| Invite Link | Authorized display/copy, manual sharing, before-start/expired/revoked/unavailable checks and no automatic email |

The existing person identifier is `applicants.applicantId`; it is shown as the
Candidate ID. An assessment assignment has its own `ASGN-…` identifier, assessment
ID and optional application/job IDs. A legacy per-assessment `candidates` document
is not silently adopted as another person. No browser demo/cache records are
imported, no candidate ID is rotated, and no V1 record is copied or changed.

Original resumes continue to use the existing intake storage and scanning policy.
This module does not add a new upload path or accept an arbitrary file reference.
Missing, unscanned or unauthorized originals return a clear unavailable response.
Existing optional institution values are permitted, consistent with intake;
each provided institution is validated. Graduation years use 1900 through the
current IST year plus 10, as specified in the supplied document.

## Permissions and consistency

- Super Admin/Admin see their organization; Recruiter/HR/read-only users see
  candidates associated with accessible assigned jobs, their own records or
  explicit shares. Every detail/action rechecks organization and object scope.
- Recruiter/HR writes require the existing configured create/edit access;
  read-only and impersonation sessions cannot edit, assign, generate or reveal.
  Technical and Managerial interviewers keep their existing separate portals.
- Contacts are masked by the central server projection. Editing/reveal requires
  a distinct authorized, audited request. Invite links are omitted for read-only
  users. Profile and link responses use `Cache-Control: no-store`.
- Candidate edits use contact/person leases, a revision and the last update time
  so another candidate workflow's update cannot be silently overwritten. Profile
  edits merge documented fields without dropping other stored intake information.
- Current account status/role and current job access are checked, including after
  permissions change. Audit entries record actor, IDs, action, fields and revision,
  without storing contact values or provider passwords in the audit details.
- Lists, job/assessment selectors and related-record sections are paginated;
  workspace joins have a 5,000-key cap and ask for narrower filters beyond it.
  The API caps candidate JSON envelopes at 128 KB.

## Invite security and provider boundary

Invite tokens contain a random assignment ID and a purpose-specific HMAC. No
candidate name/email/phone appears in the invite URL. The token is in the URL
fragment, then submitted in a POST body, keeping it out of normal request paths
and referrers. It is a candidate assessment credential, never an HR portal login.

The candidate gateway verifies the signature, saved assignment, availability
window, current candidate existence and assessment availability before returning
the provider destination. The provider then performs its existing candidate
login and assessment access checks. Provider URLs are encrypted with a purpose
marker using `OUTBOX_ENCRYPTION_KEY`, falling back to the existing
`RECRUITMENT_OUTBOX_ENCRYPTION_KEY`; neither key nor existing email configuration
is rewritten. Provider passwords may be shown to the authorized recruiter once
in the generation response; they are never persisted or emailed by Module 4.

Reloading/reopening an assignment reuses its invite link. There is no regeneration
action. JWT signing-secret rotation invalidates previously shared gateway tokens;
the current authorized assignment view renders the token for the current key.
Preserve the configured URL-encryption key to retain access to stored destinations.

Definite provider rejection preserves the assignment and permits retry. Timeouts,
409/server errors, malformed success, mismatched candidate identity and interrupted
generation require provider reconciliation before another mutating request. This
prevents a retry from silently creating another interview or rotating credentials.

## Activation and safety

Migration `010_candidate_management_v2` adds only the new assignment indexes and
an applicant listing index. Startup applies it only to `primehire_admin_v2`;
dry-run is available and writes against another database are refused. It performs
no record backfill or existing candidate/application/assessment rewrite.

```powershell
.\backend\.venv-v2\Scripts\python.exe scripts/candidate_management_preflight.py --verify
npx playwright test --config playwright.candidate.config.ts
```

The ignored Module 4 V1 baseline and verification logs live in `backend/runtime`.
A baseline count comparison is a safety check, not a complete content checksum.
Do not overwrite a baseline to hide a mismatch; investigate concurrent activity.

## Verification and limits

Acceptance uses synthetic in-memory MongoDB fixtures and a fake assessment
provider. It never publishes a live assessment, creates a live assignment, sends
an invitation or uses an LLM. Browser coverage includes listing/search/pagination,
Unicode profile edits, preserved invalid saves, assignment review/confirmation,
date editing, separate link generation, blocked early access, mobile layout and
read-only access. API tests include organization/object isolation, field limits,
duplicates, concurrent assignment, account changes, stale edits from another
workflow, provider response parsing, encryption purpose, reuse and expiry/revocation.

Real provider login/completion and provider-side expiry after direct navigation
remain external acceptance checks; the local gateway checks are verified here.
No new reschedule, regeneration, repeat-attempt, bulk invitation, candidate upload,
automatic email or 1,000-user capacity claim is included in this document scope.
The existing large bundle warning and a dedicated production load/security review
remain separate follow-ups. The local gitleaks executable was unavailable.

### Recorded acceptance results

- Full backend regression: **1,666 passed**, **82.72%** coverage (80% gate).
  The subsequent Candidate Management/current-account authorization regression,
  including the final cross-workflow edit conflict test: **1,035 passed**.
- UI regression: **147 passed** across 26 files, followed by the focused final
  profile form checks (**5 passed**). TypeScript, lint and production build passed.
- Final browser acceptance: **3 passed** against the isolated in-memory fixture.
  Mobile screenshots were inspected; a 390px profile viewport did not overflow.
- Live migration 010 applied in V2. V1 pre/post counts matched, V2 API readiness
  and the frontend returned HTTP 200. Only startup/index activation and read-only
  checks ran live; no real candidate profile or assignment was created/edited.

### Existing dependency audit findings outside this document change

No dependency manifest, lockfile or installed package version was changed by
Module 4. The audit nevertheless reports existing advisories in the installed
versions: Vite 6.4.3 (including high-severity GHSA-587h-7wmj-h5pm), certifi
2026.7.22 (PYSEC-2026-4320), and pypdf 6.20.1 (CVE-2026-113786). These are
recorded for a separate dependency security update rather than silently changing
the existing development server, TLS trust bundle or resume parser in this
Candidate Management request. The audit is **not** claimed clean. Sanitized audit
results are in the ignored `backend/runtime/candidate-management-*-audit.json`.
