# Leadership hiring intelligence

Leadership is a separate read-only role, invited through **Team & Access → Invite
user → Leadership (Hiring Intelligence)**. It uses the existing password invitation,
Google sign-in and session security. After sign-in it opens its own dashboard at
the app root; changing the URL cannot grant access to admin modules. No separate
identity provider or paid service is added. Admin/Super Admin can inspect the API;
the dedicated UI is the leadership account's workspace, including View As.

The server grants `leadership.view` only to leadership and administrators. No
candidate directory, operational jobs/resume permissions, raw reviews, assessment
links/passwords, contacts or salary data are returned. Every query is scoped to
the authenticated organisation. Job selection is validated against that scope.

## Numbers and time

- Current role health: open roles/seats, resumes, ATS processing, links generated
  and sent, completed assessments, current technical/managerial/HR occupancy,
  offers, hires and holds. Intake-derived profiles are not counted twice.
- Daily IST trends for the selected 7/30/90/180 calendar days, including today.
  Role inventory and current pipeline counts remain a snapshot, independent of
  activity-period selection. Daily completions prefer the provider submission
  timestamp, then the first completion transition, then the stored completion date.
- Invitation → assessment start uses recorded delivery or ASSESSMENT_SENT history
  and a provider start timestamp. Link creation is not delivery. Completed
  assessments without start timestamps have no measured response duration.
- Assessment completion → technical booking uses its completion transition.
  Technical/managerial approval → next managerial/HR booking uses an applied
  `advance` review and the first non-cancelled booking created after that review.
  Repeated reviews use the most recent approval; cancelled bookings do not close
  the queue. Review-to-booking measures administrative response, not waiting until
  the scheduled interview begins. These are elapsed hours, including weekends.
- Median and interpolated p90 use valid nonnegative completed intervals whose
  origin is in the selected period. The UI discloses eligible and measured counts.
  Waiting queues include older active applications; 48h is an attention threshold,
  not a contractual SLA. Missing historical timestamps are never backfilled with
  the current time or treated as zero. Unknown stage age is displayed separately.
- Existing assessment sync now retains provider start time even if its first poll
  observes completion, and preserves the first observed submission time rather
  than moving that timestamp on every poll. Future submission timestamps carry
  provider/observed provenance; legacy timestamps are not rewritten.

Charts offer stage/role drilldown, timing distributions, an age heatmap, a daily
data table and a sortable, paginated role table. Refresh is explicit; there is no
rapid polling and no write operation from this workspace.

## Limits and operations

No new environment settings, tables, persisted fields required by validation, or
indexes are introduced; existing role strings accept the new enum value. Existing
accounts are unchanged and no migration/backfill is needed. Optional assessment
timestamp provenance is backward compatible. Existing org/job/application indexes
and native PostgreSQL aggregation support are used.

Reads are bounded to 500 latest roles, 20,000 applications/intake events and 60,000
history/interview/review events. Database snapshot counts are independent of timing
sample caps. If any cap is exceeded, the UI explicitly warns that portfolio/charts
are partial and asks for a role filter. This initial module does not claim unlimited
warehouse scale or an atomic multi-collection snapshot. Archived jobs remain in
portfolio history, with no open seats counted for them.

Validation: tenant isolation, exact time cohorts/negative and missing intervals,
repeated approval/cancelled booking semantics, read-only role permissions, user
invitations, timestamp retention, chart interactions, empty/error states, responsive
desktop/mobile rendering, typecheck, lint and production build.

Local verification on 9 November 2026: 2,037 backend tests passed (27 optional
tests skipped), 81.49% overall coverage; focused leadership coverage 99.40%.
The full frontend suite passed 320 tests, followed by the additional leadership
invitation test and affected dashboard checks. A disposable PostgreSQL schema
verified the analytics queries. Browser checks used a temporary leadership
identity against the isolated validation database at 1440, 768 and 390px, with
no page overflow, unexpected API failures or write requests; the identity was
removed afterward. No production users or public deployment were changed.

On 10 November 2026 the redesigned overview, role portfolio and handoff views
went live at elitehr.vils.ai. Pages deployment `227bc9b4` uses E2E release
`20261110-leadership-01`. The live stage counts reconciled to 32 applications
across five roles during verification. A temporary account in an isolated
tenant verified public password login and leadership permissions through the
production gateway. Local password login was verified in a browser after
restoring the private database tunnel.
