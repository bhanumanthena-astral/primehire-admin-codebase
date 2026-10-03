# Deployment — tool-agnostic checklist (PrimeHire)

> No container files in this repo (see `CLAUDE.md`). Pick any host/VM/PaaS that
> satisfies the checklist below. Tested versions: Node v24.11.1, Python 3.11.9.

## 0. Hosting constraint

The FastAPI backend (`backend/app/main.py`) needs a **long-lived host process with a
persistent disk** — a VM, bare metal, or PaaS with disk persistence. Do **not** deploy
it to serverless/functions: in-memory rate limits, outbox workers, and the storage
directory (§5) do not survive there. The Cloudflare Pages Functions in `functions/api/`
are edge proxies only and stay serverless.

## 1. Pinned versions

- Python: `.python-version` (`3.11.9`). Create the venv from it; install
  `backend/requirements.txt`.
- Node/npm: `engines` in `package.json` (`node >=20.19.0`, `npm >=10`).
  `npm ci` (never `npm install`) for reproducible builds.

## 2. Environment variables

Copy the examples and fill in — never commit real values:

```powershell
Copy-Item backend\.env.example backend\.env   # backend
Copy-Item .env.example .env                   # frontend/BFF (server + Pages env)
```

Production requirements (enforced at startup by `validate_settings()` —
`backend/app/config.py`; boot fails with a named-variable error otherwise):

- `ENV=production`, `DEBUG=false`.
- `MONGODB_URI` set (reachable MongoDB with TLS + auth).
- `JWT_SECRET` set, ≥32 chars, not a placeholder. Generate:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `ALLOWED_ORIGINS` set to explicit `https://` origins (no `*`).
- `STORAGE_DIR` set to an absolute path on the persistent disk (e.g. `/data/storage`).
- Optional: `SENTRY_DSN`, `MIGRATION_SECRET` (one-time import; leave empty afterwards to
  disable the endpoint), `PRIMEHIRE_*`, `ZEPTOMAIL_API_KEY`, `VITE_API_URL` (build-time).

## 3. Start commands

```powershell
# Backend (from repo root; port 8000)
.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend `
  --host 0.0.0.0 --port 8000 --workers 2

# Frontend/BFF (from repo root; port 3000)
npm ci; npm run build
node dist/server.cjs

# Background worker (from backend/; REQUIRED for resume parsing/scoring —
# uploads enqueue jobs and the batch table polls until the worker finishes)
.\backend\.venv\Scripts\python.exe backend\cli.py worker --poll-seconds 5
```

Verify: `GET /api/health` → `{"status":"ok"}` (liveness);
`GET /api/ready` → `{"status":"ready"}` (Mongo + storage writable, else 503).

## 4. Process manager (sample — docs only, pick one)

systemd unit **or** pm2 — keep exactly one per host:

```ini
# /etc/systemd/system/primehire-api.service (sample)
[Unit]
Description=PrimeHire FastAPI
After=network.target mongod.service
[Service]
User=primehire
WorkingDirectory=/srv/primehire-admin-codebase
EnvironmentFile=/srv/primehire-admin-codebase/backend/.env
ExecStart=/srv/primehire-admin-codebase/backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --workers 2
Restart=on-failure
[Install]
WantedBy=multi-user.target
```

```powershell
# pm2 alternative (sample)
pm2 start "npm run start" --name primehire-web
pm2 start "backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000" --name primehire-api
pm2 start "backend/.venv/Scripts/python.exe backend/cli.py worker" --name primehire-worker
pm2 save; pm2 startup
```

Requirement: auto-restart on crash + on host reboot; logs to a rotated file or journald.

## 5. Persistent storage directory

- `STORAGE_DIR` must live on the persistent disk (backed up, §7), be writable by the
  service user only (`0700`/`0600`-style perms), and sit **outside any web-served
  directory**. `GET /api/ready` probes writability on every call.
- Uploads (when built) use random UUID filenames there; never the client filename.

## 6. Reverse proxy + HTTPS

- Terminate TLS at the proxy (HSTS on, HTTP→HTTPS redirect). Serve the frontend and
  proxy `/api/*` to `127.0.0.1:8000` on the same origin where possible.
- Forward `X-Forwarded-For/Proto` and set `Host`; backend trusts these **only** from
  the proxy. Enforce request-body caps at the proxy (JSON ~1 MB; uploads per §3 of
  `docs/ENGINEERING_STANDARDS.md`).
- Security headers (CSP, HSTS, `nosniff`, `frame-ancestors`) per §2.3 of the standards.

## 7. Backups

- MongoDB: scheduled snapshots (provider-native or `mongodump` cron), ≥30-day retention,
  off-site copy. Record schedule + location in the ops runbook.
- `STORAGE_DIR`: same schedule as the DB (point-in-time alignment); include in the
  off-site copy.
- Quarterly restore drill: restore both to a staging host, boot, check `/api/ready` and
  spot-read records. Log the drill date + result.

## 8. Pre-launch checklist

- [ ] `.python-version` + `engines` satisfied on the host.
- [ ] Prod env set per §2; `validate_settings()` passes (bad config = refused boot).
- [ ] `/api/health` 200, `/api/ready` 200 (`{"status":"ready"}`).
- [ ] HTTPS + HSTS live; `ALLOWED_ORIGINS` has no `*`; CORS preflight checked.
- [ ] Rate limits active on login/reset/upload/email endpoints (§2.4).
- [ ] `STORAGE_DIR` on persistent disk, correct owner/perms, included in backups.
- [ ] Backups scheduled + first restore drill logged.
- [ ] `npm audit` / `pip-audit` / gitleaks clean (CI gates on every PR).
- [ ] Diagnostics reachable: queue depth, failed emails/parses visible to admins.
