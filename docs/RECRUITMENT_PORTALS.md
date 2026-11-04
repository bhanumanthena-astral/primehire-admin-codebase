# Recruitment portals — V2

User-authorized scope: invitations/password/roles, existing Jobs integration,
global/job/candidate trackers, manual interviews, shared in-app calendar,
technical and managerial reviews, HR questions, decisions and compensation.
Resume intake was subsequently completed against its document, excluding Drive;
assessment creation/management is unchanged. Existing assessment
scores are read from the application; absent results display Not available.

## Accounts and navigation

Super Admin → Team & Access creates invitations using the existing one-use,
hashed invitation/password workflow. Share each private link with its intended
recipient. Existing password, MFA, reset and session rules continue to apply.
Create real Rahul, Srinivas, HR and additional administrator accounts with their
actual email addresses; this implementation does not invent real accounts.

- Super admin/admin: Recruitment Tracker plus existing administration and Jobs.
- Recruiter: Recruitment Tracker and existing assigned Jobs/resume permissions.
- Technical interviewer: Technical Interview Portal, assigned interviews only.
- Managerial interviewer: Managerial Interview Portal, assigned interviews only.
- HR: HR Interview Portal, assigned HR interviews, plus Jobs & resumes when
  existing account grants permit. Use Recruiter for the person coordinating jobs.
- Viewer: existing Jobs access, no recruitment mutations or interviewer portal.

Recruitment → Team access configures candidate fields per interviewer: skills,
experience, education, summary, assessment result, resume, previous reviews,
compensation and audited contact reveal. Contacts are masked initially. Financial
details require HR-round compensation access. View-as sessions remain read-only.
Assignment, organization and field permissions are enforced by the API.

## Recruiter journey

1. Recruitment Tracker → choose all accessible jobs or one job. Stage tiles show
   current occupancy; cumulative milestones remain separately labelled.
2. Search/filter candidates. Select one, the page, or up to 1,000 matching rows.
   Schedule selected opens one manual scheduling form per candidate, preserving
   individual dates, interviewer and meeting details rather than mass-booking an
   identical slot. Cancel exits the remaining selection without creating it.
3. Choose technical/managerial/HR, active matching-role interviewer, start/end in
   IST, 10/15/20-minute reminder, manual HTTPS meeting link/location and reason.
   Assessment completion normally precedes technical scheduling. A deliberately
   supplied manual exception reason is recorded for an out-of-sequence round.
4. Candidate/interviewer overlaps and duplicate active rounds are rejected. Only
   one active interview per application is allowed in this release.
5. The shared calendar displays the same authorized interview records. All times
   are stored in UTC with explicit offsets in API responses and displayed in IST.
6. Open an interview → Schedule & delivery. Reschedule/reassign, cancel, download
   the professional PDF invitation, or explicitly request a candidate email.
   Interviewer assignment emails/in-app notifications are automatic. Rescheduling
   retires stale queued emails/reminders. Candidate email is an explicit action.
   Candidate cards show their active interview independently of the interview
   list's Upcoming/Pending filter: round, assigned interviewer, start/end in IST,
   meeting link and latest reschedule reason. Booked candidates use Reschedule
   interview rather than a duplicate Schedule interview action. New reschedules
   require a reason and append the previous/new times to the existing audit trail;
   Schedule & delivery exposes the latest 20 changes. Existing older audit entries
   show their saved reason/date even when previous times were not recorded.
7. Candidate roadmap opens a full page for the clicked application, showing
   projected profile details, timestamps in IST, stages, actors and reasons. It has
   loading, empty and retryable error states, plus Refresh roadmap. Closing or
   switching candidates cancels the request; late responses cannot replace the
   selected candidate’s history. Back returns to the prior list, filters, scroll
   position and originating button. View interview & review opens the existing
   full-page interview workspace, including the HR questions and decision form.
   Legacy history is read only after authorizing its parent application;
   no legacy assessment history is rewritten/backfilled.
   Resume-received and existing ATS-evaluation timestamps are displayed as
   read-only intake milestones; the tracker never recalculates or mutates ATS.

