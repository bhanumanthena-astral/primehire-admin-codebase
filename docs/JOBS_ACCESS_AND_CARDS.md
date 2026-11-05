# V2 Jobs cards, status and access controls

Implemented for the 13 October 2026 request and supplied screenshots.

## Jobs experience

- Responsive cards replace the wide table for administrators and assignees.
- Each card shows company, title, role, location/work mode, experience,
  remaining positions, applications, assignee, closing date and job ID.
- Search, matching modes, filters, server pagination and sorting are retained.
  Secondary filters collapse into More filters. Candidate report filters are
  hidden on Jobs. Refresh jobs also refreshes the current user's access.
- Administrators can view, edit, assign and adjust assignee access from a card.
  Job details retain deletion and full activity/history controls.
- The Job status selector is available on cards and job details. Confirmation
  is required; closed jobs reopen through the existing future-closing-date form.

## Status rules

| State | Assignee actions | Administrator controls |
|---|---|---|
| Draft | Summary card; waiting for publication | Publish, close, archive, edit/assign |
| Open | View; upload/edit when granted | Hold, close, archive, edit/assign |
| On hold | Summary card; uploads/editing unavailable | Resume, close, archive, edit/assign |
| Closed | Summary card; uploads/editing unavailable | Reopen, archive, limited edits |
| Archived | Summary card; read-only | Read history; no further lifecycle changes |

Only administrators change lifecycle, assignments, deletion and manual closure
sweeps. Trusted background workers still perform automatic closure. A staff
account with Create jobs can create drafts; it cannot directly publish through
the API. Resume intake also checks closing dates and remaining positions.

## Account and assignment access

Team & Access → Invite Member now includes View assigned jobs, Upload resumes,
Edit job details and Create jobs. New HR/recruiter invitations from the UI
default to View + Upload. Existing accounts can be adjusted with their Access
button. Administrator accounts retain full rights; interviewer roles continue
to use their dedicated role boundary.

The assignee-access shield on a card, or Assignee access in job details, controls
View/Edit/Upload for that job. These settings can restrict team permissions,
but cannot grant a permission the account lacks. Removing View hides the job
from the assignee. Permissions are checked against stored settings on every
request, including clients with already-issued access tokens. Refresh the
staff browser or use Refresh jobs to update the visible controls.

This controls Jobs and resume intake. Interview assignment/review permissions
remain the next module.

## Data handling

Super Admin can restore an archived job by choosing Open in its status control
or Restore job in its workspace. A future closing date is required, and the
API clears archival/closure timestamps with an optimistic concurrency check.
The `job.restore` audit event records the previous state and new closing date.
Regular admins and staff cannot restore archived jobs; existing closed-job
reopening permissions remain unchanged. Candidates and interview history are
preserved. No job is restored automatically by the code change.

Only V2 is activated with these changes, through `scripts/run_v2_backend.py`
and `primehire_admin_v2`. The V1 server/database is not restarted or written.
New optional fields are `users.jobAccess` and `jobs.assigneeAccess`; existing
records retain role defaults until an administrator changes their settings.
Migration 005 records the additive feature and requires no record backfill or
index changes. Permissions changes are audited. No existing job status, user
access setting or assignment was changed automatically during development.

## Verification

November 5, 2026 restore/local-development update: 1,084 focused backend and
authorization checks passed, including four restore regressions; those four
also passed against real PostgreSQL in disposable schemas. All 312 frontend
tests passed, along with TypeScript/lint and the production build. A real
localhost browser restored a temporary archived job, verified the persisted
OPEN state and audit event, and removed the temporary job. The existing Backend
Developer record was unchanged. The repeatable local launcher and connection
check confirmed the test database is reachable and production access is denied.

- Full backend regression: 853 passed; 83.21% coverage.
- Final focused status/access/assignee checks: 465 passed.
- Frontend regression: 108 passed; TypeScript and production build passed.
- Browser flows: invitation/password setup; administrator JD creation and
  lifecycle changes; read-only viewer; recruiter creation; upload-only account
  invitation, assignment, selected upload job and held-job restrictions.
- Desktop and mobile card screenshots were visually inspected; the mobile
  browser check asserts no horizontal overflow.
