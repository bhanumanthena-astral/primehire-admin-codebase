# Elite HR V2 backend

Standalone FastAPI backend for Oracle. There is no frontend or Node server in
this repository. The `backend/` directory is retained so existing migration,
worker, test and deployment paths continue to work.

## Development

Use Python 3.11. From this repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
# Privately configure V2 MongoDB, provider accounts, keys and feature flags.
# MONGODB_DATABASE must be primehire_admin_v2; never use V1.
.\.venv\Scripts\python.exe scripts/run_v2_backend.py
```

The API listens on 127.0.0.1:8002. Configure assessment provider credentials in
backend/.env; there is no frontend root environment to inherit in this repo.
Local parsers/scanners must be installed separately; do not copy the old local
tools, uploads or environments into Git. Worker entry points are in scripts/.

Tests use in-memory MongoDB and synthetic providers:

```powershell
.\.venv\Scripts\python.exe -m pytest -c pytest.ini --cov=app --cov-report=term-missing --cov-fail-under=80
```

Monorepo frontend-export tests are intentionally excluded. All backend application,
authorization, isolation and deployment tests are retained. Cross-stack browser
fixtures remain in backend/tests; browser orchestration stays in the original
integration workspace until a shared integration test project is chosen.

## Oracle release

```powershell
python backend/deploy/build_release.py --version YOUR-UNIQUE-RELEASE
```

Follow [Oracle deployment](docs/ORACLE_BACKEND_DEPLOYMENT.md) and
[the current free-capacity profile](docs/ORACLE_FREE_TIER_KAFKA.md).
Production uses requirements-production.txt and the existing hardened deployment
entry points. Development requirements and tests are excluded from the release.
Do not run provisioning or migrations against an existing V1 host/database.

## Connect Cloudflare

Set the frontend Pages runtime BACKEND_ORIGIN to the backend's public HTTPS
origin. Set Oracle ALLOWED_ORIGINS to the exact frontend HTTPS origin and use
that frontend URL for invitation/access links and registered Google callbacks.
The backend owns authentication, authorization, MongoDB, files, provider keys,
workers and application state. Cloudflare owns static UI and the same-origin API
gateway. Both repos must preserve the existing /api contract when released.

No cloud deployment, database migration or live email is performed by this export.
The actual Oracle host and public Pages-to-Oracle flow still need smoke tests.
