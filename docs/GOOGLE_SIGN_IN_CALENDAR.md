# Google sign-in and interview calendar

Elite HR uses direct Google OAuth, without Firebase, Identity Platform, paid intermediaries or new dependencies. Google login is limited to existing active members in `GOOGLE_LOGIN_ORG_ID`; organization membership and roles remain server controlled. Existing MFA stays required. Administrators must enroll MFA through their current sign-in before Google login is accepted.

Administrators can sign in with their existing password, open **Google Calendar → Two-factor authentication**, add the displayed setup key to an authenticator app, verify its code, and save their recovery codes privately. Google sign-in then continues through the existing verification-code screen.

## Configure your existing Web application client

1. In your Google Cloud project, enable Google Calendar API and configure Google Auth Platform branding, audience and data access. Use your existing OAuth client of type **Web application**. An API key cannot sign users in or authorize private calendars.
2. Register this exact development redirect URI: `http://localhost:3000/api/auth/google/callback`. For Cloudflare, register `https://YOUR-APP-DOMAIN/api/auth/google/callback` and set the same value below. Google requires an exact URI match; a changing temporary tunnel URL must be registered again. Use one canonical application origin per backend configuration.
3. Keep the downloaded client JSON private. Run the configuration helper below; it reads credentials locally without displaying them. Alternatively set the variables in `backend/.env` or your backend secret store yourself. Never place the secret or encryption key in browser environment variables, source control or chat.

   ```powershell
   .\backend\.venv\Scripts\python.exe scripts\configure_google_oauth.py --client-json "C:\path\client_secret.json" --redirect-uri "http://localhost:3000/api/auth/google/callback"
   ```

   The helper checks the registered URI in the JSON. If Google omitted that metadata or you updated the client afterward, first save the exact URI in Google Cloud, then pass `--confirm-registered-redirect`. It preserves an existing encryption key, generates a dedicated Fernet key if absent, and enables the feature only after validation. It does not contact Google, enable billing or change Cloud resources. Restart the V2 API and recruitment worker afterward.

   On this workstation the supplied JSON is stored at `backend/secrets/google-oauth-client.json`, with runtime credentials in `backend/.env`. Both locations are Git-ignored and excluded from frontend/backend release archives. The configured callback is `http://localhost:3000/api/auth/google/callback`, confirmed registered by the user. Google sign-in through a Cloudflare hostname requires that hostname’s registered callback and the matching backend configuration.

