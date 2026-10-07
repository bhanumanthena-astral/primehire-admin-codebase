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
| `MONGODB_URI` | Atlas connection string (mongodb+srv://.) |
| `MONGODB_DATABASE` | Database name (default `primehire`) |
| `PRIMEHIRE_BASE_URL` | PrimeHire API base (has working default) |
| `PRIMEHIRE_ACCESS_KEY` / `PRIMEHIRE_SECRET_KEY` | Server-side PrimeHire credentials |

`backend/.env` is the single canonical home for PrimeHire keys. For isolated
live testing use `backend/.env.dev` (`MONGODB_DATABASE=primehire_dev`, see
`.env.dev.example`) via `$env:BACKEND_ENV_FILE=".env.dev"` — never test
against `primehire_admin`. Both `.env` and `.env.dev` are git-ignored.

## PrimeHire key checks (presence vs live)

| Check | Meaning |
|---|---|
| `GET /api/primehire/status` (public) | **PRESENCE ONLY** — keys exist in backend env. Says nothing about validity. |
| `GET /api/primehire/check` (admin-only) | **LIVE** — calls PrimeHire `GET /response/report-not-generated` server-side, relays only the upstream HTTP status (200 = accepted, 401 = rejected). Bodies/keys never returned. |
| A `ZZ TEST` assessment reaching `syncState.synced` | End-to-end proof (also covers the assessment payload mapping). |

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

## Security policy

Candidate-portal `password` is never accepted, stored, or returned
(`schemas/candidate.py` rejects it, `models/candidate.py` strips it).
Credentials are regenerated via PrimeHire `POST /interview` when needed.
