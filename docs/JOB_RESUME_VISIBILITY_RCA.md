# Job resume visibility

Reported job: `JOB-cbb30f522aed4cc791e7f01074320649`.
Reported production totals: 967 uploaded, 592 under ATS, 3 matching rows in review.

## Root cause found in source

`job_pipeline.pipeline_counts` counts non-deleted intake records across the job.
Its ATS count includes `done`, `queued`, and `scoring`, so 592 does not necessarily
mean 592 finished scores or confirmed candidate profiles.

`uploadResumeSelection` splits multiple-file uploads into small requests and
returns the last batch. `ResumeIntakePage` selects that batch after upload, or
selects the newest batch when reopened. The review request uses
`/batches/{batchId}`; its `total` and pagination include only that batch.
There was no combined job-wide review table. A final batch containing three
files therefore appears as only three matching records even when earlier
batches contain hundreds more. The screenshots are consistent with this bug;
the exact production batch distribution and continued existence of all records
have not been independently verified against the live database.

## Fix

Job-scoped Processing & review now defaults to All job resumes. The new
`GET /api/resume-intake/jobs/{jobId}/items` endpoint reads every batch for the
authorized job and organization, excludes deleted rows by default, and supports
stable pagination, name/file search, and an ATS-only filter. The UI polls for
processing updates. Upload batches remains available for per-batch ATS ranges,
exports, and profile creation. Existing item actions retain their authorization.

This change reads existing records; it does not re-upload, recreate candidates,
alter ATS scores, or restore deleted data. Pre-intake legacy applications are
still available through the pipeline details and application views; they are
not intake records in the new table.

## Deployment and production verification

Deploy both backend and frontend, backend first. There is no data backfill for
this fix. The workspace contains unrelated pending changes: review the release
diff instead of treating the whole checkout as this bug fix.

1. Open the reported job, then Processing & review → All job resumes.
2. With search cleared and ATS-only unchecked, verify 967 active intake records
   if the data has not changed and the funnel contains no legacy applications.
3. Enable ATS-only and verify 592 if processing has not changed. Queued/scoring
   records are included, just as in the funnel.
4. Navigate through pages and search for a resume from an earlier upload batch.
5. Open Upload batches and verify batch-specific range/profile controls.

If counts still differ, inspect the authenticated job-wide response and funnel
details for legacy applications, subsequent processing/deletion, and job scope.
Do not re-upload all resumes based solely on the old three-row table.

Regression coverage uses 967 synthetic records spanning batches, including 592
ATS records, and checks complete pagination, search, deleted-row exclusion,
organization/job isolation, and contact redaction. Frontend coverage checks
job-wide requests, page changes, and filter resets.
