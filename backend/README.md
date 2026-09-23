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

## Security policy

Candidate-portal `password` is never accepted, stored, or returned
(`schemas/candidate.py` rejects it, `models/candidate.py` strips it).
Credentials are regenerated via PrimeHire `POST /interview` when needed.
