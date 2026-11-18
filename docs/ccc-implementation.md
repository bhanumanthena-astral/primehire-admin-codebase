# CCC local implementation — 2026-11-17

All ten requested features implemented locally; no deployment or real candidate messages.

| Feature | Changes |
| --- | --- |
| Source | Per-application persistence, manual/bulk source, filters, Unknown fallback. |
| Rejection | Organization templates/default, preview, encrypted durable intent/outbox, deduplication, status/retry and audit. Missing default blocks rejection. |
| Positions | Confirmed HIRED identities, serialized updates, normal capacity checks, cancellation refresh. |
| Duplicates | Normalized email/phone, explicit reasons/prior jobs, safe linking, audited keep/dismiss. |
| ATS | Actual scoring dimensions, HR labels, sorting and saved preferences. |
| Resume | Recruiter denial across four original-download routes and suppression of original references/raw intake text; authorized roles preserved. |
| Sharing | Finalized reports/reviews, copy/link, authorized recipient, preview/send, durable company/Gmail queue, status/retry and HR handoff. |
| Traits | Job/round configurations, ordering/descriptions, maximum six active, revisions and historical snapshots. |
| Reminders | Separate candidate/company templates, per-recipient jobs, disabled and 15/30/60/1440-minute options, restored rescheduling choices; Calendar attendee/timezone integration. |
| Terminology | Central HR-friendly labels with Super Admin bypass. |

## Files, migration and integration

Backend: app/api/hiring_workflow.py exposes /api/hiring-workflow settings, traits, source, duplicate review, sharing, recipient, status/retry and integration status routes. Shared services are app/services/hiring_workflow.py, gmail_send.py and security/resume_access.py. Existing recruitment worker, transitions, intake, candidate and Google integrations are extended.

Additive migration: backend/migrations/hiring_workflow_v1.py, registered in V2 startup. Adds indexes, normalizes legacy identity keys and repairs position counts with an idempotent marker. Actual local runtime restart is still required to load routes/migration; no manual production migration run.

Frontend: HiringTemplateSettings, RejectionPreview, TraitManager, ShareReports, ApplicationEmailStatus and IntakeIdentityReview integrated into existing screens. Shared API/types and labels in frontend/src/lib/hiringWorkflow.ts and hrTerminology.ts. Existing navigation retained.

## Verification

- 150 selected non-Google backend regression tests passed.
- After final transition locking change: 18 workflow tests passed; additional concurrent-rejection test passed, proving one queued message.
- Earlier isolated real PostgreSQL run: 15 workflow tests passed. Later refinements were verified using synthetic in-memory data.
- 47 affected frontend tests across 12 files passed, including admin/company regressions and the corrected column assertion.
- Typecheck and production build passed; existing large-chunk build warning remains.
- Earlier full frontend run: 372 passed, one column assertion failed. That assertion was corrected and passed in the affected suite; full suite not repeated.
- Synthetic browser: persisted template, report preview/queue with dry-run status, interview scheduling with selected reminder templates, 390px report view without horizontal overflow.
- Super Admin: affected admin/company tests passed; terminology bypass and navigation retained. Not exhaustive manual verification of every Super Admin page.

## Limits

User explicitly waived live Gmail/Calendar verification. No stored Google connections were found. Provider paths used mocks; browser email used dry-run. Real company email delivery also unverified. Appropriate OAuth scopes, approved organization templates and live provider configuration remain necessary.

No real candidate records changed by fixtures, real emails/events sent, production deployment, commit or push. Existing unrelated changes preserved.


## Portal-owned traits update — 2026-11-18
Assigned Technical, Managerial and HR reviewers can now add/edit their own trait set from Interview > Manage Traits. Sets are isolated by company, job, round and assigned reviewer, falling back to job defaults until customized. Admin/recruitment managers can view/manage authorized interviews. Submitted reviews retain immutable trait snapshots, and authorized later-round reviewers see those names and ratings in previous reviews. Read-only users see Round Traits without edit controls; closed interviews reject updates. Existing six-active-trait limit and revision conflict checks remain.

Verified: 23 backend workflow tests passed, including all three portal roles, tenant/unassigned access denial, reviewer isolation, stale revision, closed interview protection and handoff of names/ratings to the next reviewer. Six frontend workflow tests passed, including portal-route and read-only coverage; TypeScript check passed. No new migration is required; existing hiring_traits storage is reused. Restart backend to expose the new interview-traits route.