Calendar results are paginated (50 per page), including busy months. Filters and
counts respect the current user’s scope; interviewer views are not global access.

### Personal reviewer overview

Technical, managerial and HR reviewer logins open a personal Overview. Four
shortcuts show interviews today (IST), upcoming interviews, finished interviews
awaiting feedback, and submitted reviews. These counts come from one bounded
aggregate over the reviewer’s own permitted interviews, independently of the
50-item list page; job and organization scope apply. Cancelled interviews do not
inflate the overview. Today and completed-review filters use the same scope.
The reviewer’s round-outcome aggregates exclude other interviewers’ rounds even
when they share an application.

The overview highlights the next interview, its preparation checklist and up to
three upcoming candidate cards. My interviews provides the paginated full list.
Cards separate their interview status/round from the application’s later stage,
with assessment, experience, skills, schedule in IST, meeting and roadmap
actions. Reviewed cards show the saved recommendation; meeting actions appear
only on scheduled interviews.

In candidate roadmaps, a managerial advance is **Managerial review completed**
with **Ready for HR interview assignment** as the next step. The two adjacent
same-actor, same-reason review/handoff writes (within five seconds) are presented
as one event, preserving the original stored history. Distinct actors/reasons
remain separate. This never represents the manager as an HR interviewer or
asserts that an HR interview has already happened. Interview details explicitly
label both the application stage and the round being viewed.

## Interview and HR journey

Interview cards show candidate summary/skills, permitted assessment result, time
and meeting link. Technical reviewers submit strengths, concerns, comments and
scorecard; advance/reject/hold/another-round are human decisions. Reviews open
after the scheduled start and lock on submission.
The review form displays its scheduled opening time and automatically unlocks
using a clock aligned to the API's server timestamp, preserving drafted feedback.
The backend still enforces the start-time rule. An interrupted submission is
replayed from its durable journal. Technical advance awaits managerial assignment;
managerial advance awaits HR assignment. Handoffs notify the recruiter in-app;
they do not automatically email the candidate or schedule another interview.

Managerial and HR profiles can see permitted previous reviews. HR generates ten
HR/behavioral questions primarily from the stripped JD and parsed resume/profile.
Previous reviews may inform behavioral follow-ups; technical knowledge, coding,
architecture and technology quizzes are excluded. Source labels identify the
context, not a technical interview. The existing provider/model configuration is
read, never changed. The `hr-questions-v2` prompt, strict JSON and HR-topic checks,
shared capacity governance and hash-only LLM audit apply.
Provider failure/injection concerns yield visibly labelled local guidance; no AI
output makes a decision. HR edits questions, marks asked and records answers.
Generated sets retain their context-permission snapshot. Revoking review or
profile context also blocks access through saved questions/answers; historical
answers are preserved instead of overwritten or deleted.

Use **Regenerate HR questions** to explicitly replace an unused historical set,
then confirm **Replace unused questions**. Both interview and question revisions
are checked under the same question-edit lease. Saved edits, asked markers,
answers and unsaved UI changes block regeneration; edit those questions
individually instead. Optional prompt/generated-revision metadata requires no
backfill or index change, and historical sets remain readable under the same
context permissions. No ATS or assessment flow is changed.

Only the latest technical and managerial reviews enter the bounded question
prompt. A synthetic live check returned ten schema-valid questions, covering
technical, managerial, job and profile sources. No real candidate data was used.

HR records budget, candidate expectation, proposed/agreed amount, currency,
annual/monthly period and notes. Positive HR review enters Offer, not Hired.
Negotiating → offered → accepted → joined is explicitly recorded; joined updates
the application and filled-position count. A position-capacity check prevents
overfilling through these actions. Technical/managerial rejection awaits human
approval; HR rejection is final. Rejection keeps application history/talent-pool
metadata. Intelligent talent-pool matching is now available in Recruitment →
Intelligent talent pool; see TALENT_POOL.md.

