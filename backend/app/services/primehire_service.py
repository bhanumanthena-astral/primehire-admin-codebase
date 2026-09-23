"""Server-to-server PrimeHire client configuration.

Network calls (fetch/validate/normalize) land in Phase 4-6; this module owns
the non-network pieces now: base-URL resolution and auth headers, so routes
and future services share one definition and secrets never touch the client.
"""

from __future__ import annotations


def resolve_base_url(configured: str, default: str) -> str:
    base = (configured or default).strip().rstrip("/")
    return base or default


def auth_headers(access_key: str, secret_key: str) -> dict[str, str]:
    """Server-side credential headers. Callers must never log these values."""
    return {
        "Content-Type": "application/json",
        "x-access-key": access_key.strip(),
        "x-secret-key": secret_key.strip(),
    }


def has_credentials(access_key: str, secret_key: str) -> bool:
    return bool(access_key.strip() and secret_key.strip())
