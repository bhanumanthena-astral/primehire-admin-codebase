# Managerial notes and AI feedback

The managerial interview uses the existing Reviews & decision workspace and scorecard. Additional Managerial notes allow up to 10,000 characters. Save draft persists an incomplete evaluation without completing the interview or progressing the application. Drafts belong to the interview and application, carry author/timestamp metadata, and are visible only to the assigned interviewer. Updates enforce the existing interview revision and lease checks. Submitted evaluations and notes remain locked.

Submission triggers an AI-assisted managerial summary independently of the human recommendation. It includes the submitted evaluation, notes, permitted preceding technical review, and authorized pinned assessment summary when available. Source report/version and evaluation references are retained. HR sees this summary with the prior managerial review. AI never changes the human recommendation or recruitment transitions.

Generation uses the existing OpenRouter key and resume_ats_model/openrouter_model configuration, circuit breaker, and rate limiter. Missing configuration or provider failure preserves the submitted evaluation and records a failed summary status. The assigned interviewer can retry; completed summaries are immutable and retries do not regenerate them. Previous assessment reports are never updated.

Routes: POST /api/recruitment/interviews/{key}/evaluation-draft and POST /api/recruitment/interviews/{key}/managerial-summary. Both use existing recruitment.review permission, assigned-interviewer checks, and view-as write protection. Sensitive actions are audited.

Google Calendar integration is deferred. Existing scheduling is unchanged.

Validation: frontend typecheck, 11 recruitment UI tests, 11 backend recruitment/managerial feedback tests. Backend tests use synthetic Mongo and mocked AI; no live AI call is required.
