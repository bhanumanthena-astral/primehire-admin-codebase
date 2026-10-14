# Assessment creation review and preparation buffer

The assessment form now opens a preview without saving or contacting PrimeHire. Creation happens only after the user checks the review acknowledgement and confirms. Back to form preserves the draft. Saved assessment content is locked in the UI and on the backend; content PUT/PATCH requests return `403 ASSESSMENT_LOCKED`. Candidate rescheduling and assessment activation/deactivation remain available.

After successful provider setup, the backend saves `candidateCreationAvailableAt` as its current UTC time plus five minutes. Countdown displays use this saved deadline. Single candidate creation, bulk creation and reassignment into a preparing assessment are blocked by the backend until the deadline. Failed or pending setup stays blocked and does not unlock just because five minutes have elapsed. A successful retry starts its own full preparation buffer; retrying an already successful setup does not restart the buffer. Existing assessments without a deadline get no new wait.

This is a preparation buffer requested for TTS generation, not a provider-confirmed readiness check. The API documentation supplied does not contain an assessment/TTS readiness endpoint.

Both frontend and backend changes must be deployed together. No migration is required for existing assessments. No real provider requests, invitations or candidate writes were made during verification.

## Manual checks

1. Create a draft with a job title, description, language, round and questions. Click **Review assessment**. Confirm that no new assessment appears in another browser yet.
2. Check the preview's full question text, timing, scores and weighting. For MCQs, check every option and the marked correct answer. For Basic spoken questions, check the rubric. For Technical spoken questions, check the reference answer.
3. Click **Back to form**, change a detail and review again. Confirm the updated detail appears. Check the acknowledgement and confirm creation.
4. Verify the assessment detail shows **Preparing assessment** and candidate assignment is disabled. After two minutes, refresh or reopen the portal in another browser. About three minutes should remain, not a new five-minute countdown.
5. At the saved deadline, confirm candidate assignment enables automatically. Refresh again and confirm it stays enabled. The assessment has no Edit option.
6. If provider setup fails, verify candidate creation remains disabled. Retry setup from the assessment list. When setup succeeds, a full five-minute buffer should begin.

## Automated checks

- Mocked backend tests cover immutable content, persisted deadlines, reloads, no-op retries, failed setup recovery, request-supplied timestamp rejection, single/bulk creation and reassignment checks.
- Frontend tests cover reload-safe deadline calculations and preview content for MCQ, Technical, Basic and HR rounds.
- A local headless browser test covers review without a create request, acknowledgement, retained drafts, submitted preview values, 360px layout, waiting state, refresh during the buffer, automatic unlock and refresh after expiry. Screenshots and the result are in `outputs/assessment-preview-qa`.
