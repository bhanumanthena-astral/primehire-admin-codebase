# Module 2 — V2 resume intake

User-authorized implementation, 14 October 2026. Reference: supplied Module 2
document. Scale target: 1,000 accounts and 1,000 simultaneous users. That is a
deployment/load-test target, not a measured capacity claim for this workstation.

## Flow and boundaries

Receive bounded uploads → durable batch/items → isolated background parsing →
human review/correction → duplicate-safe candidate/application confirmation →
ATS-only LLM evaluation plus a separately labelled local breakdown. A score belongs to an application. Confirmation
does not shortlist, reject, hire or send email. Existing candidate/application
records are reused. Original resume versions remain accessible through authorized
downloads. Missing fields stay blank; confirmation needs a name and at least one
valid contact. Uncertain/conflicting identities require explicit resolution.

Modes: single PDF/DOC/DOCX (10 MB default), multi-file convenience, ZIP (100 MB,
500 resumes, bounded total decompression), and XLSX (5,000 rows, prescribed
template, optional accompanying resume ZIP). Row/file failures remain identifiable;
valid rows survive. Original archives and sheets are never publicly served.

The V2-only feature flag isolates the expanded workflow from the legacy intake path.
New collections: `resume_intake_batches`, `resume_intake_items`,
`resume_intake_claims`, `resume_intake_notes`, `resume_intake_settings` and
`resume_intake_limits`. Existing V2 `resume_files`, `applicants`, `applications`,
`stage_history`, `background_jobs` and `audit_log` are reused through additive
records. No V1 backfill, data conversion, deletion or collection/index alteration.

## Reliability and access

Parsing and scoring do not hold upload requests. Worker jobs use persisted
claims/leases, bounded attempts, retry and reconciliation. Request idempotency
and contact/application identity claims protect concurrent submissions. Batch
and item results are paginated and scoped by organization, job assignment and
configured job access. Reviewer edits use expected revision checks. Uploaded
content is data. Parsing, extraction, duplicate checks and form filling never
call an LLM; only confirmed ATS evaluation uses the configured provider. No
external recruitment portal is accessed.

API admission/body caps apply before multipart parsing. Shared Mongo leases
provide backpressure across processes. CPU-heavy parser work runs outside the
event loop with bounded concurrency. Multiple workers require shared private
storage; large installations need provisioned storage, database, scanner and
worker capacity, plus a realistic deployment load test.

## Security and product decisions

Validate content, MIME, signatures, encrypted/corrupt files, unsafe ZIP entries,
nested archives, compression bombs and Excel formulas/macros. ZIP entries are
read without extracting client paths to disk. Malware scanning fails closed:
unavailable scanners produce a visible retryable security state. OCR and legacy
DOC conversion use configured local tools with time/page limits; absent tools
produce explicit review/retry states. No fabricated OCR or clean scan results.

Administrators configure limits and score categories within safe hard bounds.
In-app status/reporting supplies notifications. Drive integration is excluded
from this module by the user's 16 October instruction.
Exports escape spreadsheet formulas and are audited. PII is masked in list views
and explicitly revealed for authorized profile review, with an audit event.

## Verification and activation

Tests use in-memory Mongo and private temporary files, never the live databases.
Cover role/organization/assignment isolation, ZIP/XLSX adversarial input, partial
failure, concurrent duplicate confirmation, crash/retry, job closure, score
separation, preview/review and browser flows. Register additive V2 indexes through
a gated versioned migration. Production activation requires the real malware/OCR
tools, storage, workers and deployment capacity checks documented in
[MODULE2_RUNBOOK.md](MODULE2_RUNBOOK.md).
