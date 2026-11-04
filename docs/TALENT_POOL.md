# Intelligent talent pool — V2

Recruitment → Intelligent talent pool → select a job. Open jobs created after
migration 008 automatically queue a first comparison when their original creator
is still an authorized admin/recruiter. No existing Jobs CRUD code is changed.
Older jobs use Compare talent pool. A creator without recruitment-manager access
does not cause an administrator to be impersonated; an authorized manager can
request the comparison explicitly.

The queue runs in the existing dedicated recruitment worker. Each request covers
100 distinct historical candidates by default, up to 1,000 through the API.
Compare next 100 handles larger pools. Saved comparisons remain selectable with
pagination. Each cycle handles one bounded candidate, persisting its cursor and
result before moving on. Retries after interruption reuse the same result ID.
Only one active run per job is admitted under a workflow lease; identical request
keys return the existing request. Job changes or revoked creator access block a
run visibly; request a new comparison after resolving the issue.

Sources are rejected/talent-pool applications from other jobs in the same
organization. Admins can access the organization pool; recruiters can access only
their currently assigned, view-authorized source jobs. Consent, retention and
recontact restrictions are rechecked. Candidate identity is grouped so the same
person is not repeatedly scored in one run.

The candidate's structured profile, historical assessment and interview feedback
are compared with the NEW job. The LLM receives bounded stripped data, with
prompt-injection checks, a strict result schema, shared provider governance and
hash-only audit records. It returns advisory compatibility/reasons/cautions.
Unavailability, capacity limits and suspicious instructions retain a clearly
labelled local score; they do not fabricate a successful AI evaluation. Historical
feedback is evidence from that time, never proof that a candidate has improved.

Ranked cards expose the previous assessment as historical, with matched/missing
skills and reasons. Review history & reuse shows permitted reviews, rejection
reasons and the candidate roadmap. Contacts in free text remain masked. Changed
job/profile/review evidence marks the result stale and prevents reuse.

Add to this job for review requires a human reason, current upload/job permission
and an open job. The same person is reused; an existing application for that job
is returned, otherwise one separate application is created at Parsed with audited
origin. Original rejection/history remains intact. Old ATS/assessment scores are
NOT copied into current-job scores. No automatic hire, interview or email occurs.

Migration `008_talent_v2` creates indexes only on `talent_match_runs` and
`talent_matches`; there is no V1 write or backfill. Match retention is bounded by
the candidate's retention and configured retention days; TTL indexes remove old
recommendations/runs. Runtime access rejects expired records even before TTL
cleanup. Resume/assessment workers remain separate.

Validation: isolated backend permission/concurrency/consent/retention/provider
tests, a synthetic live model comparison and browser review/reuse coverage.
Production throughput depends on database/storage sizing and provider quotas;
the queue does not establish 1,000-user deployment capacity.
