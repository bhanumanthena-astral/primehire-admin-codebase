# Process.md — How to Start This App (Copy & Use Anytime)

> Verified on: 2026-10-06 | Node v24.11.1, npm 11.7.0, Windows PowerShell
> App boots on `http://localhost:3000` via `npm run dev` (`tsx server.ts`)
> Health check: `GET http://localhost:3000/api/health` → `{"status":"ok"}`

This repo has **two parts**:
1. **Frontend + BFF proxy (main app)** — React + Vite + Express (`server.ts`, port `3000`). **This is what you run normally.**
2. **Backend (optional)** — FastAPI + MongoDB (`backend/`, port `8000`). Only needed if you are working on the MongoDB read cutover.

---

## 0. Prerequisites (one-time per machine)

```powershell
# Check versions (need Node 20+)
node --version
npm --version
python --version   # only for optional backend
```

---

## 1. First-time setup (one-time per clone)

```powershell
# 1. Go to project root
Set-Location -LiteralPath "C:\Users\onlyf\Desktop\Primehire-admin-v1"

# 2. Install dependencies
npm install

# 3. Create .env from example (already exists in this machine, skip if .env present)
Copy-Item .env.example .env

# 4. Edit .env and fill real values:
#    PRIMEHIRE_ACCESS_KEY=...
#    PRIMEHIRE_SECRET_KEY=...
#    ZEPTOMAIL_API_KEY=...
#    BACKEND_URL=https://api.placement.vils.ai/primehire/api/v1  (default works if unset)
notepad .env
```

> Without `PRIMEHIRE_ACCESS_KEY` / `PRIMEHIRE_SECRET_KEY` the app still starts,
> but `/api/backend/*` and `/api/primehire/*` return `500 CONFIGURATION_ERROR`.

---

## 2. Start the app — Daily use (copy this)

```powershell
Set-Location -LiteralPath "C:\Users\onlyf\Desktop\Primehire-admin-v1"
npm run dev
```

Then open:

- App: http://localhost:3000/
- Health: http://localhost:3000/api/health  (should show `{"status":"ok"}`)

Stop with `Ctrl + C`.

---

## 3. Other commands

```powershell
npm run lint    # typecheck: tsc --noEmit
npm run build   # production build -> dist/ + dist/server.cjs
npm start       # run production build (needs `npm run build` first), same port 3000
```

---

## 4. Optional backend (FastAPI, port 8000) — only if needed

```powershell
# Setup (one-time)
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env   # then fill MONGODB_URI etc.
notepad backend\.env

# Run
.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000

# Health: http://localhost:8000/api/health
# Tests (no Atlas needed):
.\backend\.venv\Scripts\python.exe -m pytest backend\tests -v
```

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 3000 already in use` | `Get-Process -Name "node" \| Stop-Process -Force` then `npm run dev` again |
| `CONFIGURATION_ERROR` on `/api/backend/*` | Check `.env` has `PRIMEHIRE_ACCESS_KEY` + `PRIMEHIRE_SECRET_KEY`, restart server |
| `ZeptoMail API key is missing` | Add `ZEPTOMAIL_API_KEY` to `.env`, restart |
| Blank page / HMR flicker | Normal Vite dev; hard refresh `Ctrl+Shift+R` |
| `npm install` fails | Delete `node_modules`, `package-lock.json` stays, run `npm install` again; ensure Node 20+ |
| Backend `mongo: not_configured` | Normal without `MONGODB_URI` in `backend/.env`; app still boots |
| `Dashboard shows 0 for everything` | Check `curl http://localhost:8000/api/health` for DB name & counts. Ensure `VITE_API_URL=http://localhost:8000` in `.env` and restart Vite (`npm run dev`). Kill any stale backend on 8001. |

---

## Quick-verify (after start)

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health"
# Expected: status : ok
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/
# Expected: 200
```
