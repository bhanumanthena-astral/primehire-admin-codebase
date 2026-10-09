# Interview window audit — 8 October 2026

## Confirmed findings

The reported invitation is for 8 October 2026, 5:05 PM–8:02 PM IST.
The matching saved candidate record contains:

- Candidate key: `CAND-9786996B`
- Assessment: `JOB-9D58468D`, BASIC
- Interview ID: `175531464472321ba89684675b0f3763b0027b45`
- Start: `2026-10-08T11:35:00.000Z`
- End: `2026-10-08T14:32:00.000Z`

These UTC timestamps represent exactly the requested IST times. Initial candidate entry and CSV conversion use explicit IST arithmetic, not the browser timezone. The API client serializes the schedule fields, and both Express and Cloudflare proxies forward them without applying an additional timezone conversion. The database record alone cannot establish what timestamps the provider persisted internally.

At `2026-10-08T11:42:55.860934+00:00` (5:12:55 PM IST), the candidate login API returned HTTP 401 with `Your interview time slot has been completed`. Its HTTP Date header was `Thu, 08 Oct 2026 11:42:56 GMT`, within the requested window. Both scheduling and portal API hosts returned HTTP 200 from the interview status endpoint and reported that the candidate had not started or submitted the interview.

The supplied API reference (§4, §7.1, §7.2) defines offset-bearing ISO timestamps, start as earliest entry, and end as latest completion. Assessment creation and candidate scheduling are separate operations. The status endpoint does not expose the stored schedule, so it cannot confirm that the provider persisted the requested end time.

## Approved live diagnostic interviews

Two synthetic candidates were scheduled on the existing assessment. No invitations were sent, no interview questions were fetched, and no answers were submitted. The real candidate was not modified.

| Format | Synthetic candidate | Interview ID | Initial result |
| --- | --- | --- | --- |
| `Z` | `CAND-TZAUDIT-77B968C59E` | `17553577a303b2b12563483d662028c8f6b26ef6` | Schedule HTTP 201; login HTTP 401, slot completed |
| `+00:00` | `CAND-TZAUDIT-8D70B903C2` | `17553577717e0513acb184be7af6d433aef241c6` | Schedule HTTP 201; login HTTP 401, slot completed |

Both initial windows represented the same instants: start `2026-10-08T11:50:59.420+00:00`, end `2026-10-08T13:50:14.420+00:00`. Login checks ran after the start and well before the end. The failure is therefore reproducible with freshly created interviews and with the exact timestamp suffix used in the documentation.

The two synthetic records were subsequently rescheduled to probe offset handling. The first used `17:24:15.738–19:23:45.738+05:30`; the second used `11:54:15.738–19:53:45.738+00:00`. Both returned HTTP 206, `Interview has been rescheduled`. These follow-up reschedules were not login-verified; their acceptance alone does not establish a workaround. The diagnostic records remain in the provider service.

## Local corrections

At the user's request, a temporary frontend policy now requires an interview window of at least 24 elapsed hours. This is a product workaround, not a documented PrimeHire API requirement or a confirmed provider fix. Manual scheduling, CSV review/import, bulk scheduling, rescheduling, generation, and regeneration enforce the same shared policy. Forms display the requirement, and windows shorter than 24 hours cannot reach the scheduling API through this frontend. Unscheduled candidate registration remains available; existing saved schedules are not automatically extended. The previously successful overnight example was less than 24 hours, so its success alone does not establish that 24 hours is technically necessary or sufficient for every portal case.

- Existing interviews show an open window until the completion deadline; passing the start no longer implies expiry.
- Reschedule picker values explicitly represent IST, independent of the browser timezone; invalid calendar dates are blocked.
- Scheduling and rescheduling requests normalize instants once at the API boundary into millisecond ISO timestamps with `+00:00`, matching the documented examples. `Z` is also valid ISO; the live comparison proves that changing this suffix alone does not fix the provider rejection.
- Invitations render explicit IST dates and times, independent of the sender's browser timezone.
- Regression tests intercept the real API client's fetch calls and assert the exact reported window and reschedule payload, rather than duplicating the implementation.

## Provider investigation needed

### Additional overnight-window comparison

The user supplied a new scheduled interview, `1755383dbabd68fdf3ae8a8b962513f40111dcd2`, for candidate `CAND-3602137C`. Its local saved window is `2026-10-08T12:05:00.000Z` through `2026-10-09T06:30:00.000Z` (8 October, 5:35 PM IST through 9 October, noon IST). At `2026-10-08T12:03:57.629927+00:00` (5:33:57 PM IST), the portal login returned HTTP 201, `Logged in successfully`. No interview questions were fetched and no answers were submitted. Authenticated `check-login-status` returned only status/message, without stored schedule fields.

This shows that the new overnight-window credentials work while the earlier valid same-day windows were rejected. It strengthens the UTC-versus-local expiry hypothesis: a same-day `14:32Z` misread as 2:32 PM local would already be expired, while next-day `06:30Z` misread as 6:30 AM local would still be future. It does not establish the provider's stored values or exact comparison implementation. Login before the earliest interview start does not by itself prove that the interview can begin early; the portal may validate the start at a later step.

The two responses supplied by the user are a PrimeHire scheduling success response followed by the local candidate persistence response. They do not indicate two scheduling requests. The persistence response contains locally fabricated candidateUUID/responseId placeholders from legacy mapping; those are not provider-issued identifiers and were not used by the tested portal login.

The remaining rejection is generated by `POST https://api.elitehr.nxtagent.ai/primehire/api/v1/candidate/login`. The provider needs to inspect the persisted start/end timestamps for the listed interview IDs, compare them with the submitted request, and inspect the expiry comparison and any additional assessment-level login rules. A timezone-aware/naive comparison or a persistence conversion is a hypothesis, not yet a confirmed implementation cause. Do not add 5.5 hours to the UTC timestamps or extend the real candidate's deadline as a speculative workaround.

Suggested message for the provider:

> Candidate login returns HTTP 401 “Your interview time slot has been completed” during a valid scheduled window. Interview `175531464472321ba89684675b0f3763b0027b45` was requested for `2026-10-08T11:35:00.000Z` through `2026-10-08T14:32:00.000Z`, and login was rejected at `2026-10-08T11:42:55Z`. Two fresh synthetic interviews reproduce the same failure using both `Z` and documented `+00:00` timestamps. Please verify the stored schedule and the candidate-login expiry comparison, including timezone handling and assessment-level constraints. Status endpoints report not started, not submitted.
