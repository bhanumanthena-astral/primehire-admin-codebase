# Resume intake — operation and validation

Single PDF/DOCX/DOC, ZIP and prescribed XLSX intake share the durable V2 review
workflow. Extraction and form filling are local. Only ATS evaluation can call
the configured LLM, after human confirmation. The LLM never changes a stage or
sends an email. Each application retains its own ATS result and local comparison.

## Local startup

Use the existing `primehire_admin_v2` backend configuration. Both launchers refuse
to run against another database. The Node frontend must proxy FastAPI to port
8002. Never point the V2 launchers at V1.

```powershell
py -3.11 -m venv backend/.venv-v2
backend\.venv-v2\Scripts\python.exe -m pip install --upgrade pip
backend\.venv-v2\Scripts\python.exe -m pip install -r backend/requirements.txt
backend\.venv-v2\Scripts\python.exe scripts/run_v2_backend.py
backend\.venv-v2\Scripts\python.exe scripts/run_v2_resume_worker.py
npm run dev
```

Run these as separate services/processes. Windows background launchers must use
hidden windows. Local PIDs and diagnostic logs are in ignored `backend/runtime`.
Production needs a process supervisor; closing an ad hoc terminal is not a
deployment strategy. Retention and interrupted-job reconciliation run in the
dedicated intake worker every 30 seconds. Originals are private files, accessible
only through authenticated routes after a clean scan.

## Scanner and local document tools

ClamAV runs on loopback TCP3310. Its INSTREAM result must be clean; unavailable
scanners produce `scan_required`, never a fabricated clean result. The project-local
verified ClamAV distribution and current signature databases are under ignored
`backend/tools`. Local configuration is under `backend/runtime`.

```powershell
backend/tools/clamav-1.5.4/clamav-1.5.4.win.x64/freshclam.exe --config-file=backend/runtime/freshclam.conf --quiet
backend/tools/clamav-1.5.4/clamav-1.5.4.win.x64/clamd.exe --config-file=backend/runtime/clamd.conf
backend\.venv-v2\Scripts\python.exe scripts/verify_resume_tools.py
```

Run FreshClam regularly in deployment. The installer/package came from the
[official ClamAV distribution](https://docs.clamav.net/manual/Installing.html),
and its detached release signature verified against the vendor public key.

The development launchers discover project-local `backend/tools/tessdata` and
`backend/tools/antiword/antiword.exe`. The isolated DOC converter uses UTF-8 mapping
files from `share/antiword`. Its Windows package SHA256 matched the
[MSYS2 package record](https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-antiword).
English OCR data matched the official Tesseract repository's file hash. Real
scanned-PDF and Word97 conversion smoke checks passed. Different deployment hosts
must provision their own tools and set `RESUME_OCR_TESSDATA` /
`RESUME_DOC_CONVERTER` explicitly. Review third-party licenses for the chosen
deployment, including PyMuPDF and the separate GPL converter.

Parser children have a 60-second deadline, 768MB OS memory limit and a minimal
environment without application credentials. Legacy DOC conversion is additionally
limited to 20 seconds. PDFs have a 20-page limit. OCR supports English in the
installed configuration; unreadable or other-language documents require review.

## ATS configuration and behavior

`OPENROUTER_API_KEY` is server-only. `RESUME_ATS_MODEL` overrides the model for the
new ATS flow without changing legacy `OPENROUTER_MODEL`. The authorized local
override is `liquid/lfm-2.5-2.6b:free`, selected from the existing provider's
model catalog with structured JSON support. A synthetic live request returned a
validated score. ATS permits up to 1,600 output tokens because this free provider
requires internal reasoning before emitting JSON; the legacy allowance is unchanged.
Free-model availability and quotas are external dependencies.

ATS sends bounded, stripped confirmed skills, experience, education, role/summary
and job requirements. Original files and raw resume text are never sent. Known
names, company/university identifiers, dates of birth and contact details are
removed. Suspicious instructions block LLM evaluation. A strict response schema
validates the advisory overall score; local dimension scores remain separately
labelled. Large LLM/local disagreement flags reviewer attention. A provider error
retains the candidate/application and visibly uses the local score; Recalculate
ATS retries later. The provider uses shared rate/breaker governance and model-
scoped cache keys. `llm_runs` stores hashes/token counts/status, never prompts.

```powershell
backend\.venv-v2\Scripts\python.exe scripts/verify_ats_provider.py
```

This smoke check sends one synthetic request and uses an in-memory audit database.
It never uploads a candidate or writes to either live hiring database.

## Checks and capacity

```powershell
backend\.venv-v2\Scripts\python.exe -m pytest backend/tests --cov=app --cov-report=term-missing --cov-fail-under=80
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run build
npm run test:e2e -- --config playwright.intake.config.ts
```

The browser server uses in-memory Mongo, synthetic files and a test-only scanner;
the real-tool checks above separately exercise the real scanner/OCR/converter.
The suite tests 1,000 simultaneous upload attempts with bounded admission, and
50 same-person confirmations with no duplicate person/application creation.
These are correctness drills, not a measurement of 1,000 simultaneous large-file
uploads over a production network. Provision and load-test actual Mongo, shared
private storage, malware scanners, ingress and worker CPU/memory before making
a production throughput claim. Free-model quotas require explicit capacity
planning. ZIP defaults to 100MB/500 files; XLSX defaults to 5,000 rows. Admins can
adjust safe limits. Upload admission returns 429/Retry-After instead of accepting
unbounded processing work.

Local validation on 15 October 2026: the patched, isolated V2 runtime passed
1,126 backend tests with 80.85% coverage, all four Module 2 browser journeys,
and real scanner/OCR/DOC smoke checks. After the final free-model allowance
change, 35 focused ATS/legacy regression tests passed, including model-specific
cache separation and preserved legacy output limits. Frontend validation passed typecheck,
lint, 115 tests and the production build. Python dependency audit of the isolated
V2 environment and the production JavaScript audit reported no known
vulnerabilities. This does not replace deployment load testing or a native-tool
security review. The separate environment avoids replacing DLLs loaded by V1.

The V2 migration is additive: `006_resume_intake_v2`. It only creates indexes on
new intake collections and records its application. No V1 migration or backfill
is performed. Read-only preflight/snapshot verification:

```powershell
backend\.venv-v2\Scripts\python.exe scripts/v2_intake_preflight.py
# After activation:
backend\.venv-v2\Scripts\python.exe scripts/v2_intake_preflight.py --verify
```
