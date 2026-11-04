# Invitation onboarding and assigned Jobs

Follow-up: see [V2 Jobs cards and access controls](JOBS_ACCESS_AND_CARDS.md) for
current administrator-only lifecycle and configurable staff rights.

Implemented against the user's request on 2026-10-13. This extends the Jobs
completion report; it does not declare the interview or candidate modules complete.

## Choice

Keep the application's existing Argon2id password hashing, JWT sessions,
refresh cookies, role permissions, MFA and password-reset implementation.
No additional authentication provider, paid subscription or dependency was added.
Keycloak is an alternative self-hosted identity provider under Apache-2.0
(https://github.com/keycloak/keycloak), but switching now would introduce another
service and a migration. Software licensing does not make hosting/email free forever.

## How to use

1. Admin: Team & Access → Generate Invitation → enter name, email and role.
2. Copy the invitation link and share it privately with that person. Invitation
   creation does not send email automatically.
3. New user opens the invitation and enters/confirms their chosen password.
4. They sign in with their email and password using the existing login page.
5. HR/recruiter lands on Jobs. Only jobs assigned to their user ID are visible.
6. Admin assigns a job to that user. Admin retains organization-wide visibility.
7. For an expired link, use New invitation beside an active account marked
   Awaiting password. Issuing a replacement invalidates earlier invitation links.

Technical and managerial interviewer accounts can also be invited and sign in.
Their current landing pages explain that assignments and review forms belong to
the next module. No real accounts were created for the named interviewers; their
email addresses are needed when an administrator invites them.

## Security and scope

- Store Argon2id hashes, never readable passwords. Apply the existing minimum
  12-character/common-password policy.
- Store invitation token hashes with expiration and atomic single-use consumption.
  Password creation uses an atomic pending-account update and cannot overwrite
  an established password. Deactivated/deleted accounts cannot accept invitations.
- Invitation tokens are URL fragments, removed from browser history on opening.
  Earlier query-based invitation URLs remain supported. Tokens are not saved
  in browser storage. Setup is throttled using the existing rate limiter.
- Scope staff Jobs queries on both organization and assignee user ID, including
  searches, pagination, counts, detail/activity/notifications and actions.
  Staff cannot create/reassign jobs for another user. Read-only users retain
  read-only permissions; interviewers cannot access the general Jobs APIs.
- Scope resume uploads, batch listing/detail and downloads to assigned jobs.
  Scope application listing/detail/history/transitions/assessment requests and
  application summaries embedded in candidate profiles to assigned jobs.
  Manual organization-wide assessment sync is admin-only; trusted workers
  retain their background processing scope.
- The shared candidate identity registry and legacy candidate APIs remain a
  separate module. This change does not claim complete candidate-data isolation
  across every legacy endpoint or a finished interviewer authorization model.
- Invitations are manually shared. Automatic invitation email delivery and
  deployment configuration are outside this change.

## Validation

- Full backend regression: 834 passed; 82.92% coverage (80% required).
- After the final admin-invitation protection: 43 focused tests passed, including
  the additional administrator takeover regression.
- Frontend: 100 passed; TypeScript and production build passed.
- Browser: 4 passed, including invitation setup, login and assigned-only Jobs.

Backend tests cover setup/login, expiration, replay, inactive accounts, wrong
token kind, common-password rejection, replacement invitations, hashing,
throttling, cross-organization management and cross-user Jobs/resume/application
access. Frontend tests cover token handling, successful setup, mismatched
passwords and expired/missing invitations. Browser tests exercise first password
creation and login, assigned-only HR/viewer views, and the existing local JD flow.
