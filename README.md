# Jobs module completion

Google sign-in and interview Calendar setup: [configuration and behavior](docs/GOOGLE_SIGN_IN_CALENDAR.md).

Folder layout, cleanup, Git safeguards and credential follow-up: [repository structure audit](docs/REPOSITORY_STRUCTURE_AUDIT.md).

V2 acceptance records: [Resume Module](docs/RESUME_ACCEPTANCE.md),
[Recruitment workflows](docs/RECRUITMENT_ACCEPTANCE.md), and
[Intelligent talent pool](docs/TALENT_POOL.md). Drive integration is excluded.

The supplied requirements are preserved in `docs/JOBS_SPEC.md`; the requirement
map and verification record are in `docs/JOBS_COMPLETION.md`. Both template and
ordinary JD imports now parse locally, with no LLM call. Resume AI scoring is
unchanged. New jobs are drafts until published, and intake respects status,
opening/closing dates and filled positions.

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.
The browser tests use Edge, ports 8001/4173, an in-memory database and fictional
users; these ports must be free. No live database, email or LLM is used. Backend:
`backend/.venv/Scripts/python.exe -m pytest backend/tests --cov=app --cov-fail-under=80`.
Migration 004 normalizes legacy date values to UTC while preserving their old
organization-local closing boundary; deploy through the normal migration runner.
The background worker must run for automatic closure and email delivery.

The shadcn stylesheet and MIT license are preserved in `src/styles/` so the app
does not install the unrelated CLI and its vulnerable dependency chain. To
regenerate the fictional browser fixture, run `scripts/make_jobs_browser_fixture.py`.

V2 uses a separate database and backend launcher. See `docs/V2_DATABASE.md`
for startup, and `docs/JOBS_ACCESS_AND_CARDS.md` for the new card layout,
administrator status selector, account permissions and per-job access controls.
# Resume Upload Module 2

The isolated V2 workflow supports single PDF/DOCX/DOC, ZIP and Excel imports,
local extraction, human review, duplicate-safe candidate/application creation,
ATS-only LLM evaluation, local fallback, reports and exports. See
[the Module 2 runbook](docs/MODULE2_RUNBOOK.md) for startup, scanner/OCR/converter
setup, validation commands, V1 protection and deployment capacity requirements.

# Recruitment portals

V2 now includes a recruitment tracker, shared interview calendar, manual scheduling,
technical/managerial/HR workspaces, locked reviews, HR questions and compensation.
See [the recruitment runbook](docs/RECRUITMENT_PORTALS.md) for roles, invitations,
access controls, the dedicated worker, migration and validation commands.
# Oracle backend deployment

The UI now lives in [frontend/](frontend/README.md), with its own package and
Cloudflare build. Pages Git settings: root `frontend`, build `npm run build`,
output `dist`. Leave the runtime `BACKEND_ORIGIN` unset for frontend-first
deployment, then connect it to Oracle HTTPS. No backend secrets belong in the
frontend package. Root install/test/build commands remain compatibility entries.

Elite HR V2 uses an independently packaged FastAPI backend. The deployment
scripts, private configuration template and cutover/backup procedures are in
[docs/ORACLE_BACKEND_DEPLOYMENT.md](docs/ORACLE_BACKEND_DEPLOYMENT.md).
Oracle provisioning and public HTTPS remain pending account/VM availability;
the Cloudflare frontend is a separate deployment step.