4. Variables: `GOOGLE_OAUTH_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_LOGIN_ORG_ID=default`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CALENDAR_DAILY_LIMIT=10000`. Keep the encryption key stable across API/worker deployments and backups; losing it requires reconnecting every Google account. OAuth is restricted to `primehire_admin_v2`.
5. For an External consent screen in Testing, add your team as test users. Google refresh tokens involving Calendar scopes normally expire after seven days in Testing. Publish/verify the consent screen as required by Google before general production use; internal Workspace apps have different audience/admin requirements. A Workspace administrator may also need to trust the app.
6. Restart the app, select **Sign in with Google**, and sign in with the email already on the Elite HR team account. After sign-in, each interviewer selects **Google Calendar → Connect Google Calendar** and grants access using that same account. Google login initially requests only `openid email profile`; the Calendar connection requests incremental `calendar.events.owned` access to owned calendars. Elite HR operates on `primary` only. Initial Google login via a non-Gmail, non-Workspace email must first be explicitly linked from an existing authenticated Elite HR session.

Run migration dry-run before deployment:

```powershell
$env:PYTHONPATH="backend"
.\backend\.venv\Scripts\python.exe -m migrations.google_workspace_v2 --dry-run
```

The normal versioned migration runner applies `006_google_workspace`. No existing resumes, reports, interviews or users are rewritten.

## Cancelled or stalled Google connections

Google sign-in start, Calendar status/connect/disconnect requests, and callback completion have a 30-second browser deadline. The start/redirect buttons also recover after 30 seconds if navigation never completes. A browser Back restore after cancelling Google clears the busy state immediately. Errors expose sign-in/connect actions again; callback errors have a direct retry action. Late responses after timeout/cancellation cannot redirect the page or apply a late Google login response.

The Google sign-in button displays **Recently used** when the last successful login on that browser used Google, including successful MFA completion. A later successful password login replaces that preference. The preference stores only `google` or `password`, without identities, credentials or tokens. Calendar consent alone does not change the last sign-in method. Google’s own consent page remains under Google’s control; these deadlines apply to waiting inside Elite HR.

## Scheduling behavior

Availability uses the **assigned interviewer’s primary Google Calendar**, not the scheduler’s calendar. Meetings block only when their time overlaps the proposed interview. The API expands recurring events, respects all-day calendar timezones and ignores cancelled, transparent/free and self-declined events. Adjacent meetings do not overlap. The existing Elite HR candidate/interviewer collision checks remain authoritative as well.

Google Calendar connection is optional. Admins and super admins can schedule and reschedule an active interviewer before that person connects Google; the interview is stored in the shared in-app calendar with `not_connected` Google status, without a Google availability claim or reminder. The staff picker shows the interviewer’s name and whether they have a calendar grant. Check availability is shown only for a connected interviewer. Connection metadata stays org-scoped and contains no Google email, tokens or meeting details. Selected interviewer metadata is retained across staff search and pagination.

For connected interviewers, managers may preview availability and the backend checks again before saving. A real overlap still blocks booking, as do provider outages or unknown availability on a connected calendar; unknown never means free. An expired/revoked grant marked for reconnection permits manual scheduling. Other meeting titles/details are neither returned to the manager nor stored. When Google is disabled, local scheduling remains available and explicitly states that no Google reminder was created. An interviewer can connect later; subsequent scheduling/rescheduling uses their calendar automatically.

For connected calendars, after a successful preflight, booking and a durable Calendar delivery intent are saved under the interview lease. A manual booking without an existing Google mapping creates no phantom sync job. The API tries event delivery immediately. Pending failures stay visible on the interview and retry with bounded backoff via `scripts/run_v2_recruitment_worker.py`. A deterministic event ID prevents duplicate events after retries/crashes. A worker rechecks availability, and a conflict introduced between preflight and event delivery becomes a visible conflict requiring rescheduling. Google has no atomic availability-and-create transaction, so unrelated apps can still introduce later overlaps.

Events are private, contain only interview round, time and optional joining/location information, and use the chosen 10/15/20-minute popup reminder. They do not include candidate contact details, resume text, attendees or invitation emails. Device/browser Calendar notification permissions still govern whether a popup is displayed.

Rescheduling updates the event. Reassigning the interviewer creates the new event and removes the old owned event; cleanup failures stay visible and block another reassignment until resolved. Cancellation queues removal of owned events even during an outage. The worker checks event ownership before modifying/deleting. A manually deleted Google event needs a new Elite HR interview to recreate its reminder. Disconnecting erases the local encrypted grant and attempts Google revocation; existing Calendar events remain, so reconnect to update/remove them. Google identity linkage remains for sign-in.

## Security and zero-spend boundaries

Authorization codes use PKCE S256 and one-use state bound to a HttpOnly SameSite cookie. OIDC signatures, issuer, audience, expiry, verified email and nonce are checked. Completion uses a short-lived HttpOnly ticket and existing application sessions; application JWTs and provider tokens do not appear in redirects. Calendar grants are encrypted separately from users. Self-service connection routes reject impersonation. Availability and retry routes require recruitment management and authorized job/application access. OAuth query parameters are redacted from Uvicorn access logs; reverse proxies should also omit callback query strings from access logs.

Google currently says standard Calendar API use has no additional cost, with charging above its published free threshold planned later in 2026. This is not a lifetime pricing guarantee. Elite HR imposes a shared hard cap of at most 10,000 Calendar requests/day per OAuth client, plus 100/min globally and 20/min per user; it stops on budget, permission and quota errors. It never enables Cloud billing, increases quotas or falls back to a paid provider. Use a dedicated Google project with billing disabled to keep this feature outside paid billing. The application cannot control usage from other applications in a shared Cloud project.

Official references: [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OpenID Connect validation](https://developers.google.com/identity/openid-connect/openid-connect), [Calendar authorization](https://developers.google.com/workspace/calendar/api/auth), [Calendar quotas and pricing](https://developers.google.com/workspace/calendar/api/guides/quota), [Testing refresh token expiry](https://developers.google.com/identity/protocols/oauth2), [scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

Automated tests use synthetic identities and mocked provider responses. Live Google sign-in and reminder delivery require your registered OAuth client and an interviewer’s explicit consent.


## Optional-calendar scheduling verification — 3 November 2026

Both admin and super-admin schedule/reschedule tests pass with Google configured
and no interviewer calendar grant. Coverage also checks reconnect-required and
sign-in-only accounts, later connection followed by event creation on reschedule,
actual connected-calendar conflicts, minimal org-scoped staff metadata, and role
denials. UI checks cover hidden availability for unconnected staff, named connected
staff, selection across paging/filtering, and aborting stale availability requests.
All 267 frontend tests and 1,953 backend tests passed (one pre-existing skip;
83.21% backend coverage). Five recruitment browser journeys passed, including
manual scheduling/rescheduling and the shared calendar. TypeScript/lint and build
checks pass. The running V2 API includes the updated staff metadata route and the
local frontend serves the optional controls. No live test booking, invitation or
calendar provider call was made. No schema, migration, permission or setting added.

Existing Google-event cleanup restrictions remain for linked interviews with an
unresolved previous event; connected-calendar provider failures are shown rather
than claiming that the interviewer is free. Connecting later applies to subsequent
scheduling/rescheduling; this change does not backfill past bookings automatically.
