# Backend repository

Read docs/ENGINEERING_STANDARDS.md. Never print secrets or candidate PII.
Backend-only repository: Python source lives in backend/; operational scripts
live in scripts/. Keep /api compatibility with the separately deployed UI.
Run `python -m pytest -c pytest.ini --cov=app --cov-fail-under=80` with in-memory
MongoDB. Build releases using backend/deploy/build_release.py. No auth surface
changed by the repository split. Preserve tenant/job scope, role checks, encrypted
outbox and V2-only migration guards. Never copy private environments, uploads,
credentials, local databases or virtual environments into source control.
Frontend source and root Express compatibility server belong outside this repo.
