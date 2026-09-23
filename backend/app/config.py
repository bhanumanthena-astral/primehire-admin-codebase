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
    mongodb_uri: str = ""
    mongodb_database: str = "primehire"

    primehire_base_url: str = "https://api.placement.vils.ai/primehire/api/v1"
    primehire_access_key: str = ""
    primehire_secret_key: str = ""

    allowed_origins: str = ""
    proxy_origin: str = ""

    # Server-side secret guarding POST /api/migration/import. Empty = disabled.
    # NEVER put this in React, NEVER log it.
    migration_secret: str = ""

    @property
    def has_mongo(self) -> bool:
        return bool(self.mongodb_uri.strip())

    @property
    def has_primehire_credentials(self) -> bool:
        return bool(self.primehire_access_key.strip() and self.primehire_secret_key.strip())

    @property
    def extra_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


settings = Settings()
