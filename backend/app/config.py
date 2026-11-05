"""PrimeHire application backend (FastAPI + MongoDB Atlas)."""

from pathlib import Path
from pydantic import Field

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
    google_oauth_enabled: bool = False
    google_client_id: str = Field(default="", repr=False)
    google_client_secret: str = Field(default="", repr=False)
    google_redirect_uri: str = "http://localhost:3000/api/auth/google/callback"
    google_login_org_id: str = "default"
    google_token_encryption_key: str = Field(default="", repr=False)
    google_calendar_daily_limit: int = 10000
    recruitment_portals_enabled: bool = False
    recruitment_outbox_encryption_key: str = Field(default="", repr=False)
    recruitment_zeptomail_api_key: str = Field(default="", repr=False)
    recruitment_email_dry_run: bool | None = None
    recruitment_email_test_recipient_allowlist: str = ""
    mongodb_uri: str = Field(default="", repr=False)
    mongodb_database: str = "primehire"
    database_backend: str = "mongodb"
    postgres_url: str = Field(default="", repr=False)
    postgres_schema: str = "elitehr"

    primehire_base_url: str = "https://api.placement.vils.ai/primehire/api/v1"
    primehire_access_key: str = Field(default="", repr=False)
    primehire_secret_key: str = Field(default="", repr=False)

    allowed_origins: str = ""
    proxy_origin: str = ""

    # Auth (required in production; auth routes land with the feature).
    jwt_secret: str = Field(default="", repr=False)

    # Writable dir for uploads/resumes/storage (see §3). Relative paths resolve
    # against the backend dir; absolute paths are used as-is.
    storage_dir: str = ""
    report_media_allowed_hosts: str = ""

    # Optional Sentry-compatible DSN for error tracking (empty = disabled).
    sentry_dsn: str = Field(default="", repr=False)

    # Server-side secret guarding POST /api/migration/import. Empty = disabled.
    # NEVER put this in React, NEVER log it.
    migration_secret: str = Field(default="", repr=False)

    # --- Phase 2: resume pipeline / LLM / outbox / uploads ---
    # LLM provider adapter: "openrouter" (free tier) — swappable later.
    # The model name comes ONLY from OPENROUTER_MODEL env; nothing is
    # hardcoded. Empty = LLM disabled → deterministic scores + visible flag.
    llm_provider: str = "openrouter"
    openrouter_api_key: str = Field(default="", repr=False)
    openrouter_model: str = ""
    # Max concurrent LLM calls (free-tier rate-limit guard). Slice B enforces.
    llm_concurrency: int = 2

    # --- LLM resilience Tier 1 (dispatch hardening; all have safe defaults) ---
    # Background LLM retries: attempts cap + total age cap before the
    # deterministic fallback wins (visible flag, never silent).
    llm_job_max_attempts: int = 12
    llm_job_max_age_hours: int = 6
    # Stage decisions wait this long for a deferred LLM before deciding on
    # the deterministic score (a late LLM then only annotates / needsReview).
    llm_wait_seconds: int = 120
    # Shared token bucket per provider+model (Mongo-atomic take; interactive
    # calls keep a reserved share so bulk batches can't starve them).
    llm_rpm: int = 30
    llm_burst: int = 5
    llm_interactive_reserve: float = 0.25
    # Circuit breaker per provider+model (consecutive 429/5xx → open).
    llm_breaker_threshold: int = 5
    llm_breaker_cooldown_s: int = 300
    # Borderline band around the job threshold: without a usable LLM score,
    # candidates inside ±margin go to needsReview instead of auto-pool.
    llm_borderline_margin: int = 10
    # Dev-only fake provider for 429 drills ("off" | "mixed" | "down").
    # REFUSED in production (startup failure).
    llm_fake_provider: str = "off"
    llm_fake_failure_rate: float = 0.5
    llm_fake_retry_after_s: int = 5

    # Fernet key (base64 urlsafe 32 bytes) encrypting email_outbox bodies.
    # REQUIRED in production. Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    outbox_encryption_key: str = Field(default="", repr=False)

    # Backend ZeptoMail sender (server-side only, never the browser).
    zeptomail_api_key: str = Field(default="", repr=False)
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
    assessment_sync_interval_s: int = 60

    # Automatic job closure sweep in the background worker (Slice V1).
    jobs_auto_close_interval_s: int = 60

    # Upload caps (§3). Enforced pre-read via Content-Length + streaming cap.
    upload_max_mb: int = 5
    upload_batch_max: int = 10
    # Module 2 is explicitly opt-in; the V2 launcher enables it only in V2.
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_graph_version: str = ""
    whatsapp_template_name: str = ""
    whatsapp_template_language: str = "en_US"
    whatsapp_price_per_message: float = 0
    whatsapp_currency: str = "INR"
    resume_module_v2_enabled: bool = False
    resume_identity_secret: str = Field(default="", repr=False)
    resume_clamd_host: str = "127.0.0.1"
    resume_clamd_port: int = 3310
    resume_scan_timeout_s: int = 30
    resume_ocr_tessdata: str = ""
    resume_doc_converter: str = ""
    # Opt-in, single-host Oracle free deployment profile.
    free_tier_guard_enabled: bool = False
    resource_guard_enabled: bool = False
    free_tier_active_resume_limit: int = 1000
    resume_kafka_enabled: bool = False
    resume_kafka_bootstrap_servers: str = "127.0.0.1:9092"
    resume_worker_concurrency: int = 2
    resume_upload_concurrency: int = 32
    # Optional ATS-only model override; legacy workflows keep OPENROUTER_MODEL.
    resume_ats_model: str = ''
    # Total uncompressed cap for DOCX (zip) members — zip-bomb guard.
    upload_max_uncompressed_mb: int = 20

    # Shared JD/resume scanner uses the configured private ClamAV INSTREAM service.
    clamav_enabled: bool = False

    # DPDP retention (days) — retentionUntil = now + this on upload.
    retention_days: int = 365

    @property
    def has_mongo(self) -> bool:
        return bool(self.postgres_url.strip()) if self.database_backend == "postgresql" else bool(self.mongodb_uri.strip())

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
    if target.google_oauth_enabled:
        if target.mongodb_database != 'primehire_admin_v2':
            raise RuntimeError('Google workspace requires the isolated V2 database.')
        from urllib.parse import urlsplit
        from cryptography.fernet import Fernet
        if not target.google_client_id.strip() or not target.google_client_secret.strip():
            raise RuntimeError('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for Google OAuth.')
        try:
            Fernet(target.google_token_encryption_key.encode())
        except (ValueError, TypeError):
            raise RuntimeError('GOOGLE_TOKEN_ENCRYPTION_KEY must be a valid Fernet key.') from None
        redirect = urlsplit(target.google_redirect_uri)
        if (redirect.path != '/api/auth/google/callback' or redirect.query or redirect.fragment
                or redirect.username or redirect.password or not redirect.hostname
                or (redirect.scheme != 'https' and not (
                    not target.is_production and redirect.scheme == 'http'
                    and redirect.hostname in {'localhost', '127.0.0.1'}))):
            raise RuntimeError('GOOGLE_REDIRECT_URI must be the registered HTTPS callback (localhost HTTP allowed in development).')
        if not target.google_login_org_id.strip() or not 1 <= target.google_calendar_daily_limit <= 10000:
            raise RuntimeError('Google login organization and Calendar daily limit (1–10000) are required.')
    if target.recruitment_portals_enabled and target.mongodb_database != 'primehire_admin_v2':
        raise RuntimeError('Recruitment portals require the isolated V2 database.')
    if target.recruitment_portals_enabled and target.recruitment_email_dry_run is False:
        if not (target.recruitment_zeptomail_api_key or target.zeptomail_api_key).strip():
            raise RuntimeError('Recruitment email requires RECRUITMENT_ZEPTOMAIL_API_KEY or ZEPTOMAIL_API_KEY.')
        if not target.is_production and not (target.recruitment_email_test_recipient_allowlist or target.email_test_recipient_allowlist).strip():
            raise RuntimeError('RECRUITMENT_EMAIL_TEST_RECIPIENT_ALLOWLIST is required for real recruitment email outside production.')
    if target.recruitment_portals_enabled and target.recruitment_outbox_encryption_key:
        try:
            from cryptography.fernet import Fernet
            Fernet(target.recruitment_outbox_encryption_key.strip().encode())
        except (ValueError, TypeError):
            raise RuntimeError('RECRUITMENT_OUTBOX_ENCRYPTION_KEY must be a valid Fernet key.') from None
    if target.resume_module_v2_enabled:
        import re
        if target.resume_ats_model and not re.fullmatch(r'[A-Za-z0-9_.:/-]{1,200}',target.resume_ats_model):
            raise RuntimeError('RESUME_ATS_MODEL must be a valid provider model identifier (max 200 characters).')
        if target.mongodb_database != "primehire_admin_v2":
            raise RuntimeError("Module 2 requires the isolated V2 database.")
        if not 1 <= target.resume_worker_concurrency <= 8 or not 1 <= target.resume_upload_concurrency <= 64:
            raise RuntimeError("Resume worker/upload concurrency is outside safe bounds.")
        if not 1 <= target.resume_scan_timeout_s <= 60 or not 1 <= target.resume_clamd_port <= 65535:
            raise RuntimeError("Resume scanner configuration is outside safe bounds.")
        if target.is_production and len(target.resume_identity_secret) < 32:
            raise RuntimeError("RESUME_IDENTITY_SECRET must be set in production (>=32 characters).")
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
    if target.database_backend not in {"mongodb", "postgresql"}:
        problems.append("DATABASE_BACKEND must be mongodb or postgresql")
    if target.database_backend == "postgresql":
        from urllib.parse import urlsplit
        import re
        try:
            parsed = urlsplit(target.postgres_url)
            valid = parsed.scheme in {"postgresql", "postgres"} and parsed.hostname and parsed.username and parsed.password and parsed.path not in {"", "/"}
        except ValueError:
            valid = False
        if not valid:
            problems.append("POSTGRES_URL must be a complete authenticated PostgreSQL URL")
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", target.postgres_schema):
            problems.append("POSTGRES_SCHEMA must be a valid SQL identifier")
        if target.mongodb_database != "primehire_admin_v2":
            problems.append("PostgreSQL is restricted to the isolated V2 database")
    elif not target.mongodb_uri.strip():
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
    if target.llm_fake_provider.strip().lower() != "off":
        problems.append("LLM_FAKE_PROVIDER must be 'off' in production")
    for var, value, lo, hi in (
        ("LLM_JOB_MAX_ATTEMPTS", target.llm_job_max_attempts, 1, 100),
        ("LLM_JOB_MAX_AGE_HOURS", target.llm_job_max_age_hours, 1, 72),
        ("LLM_WAIT_SECONDS", target.llm_wait_seconds, 10, 3600),
        ("LLM_RPM", target.llm_rpm, 1, 1000),
        ("LLM_BURST", target.llm_burst, 1, 100),
        ("LLM_BREAKER_THRESHOLD", target.llm_breaker_threshold, 2, 50),
        ("LLM_BREAKER_COOLDOWN_S", target.llm_breaker_cooldown_s, 30, 3600),
        ("LLM_BORDERLINE_MARGIN", target.llm_borderline_margin, 0, 50),
        ("LLM_FAKE_RETRY_AFTER_S", target.llm_fake_retry_after_s, 0, 300),
    ):
        try:
            ok = lo <= float(value) <= hi
        except (TypeError, ValueError):
            ok = False
        if not ok:
            problems.append(f"{var} must be between {lo} and {hi} in production")
    if not 0.0 <= float(target.llm_interactive_reserve or 0) <= 0.9:
        problems.append("LLM_INTERACTIVE_RESERVE must be between 0 and 0.9 in production")
    if not 0.0 <= float(target.llm_fake_failure_rate or 0) <= 1.0:
        problems.append("LLM_FAKE_FAILURE_RATE must be between 0 and 1 in production")
    if target.retention_days < 30:
        problems.append("RETENTION_DAYS must be at least 30 in production")
    if problems:
        raise RuntimeError("Production config invalid: " + "; ".join(problems))