Submitted reviews are immutable in this release. An additional interview creates
a new review; no silent edit/unlock bypass is provided.

## Isolation, migration and operation

`RECRUITMENT_PORTALS_ENABLED=false` is the safe default in both example files.
Validation refuses enablement outside `primehire_admin_v2`. The V2 API launcher
enables it in that process only. Migration `007_recruitment_v2` is additive and
creates only `recruit_interviews`, `recruit_reviews`, `recruit_notifications`,
`recruit_profiles`, `recruit_questions`, `recruit_leases` and
`recruit_email_outbox` indexes. No V1 backfill or user/account copying occurs.

The dedicated encrypted recruitment outbox reuses the existing encryption,
Zepto delivery client and dry-run/recipient gates. It is separate from assessment
emails and the resume worker. Delivery is at-least-once across an ambiguous
provider/network crash; dedupe prevents repeated user clicks and repeated normal
worker dispatch. A supervisor and periodic worker-health monitoring are required.

`RECRUITMENT_OUTBOX_ENCRYPTION_KEY` can isolate recruitment encryption from the
assessment outbox; otherwise the existing outbox key is reused. A private local
key was provisioned without changing assessment mail configuration. Back up this
key securely; replacing it can make queued ciphertext unreadable. Real delivery
still respects the existing backend mail credentials, dry-run and allowlist gates.

Recruitment can override those gates with `RECRUITMENT_ZEPTOMAIL_API_KEY`,
`RECRUITMENT_EMAIL_DRY_RUN` and `RECRUITMENT_EMAIL_TEST_RECIPIENT_ALLOWLIST`.
Unset overrides retain the previous behavior. Assessment sender/settings are
never modified by recruitment overrides. A single synthetic test invitation was
accepted by the provider for the recipient explicitly supplied by the user.
That confirms provider acceptance, not receipt in an inbox. Local live delivery
is restricted to the configured test recipient; production audiences require
deliberate deployment configuration. Permanent provider refusals are recorded
without repeated retries or payload/credential logging.

```powershell
backend\.venv-v2\Scripts\python.exe scripts/run_v2_backend.py
backend\.venv-v2\Scripts\python.exe scripts/run_v2_recruitment_worker.py
# Keep the existing resume worker running independently.
npm run dev
```

Reminders, notification reconciliation, review recovery and due hold follow-ups
run through the recruitment worker. Its heartbeat is shown in the workspace.
Dry-run messages explicitly show recorded only, not sent. Deployment email gates
must be configured deliberately; no real customer email is sent by tests.
Recruitment writes have a per-user 120/minute process-local safety limit in
addition to database workflow leases. Size and rate limits must also be set at
the production ingress; provider governance is shared through MongoDB.

## Verification

```powershell
backend\.venv-v2\Scripts\python.exe -m pytest backend/tests --cov=app --cov-fail-under=80
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run build
npm run test:e2e -- --config playwright.recruitment.config.ts
```

Tests use in-memory Mongo and synthetic users only. Browser acceptance covers
manual scheduling/calendar/PDF, technical review/mobile modal, managerial portal,
and HR questions/answers/compensation. Integration tests cover cross-tenant and
assignment denial, projection/contact access, stale revisions, concurrent booking,
reminder/email dedupe, encrypted delivery gates, locked-review crash recovery,
HR offer-to-joining, rejection, hold follow-up and stripped LLM input.

Production throughput for 1,000 simultaneous users remains a deployment load-test
target. No external calendar synchronization or automatic Meet creation is added.

### Local release evidence — 16 October 2026

- Backend: 1,347 tests passed; 81.65% total coverage against the 80% gate.
- Frontend: typecheck, lint, production build and 119 unit tests passed.
- Browser acceptance: four recruitment tests and five existing invitation/Jobs
  tests passed with synthetic users and in-memory databases.
