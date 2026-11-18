# Admin redesign requirement checklist
Scope is role admin. Preserve super_admin behavior, PostgreSQL, Kafka, APIs and authorization. Keep changes local.
- Admin landing: implemented AdminHome; browser validation pending.
- Five guided stages: implemented AdminHiringProgress and role routing; browser validation pending.
- Progress: existing backend job counters, automatic refresh, existing base-ui Progress. Requested ASTRYX component is absent from installed code/dependencies. Existing compatible progress chosen to avoid a new dependency.
- Preferences: selected step stored per org/user/job. Resume table uses useTableColumnSettings and user-scoped preferenceKey. Cross-user regression required.
- ATS range: existing slider plus synchronized inputs; existing matchingApplications reads across pages; tests exist.
- Assessment choice: guided workspace now opens existing assignment component in Modal. Actual APIs preserved.
- Interviews and decisions: existing ScheduleDialog, RecruitmentWorkspace, reviews, offer and hire operations reused. End-to-end validation pending.
- Remaining pages: existing Jobs, Resume, Reports, Team pages retained; Admin-wide simplification needs verification.
- Reference research: Dribbble dashboard page inspected via Somputer 2026-11-17. Astra is not an available model-switching tool; user approved Sol medium.
- Tests: rerun after current changes. Existing passing results are historical.
- No push or deployment authorized in current scope.
