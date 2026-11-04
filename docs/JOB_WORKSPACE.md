# Job workspace

Job cards open a workspace with Job details, Resumes & ATS review, Assessments, Candidate reports, and Interview scheduling. Creation opens the new job workspace. Breadcrumbs, previous/next and Exit to jobs provide navigation.

Resume intake locks the selected job and filters batch queries on the server. Assessment creation pre-fills the job title/description, uses the linked assessment ID (or job key), and links publication back to the job. Interview scheduling uses a fixed job scope.

The shadcn candidate table shows ATS and assessment scores, sorts the current 50-row page, and supports explicit bulk selection, shortlisting, and existing background assessment link/email delivery. Shortlisting is a human decision; existing transition rules still apply. Email dry-run is displayed. An invitation queue acknowledgment is not delivery confirmation.

## Meta WhatsApp setup later

Leave WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_GRAPH_VERSION and WHATSAPP_TEMPLATE_NAME empty until ready. Configure the deployed Graph version explicitly, an approved template language and a template with two positional body parameters: job title and full HTTPS assessment link. Configure WHATSAPP_PRICE_PER_MESSAGE and WHATSAPP_CURRENCY as an estimated approved rate, not a claim about Meta billing.

WhatsApp is disabled per job by default. An administrator or HR manager with job access approves the displayed price. The creator/assignee or administrator may then select candidates, confirm their WhatsApp opt-in, and queue invitations. Generate assessment links first. Pricing changes invalidate approval. International phone numbers must include + and country code. Run the existing general worker, which now handles whatsapp_invite jobs.

Meta credentials stay on the server. A journal prevents automatic duplicate sends after accepted or unknown provider outcomes. Accepted means accepted by Meta, not delivered/read. Delivery webhooks and manual reconciliation/resend controls are not implemented. No live email or WhatsApp messages are sent by tests.

## Assessment invitations and candidate reports (2026-10-30)

The Assessments stage links a published assessment using a dropdown and explicit
Link assessment action. There is no candidate-assignment table or assignment-date
form in this linker. Published assessment rows have a View table action. In a job,
that action opens the existing job-scoped Candidates, results & invitations table
with selection, shortlisting, link generation, copying, email/WhatsApp confirmation,
result sync and pagination. Back to assessments returns to the assessment library.
Assessment creation, question preview, confirmation and publication are unchanged.

Candidate reports replaces Candidates & invitations. Its columns are Candidate
name, ATS score, Pipeline stage, Assessment score and Actions. Zero scores remain
zero. Missing scores are labelled Pending, Report pending or Not attempted rather
than invented. View report reads the actual provider assessment report through
GET /api/job-assessments/{job_id}/applications/{application_id}/report. This requires
candidates.manage and job/application access; identifiers come from the stored
application, contacts pass through the central projection, responses are no-store,
reads are rate limited and audited. No mock reports or automatic regeneration.

Schedule interview selects that exact application, switches to Interview scheduling
and opens the existing dialog. Active bookings open Reschedule interview with the
existing required reason. Existing permissions, terminal-stage exclusions, manual
exception rules, conflict checks and confirmation are preserved. No interview is
created merely by navigating, opening a report or opening the scheduling form.

No new collections, indexes, configuration keys or backfill are needed. The optional
reportAvailable response flag is derived from existing assessment state. Provider
fetches have a bounded timeout and pending/service failures remain retryable.

Verification for this change: backend 1,830 tests passed with 83.54% coverage;
frontend 215 tests passed, plus the eight assessment-library tests rerun after
the initial search-debounce pagination correction. Typecheck, lint and production
build passed. All five isolated assessment browser journeys passed, including
existing preview/edit/publication, CSV import, read-only access, Dutch BASIC
rubric preservation, and the new invitations/report/scheduling flow. Desktop
report and invitation layouts and mobile report/scheduling captures were reviewed.
The current local V2 API already exposed the report endpoint, so an additional
restart was unnecessary. No live report, candidate mutation or invitation was
triggered during verification. Existing bundle-size warnings and previously
documented local dependency advisories remain; no dependency was added.

The assessment invitation table includes Search by candidate name or email.
Search is case-insensitive and literal, spans all job candidates before pagination,
clears selection and returns to page one. Refresh and background polling retain
the filter; Clear search restores the full job list. Email matching requires
existing contact-field access, and names remain searchable in restricted views.

## Assessment links and result synchronization

The supplied PrimeHire API reference (§7.1, §7.3, §8.1) is implemented as `POST /interview`
with job/round/candidates and distinct candidate/interview IDs, then `GET /interview/{id}/status`
and `GET /interview/{id}/report`. No report regeneration or invented score is needed
when the provider already reports that the result is available.

Generate links now executes each requested candidate job during the HTTP request,
with at most three concurrent provider calls per request, and returns after saving the link and
encrypted access code. The existing durable job is retained for crash recovery and
claimed atomically, so an API request and worker cannot create the same job twice.
Per-candidate leases also serialize generate/send actions. Email and WhatsApp are
not sent by Generate links. A normal provider response is shown immediately without
waiting for a daemon. Provider latency/errors remain real limits; the app cannot
guarantee a fixed one-second response from an external service.

Sync results performs the queued checks immediately for up to 50 eligible applications
in the authorized job. Background checks continue independently, in bounded batches
with a one-minute default interval and a per-application cooldown. Submitted assessments
show Pending until a numeric report score is available; zero is preserved. The live
provider status payload confirms `is_interview_started`, `is_interview_submitted`,
`is_report_available`, `started_at` and `submitted_at`. An explicitly started but
unsubmitted assessment is In progress; a link alone remains Not attempted. Link creation
requests display Generating link, without implying an invitation was delivered.

The table reads saved data after 30 seconds, then backs unchanged responses off to
60 and 120 seconds. It pauses while hidden, loading/searching or performing an action,
cancels stale requests, and stops when there are no unfinished visible assessments.
Manual Refresh results remains available. These read-only table refreshes do not call
PrimeHire or regenerate a report.

Local results/link recovery can run without delivering emails:

```powershell
.\backend\.venv\Scripts\python.exe scripts\run_v2_assessment_worker.py --no-email
```

`--results-only` excludes both link creation and email delivery. The default worker
mode additionally processes explicitly requested invitation emails. Keep the appropriate
worker running for recovery and unattended synchronization; restarting only the API
does not start it. On this fix, three provider-ready reports were synchronized into
the affected job, and its pending generate-only request was completed without sending
an invitation. No database identifiers were changed and no duplicate interviews were created.

Verification: 1,953 backend tests passed, one skipped, with 83.21% coverage. The
assessment/report/authorization subset passed 1,105 tests; frontend assessment
refresh/table cases and the full frontend suite, typecheck, lint and production
build passed. A headless browser verified In progress/Pending/zero-score rows and
an immediately displayed generated link using synthetic API responses. The live
V2 job was separately checked to confirm all three recovered reports and the
protected link/password are saved, and the link/results worker is running with
`--no-email`.