- A synthetic live HR-question request returned ten schema-valid questions.
- Reloaded V2 API and recruitment worker; API readiness and frontend returned
  HTTP 200. Migration 007 and worker heartbeat were verified. V1 collection
  counts still match the read-only safety snapshot.
- This initial release left resume/ATS and assessment flow source unchanged;
  the subsequent document-acceptance work updates resume UI/history only.
- Subsequent recruitment-only mail configuration and the authorized live
  verification supersede the initial dry-run limitation above.
- Implementation and final verification exceeded the requested two-hour target.

These checks establish local functional evidence, not 1,000-user production
capacity or hosted-service supervision. The production build still reports the
existing large-bundle warning.


## Full-page candidate and review workspace — 3 November 2026

Candidates waiting between rounds are covered by the
[pending scheduling queues](RECRUITMENT_SCHEDULING_QUEUES.md). A candidate advanced
to HR remains available before an HR booking exists, including their saved review
and a direct HR scheduling action.

View candidate & review opens an inline page across the technical, managerial and
HR portals. It replaces the interview list while open, fills the available page
width, and has no modal overlay, focus trap or small-dialog scroll area. Back to
interviews restores the previous view, filters and scroll position, with keyboard
focus returned to the originating card (or workspace heading if the card is no
longer in that filter). The candidate heading receives focus when opened.

Interview ratings now lead every submitted review card, before strengths, concerns,
notes and recommendations. Each criterion has a named score out of five and a
high-contrast visual scale. Historical reviews without scores say No ratings
recorded. Editable ratings are grouped in a highlighted Your ratings section before
written feedback. Scores use the same existing review fields and default values;
submitted reviews stay locked. The assessment report snapshot remains available
below the review content. Candidate brief, HR questions, managerial drafts, salary,
offer actions, joining links and schedule/delivery controls are retained.

Back navigation and page unload protect unsaved review/question edits. The page
uses the existing role/field projections and request endpoints; no backend, auth,
provider, schema, migration, CRUD or environment changes are required. This is an
in-app full-page view, without requesting the browser's fullscreen permission.


Verification for this presentation change: all 273 frontend tests passed, including
review payload/locking, earlier round ratings, all three portal criteria, timed
submission, HR questions and unsaved-feedback checks. All five recruitment browser
journeys passed with full-page width assertions, no review modal, keyboard return
focus, technical score submission, dark mode, mobile reflow, managerial review,
HR questions/compensation, and scheduling/PDF delivery. TypeScript/lint, production
build and diff whitespace checks passed. Local frontend HTTP probes confirm the
new workspace and prominent rating controls are being served. No live candidate
record, invitation, provider or database operation was used for verification.

The remaining candidate roadmap dialog is now a full page in every recruitment
portal, including HR. Profile and interview pages replace the list while open,
with no overlay, focus trap or nested modal scrolling. Candidate headings receive
focus, profile values come from the existing authorized projection, and Back
restores the original list context. Review, offer and compensation actions retain
their existing endpoints and permissions. There are no backend or setting changes.

Validation: all 288 frontend tests pass, including HR profile-to-review navigation,
focus restoration, projected profile data, zero scores, history isolation and retry.
All six recruitment browser journeys pass (the updated shared page-layout check
passed on rerun), including HR desktop/mobile profile layout, HR questions,
compensation and submission. TypeScript/lint and the production build pass.


Desktop width correction (2026-11-04): the shared interview review page and its
standalone toolbar now fill the available application width without the previous
1280-pixel cap. A fresh HR session against localhost:3000 measured 1920 pixels
on a 1920-pixel viewport, with no dialog. The same session verified the 390-pixel
mobile layout without document overflow, HR questions, the highlighted ratings
section and Back navigation with focus restored to the originating card. Tests
use an isolated synthetic backend and do not modify live candidate records.

The width correction also passes all 288 frontend tests across 48 test files,
including shared HR page navigation, ratings, submission and feedback protection.
