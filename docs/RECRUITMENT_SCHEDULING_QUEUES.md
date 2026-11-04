# Candidates between interview rounds

Advancing a managerial review moves the application to `HR_ROUND`; it does not
create an interview until a recruiter or administrator chooses an HR interviewer
and time. `HR_ROUND` is also used after that booking, so filtering on this stage
alone does not identify candidates waiting to be scheduled.

Recruitment tracker and Interviews now offer **HR interview scheduling pending**,
plus equivalent technical and managerial filters. The pending queue includes ready
applications with no scheduled interview. It retains candidate details, a roadmap,
and access to the latest permitted interview and its completed reviews. The HR
scheduling action defaults to the HR round without requiring a manual exception.

`GET /api/recruitment/applications?schedulingRound=hr` applies readiness and booking
filters before search counts and pagination. `technical` and `managerial` are also
accepted. Bulk selection uses the same filters. Tracker `schedulingPending` counts
use the same readiness rules. Historical reviews and cancelled interviews do not
hide a pending application; an existing scheduled booking is recognized even if
an older record lacks the `active` flag.

Scheduling removes a candidate from the pending queue. Cancellation returns a
still-eligible application to that queue. Completed interview reviews remain
available from Completed reviews. No stage, candidate or completed review is
recreated to restore visibility.

Queues retain organization, assigned-job and interviewer access restrictions.
Scheduling controls belong to recruiters and administrators; readiness alone does
not grant an unassigned interviewer access to a candidate. Contacts retain central
masking/projection. No new environment variable, collection, index or migration is
required. These changes are a corrective extension of the existing workflow.

Regression coverage checks each round handoff, historical review access, pending
counts, scheduling/cancellation, pagination, search, cross-organization bookings,
legacy flags and unassigned interviewer restrictions. Browser coverage follows a
managerial reviewer advancing a candidate, then an administrator finding the
candidate in the HR queue, opening the saved feedback and opening the HR scheduling
form with the correct round selected. Isolated API tests verify actual scheduling
and cancellation transitions.

Verification on 3 November 2026: all 1,957 backend tests pass (one intentional skip,
83.23% coverage); all 283 frontend tests, TypeScript/lint and the production build
pass. The dedicated browser handoff journey passes on isolated test ports. A
read-only check of the reported live application confirms it is present in the HR
pending queue with its completed managerial interview reachable. The restarted
local API exposes `schedulingRound`, and the frontend responds with HTTP 200.

## Direct candidate discovery

The app-header candidate search is connected to Recruitment, and a Candidates tab
provides a permanent application list across stages, including completed rounds
and pending handoffs. Global search opens that tab, clears stale stage/round and
global job filters, and searches the paginated server dataset instead of only the
currently displayed page. Searches inside an explicitly scoped job retain that job
boundary. The local search and app header stay synchronized. Clear candidate
filters restores the broader authorized list.

Candidate lookup does not wait for an unrelated interview-list request. A candidate
waiting for HR can open the HR scheduling form directly from the resulting card.
Interviewers retain assignment-based visibility; an HR-stage application without
an assigned HR interview is visible to the authorized scheduler, not automatically
to every HR user. The Candidates view explains that assignment requirement.

Verified against the running local app: header search finds the reported existing
candidate and opens an HR scheduling form with `hr` preselected. Browser QA blocks
all data-changing requests and keeps its temporary authentication in memory; no
booking, candidate or staff account was created. All 286 frontend tests,
TypeScript/lint and the production build pass. New regression tests cover global
search after another interview filter, avoiding unrelated interview-list failures,
and retaining an explicit job scope. No backend or access policy change was needed.
