# Interview rescheduling audit

Reviewed on 13 October 2026. This change is limited to candidate interview scheduling and credential linkage. Assessment content publishing and question revision behavior are unchanged.

## Findings

- The supplied screenshot contains a `primehire-test.com` URL and `PRIME-` password from the retired testing fallback. Such credentials do not establish a real provider interview that can be rescheduled. The actual interview ID is not visible in the screenshot, so the provider's stored record was not inspected.
- Existing interview reschedules changed the provider and local state, but their persistence helper omitted `startTime` and `endTime`. Refreshing could therefore restore the previous dates.
- Regenerating credentials changed the local candidate key. The caller then tried to persist the result using the previous key, so the new interview ID could fail to reach the existing candidate record.
- Rescheduling relied on the browser's cached linkage even when another session had replaced the interview.

## Changes

- Keep the stable application candidate key when generating replacement credentials. A fresh provider candidate key is used only for the scheduling request.
- Reload persisted candidate linkage before changing an interview, and reject inactive candidates based on the current server record.
- Save the selected start/end times and current linkage to the existing candidate record after a provider reschedule.
- For candidates with no real interview, save their planned window before presenting it as saved. No provider reschedule call is made with a retired testing identifier.
- Reject known testing, job, candidate, response, and malformed identifiers before calling the reschedule endpoint. Both the observed opaque provider IDs and UUID-style IDs remain supported.
- When the provider reports an invalid/missing interview, keep the entered window and offer an explicit Create New Interview action. This creates candidate credentials against the existing assessment, then saves the new interview ID. It does not create an assessment or publish edited questions.
- Provider failures leave the saved window unchanged. If the provider accepts a change but the portal save fails, show a partial-success warning instead of claiming the portal has saved it.

## Manual retest

1. Use a candidate with a genuine provider interview link. Select a future IST start and end at least 24 hours apart, reschedule, then refresh. Both dates and the existing link should remain correct.
2. Regenerate a candidate link, refresh, and reschedule again. The candidate should retain the same application key, and the provider request should use the replacement interview ID.
3. Open the same candidate in two browsers. Replace the link in one browser, then reschedule from the other. The second browser should load the current stored interview ID.
4. For an old testing record, save a valid future window. It should not send `int-*` or a candidate/job key to the provider. Use Generate Link to obtain real credentials before inviting the candidate.
5. If the provider no longer recognizes a genuine interview ID, confirm the recovery message. Choose Create New Interview only when a replacement link is intended, then send the new credentials to the candidate.
6. Force a request failure during local QA. A provider failure must not change the stored dates. A portal-save failure after provider acceptance must display a warning.

The current minimum 24-hour policy is retained. These changes do not repair provider start-time enforcement, publish edited assessment questions, or automatically invalidate an earlier provider link.

## Validation

- 17 focused rescheduling checks cover current stored linkage, persistent dates after refresh, legacy testing records, failed requests, replacement credentials, and rescheduling after link regeneration.
- All 187 frontend tests passed with `npx vitest run --testTimeout=60000`. The default timeout had intermittently expired while importing the existing report component; assertions were unchanged.
- TypeScript and the production build passed. The existing large-bundle warning remains.
- No live provider requests, invitations, or production candidate changes were made. Deployment and manual testing with a genuine provider interview remain pending.
