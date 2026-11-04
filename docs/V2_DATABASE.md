# Separate Prime Hire V2 database

- V1 configured database before the change: `primehire_admin`.
- New database on the same cluster: `primehire_admin_v2`.
- No V1 records were copied, queried or changed during this setup.
- V2 backend: `http://127.0.0.1:8002`.
- V2 frontend: `http://localhost:3000`; its proxy now targets port 8002.
- The existing server on port 8000 was not stopped or reconfigured.
- V2 has its own JWT signing key. V1 tokens do not authenticate against V2.
- Backend configuration is in the ignored `backend/.env`; frontend proxy
  configuration is in the ignored root `.env`. Do not commit either file.

## Start V2

From the project root, in separate terminals:

```powershell
.\backend\.venv\Scripts\python.exe scripts/run_v2_backend.py
npm run dev
```

The V2 launcher refuses a database name other than `primehire_admin_v2`.
It uses compatible MongoDB partial-index filters only in the V2 process:
nonempty string identifiers use `$type`/`$gt`, and active application stages
use an explicit `$in` list. The original shared index definitions, migration
files and CRUD code were not edited. The normal startup initialized the new
database and applied migrations 001–004 there.

## First administrator

An active pending super-admin account was created for `bhanu.manthena@vils.ai`.
Its password is chosen through the private invitation saved locally in
`v2-admin-invite.txt`, which is excluded from Git. The startup-created default
admin account was deactivated in V2. No V1 users were copied or changed.

Open the invitation in the browser, choose your password, and sign in.
Remove the local invitation file after use. An expired invitation can be
replaced without resetting an established password.

## Verification

The new database contains the initialized V2 collections and migration records.
An empty POST to `/api/auth/accept-invite` returns validation status 422 through
both port 8002 and port 3000, confirming the prior missing-route 404 is resolved
without submitting an actual password or consuming the invitation.
