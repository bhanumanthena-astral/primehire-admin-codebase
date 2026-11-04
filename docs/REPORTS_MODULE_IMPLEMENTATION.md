# Reports module implementation

Implemented against the Reports Section PRD supplied on 2 November 2026. The new workspace is at `/reports` and in the Reports navigation item. Job candidate reports open the same stored evidence contract; interviewer review screens expose previous-round snapshots.

| Requirement group | Implementation |
| --- | --- |
| Listing, combined search/filters, global sorting and pagination | Complete. Candidate/report/application/job/round searches; round/status/job/application/date filters; backend totals reflect authorization. |
| Detail context and navigation | Complete. Candidate, application, job, round, attempt, report version, generation status and source timestamps; candidate/application history retains its application context. |
| Basic and Technical evidence | Complete for returned fields. Overview, supplied grades/scales, detailed feedback, skill profile, communication, source distribution, consolidated question analysis, AI summary and integrity evidence. |
| Partial/missing/pending/zero states | Complete. Zero remains zero; no inferred score scale, grade, AI conclusion, transcript, proctoring clearance or hiring decision. |
| Mixed and HR schemas | Guarded as required by PRD. Common metadata is available; unconfirmed round-specific fields are withheld until a provider contract is supplied. |
| Versions and attempts | Complete. Immutable `report_versions` and `report_summaries`; distinct report series per application/attempt. Identical source content is idempotent. Current version and currently linked application attempt are independent indicators. |
| Previous-round summaries | Complete. Source report/version/round/attempt and snapshot timestamp retained; skill/communication/performance/AI/integrity fields are source snapshots. No question/video/transcript payload in summaries. |
| Downstream historical integrity | Complete. New interview scheduling pins a snapshot. An explicit authorized refresh can replace a scheduled interview's snapshot; submitted reviews cannot be rewritten. Later report capture never silently changes an existing snapshot. |
| Human evaluation separation | Complete. Managerial/HR reviews remain in their existing modules and collections. Report history reads authorized human evaluations separately. |
| Access and audit | Complete. Tenant, application/job relationship, job ownership, interviewer assignment, prior-round timing and visible-field permissions; view/sync/export/control/video events audited. Legacy direct report lookup now requires proven tenant ownership. |
| Media | Authorized streaming route and controlled loading implemented. HTTPS, explicit approved origin, public DNS, no redirects, bounded size; unavailable clips do not hide other evidence. |
| Export and controlled validity | Administrators may export JSON and archive/invalidate/restore the current version with a reason. Earlier evidence and downstream snapshots are retained. Recruiter/interviewer permissions do not allow these actions. |

## Backend rules reconciled with the existing app

- The officially linked attempt is the application's `assessment.interviewId`; other attempts are retained and never silently promoted because they are latest or highest scoring.
- Provider generation status is distinct from application/round completion. The provider status/availability and question-generation flags drive report lifecycle. A score alone does not make a report complete. For confirmed Basic/Technical schemas, a usable overview and question analysis are required; missing optional metrics do not make a report Partial.
- Provider generation timestamps are displayed only if supplied. The application separately records capture time; it does not label fetch time as provider generation time.
- Existing scheduling readiness and manual-exception rules remain authoritative. No new automatic block or hiring decision was introduced for a missing/partial report. The UI exposes snapshot availability and an explicit capture action.
- `reports.view` follows current staff roles; `reports.refresh` is available to administrators, recruiters and HR; export/version controls are administrator-only. Existing assessment/previous-review visible-field revocation remains enforced.
- Date display and date-range boundaries use the organization timezone.

## Storage and API

- `report_catalog`: current series metadata, scoped to tenant/application/candidate/job/attempt.
- `report_versions`: immutable source/presentation evidence per version, with controlled validity metadata.
- `report_summaries`: immutable snapshots referencing exact versions.
- `recruit_interviews.reportSummarySnapshot`: pinned source reference for the interview.
- Migration: `backend/migrations/reporting_v2.py` creates scoped lookup and unique indexes.
- `/api/reporting/capabilities`, `/reports`, `/reports/{id}`, `/reports/{id}/versions`, `/applications/{id}`, `/summaries/{id}`, `/interviews/{id}/summary`.
- Explicit background sync: `POST /api/reporting/sync`. The `report_sync` worker only reads provider status/reports; it does not generate new assessment links or send invitations.
- Admin controls: `POST /api/reporting/reports/{id}/version-action`; JSON export and authenticated question media routes.

## Provider-dependent configuration

`REPORT_MEDIA_ALLOWED_HOSTS` is a comma-separated list of approved media hostnames. The provider API hostname is also permitted. Configure actual clip origins when the provider returns third-party media; clips from other origins are reported unavailable. No provider credentials are forwarded to third-party media hosts.

Mixed/HR detailed schemas, new scoring scales/grade definitions, provider-generated summaries and additional metrics remain provider inputs. The UI renders supplied supported values and explicitly identifies absent data. No substitutes are invented.

## Validation

- Full backend regression suite: 1,853 tests passed before the final job-dialog adapter; targeted report/job-report tests cover that adapter separately.
- Full frontend regression suite: 229 tests passed; targeted report/job-report tests and TypeScript checks validate the final integration.
- Desktop/mobile browser checks cover listing, detail navigation, zero scores, one consolidated question-analysis section, missing media and page width.
- Initial V2 indexing found 14 linked assessment applications: 7 completed reports and 7 not-started assessments. Source records and historical application stages were preserved.
