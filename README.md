# PrimeHire Placement Admin

Administrative portal for PrimeHire placement assessments, candidate pipelines, and evaluation reports.

## Architecture

* **Frontend**: React 18 + Vite + Tailwind/CSS (`http://localhost:3000`)
* **Backend**: FastAPI + MongoDB Atlas (`http://localhost:8000`)
  - **Standard pinned port**: `8000`

---

## Quick Start

### 1. Backend (FastAPI + MongoDB)

The backend MUST run on pinned port **8000** using the isolated virtual environment:

```powershell
# 1. Start the backend with the venv python
.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload

# 2. Verify backend & MongoDB health
curl.exe http://127.0.0.1:8000/api/health
# Should return:
# {"status":"ok","app":"primehire-backend","mongo":"connected","database":"primehire_admin","counts":{"assessments":1,"candidates":14,"reports":1,"templates":0}}
```

### 2. Frontend (React + Vite)

Ensure root `.env` has:
```env
VITE_API_URL=http://localhost:8000
```

Start the frontend:
```powershell
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

---

## Troubleshooting: Dashboard Shows 0 Data

If the dashboard displays 0 assessments or 0 candidates, follow these verification steps:

1. **Verify `/api/health` Database Name and Document Counts**:
   Run:
   ```powershell
   curl.exe http://127.0.0.1:8000/api/health
   ```
   Confirm that:
   * `"mongo": "connected"`
   * `"database": "primehire_admin"` (or your intended Atlas database)
   * `"counts"` has positive counts (e.g. `"candidates": 14`).
   If `"database"` is `"primehire"` or counts are 0, check `MONGODB_DATABASE=primehire_admin` in `backend/.env` and restart the backend. Note: Uvicorn `--reload` does **not** auto-reload on `.env` file changes.

2. **Check `VITE_API_URL` Port Alignment**:
   * Inspect the root `.env`: `VITE_API_URL` must point to `http://localhost:8000`.
   * Check the bottom footer badge on the dashboard: it displays the connected API (`API: http://localhost:8000`) and DB (`DB: primehire_admin`).
   * If `VITE_API_URL` points to an old or different port (e.g. `8001`), the frontend is talking to the wrong backend process.

3. **Restart Vite After `.env` Changes**:
   * Vite loads `.env` variables at startup. Changes to `VITE_API_URL` in root `.env` require stopping and restarting Vite (`npm run dev`).

4. **Kill Stale Background Processes**:
   If an old backend is holding a port:
   ```powershell
   # Find process listening on port 8000 or 8001
   Get-NetTCPConnection -LocalPort 8000, 8001 -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess

   # Stop by PID
   Stop-Process -Id <PID> -Force
   ```
