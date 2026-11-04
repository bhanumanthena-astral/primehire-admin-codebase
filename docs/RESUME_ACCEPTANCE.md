# Resume Module acceptance — supplied Module 2 document

Scope: Single, ZIP, XLSX and application-specific ATS. Drive integration is
excluded by the user's 16 October instruction. Parsing/extraction/form filling
are local. Optional personal data stays blank when absent; confirmation requires
a name and at least one valid contact, consistent with the Excel requirements
and missing-information rule. Scores are advisory, not automated hiring decisions.

| Requirement | Implementation evidence | Verification |
|---|---|---|
| Eligible assigned open job, source, consent, drag/drop/browse | ResumeIntakePage, job_access, resume_intake | Passed focused backend/browser checks |
| PDF/DOC/DOCX, content/MIME/size/encryption/malware checks | resume_intake_security, isolated parser | Passed focused backend/browser checks |
| Local extraction, optional fields/confidence, corrections, original | CandidateProfile, resume_intake_parse/fields, ResumeProfileDialog | Passed focused backend/browser checks |
| New person, same-job duplicate, different-job reuse, concurrent confirmation | resume_intake_review, identity claims | Passed focused backend/browser checks |
| ZIP 100MB/500 entries, safe bounded expansion, partial success/error report | resume_intake_bulk, report endpoint | Passed focused backend/browser checks |
| XLSX template/5000 rows, strict columns/types/contact/reference validation | resume_intake_excel, bulk worker | Passed focused backend/browser checks |
| ATS inputs, five dimensions, categories, explanations, per-application storage/retry | resume_intake_ats/llm, recalculate | Passed focused backend/browser checks |
| States/filter/report, server-side queue/retry/recovery | intake repository/jobs/worker, ResumeIntakePage | Passed focused backend/browser checks |
| Profile actions, versions, comments, assignment, other-job association, CSV/XLSX/PDF | resume_intake API, ResumeProfileDialog | Passed focused backend/browser checks |
| Org/role/job permissions, private originals, auditing, retention | projection/security/retention | Passed focused backend/browser checks |

Functional acceptance does not establish production capacity for 1,000 concurrent
large-file uploads. The Module 2 runbook describes the separate deployment checks.

16 October focused verification: 72 backend tests, two new UI regressions and
four synthetic browser journeys passed. Typecheck passed. Added all processing
status filters, accessible version pagination and completed-extraction refresh.
Full application regression checks will run after recruitment integration.

The subsequent full backend run passed 1,411 tests at 81.71% total coverage;
the full frontend run passed 124 tests. See RECRUITMENT_ACCEPTANCE.md for the
integration checks and separate deployment limits.

