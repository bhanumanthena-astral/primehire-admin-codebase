# ATS range after resume parsing

The uploader or an administrator chooses and saves an inclusive minimum and
maximum score for each upload batch. The interface uses the shadcn Base UI range
slider with a controlled two-number array, plus accessible numeric inputs.
The initial 60–100 display is a suggestion, not a saved policy. Any integer band
from 0 through 100 is supported, including 50–100 and equal endpoints.

## Workflow

1. Import and security-scan files; extract text/profile fields locally.
2. Show **Choose your ATS range** after parsed records are available.
3. Save the range to queue bounded ATS jobs before candidate creation. The
   existing ATS provider, stripped technical input, rate limits and labelled
   local fallback still apply. Extraction itself never calls an LLM.
4. Show every resume by default, including scores below/above the saved range.
   Optional eligibility filters use server pagination. Counts cover the batch.
5. Let a reviewer save corrections and confirm eligible profiles individually
   or approve eligible profiles in bulk. Scores never create candidates by
   themselves. Uncertain names and conflicting identities still need review.
6. Changing the range recomputes eligibility from cached current scores. It
   neither reparses documents nor repeats provider requests for unchanged
   evidence. Excluded resumes remain in the intake ledger under normal retention.

Already-created candidates/applications are retained when a range changes.
Associating a candidate with a different job opens a separate review batch;
that job needs its own range, score and confirmation.

## Consistency and recovery

- Policy revisions reject stale saves and approvals. A shared batch lease
  serializes range changes with candidate creation. Queued confirmations recheck
  the saved revision and current job/profile evidence before writing records.
- A changed range pauses delayed creation; retry requires a currently eligible
  score and explicit reviewer action. No automatic rejection, email or deletion.
- Saved technical profile corrections and changed job requirements invalidate
  ATS evidence. A current score is required before confirmation.
- ATS jobs use durable deduplication, item leases, queue retries and reconciliation.
  Scoring failures retain the resume and do not create a person/application.
- New routes are `PUT /api/resume-intake/batches/{id}/ats-range` and
  `POST /api/resume-intake/items/{id}/score`. Existing writer permissions,
  organization/job access and impersonation restrictions remain enforced.
- Migration `011_resume_ats_range_v2` creates additive indexes only and refuses
  databases other than `primehire_admin_v2`. No profile/data backfill or V1 writes.
  No new environment variables, dependencies or external services are required.

## Verification

`backend/tests/test_resume_ats_range.py` covers inclusive endpoints, 50% selection,
retained exclusions, cached range changes, bulk eligibility, stale policy/job/
profile evidence, paused confirmations, permissions, scoring failures and V1
migration refusal. Component tests cover both handles, explicit saves, errors and
read-only access. `e2e/intake.spec.ts` exercises real API/worker integration against
an in-memory test database, including keyboard operation and mobile layout.
