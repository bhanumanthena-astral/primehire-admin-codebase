# PrimeHire backend (FastAPI + MongoDB Atlas) — Phase 1: database foundation

## Setup

```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env   # then fill in values (never commit)
```

Required variables (`backend/.env`, git-ignored):

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string (mongodb+srv://…) |
| `MONGODB_DATABASE` | Database name (default `primehire`) |
| `PRIMEHIRE_BASE_URL` | PrimeHire API base (has working default) |
| `PRIMEHIRE_ACCESS_KEY` / `PRIMEHIRE_SECRET_KEY` | Server-side PrimeHire credentials |

## Run locally

```powershell
.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
# GET http://localhost:8000/api/health
```

Without `MONGODB_URI` the API still boots (health reports `"mongo": "not_configured"`).
With a URI, startup ensures all indexes and health reports `"connected"`/`"unreachable"`.

## Tests (no Atlas needed — in-memory mongomock-motor)

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -v
```

## Background worker (Phase 2 Slice B)

Resume uploads only validate, store, and enqueue. Parsing, LLM scoring, and
job matching run in the worker — it must be running or batches stay `processing`:

```powershell
.\backend\.venv\Scripts\python.exe backend\cli.py worker --poll-seconds 5
```

Phase 2 env additions (`backend/.env`, see `backend/.env.example`):
`LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (empty = LLM
disabled → deterministic scores + visible flag), `LLM_CONCURRENCY`,
`OUTBOX_ENCRYPTION_KEY`, `ZEPTOMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`,
`UPLOAD_MAX_MB`, `UPLOAD_BATCH_MAX`, `UPLOAD_MAX_UNCOMPRESSED_MB`,
`CLAMAV_ENABLED`, `RETENTION_DAYS`.

Slice C email/upstream safety (`backend/.env`, see `backend/.env.example`):
`EMAIL_DRY_RUN` (default true — records without sending; production refuses
true), `EMAIL_TEST_RECIPIENT_ALLOWLIST` (required outside production when
dry-run is off), `EMAIL_FROM_NAME`, `ASSESSMENT_SYNC_BATCH`,
`ASSESSMENT_SYNC_INTERVAL_S`. Real sends need `ZEPTOMAIL_API_KEY`,
`EMAIL_FROM_ADDRESS`, `OUTBOX_ENCRYPTION_KEY`, plus `PRIMEHIRE_*` for
interview creation. Test with your own addresses only.

## Security policy

Candidate-portal `password` is never accepted, stored, or returned
(`schemas/candidate.py` rejects it, `models/candidate.py` strips it).
Credentials are regenerated via PrimeHire `POST /interview` when needed.
