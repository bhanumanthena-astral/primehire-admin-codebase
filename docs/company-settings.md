# Company settings

Super admins open **Team & Access → Company settings** on the relevant company card.
Company administrators and other roles cannot read or modify the credentials or company permission ceiling.
View-as sessions cannot write these settings.

Each company can have its own ZeptoMail Send Mail token, sender address and sender name.
The sender domain must be verified in the corresponding ZeptoMail account. Saving settings does not verify provider acceptance or send email.
Tokens can be pasted raw or with the `Zoho-enczapikey` prefix. Leave the field blank to keep a saved token.
Disable delivery to reveal the option to remove the saved token.

Credentials are Fernet-encrypted using the existing `OUTBOX_ENCRYPTION_KEY`, bound to the company ID, and stored in the private `company_settings` collection/table.
Keep that encryption key persistent across application and worker restarts; replacing it without migrating ciphertext prevents decryption.
Read responses expose only `apiKeyConfigured`. Generic organization settings and company-directory responses do not contain credential ciphertext.
Settings updates use a revision check to reject conflicting writes. Audit records contain no credentials.

The existing `default` organization retains platform email settings until explicitly changed.
Other companies default to disabled delivery until the super admin configures their credentials; they never fall back to another company's sender.
Assessment, job notification, manual assessment email, interview invitation and reminder delivery resolve credentials from their own company ID.
Existing dry-run and recipient-allowlist protections still apply. No new environment variables or destructive migrations are required.

Company permissions restrict existing role and individual grants; checking a box never grants a member access beyond their role.
Super admins retain full access. Changes are read on subsequent API requests and supported background-worker authorization checks.
Existing companies without a permission policy keep their current grants. Requests already running can complete under the access checked when they began.

Verification: `backend/tests/test_company_settings.py` covers root-only access, encrypted write-only tokens, preservation/removal, revision conflicts, company policy enforcement, invalid ciphertext and cross-company provider routing.
The same tests can run against the isolated PostgreSQL validation database using the existing `ELITEHR_TEST_POSTGRES_ENV` fixture.
Frontend tests cover settings controls, key replacement/removal, permission updates, conflict messages and super-admin-only visibility.


## Local delivery testing

Normal `scripts/start_e2e_local.ps1` startup runs email in dry-run mode, regardless of ambient live-mail settings. For an explicitly authorized real test, pass `-TestEmailRecipient` with one exact email address. This restarts the local API/workers with both assessment and recruitment allowlists restricted to that address. Other recipients remain blocked. Running the launcher again without this option returns to dry-run and restarts services when the mode changes. The existing configured Zepto sender and encrypted company configuration paths are reused; no credential is written to source or logs.

Verification on 2026-11-18: the configured Nxtagent sender successfully sent one authorized configuration test through the encrypted outbox and ZeptoMail. Provider acceptance was recorded, and the user confirmed inbox receipt. CCC still requires its own company sender/key configuration. Nine mail-mode/company/recruitment regression tests passed; PowerShell launcher syntax passed. This test did not send candidate invitations.
