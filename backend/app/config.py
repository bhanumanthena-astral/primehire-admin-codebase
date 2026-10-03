"""PrimeHire application backend (FastAPI + MongoDB Atlas)."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path so backend/.env is honored regardless of process CWD
# (e.g. `uvicorn app.main:app --app-dir backend` run from the repo root).
_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Environment-driven configuration. Secrets never leave the server."""

    model_config = SettingsConfigDict(env_file=_BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "primehire-backend"
    # local | development | test | staging | production (alias APP_ENV accepted)
    env: str = "local"
    debug: bool = False
    mongodb_uri: str = ""
    mongodb_database: str = "primehire"

    primehire_base_url: str = "https://api.placement.vils.ai/primehire/api/v1"
    primehire_access_key: str = ""
    primehire_secret_key: str = ""

    allowed_origins: str = ""
    proxy_origin: str = ""

    # Auth (required in production; auth routes land with the feature).
    jwt_secret: str = ""

    # Writable dir for uploads/resumes/storage (see §3). Relative paths resolve
    # against the backend dir; absolute paths are used as-is.
    storage_dir: str = ""

    # Optional Sentry-compatible DSN for error tracking (empty = disabled).
    sentry_dsn: str = ""

    # Server-side secret guarding POST /api/migration/import. Empty = disabled.
    # NEVER put this in React, NEVER log it.
    migration_secret: str = ""

    # --- Phase 2: resume pipeline / LLM / outbox / uploads ---
    # LLM provider adapter: "openrouter" (free tier) — swappable later.
    # The model name comes ONLY from OPENROUTER_MODEL env; nothing is
    # hardcoded. Empty = LLM disabled → deterministic scores + visible flag.
    llm_provider: str = "openrouter"
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    # Max concurrent LLM calls (free-tier rate-limit guard). Slice B enforces.
    llm_concurrency: int = 2

    # Fernet key (base64 urlsafe 32 bytes) encrypting email_outbox bodies.
    # REQUIRED in production. Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    outbox_encryption_key: str = ""

    # Backend ZeptoMail sender (server-side only, never the browser).
    zeptomail_api_key: str = ""
    email_from_address: str = "noreply@nxtagent.ai"
    email_from_name: str = "PrimeHire Careers"

    # Slice C safety: dry-run records (never sends) unless explicitly off.
    # Default true everywhere; production REFUSES dry-run (must really send).
    email_dry_run: bool = True
    # Comma-separated emails or @domains allowed real sends in non-production
    # when dry-run is off. Empty + dry-run off + non-prod = startup failure.
    email_test_recipient_allowlist: str = ""

    # Completion-sync sweep knobs (Slice C).
    assessment_sync_batch: int = 20
    assessment_sync_interval_s: int = 300

    # Upload caps (§3). Enforced pre-read via Content-Length + streaming cap.
    upload_max_mb: int = 5
    upload_batch_max: int = 10
    # Total uncompressed cap for DOCX (zip) members — zip-bomb guard.
    upload_max_uncompressed_mb: int = 20

    # ClamAV hook: interface + quarantined status ship in Phase 2;
    # real clamd integration lands in Phase 7.
    clamav_enabled: bool = False

    # DPDP retention (days) — retentionUntil = now + this on upload.
    retention_days: int = 365

    @property
    def has_mongo(self) -> bool:
        return bool(self.mongodb_uri.strip())

    @property
    def has_primehire_credentials(self) -> bool:
        return bool(self.primehire_access_key.strip() and self.primehire_secret_key.strip())

    @property
    def extra_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def test_recipient_allowlist(self) -> list[str]:
        return [o.strip().lower() for o in self.email_test_recipient_allowlist.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.env.strip().lower() in ("production", "prod")

    @property
    def resolved_storage_dir(self):
        """Absolute storage path (default: <backend>/storage)."""
        from pathlib import Path as _Path

        raw = (self.storage_dir or "").strip()
        if not raw:
            return _BACKEND_DIR / "storage"
        p = _Path(raw)
        return p if p.is_absolute() else (_BACKEND_DIR / p)


settings = Settings()


# Fail-fast production validation (§2.7). Names only in messages — never values.
_WEAK_JWT_SECRETS = frozenset({
    "changeme", "secret", "password", "test", "testing", "12345678",
    "your_jwt_secret", "replace_me", "replace-me", "example",
})


def validate_settings(candidate: Settings | None = None) -> None:
    """Raise RuntimeError (blocking boot) when config is missing/insecure.

    Production requires the full checklist. Non-production passes except one
    guardrail: EMAIL_DRY_RUN=false demands a non-empty allowlist, so a real
    send can never fire at an unnamed audience by misconfiguration.
    """
    target = candidate if candidate is not None else settings
    # Non-production guardrail (always enforced): a real send must name test recipients.
    if (not target.is_production and not target.email_dry_run
            and not [o for o in target.email_test_recipient_allowlist.split(",") if o.strip()]):
        raise RuntimeError(
            "Refusing to boot: EMAIL_DRY_RUN=false with an empty "
            "EMAIL_TEST_RECIPIENT_ALLOWLIST outside production. Keep dry-run on, "
            "or list the test recipient emails/domains."
        )
    if not target.is_production:
        return
    problems: list[str] = []
    if not target.mongodb_uri.strip():
        problems.append("MONGODB_URI is required in production")
    secret = target.jwt_secret or ""
    if len(secret) < 32 or secret.strip().lower() in _WEAK_JWT_SECRETS:
        problems.append("JWT_SECRET must be set in production (>=32 chars, not a default/placeholder)")
    origins = [o.strip() for o in target.allowed_origins.split(",") if o.strip()]
    if not origins:
        problems.append("ALLOWED_ORIGINS must list explicit origins in production")
    if "*" in origins:
        problems.append("ALLOWED_ORIGINS must not contain '*' in production")
    if target.debug:
        problems.append("DEBUG must be false in production")
    # Phase 2 production guards (names only in messages — never values).
    if not (target.outbox_encryption_key or "").strip():
        problems.append("OUTBOX_ENCRYPTION_KEY must be set in production")
    if not (target.zeptomail_api_key or "").strip():
        problems.append("ZEPTOMAIL_API_KEY must be set in production")
    if not (target.email_from_address or "").strip():
        problems.append("EMAIL_FROM_ADDRESS must be set in production")
    if not (target.email_from_name or "").strip():
        problems.append("EMAIL_FROM_NAME must be set in production")
    if target.email_dry_run:
        problems.append("EMAIL_DRY_RUN must be false in production")
    if target.upload_max_mb < 1 or target.upload_max_mb > 25:
        problems.append("UPLOAD_MAX_MB must be between 1 and 25 in production")
    if target.upload_batch_max < 1 or target.upload_batch_max > 50:
        problems.append("UPLOAD_BATCH_MAX must be between 1 and 50 in production")
    if target.llm_concurrency < 1 or target.llm_concurrency > 8:
        problems.append("LLM_CONCURRENCY must be between 1 and 8 in production")
    if target.retention_days < 30:
        problems.append("RETENTION_DAYS must be at least 30 in production")
    if problems:
        raise RuntimeError("Production config invalid: " + "; ".join(problems))
