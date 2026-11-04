# Recruitment acceptance — requested six areas

Scope authorized 16 October: finish the document-based Resume Module first
(Drive excluded), then the six recruitment areas below. Functional acceptance
is checked through isolated backend and browser journeys; it is not a percentage
estimate or a claim about untested deployment capacity.

| Area | Acceptance exercised |
|---|---|
| Global/job/candidate trackers | Scoped current counts and cumulative milestones; assessment completion from existing application results; resume/ATS events retain milestone-map shape; all three interview rounds through offer/joining update trackers and position counts. |
| Manual interviews/shared calendar | Role-matching assignment, explicit IST, overlap/active-round guards, visible exception reason, revision-safe reschedule/cancel, professional PDF, encrypted outbox, due reminder and cancellation/recovery tests. |
| Technical portal | Assigned-only brief/profile/assessment/resume/meeting, timed review submission, locked scorecard/reasons, recruiter handoff, rejection approval, hold and additional round. |
| Managerial portal | Assigned-only profile, permitted prior reviews, review/decision handoff to HR; source field and job access are rechecked. |
| HR portal | Ten validated contextual questions including HTML JD, previous feedback, editable questions/answers, mandatory human decision/reasons, compensation and offered/accepted/joined path with capacity checks. |
| Intelligent talent pool | Automatic advice for newly created eligible jobs, explicit older-job comparison, durable bounded runs, ranking/filter/history, previous reviews and rejection context, stale/consent/retention/access checks, human-approved duplicate-safe reuse without copying old scores or sending outreach. |

Live verification uses synthetic content only: the HR-question provider check
from the preceding release, a new talent-model comparison, and one explicitly
authorized test invitation accepted by the mail provider. In-memory tests never
connect to the hiring databases or send real email. Backend assessment mail
settings remain unchanged; recruitment uses separate credentials/gates.

Local email recipients remain restricted to the configured test allowlist.
Production load/backup/recovery/supervision verification and broader delivery
configuration remain deployment gates. The distinct ATS prefilter/threshold
candidate-creation idea and changes to assessment management are outside this
six-area release; the document-based intake order remains unchanged.

16 October verification evidence:

- Full backend run: 1,411 passed; 81.71% total coverage, above the 80% gate.
- Subsequent focused model/HR/mail regressions: 34 passed, including successful
  provider-status handling and use of HTML job descriptions in HR context.
- Frontend: 124 unit tests passed; typecheck/lint passed.
- Live synthetic talent model: `method=llm`, `providerStatus=done`, valid score
  and one hash-only audit record. No live candidate data was sent.
- Authorized synthetic email: provider accepted; assessment settings unchanged.
- Production JavaScript and installed V2 Python runtime audits found no known
  vulnerabilities. No new application dependency was introduced.
- A configured-secret canary check found no secrets copied into changed source
  or environment examples. Remote CI/gitleaks has not been executed here.
- Final browser acceptance: five recruitment/talent journeys and four resume
  journeys passed. Production build passed with the existing bundle-size warning.
- Activated additive migration 008 and reloaded only the V2 API/recruitment
  worker. Recruitment and intake worker/scanner heartbeats were healthy; V1
  collection counts still matched the read-only safety snapshot.

16 October booking/review follow-up: administrator application cards now include
their active booking independently of Upcoming/Pending view filters, with direct
rescheduling and its saved reason. Schedule details expose bounded before/after
audit history. Reviewer forms show the scheduled opening time and unlock against
server-aligned time without losing draft feedback. Interviewer lists omit other
interviewers' rounds on the same application. Verification: 1,415 backend tests
passed at 81.91% coverage, 127 frontend tests, five browser journeys, typecheck
and build passed. Reloaded only V2 API; readiness/frontend returned HTTP 200 and
V1 counts still matched the safety snapshot. No live interview was rescheduled.

16 October candidate roadmap repair: the tracker card opens the selected
application’s history in a centered viewport dialog. Loading, retryable errors,
empty history and manual refresh are visible within it; switching candidates or
closing aborts the request and ignores stale responses. New checks cover the
selected application ID, failure/retry and cross-candidate response isolation.
Browser acceptance verifies the candidate’s saved scheduling event, desktop and
mobile centering, Escape dismissal and focus return to the originating button.
Verification: 131 frontend tests passed (22 files, two workers), all five
recruitment browser journeys passed, typecheck/lint and production build passed
(existing chunk-size warning). An initial run concurrent with build/browser
checks hit three unrelated five-second test timeouts; the complete two-worker
rerun passed. The running V2 frontend returned HTTP 200. No backend code, auth
surface, dependencies, environment variables, database records or live email
delivery were changed for this repair.

16 October reviewer dashboard/handoff follow-up:

- Technical, managerial and HR logins now open a personal overview with scoped
  interview counts, a next-interview/pending-feedback focus, a preparation
  checklist, compact candidate cards and paginated interview filters. Today
  uses IST boundaries; totals remain independent of list pagination and exclude
  other users, jobs outside the filter, other organizations and cancelled rows.
- Reviewed interview cards retain their own round and recommendation even when
  the application moves ahead. Managerial review/handoff journal entries appear
  once as a completed managerial review with HR assignment clearly labelled as
  the next step. Stored history and stage-transition behavior are unchanged.
- Focused backend checks: six passed, including own-round outcomes, managerial
  handoff, today boundaries and scope. Full backend: 1,416 passed and one legacy
  100-resume flaky-provider stress assertion failed; that exact stress test
  passed on isolated rerun. Full-run coverage was 81.99%, above the 80% gate.
- Frontend: 137 tests passed across 24 files in a serial run with a 15-second
  test allowance; earlier concurrent runs hit unrelated five-second form test
  timeouts. Five recruitment browser journeys passed with overview screenshots,
  pending-feedback focus, dark theme and mobile overflow checks.
- Final compact mobile refinement: the Managerial journey passed again;
  production build and typecheck/lint passed. The existing large-bundle warning
  remains; no new dependency was introduced.
- Only the V2 API was reloaded to activate the aggregate counts. API readiness
  and frontend returned HTTP 200; the read-only V1 snapshot matched and the
  recruitment worker was healthy. No migration, live application edit, interview
  reschedule, live email, resume/ATS or assessment-management change was made.

## HR-only question correction (2026-10-28)

- The JD and parsed resume are primary context. Provider suggestions are checked
  for HR relevance, duplicates, injection and common technical-test patterns;
  invalid responses use explicitly labelled behavioral HR guidance.
- Local fallback never repeats arbitrary technical-review text. Synthetic tests
  cover JD/role and resume skill/designation context, field projection, technical
  outputs, injected reviews and historical question replacement.
- Existing POST questions action accepts explicit regeneration with interview and
  question revisions. Same edit lease and conditional persistence prevent stale
  overwrites. Asked, answered and edited sets are protected; UI also protects
  unsaved changes. No new authorization surface or database backfill is needed.
- Verification: full backend 1,813 passed, 83.45% coverage; frontend 208 passed.
  Typecheck, lint and production build passed. Build retains the existing
  large-bundle/dynamic-import warnings. No dependency was added or changed.
- Dependency audits: frontend clean; root has an existing moderate qs advisory.
  The installed local backend environment has existing advisories in 10 packages
  (152 audit entries, including duplicate advisory aliases). Remediation of that
  environment is separate from this HR-question correction; do not treat the
  local environment as passing the dependency-security gate.
- Model/provider behavior is covered by mocked responses; no real candidate
  data was sent to a model and no interview answers or decisions were changed.
